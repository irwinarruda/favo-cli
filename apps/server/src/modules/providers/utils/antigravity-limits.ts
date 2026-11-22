import { parseJson } from '@favo/domain/shared/parse-json';
import {
  clampPercent,
  LimitsUnavailableReason,
  type LimitWindow,
  LimitWindowKind,
  NoSubscriptionLimitsMessage,
  type SeatLimits,
  sortLimitWindows,
  unavailableLimits,
} from '@favo/domain/usage/seat-limits';

const SessionMins = 5 * 60;
const WeekMins = 7 * 24 * 60;
const TrailingModels = /\s+models$/i;
const WordAnd = /\s+and\s+/gi;

type AntigravityBucket = {
  id?: unknown;
  name?: unknown;
  window?: unknown;
  remaining_fraction?: unknown;
  reset_time?: unknown;
} | null;

type AntigravityGroup = {
  name?: unknown;
  buckets?: unknown;
} | null;

type AntigravityUsageOutput = {
  status?: unknown;
  command?: {
    name?: unknown;
    data?: {
      groups?: unknown;
    } | null;
  } | null;
};

export function antigravityLimitsOf(stdout: string, checkedAt: string): SeatLimits {
  const parsed = parseJson(stdout);
  if (typeof parsed !== 'object' || parsed === null) {
    return unavailableLimits(checkedAt, LimitsUnavailableReason.probeFailed, 'Antigravity did not answer.');
  }
  const output = parsed as AntigravityUsageOutput;
  if (output.status !== 'SUCCESS' || output.command?.name !== 'usage') {
    return unavailableLimits(checkedAt, LimitsUnavailableReason.probeFailed, 'Antigravity did not answer.');
  }
  const groups = output.command.data?.groups;
  if (!Array.isArray(groups)) {
    return unavailableLimits(checkedAt, LimitsUnavailableReason.probeFailed, 'Antigravity did not answer.');
  }
  if (groups.length === 0) {
    return unavailableLimits(checkedAt, LimitsUnavailableReason.unsupported, NoSubscriptionLimitsMessage);
  }
  const windows = (groups as AntigravityGroup[]).flatMap(groupWindowsOf);
  return { checkedAt, windows: sortLimitWindows(windows) };
}

function groupWindowsOf(group: AntigravityGroup): LimitWindow[] {
  if (!group || !Array.isArray(group.buckets)) return [];
  const groupName = typeof group.name === 'string' ? shortGroupNameOf(group.name) : undefined;
  return (group.buckets as AntigravityBucket[]).flatMap((bucket) => {
    const window = bucketWindowOf(bucket, groupName);
    return window ? [window] : [];
  });
}

function bucketWindowOf(bucket: AntigravityBucket, groupName: string | undefined): LimitWindow | undefined {
  if (!bucket || typeof bucket.remaining_fraction !== 'number' || !Number.isFinite(bucket.remaining_fraction)) {
    return undefined;
  }
  const remaining = Math.max(0, Math.min(1, bucket.remaining_fraction));
  const usedPercent = clampPercent((1 - remaining) * 100);
  const { kind, prefix, windowDurationMins } = windowKindOf(bucket.window, bucket.name);
  const id = bucketIdOf(bucket.id, groupName, kind);
  const label = groupName ? `${prefix} · ${groupName}` : prefix;
  return { id, kind, label, usedPercent, windowDurationMins, resetsAt: isoOf(bucket.reset_time) };
}

function windowKindOf(window: unknown, name: unknown) {
  if (window === '5h') return { kind: LimitWindowKind.session, prefix: 'Session', windowDurationMins: SessionMins };
  if (window === 'weekly') return { kind: LimitWindowKind.weekly, prefix: 'Weekly', windowDurationMins: WeekMins };
  return { kind: LimitWindowKind.other, prefix: fallbackLabelOf(name, window), windowDurationMins: undefined };
}

function fallbackLabelOf(name: unknown, window: unknown) {
  if (typeof name === 'string' && name.trim().length > 0) return name.trim();
  if (typeof window === 'string' && window.trim().length > 0) return window.trim();
  return 'Limit';
}

function bucketIdOf(id: unknown, groupName: string | undefined, kind: LimitWindowKind) {
  if (typeof id === 'string' && id.trim().length > 0) return id.trim();
  const slug =
    (groupName ?? 'limit')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'limit';
  if (kind === LimitWindowKind.session) return `${slug}-5h`;
  if (kind === LimitWindowKind.weekly) return `${slug}-weekly`;
  return `${slug}-${kind}`;
}

function shortGroupNameOf(name: string) {
  const cleaned = name.trim().replace(TrailingModels, '').replace(WordAnd, ' & ').trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

function isoOf(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const at = Date.parse(value);
  return Number.isFinite(at) ? new Date(at).toISOString() : undefined;
}
