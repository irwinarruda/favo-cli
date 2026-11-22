import { LoginState } from '@favo/contracts/rpc/views';
import { isPersonalAccount, seatHomeOf } from '@favo/domain/accounts/account';
import { isolationEnvironment, type ProviderId, Providers } from '@favo/domain/providers/provider';
import { DomainError, DomainErrorCode } from '@favo/domain/shared/domain-error';
import type { ProviderCli } from '@/modules/providers/gateways/provider-cli';
import type { ProcessRunner } from '@/modules/system/gateways/process-runner';
import type { ShellEnvironment } from '@/modules/system/gateways/shell-environment';
import type { FavoPaths } from '@/shared/config/favo-paths';

export type ProviderClis = Record<ProviderId, ProviderCli>;

export class ProvidersService {
  constructor(
    private readonly clis: ProviderClis,
    private readonly processes: ProcessRunner,
    private readonly shell: ShellEnvironment,
    private readonly paths: FavoPaths,
    private readonly callerEnv: Record<string, string | undefined>
  ) {}

  seatHome(account: string, provider: ProviderId) {
    return seatHomeOf(this.paths, account, provider);
  }

  cliOf(provider: ProviderId) {
    return this.clis[provider];
  }

  async binaryOf(provider: ProviderId) {
    return this.processes.which(Providers[provider].executable, await this.shell.path());
  }

  async isOnPath(command: string) {
    return this.processes.which(command, await this.shell.path()) !== undefined;
  }

  async requireBinary(provider: ProviderId) {
    const binary = await this.binaryOf(provider);
    if (binary) return binary;
    const { label, executable } = Providers[provider];
    throw new DomainError(DomainErrorCode.providerNotInstalled, `${label} (${executable}) is not installed here.`);
  }

  async environmentOf(account: string, provider: ProviderId) {
    const isolation = isPersonalAccount(account)
      ? {}
      : isolationEnvironment(Providers[provider], this.seatHome(account, provider), this.callerEnv);
    return { PATH: await this.shell.path(), ...isolation } as Record<string, string>;
  }

  async probeEnvironmentOf(account: string, provider: ProviderId) {
    const { env, unsetEnv } = this.cliOf(provider).limitsEnvironment(this.callerEnv);
    const cleared = Object.fromEntries(unsetEnv.map((name) => [name, undefined]));
    const seatEnv = await this.environmentOf(account, provider);
    return { ...cleared, ...seatEnv, ...env };
  }

  async isolationArgumentsOf(account: string, provider: ProviderId) {
    if (isPersonalAccount(account)) return [];
    const binary = await this.requireBinary(provider);
    return this.cliOf(provider).isolationArguments({ binary, env: await this.environmentOf(account, provider) });
  }

  async loginOf(account: string, provider: ProviderId) {
    const binary = await this.binaryOf(provider);
    if (!binary) return { login: LoginState.notInstalled };
    return this.cliOf(provider).status({ binary, env: await this.probeEnvironmentOf(account, provider) });
  }
}
