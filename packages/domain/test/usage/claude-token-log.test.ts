import { describe, expect, it } from 'bun:test';
import { readClaudeTokenLine } from '#domain/usage/claude-token-log';
import { createTokenLedger, tokenRowsOf } from '#domain/usage/token-usage';

type Usage = Record<string, unknown>;

function lineOf(id: string, usage: Usage, overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    type: 'assistant',
    timestamp: '2026-11-10T14:05:00.000Z',
    requestId: `req_${id}`,
    sessionId: 'session-a',
    message: { id: `msg_${id}`, model: 'claude-test-1', usage },
    ...overrides,
  });
}

function usageOf(input: number, cacheRead: number, cacheWrite: number, output: number): Usage {
  return {
    input_tokens: input,
    cache_read_input_tokens: cacheRead,
    cache_creation_input_tokens: cacheWrite,
    output_tokens: output,
  };
}

function read(...lines: string[]) {
  const ledger = createTokenLedger();
  for (const line of lines) readClaudeTokenLine(ledger, line);
  return { ledger, rows: tokenRowsOf(ledger, 'work', 'claude') };
}

describe('a Claude Code log', () => {
  it('reads the four numbers of an assistant message', () => {
    const { rows } = read(lineOf('one', usageOf(10, 2000, 300, 40)));
    expect(rows).toEqual([
      {
        hour: '2026-11-10T14:00:00.000Z',
        account: 'work',
        provider: 'claude',
        model: 'claude-test-1',
        input: 10,
        cacheRead: 2000,
        cacheWrite: 300,
        output: 40,
        sessions: 1,
      },
    ]);
  });
  it('counts a message once when it is written once per content block', () => {
    const line = lineOf('one', usageOf(10, 2000, 300, 40));
    const { rows } = read(line, line, line);
    expect(rows[0]).toMatchObject({ input: 10, cacheRead: 2000, output: 40 });
  });
  it('keeps the largest of each number when a copy in a second file is partial', () => {
    const partial = lineOf('one', usageOf(10, 2000, 0, 1), { sessionId: 'session-b' });
    const { rows } = read(lineOf('one', usageOf(10, 2000, 300, 40)), partial);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ cacheWrite: 300, output: 40, sessions: 1 });
  });
  it('keeps the time and the session of the earliest copy, in whatever order they are read', () => {
    const copy = lineOf('one', usageOf(1, 0, 0, 1), { timestamp: '2026-11-10T16:30:00.000Z', sessionId: 'session-b' });
    const original = lineOf('one', usageOf(1, 0, 0, 1));
    expect(read(copy, original).rows).toEqual(read(original, copy).rows);
    expect(read(copy, original).rows[0]?.hour).toBe('2026-11-10T14:00:00.000Z');
  });
  it('counts an advisor call as its own record, under its own model', () => {
    const advisor = { type: 'advisor_message', model: 'claude-advisor-1', ...usageOf(5, 100, 0, 7) };
    const other = { type: 'message', model: 'claude-test-1', ...usageOf(900, 0, 0, 900) };
    const line = lineOf('one', { ...usageOf(10, 2000, 300, 40), iterations: [other, advisor] });
    const { rows } = read(line, line);
    expect(rows.map(({ model, input, output }) => ({ model, input, output }))).toEqual([
      { model: 'claude-advisor-1', input: 5, output: 7 },
      { model: 'claude-test-1', input: 10, output: 40 },
    ]);
  });
  it('skips a placeholder that never reached the API', () => {
    const synthetic = lineOf('one', usageOf(10, 0, 0, 40), {
      message: { id: 'msg_one', model: '<synthetic>', usage: usageOf(10, 0, 0, 40) },
    });
    expect(read(synthetic).rows).toEqual([]);
  });
  it('skips a line with no timestamp, and one that is not from the assistant', () => {
    const untimed = lineOf('one', usageOf(10, 0, 0, 40), { timestamp: undefined });
    const fromUser = lineOf('two', usageOf(10, 0, 0, 40), { type: 'user' });
    const { ledger, rows } = read(untimed, fromUser);
    expect(rows).toEqual([]);
    expect(ledger.skipped).toBe(0);
  });
  it('reports a broken line instead of stopping', () => {
    const { ledger, rows } = read('{"type":"assistant","message":{"usage":', lineOf('one', usageOf(1, 0, 0, 1)));
    expect(ledger.skipped).toBe(1);
    expect(rows).toHaveLength(1);
  });
  it('ignores the cost old logs carry', () => {
    const { rows } = read(lineOf('one', usageOf(1, 0, 0, 1), { costUSD: 12 }));
    expect(rows[0]).not.toHaveProperty('cost');
  });
  it('counts a session once, in the hour of its first request', () => {
    const later = lineOf('two', usageOf(1, 0, 0, 1), { timestamp: '2026-11-10T15:20:00.000Z' });
    const { rows } = read(later, lineOf('one', usageOf(1, 0, 0, 1)));
    expect(rows.map(({ hour, sessions }) => ({ hour, sessions }))).toEqual([
      { hour: '2026-11-10T14:00:00.000Z', sessions: 1 },
      { hour: '2026-11-10T15:00:00.000Z', sessions: 0 },
    ]);
  });
});
