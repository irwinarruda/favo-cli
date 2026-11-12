import { LoginState } from '@favo/contracts/rpc/views';
import type { ProviderId } from '@favo/domain/providers/provider';
import type { SeatLimits } from '@favo/domain/usage/seat-limits';
import {
  type FoundThread,
  ProviderCli,
  type ProviderLogin,
  type ProviderSession,
  type ThreadSearch,
  type UpdateSwitchSearch,
} from '@/modules/providers/gateways/provider-cli';

export class ScriptedProviderCli extends ProviderCli {
  readonly sessions: ProviderSession[] = [];
  login: ProviderLogin = { login: LoginState.signedOut };
  isolation: string[] = [];
  foundThreads: FoundThread[] = [];
  readonly threadSearches: ThreadSearch[] = [];
  limitsReading?: Omit<SeatLimits, 'checkedAt'> | Error;
  readonly limitsSessions: ProviderSession[] = [];
  updateOff?: string;
  updateOffUnless?: (search: UpdateSwitchSearch) => string | undefined;
  currentReads = 0;
  mostReadsAtOnce = 0;

  constructor(
    readonly id: ProviderId,
    private readonly canLogout = true
  ) {
    super();
  }

  async status(session: ProviderSession) {
    this.sessions.push(session);
    return this.login;
  }

  override async limits(session: ProviderSession, checkedAt: string) {
    this.limitsSessions.push(session);
    this.currentReads++;
    this.mostReadsAtOnce = Math.max(this.mostReadsAtOnce, this.currentReads);
    await Bun.sleep(0);
    this.currentReads--;
    if (this.limitsReading instanceof Error) throw this.limitsReading;
    return this.limitsReading ? { checkedAt, ...this.limitsReading } : super.limits(session, checkedAt);
  }

  override async recentThreads(search: ThreadSearch) {
    this.threadSearches.push(search);
    return this.foundThreads;
  }

  override async updateSwitch(search: UpdateSwitchSearch) {
    return this.updateOffUnless?.(search) ?? this.updateOff;
  }

  override async isolationArguments() {
    return this.isolation;
  }

  loginArguments() {
    return ['login'];
  }

  logoutArguments() {
    return this.canLogout ? ['logout'] : undefined;
  }
}
