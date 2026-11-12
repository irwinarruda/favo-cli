import { parseJson } from '#domain/shared/parse-json';
import { addTokenEntry, type TokenLedger, timeOf, tokenCountOf } from '#domain/usage/token-usage';

const SyntheticModel = '<synthetic>';
const AdvisorMessage = 'advisor_message';

export const ClaudeTokenFiles = { folder: 'projects', suffixes: ['.jsonl'] };
export const ClaudeTokenMarkers = ['"usage"'];

type ClaudeUsage = {
  input_tokens?: unknown;
  cache_read_input_tokens?: unknown;
  cache_creation_input_tokens?: unknown;
  output_tokens?: unknown;
  model?: unknown;
  type?: unknown;
  iterations?: unknown;
};

type ClaudeLine = {
  type?: unknown;
  timestamp?: unknown;
  requestId?: unknown;
  sessionId?: unknown;
  message?: { id?: unknown; model?: unknown; usage?: ClaudeUsage };
};

export function readClaudeTokenLine(ledger: TokenLedger, line: string) {
  const parsed = parseJson(line);
  if (parsed === undefined) {
    ledger.skipped += 1;
    return;
  }
  if (typeof parsed !== 'object' || parsed === null) return;
  const record: ClaudeLine = parsed;
  const { message } = record;
  const usage = message?.usage;
  if (record.type !== 'assistant' || !message || typeof usage !== 'object' || usage === null) return;
  const at = timeOf(record.timestamp);
  const model = modelOf(message.model);
  if (at === undefined || model === undefined) return;
  const session = typeof record.sessionId === 'string' ? record.sessionId : '';
  const key = keyOf(message.id, record.requestId);
  const counts = countsOf(usage);
  if (!counts) {
    ledger.skipped += 1;
    return;
  }
  addTokenEntry(ledger, { key, at, session, model, ...counts });
  const iterations: ClaudeUsage[] = Array.isArray(usage.iterations) ? usage.iterations : [];
  for (const [index, iteration] of iterations.entries()) {
    const advisor = iteration?.type === AdvisorMessage ? modelOf(iteration.model) : undefined;
    const advisorCounts = advisor === undefined ? undefined : countsOf(iteration);
    if (advisor === undefined || !advisorCounts) continue;
    const advisorKey = key === undefined ? undefined : `${key}:advisor:${index}`;
    addTokenEntry(ledger, { key: advisorKey, at, session, model: advisor, ...advisorCounts });
  }
}

function modelOf(value: unknown) {
  return typeof value === 'string' && value.length > 0 && value !== SyntheticModel ? value : undefined;
}

function keyOf(messageId: unknown, requestId: unknown) {
  const message = typeof messageId === 'string' ? messageId : undefined;
  const request = typeof requestId === 'string' ? requestId : undefined;
  return message === undefined && request === undefined ? undefined : `${message ?? ''}:${request ?? ''}`;
}

function countsOf(usage: ClaudeUsage) {
  const input = tokenCountOf(usage.input_tokens);
  const cacheRead = tokenCountOf(usage.cache_read_input_tokens);
  const cacheWrite = tokenCountOf(usage.cache_creation_input_tokens);
  const output = tokenCountOf(usage.output_tokens);
  const isCountable =
    input !== undefined && cacheRead !== undefined && cacheWrite !== undefined && output !== undefined;
  return isCountable ? { input, cacheRead, cacheWrite, output } : undefined;
}
