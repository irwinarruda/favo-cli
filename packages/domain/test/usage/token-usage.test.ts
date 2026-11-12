import { describe, expect, it } from 'bun:test';
import {
  addTokenEntry,
  createTokenLedger,
  keepTokenRows,
  MachineTokenUsage,
  type TokenUsageRow,
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

describe('the record a machine keeps', () => {
  it('keeps its numbers when a later read finds fewer logs', () => {
    const stored = [rowOf(9), rowOf(10)];
    const rows = keepTokenRows({ stored, fresh: [rowOf(10, { output: 5, sessions: 0 })], isSameReader: true });
    expect(rows).toEqual(stored);
  });
  it('raises a number when a later read finds more', () => {
    const fresh = [rowOf(10, { output: 80, cacheRead: 900 }), rowOf(11)];
    const rows = keepTokenRows({ stored: [rowOf(10)], fresh, isSameReader: true });
    expect(rows).toEqual([rowOf(10, { output: 80 }), rowOf(11)]);
  });
  it('keeps each account, provider and model apart', () => {
    const stored = [rowOf(10), rowOf(10, { account: 'personal' })];
    const fresh = [rowOf(10, { provider: 'codex', model: 'gpt-test-1' }), rowOf(10, { model: 'claude-test-2' })];
    expect(keepTokenRows({ stored, fresh, isSameReader: true })).toHaveLength(4);
  });
  it('lets a fixed reader lower the hours whose logs are still on disk, and keeps the older ones', () => {
    const stored = [rowOf(8, { output: 999 }), rowOf(10, { output: 999 }), rowOf(11, { output: 999 })];
    const rows = keepTokenRows({ stored, fresh: [rowOf(10), rowOf(12)], isSameReader: false });
    expect(rows.map(({ hour, output }) => [hour.slice(11, 13), output])).toEqual([
      ['08', 999],
      ['10', 50],
      ['12', 50],
    ]);
  });
  it('keeps a seat whose logs are all gone when the reader changes', () => {
    const stored = [rowOf(10, { account: 'gone', output: 999 })];
    const rows = keepTokenRows({ stored, fresh: [rowOf(10)], isSameReader: false });
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
    const ledger = createTokenLedger();
    for (const each of [entry(5, 'a'), entry(50, 'a'), entry(70, 'a'), entry(75, 'b')]) addTokenEntry(ledger, each);
    const rows = tokenRowsOf(ledger, 'work', 'claude');
    expect(rows.map(({ hour, sessions, output }) => [hour.slice(11, 13), sessions, output])).toEqual([
      ['14', 1, 8],
      ['15', 1, 8],
    ]);
  });
  it('does not count a session for entries that name none', () => {
    const ledger = createTokenLedger();
    addTokenEntry(ledger, entry(5, ''));
    expect(tokenRowsOf(ledger, 'work', 'claude')[0]?.sessions).toBe(0);
  });
  it('never merges entries that carry no key', () => {
    const ledger = createTokenLedger();
    addTokenEntry(ledger, entry(5, 'a'));
    addTokenEntry(ledger, entry(5, 'a'));
    addTokenEntry(ledger, entry(6, 'a', 'same'));
    addTokenEntry(ledger, entry(6, 'a', 'same'));
    expect(tokenRowsOf(ledger, 'work', 'claude')[0]?.output).toBe(12);
  });
});
