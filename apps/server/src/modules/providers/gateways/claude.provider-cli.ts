import { LoginState } from '@favo/contracts/rpc/views';
import { ProviderId, Providers } from '@favo/domain/providers/provider';
import { parseJson } from '@favo/domain/shared/parse-json';
import { LimitsUnavailableReason, unavailableLimits } from '@favo/domain/usage/seat-limits';
import { z } from 'zod';
import {
  type LaunchEnvironment,
  ProviderCli,
  type ProviderSession,
  type UpdateSwitchSearch,
} from '@/modules/providers/gateways/provider-cli';
import { type ClaudeLimitsResponse, claudeLimitsOf } from '@/modules/providers/utils/claude-limits';
import type { FileSystem } from '@/modules/system/gateways/file-system';
import type { ProcessRunner } from '@/modules/system/gateways/process-runner';

const StatusTimeoutMs = 15_000;
const LimitsTimeoutMs = 10_000;
const PersonalOrganizationSuffix = "'s Organization";
const AmbientVariable = /^(?:CLAUDE|ANTHROPIC|HERDR)/i;
const SwitchedOnValues = ['1', 'true', 'yes', 'on'];
const ClaudeSettings = z.object({ env: z.record(z.string(), z.unknown()).optional() });
const LimitsRequestId = 'usage';
const LimitsArguments = [
  '-p',
  '--input-format',
  'stream-json',
  '--output-format',
  'stream-json',
  '--verbose',
  '--no-session-persistence',
  '--setting-sources',
  'local',
];
const LimitsRequests = [
  { type: 'control_request', request_id: 'init', request: { subtype: 'initialize' } },
  {
    type: 'control_request',
    request_id: LimitsRequestId,
    request: { subtype: 'get_usage', skip_behaviors: true },
  },
];

export class ClaudeProviderCli extends ProviderCli {
  readonly id = ProviderId.claude;

  constructor(
    private readonly processes: ProcessRunner,
    private readonly limitsTimeoutMs = LimitsTimeoutMs
  ) {
    super();
  }

  async status(session: ProviderSession) {
    const result = await this.processes.run({
      command: session.binary,
      args: ['auth', 'status'],
      env: session.env,
      timeoutMs: StatusTimeoutMs,
    });
    const status = parseStatus(result.stdout);
    if (!status) return { login: LoginState.unknown };
    if (!status.loggedIn) return { login: LoginState.signedOut };
    return { login: LoginState.signedIn, identity: status.email ?? undefined, plan: planOf(status) };
  }

  loginArguments() {
    return ['auth', 'login'];
  }

  logoutArguments() {
    return ['auth', 'logout'];
  }

  override launchEnvironment(current: Record<string, string | undefined>): LaunchEnvironment {
    if (!current.TMUX) return { env: {}, unsetEnv: [] };
    return { env: { TERM: 'xterm-256color' }, unsetEnv: ['TMUX'] };
  }

  override limitsEnvironment(current: Record<string, string | undefined>) {
    const { env, unsetEnv } = this.launchEnvironment(current);
    return { env, unsetEnv: [...unsetEnv, ...Object.keys(current).filter((name) => AmbientVariable.test(name))] };
  }

  override async updateSwitch({ env, home }: UpdateSwitchSearch, fileSystem: FileSystem) {
    const text = await fileSystem.readText(`${env.CLAUDE_CONFIG_DIR ?? `${home}/.claude`}/settings.json`);
    const settings = ClaudeSettings.safeParse(parseJson(text ?? '{}')).data;
    const switches = Providers.claude.update.switches ?? [];
    return switches.find((name) => isSwitchedOn(env[name]) || isSwitchedOn(settings?.env?.[name]));
  }

  override async limits({ binary, env, cwd }: ProviderSession, checkedAt: string) {
    const server = this.processes.open({ command: binary, args: LimitsArguments, env, cwd });
    const answer = await this.ask(server, LimitsRequests, limitsAnswerOf, this.limitsTimeoutMs);
    if (!answer)
      return unavailableLimits(checkedAt, LimitsUnavailableReason.probeFailed, 'Claude Code did not answer.');
    return claudeLimitsOf(answer.response, checkedAt);
  }
}

type ControlMessage = {
  type?: string;
  response?: { request_id?: string; response?: ClaudeLimitsResponse };
} | null;

function limitsAnswerOf(message: ControlMessage) {
  const isAnswer = message?.type === 'control_response' && message.response?.request_id === LimitsRequestId;
  return isAnswer ? message.response : undefined;
}

type ClaudeStatus = { loggedIn?: boolean; email?: string | null; orgName?: string; subscriptionType?: string };

function parseStatus(stdout: string) {
  try {
    return JSON.parse(stdout) as ClaudeStatus;
  } catch {
    return undefined;
  }
}

function planOf(status: ClaudeStatus) {
  const organization = status.orgName?.endsWith(PersonalOrganizationSuffix) ? undefined : status.orgName;
  const parts = [status.subscriptionType, organization].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

function isSwitchedOn(value: unknown) {
  return SwitchedOnValues.includes(String(value).toLowerCase());
}
