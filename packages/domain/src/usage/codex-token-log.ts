import { parseJson } from '#domain/shared/parse-json';
import {
  addTokenEntry,
  isCreatedBefore,
  MaximumTokenCount,
  type TokenLedger,
  type TokenSource,
  timeOf,
} from '#domain/usage/token-usage';

const ForkCopyMaximumGapMs = 1_000;

export const CodexTokenFiles = { folder: 'sessions', suffixes: ['.jsonl', '.jsonl.zst'] };
export const CodexTokenMarkers = ['"token_count"', '"token_usage_record"', '"turn_context"', '"session_meta"'];

const CounterFields = ['input', 'cached', 'cacheWrite', 'output', 'reasoning', 'total'] as const;

type CodexCounters = Record<(typeof CounterFields)[number], number>;
type CodexRequest = { at: number; model: string; counters: CodexCounters };

type CodexLine = {
  type?: unknown;
  timestamp?: unknown;
  payload?: {
    type?: unknown;
    id?: unknown;
    session_id?: unknown;
    model?: unknown;
    forked_from_id?: unknown;
    source?: { subagent?: { thread_spawn?: { parent_thread_id?: unknown } } };
    info?: { last_token_usage?: unknown; total_token_usage?: unknown };
    usage?: unknown;
  };
};

export type CodexRollout = {
  session: string;
  model: string;
  hasSessionMeta: boolean;
  isSkippingForkCopies: boolean;
  forkCopyAt: number;
  lastSignature?: string;
  lastTotal?: CodexCounters;
  sequenceStart?: string;
  unreported?: CodexRequest[];
};

export function codexRolloutsOf<Log extends TokenSource & { path: string }>(logs: Log[]) {
  const [plainSuffix, compressedSuffix] = CodexTokenFiles.suffixes as [string, string];
  const packedLength = compressedSuffix.length - plainSuffix.length;
  const plain = new Set(logs.map(({ path }) => path).filter((path) => path.endsWith(plainSuffix)));
  const rollouts = new Map<string, Log & { session: string }>();
  const repeatedAccounts = new Set<string>();
  for (const log of logs) {
    const isPlain = plain.has(log.path);
    if (!isPlain && plain.has(log.path.slice(0, -packedLength))) continue;
    const session = log.path.slice(log.path.lastIndexOf('/') + 1);
    const name = isPlain ? session : session.slice(0, -packedLength);
    const held = rollouts.get(name);
    const isFirst = !held || isCreatedBefore(log, held);
    if (held && held.account !== log.account) repeatedAccounts.add(isFirst ? held.account : log.account);
    if (isFirst) rollouts.set(name, { ...log, session });
  }
  return { rollouts: [...rollouts.values()], repeatedAccounts };
}

export function createCodexRollout(session: string): CodexRollout {
  return { session, model: '', hasSessionMeta: false, isSkippingForkCopies: false, forkCopyAt: 0 };
}

export function readCodexTokenLine(ledger: TokenLedger, rollout: CodexRollout, line: string) {
  const parsed = parseJson(line);
  if (parsed === undefined) {
    ledger.skipped += 1;
    return;
  }
  if (typeof parsed !== 'object' || parsed === null) return;
  const record: CodexLine = parsed;
  const { payload } = record;
  if (typeof payload !== 'object' || payload === null) return;
  if (record.type === 'session_meta') readSessionMeta(rollout, record);
  else if (record.type === 'turn_context')
    rollout.model = typeof payload.model === 'string' ? payload.model : rollout.model;
  else if (record.type === 'token_usage_record') readUsageRecord(rollout, record);
  else if (payload.type === 'token_count') readTokenCount(ledger, rollout, record);
}

function readSessionMeta(rollout: CodexRollout, { timestamp, payload }: CodexLine) {
  if (rollout.hasSessionMeta) return;
  rollout.hasSessionMeta = true;
  const id = payload?.id ?? payload?.session_id;
  if (typeof id === 'string') rollout.session = id;
  const at = timeOf(timestamp);
  const parent = payload?.source?.subagent?.thread_spawn?.parent_thread_id;
  const isFork = typeof payload?.forked_from_id === 'string' || typeof parent === 'string';
  if (at === undefined || !isFork) return;
  rollout.isSkippingForkCopies = true;
  rollout.forkCopyAt = at;
}

function readUsageRecord(rollout: CodexRollout, { timestamp, payload }: CodexLine) {
  const at = timeOf(timestamp);
  const counters = countersOf(payload?.usage);
  if (at === undefined || counters === undefined || rollout.model.length === 0) return;
  if (isForkCopy(rollout, at)) return;
  rollout.unreported = [...(rollout.unreported ?? []), { at, model: rollout.model, counters }];
}

function readTokenCount(ledger: TokenLedger, rollout: CodexRollout, { timestamp, payload }: CodexLine) {
  const info = payload?.info;
  const at = timeOf(timestamp);
  if (typeof info !== 'object' || info === null || at === undefined || rollout.model.length === 0) return;
  const last = countersOf(info.last_token_usage);
  const hasTotal = info.total_token_usage !== undefined && info.total_token_usage !== null;
  const total = hasTotal ? countersOf(info.total_token_usage) : undefined;
  if (isForkCopy(rollout, at)) {
    const signature = last === undefined ? undefined : JSON.stringify(last);
    if (total !== undefined) rebase(rollout, total);
    else if (!hasTotal && last !== undefined && signature !== rollout.lastSignature) {
      rollout.lastTotal = combined(rollout.lastTotal, last, 1);
    }
    rollout.lastSignature = signature;
    return;
  }
  const previous = rollout.lastTotal;
  const pending = rollout.unreported;
  if (total !== undefined) rebase(rollout, total);
  if (last === undefined || (hasTotal && total === undefined)) {
    ledger.skipped += 1;
    return;
  }
  if (last.input + last.output === 0) {
    rollout.lastSignature = undefined;
    return;
  }
  if (total !== undefined && previous !== undefined && isSame(total, previous)) return;
  if (last.total !== last.input + last.output) {
    ledger.skipped += 1;
    return;
  }
  const signature = JSON.stringify(last);
  let bridged: CodexRequest[] = [];
  if (total !== undefined) {
    const isRestarted = isSame(total, last);
    const sequenceStart = JSON.stringify([at, last]);
    if (isRestarted && sequenceStart === rollout.sequenceStart) {
      rollout.lastTotal = previous;
      return;
    }
    const gap = combined(total, previous, -1);
    const isReconciled = previous === undefined ? combined(total, last, -1) !== undefined : gap && isSame(gap, last);
    if (!isRestarted && !isReconciled) {
      const explained = unreportedRequests(gap, last, previous === undefined ? undefined : pending);
      if (explained === undefined && !isWithin(last, total, previous)) {
        ledger.skipped += 1;
        return;
      }
      bridged = explained ?? [];
    }
    if (isRestarted) rollout.sequenceStart = sequenceStart;
  } else {
    if (signature === rollout.lastSignature) return;
    const next = combined(previous, last, 1);
    if (next === undefined) {
      ledger.skipped += 1;
      return;
    }
    rollout.lastTotal = next;
  }
  rollout.lastSignature = signature;
  for (const request of [...bridged, { at, model: rollout.model, counters: last }]) {
    addTokenEntry(ledger, { at: request.at, session: rollout.session, model: request.model, ...countsOf(request) });
  }
}

function unreportedRequests(gap: CodexCounters | undefined, last: CodexCounters, pending: CodexRequest[] | undefined) {
  if (gap === undefined || pending === undefined) return undefined;
  const reported = pending.reduce<CodexCounters | undefined>(
    (sum, request) => (sum === undefined ? undefined : combined(sum, request.counters, 1)),
    emptyCounters()
  );
  if (reported === undefined || !isSame(gap, reported)) return undefined;
  const final = pending.at(-1)!;
  const remainder = combined(final.counters, last, -1);
  if (remainder === undefined) return undefined;
  const requests = [...pending.slice(0, -1), { ...final, counters: remainder }];
  return requests.filter(({ counters }) => counters.input + counters.output > 0);
}

function isForkCopy(rollout: CodexRollout, at: number) {
  if (!rollout.isSkippingForkCopies) return false;
  if (at - rollout.forkCopyAt < ForkCopyMaximumGapMs) {
    rollout.forkCopyAt = at;
    return true;
  }
  rollout.isSkippingForkCopies = false;
  rollout.lastSignature = undefined;
  return false;
}

function rebase(rollout: CodexRollout, total: CodexCounters) {
  rollout.lastTotal = total;
  rollout.unreported = undefined;
  if (total.input + total.output === 0) rollout.sequenceStart = undefined;
}

function countsOf({ counters }: CodexRequest) {
  return {
    input: counters.input - counters.cached - counters.cacheWrite,
    cacheRead: counters.cached,
    cacheWrite: counters.cacheWrite,
    output: counters.output,
  };
}

function countersOf(value: unknown) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const raw: Record<string, unknown> = { ...value };
  const { input_tokens: input, output_tokens: output } = raw;
  if (typeof input !== 'number' || typeof output !== 'number') return undefined;
  return validCounters({
    input,
    cached: raw.cached_input_tokens ?? 0,
    cacheWrite: raw.cache_write_input_tokens ?? 0,
    output,
    reasoning: raw.reasoning_output_tokens ?? 0,
    total: raw.total_tokens ?? input + output,
  });
}

function validCounters(counters: Record<keyof CodexCounters, unknown>) {
  const isEveryCount = CounterFields.every(
    (field) =>
      Number.isInteger(counters[field]) && Number(counters[field]) >= 0 && Number(counters[field]) <= MaximumTokenCount
  );
  if (!isEveryCount) return undefined;
  const valid = counters as CodexCounters;
  const isCoherent =
    valid.cached + valid.cacheWrite <= valid.input &&
    valid.reasoning <= valid.output &&
    valid.total >= valid.input + valid.output;
  return isCoherent ? valid : undefined;
}

function combined(left: CodexCounters | undefined, right: CodexCounters | undefined, sign: 1 | -1) {
  if (sign === -1 && (left === undefined || right === undefined)) return undefined;
  const sums = CounterFields.map((field) => [field, (left?.[field] ?? 0) + sign * (right?.[field] ?? 0)]);
  return validCounters(Object.fromEntries(sums));
}

function emptyCounters(): CodexCounters {
  return { input: 0, cached: 0, cacheWrite: 0, output: 0, reasoning: 0, total: 0 };
}

function isWithin(last: CodexCounters, total: CodexCounters, previous: CodexCounters | undefined) {
  if (previous === undefined) return false;
  return CounterFields.every((field) => total[field] - previous[field] >= last[field]);
}

function isSame(left: CodexCounters, right: CodexCounters) {
  return CounterFields.every((field) => left[field] === right[field]);
}
