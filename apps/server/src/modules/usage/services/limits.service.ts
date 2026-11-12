import { LoginState, SeatLimitsView, type SeatView } from '@favo/contracts/rpc/views';
import type { ProviderId } from '@favo/domain/providers/provider';
import { LimitsUnavailableReason, unavailableLimits } from '@favo/domain/usage/seat-limits';
import type { AccountsService } from '@/modules/accounts/services/accounts.service';
import type { ProvidersService } from '@/modules/providers/services/providers.service';
import type { Clock } from '@/modules/system/gateways/clock';
import type { FileSystem } from '@/modules/system/gateways/file-system';
import type { FavoPaths } from '@/shared/config/favo-paths';

const MaximumReadsAtOnce = 4;

type ReadableSeat = SeatView & { displayName: string };

export class LimitsService {
  private isStopped = false;

  constructor(
    private readonly accounts: AccountsService,
    private readonly providers: ProvidersService,
    private readonly fileSystem: FileSystem,
    private readonly clock: Clock,
    private readonly paths: FavoPaths,
    private readonly callerEnv: Record<string, string | undefined>
  ) {}

  stop() {
    this.isStopped = true;
  }

  async read() {
    const accounts = await this.accounts.list();
    const seats = accounts.flatMap(({ displayName, seats }) =>
      seats.filter((seat) => seat.isInstalled && seat.isProvisioned).map((seat) => ({ ...seat, displayName }))
    );
    await this.fileSystem.ensurePrivateDirectory(this.paths.emptyFolder);
    const views: (SeatLimitsView | undefined)[] = [];
    let next = 0;
    const readNext = async () => {
      while (next < seats.length && !this.isStopped) {
        const index = next++;
        views[index] = await this.readSeat(seats[index]!);
      }
    };
    await Promise.all(Array.from({ length: MaximumReadsAtOnce }, readNext));
    return views.filter((view) => view !== undefined);
  }

  private async readSeat({ account, provider, displayName }: ReadableSeat): Promise<SeatLimitsView | undefined> {
    const checkedAt = this.clock.now().toISOString();
    const failure = unavailableLimits(checkedAt, LimitsUnavailableReason.probeFailed);
    const failed = { account, displayName, provider, usage: failure };
    try {
      const cli = this.providers.cliOf(provider);
      const session = await this.sessionOf(account, provider);
      const { login, identity, plan } = await cli.status(session);
      if (login === LoginState.signedOut) return undefined;
      if (login !== LoginState.signedIn) return failed;
      const usage = await cli.limits(session, checkedAt).catch(() => failure);
      const view = { account, displayName, provider, identity, plan, usage };
      return SeatLimitsView.safeParse(view).success ? view : failed;
    } catch {
      return failed;
    }
  }

  private async sessionOf(account: string, provider: ProviderId) {
    const { env, unsetEnv } = this.providers.cliOf(provider).limitsEnvironment(this.callerEnv);
    const cleared = Object.fromEntries(unsetEnv.map((name) => [name, undefined]));
    const seatEnv = await this.providers.environmentOf(account, provider);
    const binary = await this.providers.requireBinary(provider);
    return { binary, env: { ...cleared, ...seatEnv, ...env }, cwd: this.paths.emptyFolder };
  }
}
