import { describe, expect, it } from 'bun:test';
import { tokenLogIndexOf } from '#domain/usage/token-log-files';
import {
  addTokenEntry,
  createTokenLedger,
  keepTokenRows,
  MachineTokenUsage,
  type TokenUsageRow,
  TokenUsageVersion,
  tokenRowsOf,
} from '#domain/usage/token-usage';

function rowOf(hour: number, overrides: Partial<TokenUsageRow> = {}): TokenUsageRow {
  return {
    hour: `2026-11-10T${String(hour).padStart(2, '0')}:00:00.000Z`,
    account: 'work',
    provider: 'claude',
    model: 'claude-test-1',
    input: 10,
    cacheRead: 1000,
    cacheWrite: 100,
    output: 50,
    sessions: 1,
    ...overrides,
  };
}

const Same = TokenUsageVersion;
const BeforeLogsWereRemembered = 0;
const ALaterReader = TokenUsageVersion + 1;

function hourOf(row: TokenUsageRow) {
  return { account: row.account, provider: row.provider, hour: row.hour };
}

describe('the record a machine keeps', () => {
  it('keeps its numbers when a later read finds fewer logs', () => {
    const stored = [rowOf(9), rowOf(10)];
    const fresh = [rowOf(10, { output: 5, sessions: 0 })];
    expect(keepTokenRows({ stored, storedVersion: Same, fresh }).rows).toEqual(stored);
  });
  it('raises a number when a later read finds more', () => {
    const fresh = [rowOf(10, { output: 80, cacheRead: 900 }), rowOf(11)];
    const { rows } = keepTokenRows({ stored: [rowOf(10)], storedVersion: Same, fresh });
    expect(rows).toEqual([rowOf(10, { output: 80 }), rowOf(11)]);
  });
  it('keeps each account, provider and model apart', () => {
    const stored = [rowOf(10), rowOf(10, { account: 'personal' })];
    const fresh = [rowOf(10, { provider: 'codex', model: 'gpt-test-1' }), rowOf(10, { model: 'claude-test-2' })];
    expect(keepTokenRows({ stored, storedVersion: Same, fresh }).rows).toHaveLength(4);
  });
  it('remembers the hours the logs no longer explain, and no other', () => {
    const stored = [rowOf(8), rowOf(9), rowOf(10, { output: 80 }), rowOf(11)];
    const fresh = [rowOf(9), rowOf(10), rowOf(11, { output: 90 }), rowOf(12)];
    const { goneHours } = keepTokenRows({ stored, storedVersion: Same, fresh, goneHours: [hourOf(rowOf(7))] });
    expect(goneHours).toEqual([rowOf(7), rowOf(8), rowOf(10)].map(hourOf));
  });
  it('keeps a record of the version before, which counted the same way', () => {
    const stored = [rowOf(8, { output: 999 }), rowOf(10, { output: 999 })];
    const { rows, goneHours } = keepTokenRows({ stored, storedVersion: 2, fresh: [rowOf(10)] });
    expect(rows).toEqual(stored);
    expect(goneHours).toEqual(stored.map(hourOf));
  });
  it('lets a fixed reader lower every hour whose logs are all still on disk, and keeps the others', () => {
    const stored = [rowOf(8, { output: 999 }), rowOf(10, { output: 999 }), rowOf(11, { output: 999 }), rowOf(13)];
    const { rows, goneHours } = keepTokenRows({
      stored,
      storedVersion: ALaterReader,
      fresh: [rowOf(10), rowOf(11), rowOf(12)],
      goneHours: [hourOf(rowOf(11))],
    });
    expect(rows.map(({ hour, output }) => [hour.slice(11, 13), output])).toEqual([
      ['10', 50],
      ['11', 999],
      ['12', 50],
    ]);
    expect(goneHours).toEqual([hourOf(rowOf(11))]);
  });
  it('keeps the hours older than the logs when the record never said which logs fed it', () => {
    const stored = [rowOf(8, { output: 999 }), rowOf(10, { output: 999 }), rowOf(11, { output: 999 })];
    const fresh = [rowOf(10), rowOf(12)];
    const { rows, goneHours } = keepTokenRows({ stored, storedVersion: BeforeLogsWereRemembered, fresh });
    expect(rows.map(({ hour, output }) => [hour.slice(11, 13), output])).toEqual([
      ['08', 999],
      ['10', 50],
      ['12', 50],
    ]);
    expect(goneHours).toEqual([hourOf(rowOf(8))]);
  });
  it('keeps a seat whose logs are all gone when the reader changes', () => {
    const stored = [rowOf(10, { account: 'gone', output: 999 })];
    const { rows } = keepTokenRows({ stored, storedVersion: BeforeLogsWereRemembered, fresh: [rowOf(10)] });
    expect(rows.map(({ account }) => account)).toEqual(['gone', 'work']);
  });
  it('accepts a machine that was never read', () => {
    expect(MachineTokenUsage.safeParse({ rows: [], skippedRecords: 0 }).success).toBe(true);
    expect(MachineTokenUsage.safeParse({ rows: [rowOf(10, { output: -1 })], skippedRecords: 0 }).success).toBe(false);
  });
});

describe('rows by hour', () => {
  const entry = (minute: number, session: string, key?: string) => ({
    key,
    at: Date.parse('2026-11-10T14:00:00.000Z') + minute * 60_000,
    session,
    model: 'claude-test-1',
    input: 1,
    cacheRead: 2,
    cacheWrite: 3,
    output: 4,
  });

  it('counts a session that spans two hours once', () => {
    const ledger = createTokenLedger('work');
    for (const each of [entry(5, 'a'), entry(50, 'a'), entry(70, 'a'), entry(75, 'b')]) addTokenEntry(ledger, each);
    const rows = tokenRowsOf(ledger, 'claude');
    expect(rows.map(({ hour, sessions, output }) => [hour.slice(11, 13), sessions, output])).toEqual([
      ['14', 1, 8],
      ['15', 1, 8],
    ]);
  });
  it('does not count a session for entries that name none', () => {
    const ledger = createTokenLedger('work');
    addTokenEntry(ledger, entry(5, ''));
    expect(tokenRowsOf(ledger, 'claude')[0]?.sessions).toBe(0);
  });
  it('never merges entries that carry no key', () => {
    const ledger = createTokenLedger('work');
    addTokenEntry(ledger, entry(5, 'a'));
    addTokenEntry(ledger, entry(5, 'a'));
    addTokenEntry(ledger, entry(6, 'a', 'same'));
    addTokenEntry(ledger, entry(6, 'a', 'same'));
    expect(tokenRowsOf(ledger, 'claude')[0]?.output).toBe(12);
  });
});

describe('a request two accounts hold', () => {
  const entry = (output: number, key?: string) => ({
    key,
    at: Date.parse('2026-11-10T14:05:00.000Z'),
    session: 'a',
    model: 'claude-test-1',
    input: 1,
    cacheRead: 2,
    cacheWrite: 3,
    output,
  });

  function ledgerOf(...copies: [account: string, createdAt: number | undefined, output: number, key?: string][]) {
    const ledger = createTokenLedger();
    for (const [account, createdAt, output, key = 'same'] of copies) {
      ledger.source = { account, createdAt };
      addTokenEntry(ledger, entry(output, key));
    }
    return ledger;
  }

  it('is counted once, with the largest numbers, for the account whose file is older', () => {
    const ledger = ledgerOf(['personal', 300, 4], ['work', 200, 9], ['side', 250, 1]);
    expect(tokenRowsOf(ledger, 'claude')).toMatchObject([{ account: 'work', output: 9, sessions: 1 }]);
    expect([...ledger.repeatedAccounts].toSorted()).toEqual(['personal', 'side']);
  });
  it('stays with the first account in favo order when the file system cannot say which is older', () => {
    const ledger = ledgerOf(['personal', undefined, 4], ['work', 200, 9]);
    expect(tokenRowsOf(ledger, 'claude')).toMatchObject([{ account: 'personal', output: 9 }]);
    expect([...ledger.repeatedAccounts]).toEqual(['work']);
  });
  it('names no account when the copies sit in one account', () => {
    const ledger = ledgerOf(['work', 300, 4], ['work', 200, 9]);
    expect(ledger.repeatedAccounts.size).toBe(0);
  });
  it('stays with the account favo wrote down, whichever file is older or still there', () => {
    const ledger = createTokenLedger('', { same: 'personal' });
    ledger.source = { account: 'work', createdAt: 200 };
    addTokenEntry(ledger, entry(9, 'same'));
    addTokenEntry(ledger, entry(3, 'other'));
    expect(tokenRowsOf(ledger, 'claude')).toMatchObject([
      { account: 'personal', output: 9 },
      { account: 'work', output: 3 },
    ]);
    expect([...ledger.sharedOwners]).toEqual([['same', 'personal']]);
  });
  it('writes down who owns a request only when two accounts hold it', () => {
    expect([...ledgerOf(['personal', 300, 4], ['work', 200, 9]).sharedOwners]).toEqual([['same', 'work']]);
    expect(ledgerOf(['work', 300, 4], ['work', 200, 9]).sharedOwners.size).toBe(0);
  });
  it('says which hours each log fed, under the account that got them', () => {
    const ledger = createTokenLedger();
    ledger.source = { account: 'personal', createdAt: 300, log: '/personal/a.jsonl' };
    addTokenEntry(ledger, entry(4, 'same'));
    addTokenEntry(ledger, entry(4, 'mine'));
    ledger.source = { account: 'work', createdAt: 200, log: '/work/a.jsonl' };
    addTokenEntry(ledger, entry(9, 'same'));
    const hour = '2026-11-10T14:00:00.000Z';
    expect(tokenLogIndexOf(ledger, 'claude')).toEqual({
      '/personal/a.jsonl': { provider: 'claude', hours: { personal: [hour] } },
      '/work/a.jsonl': { provider: 'claude', hours: { work: [hour] } },
    });
  });
  it('forgets the stored rows of the seats that repeated a log, only for a record of the first version', () => {
    const stored = [rowOf(8, { output: 999 }), rowOf(8, { account: 'personal', output: 999 })];
    const input = { stored, fresh: [rowOf(10)], repeatedSeats: [{ account: 'work', provider: 'claude' as const }] };
    expect(keepTokenRows({ ...input, storedVersion: 1 }).rows.map(({ account }) => account)).toEqual([
      'personal',
      'work',
    ]);
    expect(keepTokenRows({ ...input, storedVersion: Same }).rows).toHaveLength(3);
  });
});
