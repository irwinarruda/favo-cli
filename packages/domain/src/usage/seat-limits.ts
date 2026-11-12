import { z } from 'zod';
import type { ValueOf } from '#domain/shared/value-of';

const Minute = 60_000;
const Hour = 60 * Minute;
const Day = 24 * Hour;
const PaceTolerance = 5;

export const LimitsFreshForMs = 5 * Minute;
export const NoSubscriptionLimitsMessage = 'This account has no subscription limits.';

export const LimitWindowKind = {
  session: 'session',
  weekly: 'weekly',
  monthly: 'monthly',
  other: 'other',
} as const;
export type LimitWindowKind = ValueOf<typeof LimitWindowKind>;

export const LimitsUnavailableReason = {
  unsupported: 'unsupported',
  probeFailed: 'probeFailed',
} as const;
export type LimitsUnavailableReason = ValueOf<typeof LimitsUnavailableReason>;

export const LimitPace = {
  ahead: 'ahead',
  on: 'on',
  under: 'under',
} as const;
export type LimitPace = ValueOf<typeof LimitPace>;

export const LimitPaceArrows: Record<LimitPace, string> = { ahead: '↗', on: '→', under: '↘' };

export const LimitWindow = z.strictObject({
  id: z.string(),
  kind: z.enum(LimitWindowKind),
  label: z.string(),
  usedPercent: z.number().min(0).max(100),
  resetsAt: z.iso.datetime().optional(),
  windowDurationMins: z.number().optional(),
});
export type LimitWindow = z.infer<typeof LimitWindow>;

export const SeatLimits = z.strictObject({
  checkedAt: z.iso.datetime(),
  windows: z.array(LimitWindow),
  unavailable: z.strictObject({ reason: z.enum(LimitsUnavailableReason), message: z.string().optional() }).optional(),
});
export type SeatLimits = z.infer<typeof SeatLimits>;

const KindOrder: Record<LimitWindowKind, number> = { session: 0, weekly: 1, monthly: 2, other: 3 };

export function compareLimitKinds(left: { kind: LimitWindowKind }, right: { kind: LimitWindowKind }) {
  return KindOrder[left.kind] - KindOrder[right.kind];
}

export function sortLimitWindows(windows: LimitWindow[]) {
  return windows.toSorted(compareLimitKinds);
}

export function clampPercent(value: number) {
  return Math.max(0, Math.min(100, value));
}

export function unavailableLimits(checkedAt: string, reason: LimitsUnavailableReason, message?: string): SeatLimits {
  return { checkedAt, windows: [], unavailable: { reason, message } };
}

export function keepLastGoodLimits(previous: SeatLimits | undefined, next: SeatLimits): SeatLimits {
  const isFailure = next.unavailable?.reason === LimitsUnavailableReason.probeFailed;
  if (!isFailure || !previous || previous.windows.length === 0) return next;
  return { ...previous, unavailable: next.unavailable };
}

export function isOldLimits(usage: SeatLimits, now: number) {
  if (usage.unavailable?.reason === LimitsUnavailableReason.probeFailed) return true;
  return now - Date.parse(usage.checkedAt) >= LimitsFreshForMs;
}

export function limitsNoticeOf({ unavailable, windows }: SeatLimits) {
  if (unavailable?.reason === LimitsUnavailableReason.unsupported) return unavailable.message ?? 'no limits available';
  if (windows.length > 0) return undefined;
  if (unavailable?.reason === LimitsUnavailableReason.probeFailed)
    return unavailable.message ?? 'Could not read limits.';
  return 'No limits reported.';
}

export function remainingPercentOf(window: LimitWindow) {
  return Math.round(100 - clampPercent(window.usedPercent));
}

export function resetMillisOf(window: LimitWindow) {
  if (window.resetsAt === undefined) return undefined;
  const at = Date.parse(window.resetsAt);
  return Number.isFinite(at) ? at : undefined;
}

export function elapsedShareOf(window: LimitWindow, now: number) {
  const resetsAt = resetMillisOf(window);
  if (resetsAt === undefined || window.windowDurationMins === undefined) return undefined;
  const length = window.windowDurationMins * Minute;
  if (length <= 0) return undefined;
  return Math.max(0, Math.min(1, (length - (resetsAt - now)) / length));
}

export function paceOfShares(usedPercent: number, elapsed: number) {
  const gap = usedPercent - elapsed * 100;
  if (gap > PaceTolerance) return LimitPace.ahead;
  if (gap < -PaceTolerance) return LimitPace.under;
  return LimitPace.on;
}

export function paceTickOf(window: LimitWindow, now: number) {
  const elapsed = elapsedShareOf(window, now);
  return elapsed === undefined ? undefined : Math.round((1 - elapsed) * 100);
}

export function formatDuration(ms: number) {
  const remaining = Math.max(0, ms);
  const days = Math.floor(remaining / Day);
  const hours = Math.floor((remaining % Day) / Hour);
  const minutes = Math.floor((remaining % Hour) / Minute);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function resetLabelOf(window: LimitWindow, now: number) {
  const resetsAt = resetMillisOf(window);
  if (resetsAt === undefined) return undefined;
  if (resetsAt <= now) return 'resets now';
  if (resetsAt - now < Minute) return 'resets momentarily';
  return `↻ ${formatDuration(resetsAt - now)}`;
}

export function readingAgeOf(checkedAt: string, now: number) {
  const age = now - Date.parse(checkedAt);
  if (age < Minute) return 'read just now';
  return `read ${formatDuration(age)} ago`;
}
