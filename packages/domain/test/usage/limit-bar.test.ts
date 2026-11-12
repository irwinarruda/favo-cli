import { describe, expect, it } from 'bun:test';
import { limitBarOf, limitHeadlineOf, limitRowOf } from '#domain/usage/limit-bar';
import type { LimitPoolMember, LimitPoolWindow } from '#domain/usage/limit-pool';

function textOf(input: Parameters<typeof limitBarOf>[0]) {
  return limitBarOf(input)
    .map(({ text }) => text)
    .join('');
}

describe('a seat row', () => {
  const Now = Date.parse('2026-11-01T12:00:00.000Z');
  const window = {
    id: 'five_hour',
    kind: 'session' as const,
    label: 'Session',
    usedPercent: 32,
    windowDurationMins: 300,
    resetsAt: '2026-11-01T12:44:30.000Z',
  };
  const usage = { checkedAt: '2026-11-01T11:48:00.000Z', windows: [window] };
  const memberOf = (seatUsage: typeof usage & { unavailable?: { reason: 'probeFailed' } }) =>
    ({ seat: { usage: seatUsage }, window, refillPercent: 32, isStale: false }) as unknown as LimitPoolMember;

  it('gives the bar, the percent and when it comes back', () => {
    const { bar, percent, facts } = limitRowOf(memberOf(usage), 20, Now);
    expect(bar.map(({ text }) => text).join('')).toBe('▄▄▄█▄▄▄▄▄▄▄▄▄▄▂▂▂▂▂▂');
    expect(percent).toBe(' 68%');
    expect(facts).toBe('↻ 44m');
  });
  it('says how old the bars are when they were kept from before a failure', () => {
    const { facts } = limitRowOf(memberOf({ ...usage, unavailable: { reason: 'probeFailed' } }), 20, Now);
    expect(facts).toBe('↻ 44m · read 12m ago');
  });
});

describe('a window headline', () => {
  const headlineOf = (window: Partial<LimitPoolWindow>) =>
    limitHeadlineOf({ label: 'Session', remainingPercent: 81, ...window } as LimitPoolWindow);
  const textOfHeadline = (window: Partial<LimitPoolWindow>) => Object.values(headlineOf(window)).join('');

  it('reads as the screen draws it', () => {
    expect(textOfHeadline({ pace: 'under', restoresPercent: 16 })).toBe('Session    81% left  ↘   ↻ +16%');
    expect(textOfHeadline({ label: 'Weekly', pace: 'under' })).toBe('Weekly     81% left  ↘');
    expect(textOfHeadline({ label: 'Weekly · Fable' })).toBe('Weekly · Fable    81% left');
  });
  it('leaves out what it does not have', () => {
    expect(headlineOf({ pace: 'ahead' }).facts).toBe('  ↗');
    expect(headlineOf({ restoresPercent: 0 }).facts).toBe('');
  });
});

describe('the usage bar', () => {
  it('draws what is left, then what the next reset gives back, from the right edge', () => {
    expect(textOf({ remainingPercent: 68, refillPercent: 32, width: 20 })).toBe('▄▄▄▄▄▄▄▄▄▄▄▄▄▄▂▂▂▂▂▂');
  });
  it('shows the rest of the track only when the reset restores less than what is missing', () => {
    expect(textOf({ remainingPercent: 50, refillPercent: 20, width: 10 })).toBe('▄▄▄▄▄▁▁▁▂▂');
  });
  it('never gives back more than what is missing', () => {
    expect(textOf({ remainingPercent: 90, refillPercent: 100, width: 10 })).toBe('▄▄▄▄▄▄▄▄▄▂');
  });
  it('draws the pace tick over the bar, at the time left', () => {
    expect(textOf({ remainingPercent: 68, refillPercent: 32, tickPercent: 15, width: 20 })).toBe(
      '▄▄▄█▄▄▄▄▄▄▄▄▄▄▂▂▂▂▂▂'
    );
  });
  it('leaves the tick out when the bar is too narrow', () => {
    expect(textOf({ remainingPercent: 50, refillPercent: 0, tickPercent: 50, width: 5 })).toBe('▄▄▄▁▁');
  });
  it('keeps the tick on the bar at both ends', () => {
    expect(textOf({ remainingPercent: 100, refillPercent: 0, tickPercent: 0, width: 8 })).toBe('█▄▄▄▄▄▄▄');
    expect(textOf({ remainingPercent: 100, refillPercent: 0, tickPercent: 100, width: 8 })).toBe('▄▄▄▄▄▄▄█');
  });
  it('does not round a little left down to nothing, or a little used up to full', () => {
    expect(textOf({ remainingPercent: 1, refillPercent: 0, width: 20 })[0]).toBe('▄');
    expect(textOf({ remainingPercent: 99, refillPercent: 0, width: 20 }).at(-1)).toBe('▁');
  });
  it('fills the whole width at both extremes', () => {
    expect(textOf({ remainingPercent: 100, refillPercent: 0, width: 6 })).toBe('▄▄▄▄▄▄');
    expect(textOf({ remainingPercent: 0, refillPercent: 0, width: 6 })).toBe('▁▁▁▁▁▁');
  });
  it('hands each part over separately, so a front end can color it', () => {
    const parts = limitBarOf({ remainingPercent: 50, refillPercent: 50, tickPercent: 50, width: 10 });
    expect(parts.map(({ part }) => part)).toEqual(['left', 'tick', 'refill']);
  });
});
