import type { SeatView } from '@favo/contracts/rpc/views';
import { ProviderId } from '@favo/domain/providers/provider';
import { DomainError } from '@favo/domain/shared/domain-error';
import { ClaudeTokenFiles, ClaudeTokenMarkers, readClaudeTokenLine } from '@favo/domain/usage/claude-token-log';
import {
  CodexTokenFiles,
  CodexTokenMarkers,
  codexRolloutsOf,
  createCodexRollout,
  readCodexTokenLine,
} from '@favo/domain/usage/codex-token-log';
import {
  createTokenLedger,
  keepTokenRows,
  type MachineTokenUsage,
  type TokenLedger,
  TokenProviders,
  TokenUsageVersion,
  tokenRowsOf,
} from '@favo/domain/usage/token-usage';
import type { AccountsService } from '@/modules/accounts/services/accounts.service';
import type { Clock } from '@/modules/system/gateways/clock';
import type { TokenLogs } from '@/modules/usage/gateways/token-logs';
import type { TokenUsageRepository } from '@/modules/usage/repositories/token-usage.repository';

export class TokensService {
  private reading?: Promise<MachineTokenUsage>;

  constructor(
    private readonly accounts: AccountsService,
    private readonly logs: TokenLogs,
    private readonly record: TokenUsageRepository,
    private readonly clock: Clock
  ) {}

  async read(isFresh: boolean): Promise<MachineTokenUsage> {
    if (isFresh) {
      this.reading ??= this.readLogs().finally(() => {
        this.reading = undefined;
      });
      return this.reading;
    }
    const stored = await this.record.read();
    return { readAt: stored?.readAt, rows: stored?.rows ?? [], skippedRecords: stored?.skippedRecords ?? 0 };
  }

  async keep(machineId: string, usage: MachineTokenUsage) {
    await this.record.saveKept(machineId, usage);
    return {};
  }

  async kept(machineId: string): Promise<MachineTokenUsage> {
    return (await this.record.readKept(machineId)) ?? { rows: [], skippedRecords: 0 };
  }

  private async readLogs() {
    const stored = await this.record.read();
    const accounts = await this.accounts.list();
    const seats = accounts.flatMap((account) =>
      account.seats.filter(({ provider }) => TokenProviders.includes(provider))
    );
    const fresh = [];
    let skippedRecords = 0;
    for (const seat of seats) {
      const ledger = createTokenLedger();
      if (seat.provider === ProviderId.claude) await this.readClaude(seat, ledger);
      else await this.readCodex(seat, ledger);
      fresh.push(...tokenRowsOf(ledger, seat.account, seat.provider));
      skippedRecords += ledger.skipped;
    }
    const isSameReader = stored?.version === TokenUsageVersion;
    const rows = keepTokenRows({ stored: stored?.rows ?? [], fresh, isSameReader });
    const usage = { readAt: this.clock.now().toISOString(), rows, skippedRecords };
    await this.record.save({ version: TokenUsageVersion, ...usage });
    return usage;
  }

  private async readClaude({ path }: SeatView, ledger: TokenLedger) {
    const files = await this.logs.files(`${path}/${ClaudeTokenFiles.folder}`, ClaudeTokenFiles.suffixes);
    for (const file of files) {
      await this.readFile(file, ClaudeTokenMarkers, ledger, (line) => readClaudeTokenLine(ledger, line));
    }
  }

  private async readCodex({ path }: SeatView, ledger: TokenLedger) {
    const files = await this.logs.files(`${path}/${CodexTokenFiles.folder}`, CodexTokenFiles.suffixes);
    for (const { file, session } of codexRolloutsOf(files)) {
      const rollout = createCodexRollout(session);
      await this.readFile(file, CodexTokenMarkers, ledger, (line) => readCodexTokenLine(ledger, rollout, line));
    }
  }

  private async readFile(file: string, markers: string[], ledger: TokenLedger, onLine: (line: string) => void) {
    try {
      await this.logs.read(file, markers, onLine);
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      ledger.skipped += 1;
    }
  }
}
