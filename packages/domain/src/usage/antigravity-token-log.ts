import { isPersonalAccount } from '#domain/accounts/account';
import { Providers } from '#domain/providers/provider';
import { parseJson } from '#domain/shared/parse-json';
import { addTokenEntry, processedTokensOf, type TokenLedger, timeOf, tokenCountOf } from '#domain/usage/token-usage';

export const AntigravityTokenFiles = {
  folder: 'brain',
  relativePath: '.system_generated/logs/transcript.jsonl',
};
export const AntigravityTokenMarkers = ['"PLANNER_RESPONSE"'];

const TranscriptTail = `/${AntigravityTokenFiles.relativePath}`;

type AntigravityStep = {
  type?: unknown;
  step_index?: unknown;
  created_at?: unknown;
  model?: unknown;
  input_tokens?: unknown;
  cache_read_tokens?: unknown;
  cache_write_tokens?: unknown;
  output_tokens?: unknown;
};

export function antigravityTokenFolderOf(account: string, seatPath: string) {
  const base = isPersonalAccount(account) ? seatPath : `${seatPath}/${Providers.antigravity.personalHome}`;
  return `${base}/${AntigravityTokenFiles.folder}`;
}

export function antigravitySessionOf(path: string) {
  const normalized = path.replaceAll('\\', '/');
  if (!normalized.endsWith(TranscriptTail)) return '';
  const parent = normalized.slice(0, -TranscriptTail.length);
  return parent.slice(parent.lastIndexOf('/') + 1);
}

export function readAntigravityTokenLine(ledger: TokenLedger, session: string, line: string) {
  const parsed = parseJson(line);
  if (parsed === undefined) {
    ledger.skipped += 1;
    return;
  }
  if (typeof parsed !== 'object' || parsed === null) return;
  const record: AntigravityStep = parsed;
  if (record.type !== 'PLANNER_RESPONSE') return;
  const at = timeOf(record.created_at);
  const model = typeof record.model === 'string' && record.model.length > 0 ? record.model : undefined;
  if (at === undefined || model === undefined) return;
  const input = tokenCountOf(record.input_tokens);
  const cacheRead = tokenCountOf(record.cache_read_tokens);
  const cacheWrite = tokenCountOf(record.cache_write_tokens);
  const output = tokenCountOf(record.output_tokens);
  if (input === undefined || cacheRead === undefined || cacheWrite === undefined || output === undefined) {
    ledger.skipped += 1;
    return;
  }
  const counts = { input, cacheRead, cacheWrite, output };
  if (processedTokensOf(counts) === 0) return;
  const stepIndex = stepIndexOf(record.step_index);
  const key = session.length > 0 && stepIndex !== undefined ? `${session}:${stepIndex}` : undefined;
  addTokenEntry(ledger, { key, at, session, model, ...counts });
}

function stepIndexOf(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined;
}
