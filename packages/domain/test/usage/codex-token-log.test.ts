import { describe, expect, it } from 'bun:test';
import { createCodexRollout, readCodexTokenLine } from '#domain/usage/codex-token-log';
import { createTokenLedger, tokenRowsOf } from '#domain/usage/token-usage';

const Start = Date.parse('2026-11-10T14:00:00.000Z');

type Counters = { input: number; cached: number; output: number };

function at(seconds: number) {
  return new Date(Start + seconds * 1000).toISOString();
}

function countersOf({ input, cached, output }: Counters) {
  return { input_tokens: input, cached_input_tokens: cached, output_tokens: output, total_tokens: input + output };
}

function meta(seconds: number, payload: Record<string, unknown> = {}) {
  return JSON.stringify({ timestamp: at(seconds), type: 'session_meta', payload: { id: 'session-a', ...payload } });
}

function turn(seconds: number, model = 'gpt-test-1') {
  return JSON.stringify({ timestamp: at(seconds), type: 'turn_context', payload: { model } });
}

function count(seconds: number, last: Counters | undefined, total: Counters | undefined) {
  const info = {
    last_token_usage: last ? countersOf(last) : undefined,
    total_token_usage: total ? countersOf(total) : undefined,
  };
  return JSON.stringify({ timestamp: at(seconds), type: 'event_msg', payload: { type: 'token_count', info } });
}

function usageRecord(seconds: number, usage: Counters) {
  return JSON.stringify({ timestamp: at(seconds), type: 'token_usage_record', payload: { usage: countersOf(usage) } });
}

function read(...lines: string[]) {
  const ledger = createTokenLedger();
  const rollout = createCodexRollout('rollout-a');
  for (const line of lines) readCodexTokenLine(ledger, rollout, line);
  const rows = tokenRowsOf(ledger, 'personal', 'codex');
  const sum = (field: 'input' | 'cacheRead' | 'cacheWrite' | 'output' | 'sessions') =>
    rows.reduce((total, row) => total + row[field], 0);
  return { ledger, rows, requests: ledger.entries.size, sum };
}

const First = { input: 1000, cached: 800, output: 50 };
const Second = { input: 2000, cached: 1500, output: 70 };
const Both = { input: 3000, cached: 2300, output: 120 };

describe('a Codex rollout', () => {
  it('counts each request, with the model of the latest turn', () => {
    const { rows, requests } = read(
      meta(0),
      turn(1),
      count(10, First, First),
      turn(20, 'gpt-test-2'),
      count(30, Second, Both)
    );
    expect(requests).toBe(2);
    expect(rows.map(({ model, output }) => ({ model, output }))).toEqual([
      { model: 'gpt-test-1', output: 50 },
      { model: 'gpt-test-2', output: 70 },
    ]);
  });
  it('takes the cached part out of the input, which includes it', () => {
    const { rows } = read(meta(0), turn(1), count(10, First, First));
    expect(rows[0]).toMatchObject({ input: 200, cacheRead: 800, cacheWrite: 0, output: 50, sessions: 1 });
  });
  it('skips counters written again with the same running total', () => {
    const { requests } = read(
      meta(0),
      turn(1),
      count(10, First, First),
      count(11, First, First),
      count(12, First, First)
    );
    expect(requests).toBe(1);
  });
  it('skips a marker that reports the size of the context, not a request', () => {
    const marker = { input: 0, cached: 0, output: 0 };
    const { requests, ledger } = read(meta(0), turn(1), count(10, First, First), count(11, marker, First));
    expect(requests).toBe(1);
    expect(ledger.skipped).toBe(0);
  });
  it('does not count the history a fork copies from its parent', () => {
    const forked = meta(0, { forked_from_id: 'session-parent' });
    const lines = [forked, turn(0.01), count(0.02, First, First), count(0.04, Second, Both)];
    const own = { input: 500, cached: 0, output: 30 };
    const after = { input: 3500, cached: 2300, output: 150 };
    const { requests, sum } = read(...lines, count(9, own, after));
    expect(requests).toBe(1);
    expect(sum('output')).toBe(30);
  });
  it('does the same for a subagent spawned from a thread', () => {
    const spawned = meta(0, { source: { subagent: { thread_spawn: { parent_thread_id: 'session-parent' } } } });
    const own = { input: 500, cached: 0, output: 30 };
    const after = { input: 1500, cached: 800, output: 80 };
    const { requests, sum } = read(spawned, turn(0.01), count(0.02, First, First), count(7, own, after));
    expect(requests).toBe(1);
    expect(sum('input')).toBe(500);
  });
  it('counts a session resumed in a new process, whose running total starts again', () => {
    const { requests, sum } = read(
      meta(0),
      turn(1),
      count(10, First, First),
      count(20, Second, Both),
      count(900, First, First)
    );
    expect(requests).toBe(3);
    expect(sum('output')).toBe(170);
  });
  it('reads the session from the first session_meta only', () => {
    const copied = meta(2, { id: 'session-ancestor' });
    const second = createTokenLedger();
    const rollout = createCodexRollout('rollout-a');
    for (const line of [meta(0), copied, turn(3), count(10, First, First)]) readCodexTokenLine(second, rollout, line);
    expect([...second.entries.values()][0]?.session).toBe('session-a');
  });
  it('waits for a model before counting', () => {
    const { requests } = read(meta(0), count(10, First, First));
    expect(requests).toBe(0);
  });
  it('counts the requests of an interrupted turn that no snapshot reported', () => {
    const lost = { input: 400, cached: 100, output: 20 };
    const after = { input: 3400, cached: 2400, output: 140 };
    const lines = [meta(0), turn(1), count(10, First, First), usageRecord(15, lost), usageRecord(18, Second)];
    const { requests, sum } = read(...lines, count(20, Second, after));
    expect(requests).toBe(3);
    expect(sum('output')).toBe(140);
  });
  it('counts the request, and nothing more, when the running total jumped by more than it', () => {
    const jumped = { input: 9000, cached: 7000, output: 900 };
    const next = { input: 10000, cached: 7800, output: 950 };
    const lines = [meta(0), turn(1), count(10, First, First), count(20, Second, jumped), count(30, First, next)];
    const { requests, ledger, sum } = read(...lines);
    expect(requests).toBe(3);
    expect(ledger.skipped).toBe(0);
    expect(sum('output')).toBe(170);
    expect(sum('input') + sum('cacheRead')).toBe(4000);
  });
  it('reports counters that do not add up instead of counting them', () => {
    const wrong = { input: 9000, cached: 0, output: 900 };
    const { requests, ledger } = read(meta(0), turn(1), count(10, First, First), count(20, Second, wrong));
    expect(requests).toBe(1);
    expect(ledger.skipped).toBe(1);
  });
  it('reports a broken line', () => {
    const { ledger } = read(meta(0), '{"type":"event_msg","payload":{"type":"token_count"');
    expect(ledger.skipped).toBe(1);
  });
  it('still counts old events that carry no running total, once each', () => {
    const { requests } = read(
      meta(0),
      turn(1),
      count(10, First, undefined),
      count(11, First, undefined),
      count(20, Second, undefined)
    );
    expect(requests).toBe(2);
  });
});
