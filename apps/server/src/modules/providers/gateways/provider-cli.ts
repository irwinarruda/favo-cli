import type { LoginState } from '@favo/contracts/rpc/views';
import type { ProviderId } from '@favo/domain/providers/provider';
import { LimitsUnavailableReason, type SeatLimits, unavailableLimits } from '@favo/domain/usage/seat-limits';
import type { FileSystem } from '@/modules/system/gateways/file-system';
import type { PipedProcess } from '@/modules/system/gateways/process-runner';

export type ProviderSession = { binary: string; env: Record<string, string | undefined>; cwd?: string };
export type ProviderLogin = { login: LoginState; identity?: string; plan?: string };
export type LaunchEnvironment = { env: Record<string, string>; unsetEnv: string[] };

export type LoginContext = { isOverSsh: boolean };
export type ThreadSearch = { session: ProviderSession; seatHome: string; directory: string };
export type FoundThread = { id: string; directory: string; updatedAt: string };
export type UpdateSwitchSearch = {
  env: Record<string, string | undefined>;
  home: string;
  configHome: string;
};

export abstract class ProviderCli {
  abstract readonly id: ProviderId;
  abstract status(session: ProviderSession): Promise<ProviderLogin>;
  abstract loginArguments(context: LoginContext): string[];
  abstract logoutArguments(): string[] | undefined;

  async isolationArguments(_session: ProviderSession): Promise<string[]> {
    return [];
  }

  launchEnvironment(_current: Record<string, string | undefined>): LaunchEnvironment {
    return { env: {}, unsetEnv: [] };
  }

  limitsEnvironment(current: Record<string, string | undefined>) {
    return this.launchEnvironment(current);
  }

  async limits(_session: ProviderSession, checkedAt: string): Promise<SeatLimits> {
    return unavailableLimits(checkedAt, LimitsUnavailableReason.unsupported);
  }

  async recentThreads(_search: ThreadSearch, _fileSystem: FileSystem): Promise<FoundThread[]> {
    return [];
  }

  async updateSwitch(_search: UpdateSwitchSearch, _fileSystem: FileSystem): Promise<string | undefined> {
    return undefined;
  }

  protected async ask<Message, Answer>(
    server: PipedProcess,
    requests: unknown[],
    answerOf: (message: Message) => Answer | undefined,
    timeoutMs: number
  ) {
    const { promise, resolve } = Promise.withResolvers<Answer | undefined>();
    const timer = setTimeout(() => resolve(undefined), timeoutMs);
    server.onLine((line) => {
      const message = parseLine<Message>(line);
      const answer = message === undefined ? undefined : answerOf(message);
      if (answer !== undefined) resolve(answer);
    });
    void server.exited.then(() => resolve(undefined));
    for (const request of requests) server.write(JSON.stringify(request));
    const answer = await promise;
    clearTimeout(timer);
    server.kill();
    return answer;
  }
}

function parseLine<Message>(line: string) {
  try {
    return JSON.parse(line) as Message;
  } catch {
    return undefined;
  }
}
