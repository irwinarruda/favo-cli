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

type ClaudeWindow = { utilization?: unknown; resets_at?: unknown } | null;
type ClaudeScopedWindow = ClaudeWindow & { display_name?: unknown };
type ClaudeMoney = { amount_minor?: unknown; currency?: unknown; exponent?: unknown } | null;
type ClaudeRateLimits = {
  five_hour?: ClaudeWindow;
  seven_day?: ClaudeWindow;
  model_scoped?: unknown;
  spend?: { enabled?: unknown; used?: ClaudeMoney; limit?: ClaudeMoney } | null;
  extra_usage?: {
    is_enabled?: unknown;
    used_credits?: unknown;
    monthly_limit?: unknown;
    utilization?: unknown;
  } | null;
};

export type ClaudeLimitsResponse = { rate_limits_available?: unknown; rate_limits?: ClaudeRateLimits | null };

export function claudeLimitsOf(response: ClaudeLimitsResponse | undefined, checkedAt: string): SeatLimits {
  if (response?.rate_limits_available === false) {
    return unavailableLimits(checkedAt, LimitsUnavailableReason.unsupported, NoSubscriptionLimitsMessage);
  }
  const limits = response?.rate_limits;
  if (response?.rate_limits_available !== true || typeof limits !== 'object' || limits === null) {
    return unavailableLimits(checkedAt, LimitsUnavailableReason.probeFailed);
  }
  const session = { id: 'five_hour', kind: LimitWindowKind.session, label: 'Session', windowDurationMins: SessionMins };
  const week = { id: 'seven_day', kind: LimitWindowKind.weekly, label: 'Weekly', windowDurationMins: WeekMins };
  const windows = [
    windowOf(session, limits.five_hour),
    windowOf(week, limits.seven_day),
    ...scopedWindowsOf(limits.model_scoped),
    spendWindowOf(limits),
  ];
  return { checkedAt, windows: sortLimitWindows(windows.filter((window) => window !== undefined)) };
}

function windowOf(spec: Omit<LimitWindow, 'usedPercent'>, window: ClaudeWindow | undefined) {
  if (typeof window?.utilization !== 'number') return undefined;
  return { ...spec, usedPercent: clampPercent(window.utilization), resetsAt: isoOf(window.resets_at) };
}

function scopedWindowsOf(scoped: unknown) {
  if (!Array.isArray(scoped)) return [];
  return (scoped as (ClaudeScopedWindow | null)[]).flatMap((entry) => {
    if (typeof entry?.display_name !== 'string') return [];
    const slug = entry.display_name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const spec = {
      id: `seven_day_${slug}`,
      kind: LimitWindowKind.weekly,
      label: `Weekly · ${entry.display_name}`,
      windowDurationMins: WeekMins,
    };
    return [windowOf(spec, entry)];
  });
}

function spendWindowOf(limits: ClaudeRateLimits) {
  const usedPercent = spendPercentOf(limits);
  if (usedPercent === undefined) return undefined;
  return { id: 'monthly_spend', kind: LimitWindowKind.monthly, label: 'Monthly spend', usedPercent };
}

function spendPercentOf({ spend, extra_usage: extra }: ClaudeRateLimits) {
  const used = spend?.used;
  const limit = spend?.limit;
  const isSameMoney =
    Boolean(used?.currency) && used?.currency === limit?.currency && used?.exponent === limit?.exponent;
  const spent = spend?.enabled === true && isSameMoney ? percentOf(used?.amount_minor, limit?.amount_minor) : undefined;
  if (spent !== undefined) return spent;
  if (extra?.is_enabled !== true) return undefined;
  const reported = percentOf(extra.used_credits, extra.monthly_limit) ?? extra.utilization;
  return typeof reported === 'number' && Number.isFinite(reported) && reported >= 0
    ? clampPercent(reported)
    : undefined;
}

function percentOf(used: unknown, limit: unknown) {
  if (typeof used !== 'number' || typeof limit !== 'number') return undefined;
  if (!Number.isFinite(used) || !Number.isFinite(limit) || used < 0 || limit <= 0) return undefined;
  return clampPercent((used / limit) * 100);
}

function isoOf(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const at = Date.parse(value);
  return Number.isFinite(at) ? new Date(at).toISOString() : undefined;
}
