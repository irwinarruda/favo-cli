import { describe, expect, it } from 'bun:test';
import { opencodeTokenFolderOf, readOpencodeTokenRow } from '#domain/usage/opencode-token-log';
import { createTokenLedger, MaximumTokenCount, tokenRowsOf } from '#domain/usage/token-usage';

const At = Date.parse('2026-11-10T14:05:00.000Z');

function rowOf(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `msg_${id}`,
    session: 'session-a',
    at: At,
    model: 'glm-test-1',
    input: 10,
    output: 40,
    reasoning: 5,
    cacheRead: 2000,
    cacheWrite: 300,
    ...overrides,
  };
}

function read(...rows: unknown[]) {
  const ledger = createTokenLedger('work');
  for (const row of rows) readOpencodeTokenRow(ledger, row);
  return { ledger, rows: tokenRowsOf(ledger, 'opencode') };
}

describe('an OpenCode database', () => {
  it('reads the numbers of an assistant message, with its reasoning as output', () => {
    const { rows } = read(rowOf('one'));
    expect(rows).toEqual([
      {
        hour: '2026-11-10T14:00:00.000Z',
        account: 'work',
        provider: 'opencode',
        model: 'glm-test-1',
        input: 10,
        cacheRead: 2000,
        cacheWrite: 300,
        output: 45,
        sessions: 1,
      },
    ]);
  });
  it('counts a message once when the old and the new table both hold it', () => {
    const { rows } = read(rowOf('one'), rowOf('one'), rowOf('two', { session: 'session-b' }));
    expect(rows).toMatchObject([{ input: 20, output: 90, sessions: 2 }]);
  });
  it('reads a number the database left empty as zero', () => {
    const { rows, ledger } = read(rowOf('one', { reasoning: null, cacheWrite: null }));
    expect(rows).toMatchObject([{ output: 40, cacheWrite: 0 }]);
    expect(ledger.skipped).toBe(0);
  });
  it('leaves out a message that used no tokens, so it opens no session', () => {
    const empty = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
    const { rows, ledger } = read(rowOf('one', empty));
    expect(rows).toEqual([]);
    expect(ledger.skipped).toBe(0);
  });
  it('leaves out a row with no model or no time it can place', () => {
    const { rows, ledger } = read(
      rowOf('one', { model: null }),
      rowOf('two', { model: '' }),
      rowOf('three', { at: null }),
      rowOf('four', { at: 9e15 }),
      'not a row',
      null
    );
    expect(rows).toEqual([]);
    expect(ledger.skipped).toBe(0);
  });
  it('says it skipped a message whose number no count can hold', () => {
    const { rows, ledger } = read(rowOf('one', { reasoning: MaximumTokenCount + 1 }), rowOf('two'));
    expect(rows).toMatchObject([{ output: 45 }]);
    expect(ledger.skipped).toBe(1);
  });
  it('sits in the data folder itself for personal, and one folder down for a cell', () => {
    expect(opencodeTokenFolderOf('personal', '/home/bee/.local/share/opencode')).toBe(
      '/home/bee/.local/share/opencode'
    );
    expect(opencodeTokenFolderOf('work', '/home/bee/.favo/accounts/work/opencode')).toBe(
      '/home/bee/.favo/accounts/work/opencode/opencode'
    );
  });
});
