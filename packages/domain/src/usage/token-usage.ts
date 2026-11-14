import { z } from 'zod';
import { ProviderId } from '#domain/providers/provider';

const HourMs = 3_600_000;
const Count = z.number().int().min(0);

export const TokenUsageVersion = 3;
const OldestVersionCountingTheSame = 2;
const FirstVersionRememberingLogs = 3;
export const MaximumTokenCount = 1_000_000_000_000;
export const TokenUsageFreshForMs = 24 * HourMs;
export const TokenProviders: ProviderId[] = [ProviderId.claude, ProviderId.codex, ProviderId.opencode];

export const TokenUsageRow = z.strictObject({
  hour: z.iso.datetime(),
  account: z.string(),
  provider: z.enum(ProviderId),
  model: z.string(),
  input: Count,
  cacheRead: Count,
  cacheWrite: Count,
  output: Count,
  sessions: Count,
});
export type TokenUsageRow = z.infer<typeof TokenUsageRow>;

export const MachineTokenUsage = z.strictObject({
  readAt: z.iso.datetime().optional(),
  rows: z.array(TokenUsageRow),
  skippedRecords: Count,
});
export type MachineTokenUsage = z.infer<typeof MachineTokenUsage>;

export const TokenHour = z.strictObject({ account: z.string(), provider: z.enum(ProviderId), hour: z.iso.datetime() });
export type TokenHour = z.infer<typeof TokenHour>;

export const TokenOwners = z.partialRecord(z.enum(ProviderId), z.record(z.string(), z.string()));
export type TokenOwners = z.infer<typeof TokenOwners>;

export type TokenCounts = Pick<TokenUsageRow, 'input' | 'cacheRead' | 'cacheWrite' | 'output'>;

export type TokenEntry = TokenCounts & {
  key?: string;
  at: number;
  session: string;
  model: string;
};

export type TokenSource = { account: string; createdAt?: number; log?: string };

export type TokenTable = { name: string; query: string };

export type TokenSeat = Pick<TokenUsageRow, 'account' | 'provider'>;

export type TokenLedger = {
  entries: Map<string, TokenEntry & TokenSource>;
  skipped: number;
  source: TokenSource;
  repeatedAccounts: Set<string>;
  owners: Map<string, string>;
  sharedOwners: Map<string, string>;
  logHours: Map<string, Map<string, Set<string>>>;
};

export function createTokenLedger(account = '', owners: Record<string, string> = {}): TokenLedger {
  return {
    entries: new Map(),
    skipped: 0,
    source: { account },
    repeatedAccounts: new Set(),
    owners: new Map(Object.entries(owners)),
    sharedOwners: new Map(),
    logHours: new Map(),
  };
}

export function isCreatedBefore(left: TokenSource, right: TokenSource) {
  return left.createdAt !== undefined && right.createdAt !== undefined && left.createdAt < right.createdAt;
}

export function addTokenEntry(ledger: TokenLedger, entry: TokenEntry) {
  const { entries, source } = ledger;
  const key = entry.key ?? `#${entries.size}`;
  const held = entries.get(key);
  const holder: TokenSource = held ?? source;
  const remembered = ledger.owners.get(key);
  const isOlder = held !== undefined && isCreatedBefore(source, held);
  const account = remembered ?? (isOlder ? source.account : holder.account);
  for (const other of [holder.account, source.account]) {
    if (other !== account) ledger.repeatedAccounts.add(other);
  }
  if (remembered !== undefined || holder.account !== source.account) ledger.sharedOwners.set(key, account);
  const first = held && held.at <= entry.at ? held : entry;
  entries.set(key, {
    key: entry.key,
    at: first.at,
    session: first.session,
    model: first.model,
    account,
    createdAt: isOlder ? source.createdAt : holder.createdAt,
    input: Math.max(held?.input ?? 0, entry.input),
    cacheRead: Math.max(held?.cacheRead ?? 0, entry.cacheRead),
    cacheWrite: Math.max(held?.cacheWrite ?? 0, entry.cacheWrite),
    output: Math.max(held?.output ?? 0, entry.output),
  });
  if (source.log === undefined) return;
  const accounts = ledger.logHours.get(source.log) ?? new Map<string, Set<string>>();
  const hours = accounts.get(account) ?? new Set();
  ledger.logHours.set(source.log, accounts.set(account, hours.add(hourOf(first.at))));
}

export function tokenCountOf(value: unknown) {
  if (typeof value !== 'number' || !(value > 0)) return 0;
  return value <= MaximumTokenCount ? Math.floor(value) : undefined;
}

export function timeOf(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const at = Date.parse(value);
  return Number.isFinite(at) ? at : undefined;
}

export function hourOf(at: number) {
  return new Date(Math.floor(at / HourMs) * HourMs).toISOString();
}

export function processedTokensOf({ input, cacheRead, cacheWrite, output }: TokenCounts) {
  return input + cacheRead + cacheWrite + output;
}

export function tokenRowsOf(ledger: TokenLedger, provider: ProviderId) {
  const rows = new Map<string, TokenUsageRow>();
  const firstRequests = new Map<string, TokenEntry & TokenSource>();
  function rowOf({ at, model, account }: TokenEntry & TokenSource) {
    const hour = hourOf(at);
    const key = `${hour}\n${account}\n${model}`;
    const held = rows.get(key);
    if (held) return held;
    const row = { hour, account, provider, model, input: 0, cacheRead: 0, cacheWrite: 0, output: 0, sessions: 0 };
    rows.set(key, row);
    return row;
  }
  for (const entry of ledger.entries.values()) {
    const row = rowOf(entry);
    row.input += entry.input;
    row.cacheRead += entry.cacheRead;
    row.cacheWrite += entry.cacheWrite;
    row.output += entry.output;
    const first = firstRequests.get(entry.session);
    if (entry.session && (!first || entry.at < first.at)) firstRequests.set(entry.session, entry);
  }
  for (const first of firstRequests.values()) rowOf(first).sessions += 1;
  return sortTokenRows([...rows.values()]);
}

export function keepTokenRows(input: {
  stored: TokenUsageRow[];
  storedVersion: number | undefined;
  fresh: TokenUsageRow[];
  goneHours?: TokenHour[];
  repeatedSeats?: TokenSeat[];
}) {
  const { stored, storedVersion = TokenUsageVersion, fresh, goneHours = [], repeatedSeats = [] } = input;
  const gone = new Map(goneHours.map((each) => [hourKeyOf(each), each]));
  const found = new Map(fresh.map((row) => [rowKeyOf(row), row]));
  const kept = stored.filter(storedRowsToKeep({ storedVersion, fresh, gone, repeatedSeats }));
  for (const row of kept) {
    const read = found.get(rowKeyOf(row));
    if (read && isReachedBy(row, read)) continue;
    gone.set(hourKeyOf(row), { account: row.account, provider: row.provider, hour: row.hour });
  }
  const rows = new Map(kept.map((row) => [rowKeyOf(row), row]));
  for (const row of fresh) {
    const held = rows.get(rowKeyOf(row));
    rows.set(rowKeyOf(row), held ? raised(held, row) : row);
  }
  return {
    rows: sortTokenRows([...rows.values()]),
    goneHours: [...gone.values()].toSorted((left, right) => hourKeyOf(left).localeCompare(hourKeyOf(right))),
  };
}

function storedRowsToKeep(input: {
  storedVersion: number;
  fresh: TokenUsageRow[];
  gone: Map<string, TokenHour>;
  repeatedSeats: TokenSeat[];
}) {
  const { storedVersion, fresh, gone, repeatedSeats } = input;
  if (storedVersion >= OldestVersionCountingTheSame && storedVersion <= TokenUsageVersion) return () => true;
  if (storedVersion >= FirstVersionRememberingLogs) return (row: TokenUsageRow) => gone.has(hourKeyOf(row));
  const oldest = oldestHours(fresh);
  const rebuilt = new Set(repeatedSeats.map(seatOf));
  return (row: TokenUsageRow) => {
    if (rebuilt.has(seatOf(row))) return false;
    const firstOnDisk = oldest.get(seatOf(row));
    return firstOnDisk === undefined || row.hour < firstOnDisk;
  };
}

function isReachedBy(held: TokenUsageRow, row: TokenUsageRow) {
  return (
    row.input >= held.input &&
    row.cacheRead >= held.cacheRead &&
    row.cacheWrite >= held.cacheWrite &&
    row.output >= held.output &&
    row.sessions >= held.sessions
  );
}

function raised(held: TokenUsageRow, row: TokenUsageRow): TokenUsageRow {
  return {
    ...held,
    input: Math.max(held.input, row.input),
    cacheRead: Math.max(held.cacheRead, row.cacheRead),
    cacheWrite: Math.max(held.cacheWrite, row.cacheWrite),
    output: Math.max(held.output, row.output),
    sessions: Math.max(held.sessions, row.sessions),
  };
}

function oldestHours(rows: TokenUsageRow[]) {
  const oldest = new Map<string, string>();
  for (const row of rows) {
    const held = oldest.get(seatOf(row));
    if (held === undefined || row.hour < held) oldest.set(seatOf(row), row.hour);
  }
  return oldest;
}

function seatOf({ account, provider }: TokenSeat) {
  return `${account}\n${provider}`;
}

function hourKeyOf({ account, provider, hour }: TokenHour) {
  return `${hour}\n${account}\n${provider}`;
}

function rowKeyOf({ hour, account, provider, model }: TokenUsageRow) {
  return `${hour}\n${account}\n${provider}\n${model}`;
}

function sortTokenRows(rows: TokenUsageRow[]) {
  return rows.toSorted((left, right) => rowKeyOf(left).localeCompare(rowKeyOf(right)));
}
