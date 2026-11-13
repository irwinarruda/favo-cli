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
  hoursOfGoneLogs,
  type SeatTokenLog,
  type TokenLogIndex,
  tokenLogIndexOf,
  tokenLogsToRead,
} from '@favo/domain/usage/token-log-files';
import {
  createTokenLedger,
  keepTokenRows,
  type MachineTokenUsage,
  type TokenLedger,
  type TokenOwners,
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
    for (const { account, provider, path } of seats) {
      const { folder, suffixes } = provider === ProviderId.claude ? ClaudeTokenFiles : CodexTokenFiles;
      const { root, files } = await this.logs.files(`${path}/${folder}`, suffixes);
      listed.push({ account, provider, root, files });
    }
    const { logs, repeatedSeats } = tokenLogsToRead(listed);
    const fresh = [];
    const read: TokenLogIndex = {};
    const owners: TokenOwners = {};
    let skippedRecords = 0;
    for (const provider of TokenProviders) {
      const ledger = createTokenLedger('', stored?.owners[provider]);
      const ofProvider = logs.filter((log) => log.provider === provider);
      if (provider === ProviderId.claude) await this.readClaude(ofProvider, ledger);
      else await this.readCodex(ofProvider, ledger);
      fresh.push(...tokenRowsOf(ledger, provider));
      Object.assign(read, tokenLogIndexOf(ledger, provider));
      owners[provider] = Object.fromEntries(ledger.sharedOwners);
      skippedRecords += ledger.skipped;
      for (const account of ledger.repeatedAccounts) repeatedSeats.push({ account, provider });
    }
    const { rows, goneHours } = keepTokenRows({
      stored: stored?.rows ?? [],
      storedVersion: stored?.version,
      fresh,
      goneHours: [...(stored?.goneHours ?? []), ...hoursOfGoneLogs(stored?.logs ?? {}, read)],
      repeatedSeats,
    });
    const usage = { readAt: this.clock.now().toISOString(), rows, skippedRecords };
    await this.record.save({ version: TokenUsageVersion, ...usage, logs: read, goneHours, owners });
    return usage;
  }

  private async readClaude(logs: SeatTokenLog[], ledger: TokenLedger) {
    for (const log of logs) {
      await this.readFile(log, ClaudeTokenMarkers, ledger, (line) => readClaudeTokenLine(ledger, line));
    }
  }

  private async readCodex(logs: SeatTokenLog[], ledger: TokenLedger) {
    const { rollouts, repeatedAccounts, sharedOwners } = codexRolloutsOf(logs, ledger.owners);
    for (const account of repeatedAccounts) ledger.repeatedAccounts.add(account);
    for (const [name, account] of sharedOwners) ledger.sharedOwners.set(name, account);
    for (const log of rollouts) {
      const rollout = createCodexRollout(log.session);
      await this.readFile(log, CodexTokenMarkers, ledger, (line) => readCodexTokenLine(ledger, rollout, line));
    }
  }

  private async readFile(log: SeatTokenLog, markers: string[], ledger: TokenLedger, onLine: (line: string) => void) {
    try {
      ledger.source = { account: log.account, createdAt: log.createdAt, log: log.realPath };
      await this.logs.read(log.path, markers, onLine);
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      ledger.skipped += 1;
      ledger.logHours.delete(log.realPath);
    }
  }
}
