import { isPersonalAccount } from '#domain/accounts/account';
import {
  addTokenEntry,
  processedTokensOf,
  type TokenLedger,
  type TokenTable,
  tokenCountOf,
} from '#domain/usage/token-usage';

const DataFolder = 'opencode';
const Numbers = [
  "json_extract(data, '$.tokens.input') as input",
  "json_extract(data, '$.tokens.output') as output",
  "json_extract(data, '$.tokens.reasoning') as reasoning",
  "json_extract(data, '$.tokens.cache.read') as cacheRead",
  "json_extract(data, '$.tokens.cache.write') as cacheWrite",
].join(', ');

export const OpencodeTokenFiles = { suffixes: ['opencode.db'] };
export const OpencodeTokenTables: TokenTable[] = [
  {
    name: 'message',
    query: `select id, session_id as session, time_created as at, json_extract(data, '$.modelID') as model, ${Numbers} from message where json_valid(data) and json_extract(data, '$.role') = 'assistant'`,
  },
  {
    name: 'session_message',
    query: `select id, session_id as session, time_created as at, json_extract(data, '$.model.id') as model, ${Numbers} from session_message where type = 'assistant' and json_valid(data)`,
  },
];

type OpencodeRow = {
  id?: unknown;
  session?: unknown;
  at?: unknown;
  model?: unknown;
  input?: unknown;
  output?: unknown;
  reasoning?: unknown;
  cacheRead?: unknown;
  cacheWrite?: unknown;
};

export function opencodeTokenFolderOf(account: string, seatPath: string) {
  return isPersonalAccount(account) ? seatPath : `${seatPath}/${DataFolder}`;
}

export function readOpencodeTokenRow(ledger: TokenLedger, row: unknown) {
  if (typeof row !== 'object' || row === null) return;
  const record: OpencodeRow = row;
  const at = typeof record.at === 'number' ? new Date(record.at).getTime() : Number.NaN;
  const model = typeof record.model === 'string' ? record.model : '';
  if (!Number.isFinite(at) || model.length === 0) return;
  const input = tokenCountOf(record.input);
  const cacheRead = tokenCountOf(record.cacheRead);
  const cacheWrite = tokenCountOf(record.cacheWrite);
  const spoken = tokenCountOf(record.output);
  const reasoning = tokenCountOf(record.reasoning);
  if (
    input === undefined ||
    cacheRead === undefined ||
    cacheWrite === undefined ||
    spoken === undefined ||
    reasoning === undefined
  ) {
    ledger.skipped += 1;
    return;
  }
  const counts = { input, cacheRead, cacheWrite, output: spoken + reasoning };
  if (processedTokensOf(counts) === 0) return;
  const key = typeof record.id === 'string' ? record.id : undefined;
  const session = typeof record.session === 'string' ? record.session : '';
  addTokenEntry(ledger, { key, at, session, model, ...counts });
}
