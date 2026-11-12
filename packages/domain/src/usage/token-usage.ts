import { z } from 'zod';
import { ProviderId } from '#domain/providers/provider';

const HourMs = 3_600_000;
const Count = z.number().int().min(0);

export const TokenUsageVersion = 2;
export const MaximumTokenCount = 1_000_000_000_000;
export const TokenUsageFreshForMs = 24 * HourMs;
export const TokenProviders: ProviderId[] = [ProviderId.claude, ProviderId.codex];

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

export type TokenCounts = Pick<TokenUsageRow, 'input' | 'cacheRead' | 'cacheWrite' | 'output'>;

export type TokenEntry = TokenCounts & {
  key?: string;
  at: number;
  session: string;
  model: string;
};

export type TokenSource = { account: string; createdAt?: number };

export type TokenSeat = Pick<TokenUsageRow, 'account' | 'provider'>;

export type TokenLedger = {
  entries: Map<string, TokenEntry & TokenSource>;
  skipped: number;
  source: TokenSource;
  repeatedAccounts: Set<string>;
};

export function createTokenLedger(account = ''): TokenLedger {
  return { entries: new Map(), skipped: 0, source: { account }, repeatedAccounts: new Set() };
}

export function isCreatedBefore(left: TokenSource, right: TokenSource) {
  return left.createdAt !== undefined && right.createdAt !== undefined && left.createdAt < right.createdAt;
}

export function addTokenEntry(ledger: TokenLedger, entry: TokenEntry) {
  const { entries, source } = ledger;
  const key = entry.key ?? `#${entries.size}`;
  const held = entries.get(key);
  if (!held) {
    entries.set(key, { ...entry, account: source.account, createdAt: source.createdAt });
    return;
  }
  const first = entry.at < held.at ? entry : held;
  const owner = isCreatedBefore(source, held) ? source : held;
  if (held.account !== source.account) {
    ledger.repeatedAccounts.add(owner === held ? source.account : held.account);
  }
  entries.set(key, {
    key,
    at: first.at,
    session: first.session,
    model: first.model,
    account: owner.account,
    createdAt: owner.createdAt,
    input: Math.max(held.input, entry.input),
    cacheRead: Math.max(held.cacheRead, entry.cacheRead),
    cacheWrite: Math.max(held.cacheWrite, entry.cacheWrite),
    output: Math.max(held.output, entry.output),
  });
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
  fresh: TokenUsageRow[];
  isSameReader: boolean;
  repeatedSeats?: TokenSeat[];
}) {
  const { stored, fresh, isSameReader, repeatedSeats = [] } = input;
  const oldest = oldestHours(fresh);
  const rebuilt = new Set(isSameReader ? [] : repeatedSeats.map(seatOf));
  const kept = stored.filter((row) => {
    if (rebuilt.has(seatOf(row))) return false;
    const firstOnDisk = oldest.get(seatOf(row));
    return isSameReader || firstOnDisk === undefined || row.hour < firstOnDisk;
  });
  const rows = new Map(kept.map((row) => [rowKeyOf(row), row]));
  for (const row of fresh) {
    const held = rows.get(rowKeyOf(row));
    rows.set(rowKeyOf(row), held ? raised(held, row) : row);
  }
  return sortTokenRows([...rows.values()]);
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

function rowKeyOf({ hour, account, provider, model }: TokenUsageRow) {
  return `${hour}\n${account}\n${provider}\n${model}`;
}

function sortTokenRows(rows: TokenUsageRow[]) {
  return rows.toSorted((left, right) => rowKeyOf(left).localeCompare(rowKeyOf(right)));
}
