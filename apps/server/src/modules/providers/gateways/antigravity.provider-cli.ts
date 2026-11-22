import { LoginState } from '@favo/contracts/rpc/views';
import { isSameDirectory } from '@favo/domain/directories/directory-input';
import { ProviderId, Providers } from '@favo/domain/providers/provider';
import { InstallMethod, installSourceOf } from '@favo/domain/updates/install-source';
import { LimitsUnavailableReason, unavailableLimits } from '@favo/domain/usage/seat-limits';
import {
  type FoundThread,
  type LaunchEnvironment,
  type LoginContext,
  ProviderCli,
  type ProviderLogin,
  type ProviderSession,
  type ThreadSearch,
  type UpdateSwitchSearch,
} from '@/modules/providers/gateways/provider-cli';
import { antigravityLimitsOf } from '@/modules/providers/utils/antigravity-limits';
import type { FileSystem } from '@/modules/system/gateways/file-system';
import type { PipedProcess, ProcessRunner } from '@/modules/system/gateways/process-runner';

const StatusTimeoutMs = 15_000;
const AuthenticateTimeoutMs = 8_000;
const LimitsTimeoutMs = 15_000;
const ThreadsTimeoutMs = 10_000;
const AuthRequiredCode = -32000;
const ConsumerAuthMethod = 'consumer';
const UpdateVariable = 'AGY_CLI_DISABLE_AUTO_UPDATE';
const WrapperExecutableVariable = 'ANTIGRAVITY_AGENTAPI_EXE';
const SwitchedOffValues = ['', '0', 'false', 'no', 'off'];
const AmbientVariable = /^(?:ANTIGRAVITY_(?:APP_DATA_DIR|CONVERSATION_ID|CSRF_TOKEN|LS_ADDRESS)|HERDR)/i;
const ApplyAuthPattern = /applyAuthResult:\s*email=([^,\s]*),\s*authMethod=([^,\s]+)/;
const AuthenticatedAsPattern = /OAuth:\s*authenticated successfully as\s+(\S+)/;
const StatusLogPattern = /^agy-status-(?:(\d+)-)?.+\.log$/;

const InitializeRequest = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'favo', version: '0' } },
};
const SessionListId = 2;
const SessionListRequest = { jsonrpc: '2.0', id: SessionListId, method: 'session/list', params: {} };
const AuthenticateId = 3;
const AuthenticateRequest = {
  jsonrpc: '2.0',
  id: AuthenticateId,
  method: 'authenticate',
  params: { methodId: 'oauth-personal' },
};

type AcpSession = { sessionId?: unknown; cwd?: unknown; updatedAt?: unknown };
type AcpTier = { name?: unknown };
type AcpMessage = {
  id?: number;
  result?: {
    sessions?: unknown;
    _meta?: { antigravity?: { tier?: AcpTier | null } | null } | null;
  } | null;
  error?: { code?: number; message?: string } | null;
} | null;

export class AntigravityProviderCli extends ProviderCli {
  readonly id = ProviderId.antigravity;
  private readonly pendingStatuses = new Map<string, Promise<ProviderLogin>>();
  private readonly activeLogs = new Set<string>();

  constructor(
    private readonly processes: ProcessRunner,
    private readonly fileSystem: FileSystem,
    private readonly logFileOf: () => string,
    private readonly statusTimeoutMs = StatusTimeoutMs,
    private readonly limitsTimeoutMs = LimitsTimeoutMs
  ) {
    super();
  }

  async status(session: ProviderSession) {
    const key = statusKeyOf(session);
    const pending = this.pendingStatuses.get(key);
    if (pending) return pending;
    const reading = this.readStatus(session).finally(() => {
      this.pendingStatuses.delete(key);
    });
    this.pendingStatuses.set(key, reading);
    return reading;
  }

  override limitsEnvironment(current: Record<string, string | undefined>): LaunchEnvironment {
    return { env: {}, unsetEnv: Object.keys(current).filter((name) => AmbientVariable.test(name)) };
  }

  override async limits({ binary, env, cwd }: ProviderSession, checkedAt: string) {
    const result = await this.processes.run({
      command: binary,
      args: ['-p', '/usage', '--output-format', 'json'],
      env,
      cwd,
      timeoutMs: this.limitsTimeoutMs,
    });
    if (result.code !== 0) {
      return unavailableLimits(checkedAt, LimitsUnavailableReason.probeFailed, 'Antigravity did not answer.');
    }
    return antigravityLimitsOf(result.stdout, checkedAt);
  }

  override async recentThreads({ session, directory }: ThreadSearch): Promise<FoundThread[]> {
    const server = this.processes.open({
      command: session.binary,
      args: ['acp', '--stdio'],
      env: session.env,
      cwd: session.cwd,
    });
    const listRequest = { jsonrpc: '2.0', id: SessionListId, method: 'session/list', params: { cwd: directory } };
    const answer = await this.ask<AcpMessage, AcpMessage>(
      server,
      [InitializeRequest, listRequest],
      (message) => (message?.id === SessionListId ? message : undefined),
      ThreadsTimeoutMs
    );
    const sessions = answer?.result?.sessions;
    if (!Array.isArray(sessions)) return [];
    return (sessions as AcpSession[]).flatMap((entry) => {
      if (
        typeof entry?.sessionId !== 'string' ||
        typeof entry.cwd !== 'string' ||
        typeof entry.updatedAt !== 'string'
      ) {
        return [];
      }
      if (!isSameDirectory(entry.cwd, directory)) return [];
      const at = Date.parse(entry.updatedAt);
      if (!Number.isFinite(at)) return [];
      return [{ id: entry.sessionId, directory: entry.cwd, updatedAt: new Date(at).toISOString() }];
    });
  }

  override async updateSwitch({ env }: UpdateSwitchSearch, fileSystem: FileSystem) {
    const value = env[UpdateVariable];
    if (value === undefined || SwitchedOffValues.includes(value.trim().toLowerCase())) return undefined;
    if (await isHomebrewWrapperSwitch(env, value, fileSystem)) return undefined;
    return UpdateVariable;
  }

  loginArguments({ isOverSsh }: LoginContext) {
    return isOverSsh ? ['acp', '--login'] : [];
  }

  logoutArguments() {
    return undefined;
  }

  private async readStatus(session: ProviderSession) {
    return (await this.readAccount(session)) ?? this.readModelsStatus(session);
  }

  private async readAccount(session: ProviderSession): Promise<ProviderLogin | undefined> {
    const logFile = await this.prepareLogFile();
    const server = this.processes.open({
      command: session.binary,
      args: ['acp', '--stdio', '--log-file', logFile],
      env: session.env,
      cwd: session.cwd,
    });
    const rpc = createAcpChannel(server);
    try {
      server.write(JSON.stringify(InitializeRequest));
      server.write(JSON.stringify(SessionListRequest));
      const listAnswer = await rpc.wait(SessionListId, this.statusTimeoutMs);
      if (!listAnswer) return undefined;
      if (listAnswer.error) {
        return isAuthRequired(listAnswer.error) ? { login: LoginState.signedOut } : undefined;
      }
      if (!listAnswer.result) return undefined;
      let logInfo = authLogOf(await this.fileSystem.readText(logFile));
      let plan: string | undefined;
      if (logInfo.authMethod === ConsumerAuthMethod) {
        server.write(JSON.stringify(AuthenticateRequest));
        const authAnswer = await rpc.wait(AuthenticateId, Math.min(this.statusTimeoutMs, AuthenticateTimeoutMs));
        plan = tierNameOf(authAnswer);
        if (!logInfo.email) logInfo = authLogOf(await this.fileSystem.readText(logFile));
      }
      return { login: LoginState.signedIn, identity: logInfo.email, plan };
    } finally {
      server.kill();
      this.activeLogs.delete(logFile);
      await this.fileSystem.unlink(logFile).catch(() => {});
    }
  }

  private async prepareLogFile() {
    const path = this.logFileOf();
    this.activeLogs.add(path);
    const slash = path.lastIndexOf('/');
    if (slash > 0) {
      const folder = path.slice(0, slash);
      await this.fileSystem.ensurePrivateDirectory(folder);
      await this.sweepStaleLogs(folder);
    }
    return path;
  }

  private async sweepStaleLogs(folder: string) {
    const names = await this.fileSystem.list(folder);
    await Promise.all(
      names.map(async (name) => {
        const matched = StatusLogPattern.exec(name);
        if (!matched) return;
        const fullPath = `${folder}/${name}`;
        if (this.activeLogs.has(fullPath)) return;
        const ownerPid = matched[1] ? Number(matched[1]) : undefined;
        if (ownerPid !== undefined && this.processes.isAlive(ownerPid)) return;
        await this.fileSystem.unlink(fullPath).catch(() => {});
      })
    );
  }

  private async readModelsStatus(session: ProviderSession): Promise<ProviderLogin> {
    const result = await this.processes.run({
      command: session.binary,
      args: ['models'],
      env: session.env,
      timeoutMs: this.statusTimeoutMs,
    });
    if (/sign in/i.test(`${result.stdout}${result.stderr}`)) return { login: LoginState.signedOut };
    return { login: result.code === 0 ? LoginState.signedIn : LoginState.unknown };
  }
}

function createAcpChannel(server: PipedProcess) {
  const buffered = new Map<number, AcpMessage>();
  const waiters = new Map<number, (message: AcpMessage | undefined) => void>();
  let isClosed = false;

  server.onLine((line) => {
    const message = parseMessage(line);
    if (!message || typeof message.id !== 'number') return;
    const resolve = waiters.get(message.id);
    if (resolve) {
      waiters.delete(message.id);
      resolve(message);
    } else {
      buffered.set(message.id, message);
    }
  });

  void server.exited.then(() => {
    isClosed = true;
    for (const resolve of waiters.values()) resolve(undefined);
    waiters.clear();
  });

  function wait(id: number, timeoutMs: number): Promise<AcpMessage | undefined> {
    const held = buffered.get(id);
    if (held !== undefined) {
      buffered.delete(id);
      return Promise.resolve(held);
    }
    if (isClosed) return Promise.resolve(undefined);
    const { promise, resolve } = Promise.withResolvers<AcpMessage | undefined>();
    const timer = setTimeout(() => {
      waiters.delete(id);
      resolve(undefined);
    }, timeoutMs);
    waiters.set(id, (message) => {
      clearTimeout(timer);
      resolve(message);
    });
    return promise;
  }

  return { wait };
}

function parseMessage(line: string): AcpMessage | undefined {
  try {
    return JSON.parse(line) as AcpMessage;
  } catch {
    return undefined;
  }
}

function isAuthRequired(error: { code?: number; message?: string }) {
  return error.code === AuthRequiredCode || /authentication required/i.test(error.message ?? '');
}

function authLogOf(text: string | undefined) {
  if (!text) return { email: undefined, authMethod: undefined };
  let email: string | undefined;
  let authMethod: string | undefined;
  for (const line of text.split('\n')) {
    const applied = ApplyAuthPattern.exec(line);
    if (applied) {
      if (applied[1]) email = applied[1];
      if (applied[2]) authMethod = applied[2];
    }
    const logged = AuthenticatedAsPattern.exec(line);
    if (logged?.[1]) email = logged[1];
  }
  return { email, authMethod };
}

function tierNameOf(message: AcpMessage | undefined) {
  const name = message?.result?._meta?.antigravity?.tier?.name;
  return typeof name === 'string' && name.trim().length > 0 ? name.trim() : undefined;
}

function statusKeyOf({ binary, env }: ProviderSession) {
  return `${binary}\n${env.HOME ?? ''}\n${env.USERPROFILE ?? ''}`;
}

async function isHomebrewWrapperSwitch(env: Record<string, string | undefined>, value: string, fileSystem: FileSystem) {
  if (value !== 'true') return false;
  const executable = env[WrapperExecutableVariable];
  if (!executable) return false;
  const resolved = installSourceOf(executable) ?? installSourceOf(await fileSystem.realPath(executable));
  return (
    resolved?.method === InstallMethod.homebrew && Providers.antigravity.update.packages.includes(resolved.packageName)
  );
}
