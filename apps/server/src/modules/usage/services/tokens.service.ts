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
import { type SeatTokenLog, tokenLogsToRead } from '@favo/domain/usage/token-log-files';
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
    const listed = [];
    let skippedRecords = 0;
    for (const { account, provider, path } of seats) {
      const { folder, suffixes } = provider === ProviderId.claude ? ClaudeTokenFiles : CodexTokenFiles;
      const { root, files, brokenLinks } = await this.logs.files(`${path}/${folder}`, suffixes);
      listed.push({ account, provider, root, files });
      skippedRecords += brokenLinks;
    }
    const { logs, repeatedSeats } = tokenLogsToRead(listed);
    const fresh = [];
    for (const provider of TokenProviders) {
      const ledger = createTokenLedger();
      const ofProvider = logs.filter((log) => log.provider === provider);
      if (provider === ProviderId.claude) await this.readClaude(ofProvider, ledger);
      else await this.readCodex(ofProvider, ledger);
      fresh.push(...tokenRowsOf(ledger, provider));
      skippedRecords += ledger.skipped;
      for (const account of ledger.repeatedAccounts) repeatedSeats.push({ account, provider });
    }
    const isSameReader = stored?.version === TokenUsageVersion;
    const rows = keepTokenRows({ stored: stored?.rows ?? [], fresh, isSameReader, repeatedSeats });
    const usage = { readAt: this.clock.now().toISOString(), rows, skippedRecords };
    await this.record.save({ version: TokenUsageVersion, ...usage });
    return usage;
  }

  private async readClaude(logs: SeatTokenLog[], ledger: TokenLedger) {
    for (const { path, account, createdAt } of logs) {
      ledger.source = { account, createdAt };
      await this.readFile(path, ClaudeTokenMarkers, ledger, (line) => readClaudeTokenLine(ledger, line));
    }
  }

  private async readCodex(logs: SeatTokenLog[], ledger: TokenLedger) {
    const { rollouts, repeatedAccounts } = codexRolloutsOf(logs);
    for (const account of repeatedAccounts) ledger.repeatedAccounts.add(account);
    for (const { path, session, account, createdAt } of rollouts) {
      const rollout = createCodexRollout(session);
      ledger.source = { account, createdAt };
      await this.readFile(path, CodexTokenMarkers, ledger, (line) => readCodexTokenLine(ledger, rollout, line));
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
