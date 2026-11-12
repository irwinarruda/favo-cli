import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const Million = 1_000_000;
const DayMs = 24 * 3_600_000;
const TotalTokens = 12_400 * Million;
const DayShape = [1, 2, 1, 3, 2, 1, 1, 4, 3, 2, 5, 3, 1, 1, 2, 6, 8, 5, 3, 2, 1, 3, 4, 2, 1, 2, 5, 3, 2, 4];
const ShapeTotal = DayShape.reduce((total, level) => total + level, 0);
const TypeMix = { input: 0.01, cacheRead: 0.96, cacheWrite: 0.025, output: 0.005 };
const Seats = [
  { account: 'work', provider: 'claude', model: 'claude-opus-5-5', share: 0.34 },
  { account: 'work', provider: 'claude', model: 'claude-fable-5-2', share: 0.06 },
  { account: 'work', provider: 'codex', model: 'gpt-6-astra', share: 0.1 },
  { account: 'personal', provider: 'claude', model: 'claude-opus-5-5', share: 0.2 },
  { account: 'personal', provider: 'codex', model: 'gpt-6-astra', share: 0.15 },
  { account: 'client', provider: 'claude', model: 'claude-opus-5-5', share: 0.1 },
  { account: 'client', provider: 'claude', model: 'claude-fable-5-2', share: 0.05 },
];
const Rates = {
  'claude-opus-5-5': { input: 0.000002, output: 0.00001, cacheRead: 0.0000002, cacheWrite: 0.0000025 },
  'claude-fable-5-2': { input: 0.000005, output: 0.000025, cacheRead: 0.0000005, cacheWrite: 0.00000625 },
  'gpt-6-astra': { input: 0.000004, output: 0.00002, cacheRead: 0.0000004, cacheWrite: 0.000004 },
};

function write(path: string, lines: unknown[]) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);
}

function seatHome(home: string, account: string, provider: string) {
  if (account === 'personal') return `${home}/.${provider}`;
  return `${home}/.favo/accounts/${account}/${provider}`;
}

export function writeUsageFixture(home: string) {
  const now = Date.now();
  for (const [index, level] of DayShape.entries()) {
    const at = new Date(now - (DayShape.length - 1 - index) * DayMs).toISOString();
    for (const { account, provider, model, share } of Seats) {
      const tokens = (TotalTokens * share * level) / ShapeTotal;
      const counts = {
        input: Math.round(tokens * TypeMix.input),
        cacheRead: Math.round(tokens * TypeMix.cacheRead),
        cacheWrite: Math.round(tokens * TypeMix.cacheWrite),
        output: Math.round(tokens * TypeMix.output),
      };
      const id = `${account}-${model}-${index}`;
      const folder = seatHome(home, account, provider);
      if (provider === 'claude') {
        const usage = {
          input_tokens: counts.input,
          cache_read_input_tokens: counts.cacheRead,
          cache_creation_input_tokens: counts.cacheWrite,
          output_tokens: counts.output,
        };
        const message = { id: `msg_${id}`, model, usage };
        const line = { type: 'assistant', timestamp: at, requestId: `req_${id}`, sessionId: `session-${id}`, message };
        write(`${folder}/projects/-Users-bee-code-hive/session-${id}.jsonl`, [line]);
        continue;
      }
      const input = counts.input + counts.cacheRead + counts.cacheWrite;
      const usage = {
        input_tokens: input,
        cached_input_tokens: counts.cacheRead,
        cache_write_input_tokens: counts.cacheWrite,
        output_tokens: counts.output,
        total_tokens: input + counts.output,
      };
      write(`${folder}/sessions/rollout-${id}.jsonl`, [
        { timestamp: at, type: 'session_meta', payload: { id: `session-${id}` } },
        { timestamp: at, type: 'turn_context', payload: { model } },
        {
          timestamp: at,
          type: 'event_msg',
          payload: { type: 'token_count', info: { last_token_usage: usage, total_token_usage: usage } },
        },
      ]);
    }
  }
  write(`${home}/.favo/usage/prices.json`, [{ fetchedAt: new Date(now).toISOString(), rates: Rates }]);
}
