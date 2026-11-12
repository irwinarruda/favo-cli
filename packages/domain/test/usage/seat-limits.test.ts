import { describe, expect, it } from 'bun:test';
import {
  elapsedShareOf,
  formatDuration,
  isOldLimits,
  keepLastGoodLimits,
  limitsNoticeOf,
  paceOfShares,
  paceTickOf,
  readingAgeOf,
  remainingPercentOf,
  resetLabelOf,
  SeatLimits,
  sortLimitWindows,
  unavailableLimits,
} from '#domain/usage/seat-limits';

const Now = Date.parse('2026-11-01T12:00:00.000Z');
const Minute = 60_000;
const at = (offsetMs: number) => new Date(Now + offsetMs).toISOString();
const windowOf = (overrides = {}) => ({
  id: 'five_hour',
  kind: 'session' as const,
  label: 'Session',
  usedPercent: 32,
  ...overrides,
});

describe('a window', () => {
  it('shows what is left, not what is spent', () => {
    expect(remainingPercentOf(windowOf({ usedPercent: 32 }))).toBe(68);
    expect(remainingPercentOf(windowOf({ usedPercent: 32.6 }))).toBe(67);
  });
  it('sorts by kind: session, weekly, monthly, other', () => {
    const kinds = ['other', 'monthly', 'weekly', 'session'] as const;
    const windows = kinds.map((kind) => windowOf({ id: kind, kind }));
    expect(sortLimitWindows(windows).map(({ kind }) => kind)).toEqual(['session', 'weekly', 'monthly', 'other']);
  });
  it('refuses a percentage outside 0-100 on the wire', () => {
    const usage = (usedPercent: number) => ({ checkedAt: at(0), windows: [windowOf({ usedPercent })] });
    expect(SeatLimits.safeParse(usage(100)).success).toBe(true);
    expect(SeatLimits.safeParse(usage(101)).success).toBe(false);
  });
  it('refuses a time it could not read later', () => {
    expect(SeatLimits.safeParse({ checkedAt: 'yesterday-ish', windows: [] }).success).toBe(false);
    const windows = [windowOf({ resetsAt: 'soon' })];
    expect(SeatLimits.safeParse({ checkedAt: at(0), windows }).success).toBe(false);
  });
});

describe('pace', () => {
  const fiveHours = { windowDurationMins: 300 };

  it('measures how much of the window has passed', () => {
    expect(elapsedShareOf(windowOf({ ...fiveHours, resetsAt: at(150 * Minute) }), Now)).toBe(0.5);
  });
  it('clamps to the window', () => {
    expect(elapsedShareOf(windowOf({ ...fiveHours, resetsAt: at(400 * Minute) }), Now)).toBe(0);
    expect(elapsedShareOf(windowOf({ ...fiveHours, resetsAt: at(-Minute) }), Now)).toBe(1);
  });
  it('has no pace without a reset time or a length', () => {
    expect(elapsedShareOf(windowOf(fiveHours), Now)).toBeUndefined();
    expect(elapsedShareOf(windowOf({ resetsAt: at(Minute) }), Now)).toBeUndefined();
    expect(paceTickOf(windowOf(fiveHours), Now)).toBeUndefined();
  });
  it.each([
    [56, 'ahead'],
    [55, 'on'],
    [50, 'on'],
    [45, 'on'],
    [44, 'under'],
  ])('at %d%% used halfway through is %s, with 5 points either way', (used, pace) => {
    expect(paceOfShares(used, 0.5)).toBe(pace as ReturnType<typeof paceOfShares>);
  });
  it('puts the tick at the time left', () => {
    expect(paceTickOf(windowOf({ ...fiveHours, resetsAt: at(45 * Minute) }), Now)).toBe(15);
  });
});

describe('the reset countdown', () => {
  it.each([
    [2 * 1440 + 12 * 60, '2d 12h'],
    [65, '1h 5m'],
    [44, '44m'],
  ])('reads %d minutes as %s', (minutes, label) => {
    expect(formatDuration(minutes * Minute)).toBe(label);
  });
  it('says so once the reset has passed, which also means the percentages are old', () => {
    expect(resetLabelOf(windowOf({ resetsAt: at(0) }), Now)).toBe('resets now');
    expect(resetLabelOf(windowOf({ resetsAt: at(-Minute) }), Now)).toBe('resets now');
  });
  it('does not count seconds', () => {
    expect(resetLabelOf(windowOf({ resetsAt: at(59_000) }), Now)).toBe('resets momentarily');
    expect(resetLabelOf(windowOf({ resetsAt: at(Minute) }), Now)).toBe('↻ 1m');
  });
  it('says nothing without a reset time', () => {
    expect(resetLabelOf(windowOf(), Now)).toBeUndefined();
    expect(resetLabelOf(windowOf({ resetsAt: 'soon' }), Now)).toBeUndefined();
  });
});

describe('a reading', () => {
  const good = { checkedAt: at(-Minute), windows: [windowOf()] };
  const failed = unavailableLimits(at(0), 'probeFailed', 'Claude did not answer.');
  const unsupported = unavailableLimits(at(0), 'unsupported', 'This account has no subscription limits.');

  it('keeps the last good bars after a failed read, marked as old', () => {
    const kept = keepLastGoodLimits(good, failed);
    expect(kept).toEqual({ ...good, unavailable: failed.unavailable });
    expect(isOldLimits(kept, Now)).toBe(true);
    expect(limitsNoticeOf(kept)).toBeUndefined();
  });
  it('clears the bars when the account has no limits at all', () => {
    expect(keepLastGoodLimits(good, unsupported)).toEqual(unsupported);
  });
  it('replaces the last reading with a new good one', () => {
    const next = { checkedAt: at(0), windows: [windowOf({ usedPercent: 40 })] };
    expect(keepLastGoodLimits(good, next)).toEqual(next);
  });
  it('has nothing to keep the first time a read fails', () => {
    expect(keepLastGoodLimits(undefined, failed)).toEqual(failed);
  });
  it('turns old after five minutes', () => {
    expect(isOldLimits({ checkedAt: at(-4 * Minute), windows: [] }, Now)).toBe(false);
    expect(isOldLimits({ checkedAt: at(-5 * Minute), windows: [] }, Now)).toBe(true);
  });
  it('says how old it is', () => {
    expect(readingAgeOf(at(-30_000), Now)).toBe('read just now');
    expect(readingAgeOf(at(-12 * Minute), Now)).toBe('read 12m ago');
  });
  it('explains why there are no bars', () => {
    expect(limitsNoticeOf(unsupported)).toBe('This account has no subscription limits.');
    expect(limitsNoticeOf(unavailableLimits(at(0), 'unsupported'))).toBe('no limits available');
    expect(limitsNoticeOf(failed)).toBe('Claude did not answer.');
    expect(limitsNoticeOf(unavailableLimits(at(0), 'probeFailed'))).toBe('Could not read limits.');
    expect(limitsNoticeOf({ checkedAt: at(0), windows: [] })).toBe('No limits reported.');
  });
});
