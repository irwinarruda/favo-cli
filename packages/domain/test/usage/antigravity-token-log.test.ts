import { describe, expect, it } from 'bun:test';
import {
  antigravitySessionOf,
  antigravityTokenFolderOf,
  readAntigravityTokenLine,
} from '#domain/usage/antigravity-token-log';
import { createTokenLedger, tokenRowsOf } from '#domain/usage/token-usage';

function plannerLine(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    step_index: 1,
    source: 'MODEL',
    type: 'PLANNER_RESPONSE',
    status: 'DONE',
    created_at: '2026-11-21T22:42:36Z',
    model: 'gemini-4-neon-xhigh',
    input_tokens: 3134,
    cache_read_tokens: 12152,
    output_tokens: 292,
    thinking: 'private thought',
    ...overrides,
  });
}

describe('finding Antigravity transcripts', () => {
  it('looks in brain under personal, and under .gemini/antigravity-cli for a cell', () => {
    expect(antigravityTokenFolderOf('personal', '/home/bee/.gemini/antigravity-cli')).toBe(
      '/home/bee/.gemini/antigravity-cli/brain'
    );
    expect(antigravityTokenFolderOf('work', '/home/bee/.favo/accounts/work/antigravity')).toBe(
      '/home/bee/.favo/accounts/work/antigravity/.gemini/antigravity-cli/brain'
    );
  });
  it('reads the conversation id from the transcript path', () => {
    expect(
      antigravitySessionOf('/home/bee/.gemini/antigravity-cli/brain/conv-1/.system_generated/logs/transcript.jsonl')
    ).toBe('conv-1');
    expect(
      antigravitySessionOf(
        'C:\\Users\\bee\\.gemini\\antigravity-cli\\brain\\conv-2\\.system_generated\\logs\\transcript.jsonl'
      )
    ).toBe('conv-2');
    expect(antigravitySessionOf('/home/bee/.gemini/antigravity-cli/brain/conv-1/other.jsonl')).toBe('');
  });
});

describe('reading Antigravity token lines', () => {
  it('counts planner response lines and keeps cache read separate from input, without double-counting thinking', () => {
    const ledger = createTokenLedger('personal');
    readAntigravityTokenLine(ledger, 'conv-1', plannerLine({ step_index: 1 }));
    readAntigravityTokenLine(
      ledger,
      'conv-1',
      plannerLine({
        step_index: 3,
        created_at: '2026-11-21T22:45:00Z',
        input_tokens: 1000,
        cache_read_tokens: 5000,
        cache_write_tokens: 200,
        output_tokens: 100,
        thinking_tokens: 50,
      })
    );
    expect(ledger.skipped).toBe(0);
    expect(tokenRowsOf(ledger, 'antigravity')).toEqual([
      {
        hour: '2026-11-21T22:00:00.000Z',
        account: 'personal',
        provider: 'antigravity',
        model: 'gemini-4-neon-xhigh',
        input: 4134,
        cacheRead: 17152,
        cacheWrite: 200,
        output: 392,
        sessions: 1,
      },
    ]);
  });
  it('counts a step once by conversation and step index, keeping the largest numbers', () => {
    const ledger = createTokenLedger('personal');
    readAntigravityTokenLine(ledger, 'conv-1', plannerLine({ step_index: 1, output_tokens: 100 }));
    readAntigravityTokenLine(ledger, 'conv-1', plannerLine({ step_index: 1, output_tokens: 292 }));
    expect(tokenRowsOf(ledger, 'antigravity')[0]).toMatchObject({ output: 292, sessions: 1 });
  });
  it('ignores non-planner lines and steps with no tokens, time or model', () => {
    const ledger = createTokenLedger('personal');
    readAntigravityTokenLine(ledger, 'conv-1', JSON.stringify({ type: 'USER_INPUT', content: 'secret' }));
    readAntigravityTokenLine(
      ledger,
      'conv-1',
      plannerLine({ input_tokens: 0, cache_read_tokens: 0, output_tokens: 0 })
    );
    readAntigravityTokenLine(ledger, 'conv-1', plannerLine({ model: '' }));
    readAntigravityTokenLine(ledger, 'conv-1', plannerLine({ created_at: 'not a date' }));
    expect(ledger.skipped).toBe(0);
    expect(tokenRowsOf(ledger, 'antigravity')).toEqual([]);
  });
  it('counts broken json and absurd token counts as skipped', () => {
    const ledger = createTokenLedger('personal');
    readAntigravityTokenLine(ledger, 'conv-1', '{"type":"PLANNER_RESPONSE"');
    readAntigravityTokenLine(ledger, 'conv-1', plannerLine({ output_tokens: 1e30 }));
    expect(ledger.skipped).toBe(2);
    expect(tokenRowsOf(ledger, 'antigravity')).toEqual([]);
  });
});
