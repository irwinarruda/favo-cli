import { type RpcRequest, RpcResponse } from '@favo/contracts/rpc/envelope';
import { isTokenCount } from '@favo/contracts/rpc/usage/read-token-usage';
import { type Machine, RemoteSystem, remoteBinaryOf } from '@favo/domain/machines/machine';
import { stripControlCharacters, stripControlCharactersDeep } from '@favo/domain/shared/control-characters';
import { DomainError, DomainErrorCode } from '@favo/domain/shared/domain-error';
import { RemoteBackends } from '@/modules/machines/gateways/remote-backends';
import type { Ssh } from '@/modules/machines/gateways/ssh';
import type { PipedProcess } from '@/modules/system/gateways/process-runner';

const RequestTimeoutMs = 45_000;
const TokenCountTimeoutMs = 15 * 60_000;
const MissingCommandCode = 127;
const SshFailureCode = 255;

type Pending = { originalId: number; resolve(response: RpcResponse): void; reject(error: Error): void };
type Connection = { process: PipedProcess; pending: Map<number, Pending> };

export class SshRemoteBackends extends RemoteBackends {
  private readonly connections = new Map<string, Connection>();
  private nextId = 1;

  constructor(
    private readonly ssh: Ssh,
    private readonly requestTimeoutMs = RequestTimeoutMs,
    private readonly tokenCountTimeoutMs = TokenCountTimeoutMs
  ) {
    super();
  }

  request(machine: Machine, request: RpcRequest) {
    const connection = this.connectionOf(machine);
    const wireId = this.nextId++;
    return new Promise<RpcResponse>((resolve, reject) => {
      const timer = setTimeout(
        () => {
          const silence = new DomainError(DomainErrorCode.machineUnreachable, `${machine.name} did not answer.`);
          this.failConnection(machine, connection, silence);
        },
        isTokenCount(request) ? this.tokenCountTimeoutMs : this.requestTimeoutMs
      );
      connection.pending.set(wireId, {
        originalId: request.id,
        resolve(response) {
          clearTimeout(timer);
          resolve(response);
        },
        reject(error) {
          clearTimeout(timer);
          reject(error);
        },
      });
      connection.process.write(JSON.stringify({ ...request, id: wireId, machineId: undefined }));
    });
  }

  close(machineId: string) {
    this.connections.get(machineId)?.process.kill();
    this.connections.delete(machineId);
  }

  closeAll() {
    for (const machineId of [...this.connections.keys()]) this.close(machineId);
  }

  private connectionOf(machine: Machine) {
    const existing = this.connections.get(machine.id);
    if (existing) return existing;
    const process = this.ssh.open(machine.target!, `${remoteBinaryOf(machine.system)} serve --stdio`);
    const connection: Connection = { process, pending: new Map() };
    this.connections.set(machine.id, connection);
    process.onLine((line) => settleResponse(connection, line));
    void process.exited.then((exit) => this.failConnection(machine, connection, connectionErrorOf(machine, exit)));
    return connection;
  }

  private failConnection(machine: Machine, connection: Connection, error: DomainError) {
    if (this.connections.get(machine.id) === connection) this.connections.delete(machine.id);
    connection.process.kill();
    for (const pending of connection.pending.values()) pending.reject(error);
    connection.pending.clear();
  }
}

function settleResponse(connection: Connection, line: string) {
  const parsed = RpcResponse.safeParse(parseRemoteJson(line));
  if (!parsed.success) return;
  const pending = connection.pending.get(parsed.data.id);
  if (!pending) return;
  connection.pending.delete(parsed.data.id);
  pending.resolve({ ...parsed.data, id: pending.originalId });
}

function parseRemoteJson(line: string) {
  try {
    return stripControlCharactersDeep(JSON.parse(line));
  } catch {
    return undefined;
  }
}

function connectionErrorOf(machine: Machine, exit: { code: number; stderr: string; failure?: string }) {
  const { code, stderr, failure } = exit;
  if (failure) return new DomainError(DomainErrorCode.machineUnreachable, `${machine.name}: ${failure}`);
  const isMissingOnWindows = machine.system === RemoteSystem.windows && code !== SshFailureCode;
  if (code === MissingCommandCode || isMissingOnWindows || /no such file|not found/i.test(stderr)) {
    return new DomainError(DomainErrorCode.machineNeedsInstall, `favo is not installed on ${machine.name} yet.`);
  }
  const reason = stripControlCharacters(stderr.trim().split('\n').at(-1) ?? '') || 'the connection closed';
  return new DomainError(DomainErrorCode.machineUnreachable, `${machine.name}: ${reason}`);
}
