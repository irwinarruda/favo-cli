import { describe, expect, it } from 'bun:test';
import { ProviderId } from '#domain/providers/provider';
import { collectLimitPools, type LimitPool, type LimitSeat } from '#domain/usage/limit-pool';
import { type SeatLimits, unavailableLimits } from '#domain/usage/seat-limits';

const Now = Date.parse('2026-11-01T12:00:00.000Z');
const Minute = 60_000;
const Day = 1440 * Minute;
const at = (offsetMs: number) => new Date(Now + offsetMs).toISOString();

function sessionOf(usedPercent: number, resetMs = 60 * Minute) {
  return {
    id: 'five_hour',
    kind: 'session' as const,
    label: 'Session',
    usedPercent,
    windowDurationMins: 300,
    resetsAt: at(resetMs) as string | undefined,
  };
}

function weekOf(usedPercent: number, resetMs = 3 * Day) {
  const resetsAt = at(resetMs) as string | undefined;
  return {
    id: 'seven_day',
    kind: 'weekly' as const,
    label: 'Weekly',
    usedPercent,
    windowDurationMins: 10080,
    resetsAt,
  };
}

function seatOf(displayName: string, windows: SeatLimits['windows'], overrides: Partial<LimitSeat> = {}): LimitSeat {
  return {
    key: `macbook/${displayName}/claude`,
    machineName: 'macbook',
    displayName,
    provider: ProviderId.claude,
    identity: `${displayName}@bee.dev`,
    usage: { checkedAt: at(0), windows },
    ...overrides,
  };
}

function poolOf(seats: LimitSeat[]) {
  return collectLimitPools(seats, Now)[0] as LimitPool;
}

function firstWindowOf(seats: LimitSeat[]) {
  return poolOf(seats).windows[0]!;
}

describe('pooling', () => {
  const work = seatOf('work', [sessionOf(32, 44 * Minute)]);
  const match = seatOf('match', [sessionOf(7, 54 * Minute)]);

  it('gives the worked example: 68% and 93% left is 81% left and +16% next', () => {
    const window = firstWindowOf([work, match]);
    expect(window.remainingPercent).toBe(81);
    expect(window.restoresPercent).toBe(16);
  });
  it('makes one group per provider, in the usual order', () => {
    const codex = seatOf('work', [sessionOf(1)], { provider: ProviderId.codex, key: 'codex' });
    expect(collectLimitPools([codex, work], Now).map(({ label }) => label)).toEqual(['Claude Code', 'Codex']);
  });
  it('matches Codex by kind, because its ids only name slots', () => {
    const codex = { provider: ProviderId.codex };
    const left = seatOf('a', [{ ...sessionOf(10), id: 'primary' }], codex);
    const right = seatOf('b', [{ ...sessionOf(30), id: 'secondary' }], codex);
    expect(poolOf([left, right]).windows).toHaveLength(1);
  });
  it('keeps two Claude allowances of one kind apart', () => {
    const fable = { ...weekOf(0), id: 'seven_day_fable', label: 'Weekly · Fable' };
    const labels = poolOf([seatOf('a', [weekOf(10), fable])]).windows.map(({ label }) => label);
    expect(labels).toEqual(['Weekly', 'Weekly · Fable']);
  });
  it('sorts windows by kind even when seats report them out of order', () => {
    const windows = poolOf([seatOf('a', [weekOf(10), sessionOf(10)])]).windows;
    expect(windows.map(({ kind }) => kind)).toEqual(['session', 'weekly']);
  });
  it('leaves a seat that does not report a window out of the average, as a gap', () => {
    const windows = poolOf([seatOf('a', [sessionOf(50), weekOf(20)]), seatOf('b', [sessionOf(10)])]).windows;
    const weekly = windows.find(({ kind }) => kind === 'weekly')!;
    expect(weekly.remainingPercent).toBe(80);
    expect(weekly.columns.map(({ seat, member }) => [seat.name, member !== undefined])).toEqual([
      ['a', true],
      ['b', false],
    ]);
  });
  it('shows no next reset for a single seat, because the bar says it', () => {
    expect(firstWindowOf([work]).restoresPercent).toBeUndefined();
  });
  it('skips a reset that gives nothing back', () => {
    const spent = seatOf('a', [sessionOf(0, 10 * Minute)]);
    const used = seatOf('b', [sessionOf(40, 20 * Minute)]);
    expect(firstWindowOf([spent, used]).restoresPercent).toBe(20);
  });
});

describe('the same account on two machines', () => {
  const devbox = { machineName: 'devbox', key: 'devbox/work/claude' };

  it('counts once and keeps the newest reading', () => {
    const old = seatOf('work', [sessionOf(50)], { usage: { checkedAt: at(-Minute), windows: [sessionOf(50)] } });
    const fresh = seatOf('work', [sessionOf(20)], devbox);
    const pool = poolOf([old, fresh]);
    expect(pool.seats).toHaveLength(1);
    expect(pool.seats[0]?.machineNames).toEqual(['macbook', 'devbox']);
    expect(pool.windows[0]?.remainingPercent).toBe(80);
  });
  it('keeps a good reading over a newer failure', () => {
    const failed = seatOf('work', [], { ...devbox, usage: unavailableLimits(at(0), 'probeFailed') });
    const good = seatOf('work', [sessionOf(20)], { usage: { checkedAt: at(-Minute), windows: [sessionOf(20)] } });
    const pool = poolOf([good, failed]);
    expect(pool.notices).toEqual([]);
    expect(pool.windows[0]?.remainingPercent).toBe(80);
  });
  it('keeps two organizations under one email apart', () => {
    const left = seatOf('a', [sessionOf(10)], { identity: 'bee@hive.dev', plan: 'team · Hive' });
    const right = seatOf('b', [sessionOf(10)], { identity: 'bee@hive.dev', plan: 'team · Comb' });
    expect(poolOf([left, right]).seats).toHaveLength(2);
  });
  it('never merges two seats it cannot name', () => {
    const left = seatOf('a', [sessionOf(10)], { identity: undefined });
    const right = seatOf('b', [sessionOf(10)], { identity: undefined });
    expect(poolOf([left, right]).seats).toHaveLength(2);
  });
  it('says which machine a repeated name is on', () => {
    const left = seatOf('personal', [sessionOf(10)], { identity: 'one@bee.dev' });
    const right = seatOf('personal', [sessionOf(10)], { ...devbox, identity: 'two@bee.dev' });
    expect(poolOf([left, right]).seats.map(({ name }) => name)).toEqual(['personal · devbox', 'personal · macbook']);
  });
});

describe('seat order', () => {
  it('puts the soonest session reset first and keeps that order in every window', () => {
    const later = seatOf('a', [sessionOf(10, 54 * Minute), weekOf(10, Day)]);
    const sooner = seatOf('b', [sessionOf(10, 44 * Minute), weekOf(10, 2 * Day)]);
    const { windows } = poolOf([later, sooner]);
    for (const window of windows) expect(window.columns.map(({ seat }) => seat.name)).toEqual(['b', 'a']);
  });
  it('falls back to the name, then to a stable key', () => {
    const noReset = [{ ...sessionOf(10), resetsAt: undefined }];
    const names = ['b', 'a'].map((name) => seatOf(name, noReset));
    expect(poolOf(names).seats.map(({ name }) => name)).toEqual(['a', 'b']);
    const sameName = [
      seatOf('a', noReset, { key: 'z', identity: 'one@bee.dev' }),
      seatOf('a', noReset, { key: 'y', identity: 'two@bee.dev', machineName: 'macbook' }),
    ];
    expect(poolOf(sameName).seats.map(({ key }) => key)).toEqual(['y', 'z']);
  });
});

describe('pace of a pool', () => {
  it('averages spending and time, using only the seats with a reset clock', () => {
    const timed = seatOf('a', [sessionOf(80, 150 * Minute)]);
    const noClock = seatOf('b', [{ ...sessionOf(0), resetsAt: undefined }]);
    expect(firstWindowOf([timed, noClock]).pace).toBe('ahead');
  });
  it('has no pace when no seat has a clock', () => {
    const noClock = seatOf('a', [{ ...sessionOf(50), windowDurationMins: undefined }]);
    expect(firstWindowOf([noClock]).pace).toBeUndefined();
  });
});

describe('a spent week blocks the session', () => {
  function blocked(session: ReturnType<typeof sessionOf>, week = weekOf(100, Day), seat: Partial<LimitSeat> = {}) {
    const pool = poolOf([seatOf('a', [session, week], seat)]);
    return pool.windows.find(({ kind }) => kind === 'session')!.columns[0]!.member!;
  }

  it('counts the session as used up, with no session pace', () => {
    const { window } = blocked(sessionOf(10));
    expect(window.usedPercent).toBe(100);
    expect(window.windowDurationMins).toBeUndefined();
  });
  it('waits for the week when the session resets first', () => {
    const member = blocked(sessionOf(10, 60 * Minute));
    expect(member.window.resetsAt).toBe(at(Day));
    expect(member.refillPercent).toBe(100);
  });
  it('waits for a spent session that resets after the week', () => {
    const member = blocked(sessionOf(100, 2 * Day));
    expect(member.window.resetsAt).toBe(at(2 * Day));
    expect(member.refillPercent).toBe(100);
  });
  it('gives back the unspent part when a part used session resets after the week', () => {
    const member = blocked(sessionOf(30, 2 * Day));
    expect(member.window.resetsAt).toBe(at(Day));
    expect(member.refillPercent).toBe(70);
  });
  it.each([
    ['session', { ...sessionOf(10), resetsAt: undefined }, weekOf(100, Day)],
    ['week', sessionOf(10), { ...weekOf(100), resetsAt: undefined }],
    ['stale session', sessionOf(10, -Minute), weekOf(100, Day)],
    ['stale week', sessionOf(10), weekOf(100, -Minute)],
  ])('does not guess with a bad %s reset', (_name, session, week) => {
    const member = blocked(session, week);
    expect(member.window.resetsAt).toBeUndefined();
    expect(member.refillPercent).toBe(0);
  });
  it('compares against the reading when it is newer than the clock', () => {
    const usage = { checkedAt: at(2 * Day), windows: [sessionOf(10, Day), weekOf(100, 3 * Day)] };
    const member = blocked(sessionOf(10, Day), weekOf(100, 3 * Day), { usage });
    expect(member.window.resetsAt).toBeUndefined();
    expect(member.refillPercent).toBe(0);
  });
  it('leaves a Claude session alone when only a model week is spent', () => {
    const fable = { ...weekOf(100), id: 'seven_day_fable', label: 'Weekly · Fable' };
    const pool = poolOf([seatOf('a', [sessionOf(10), weekOf(20), fable])]);
    const member = pool.windows.find(({ kind }) => kind === 'session')!.columns[0]!.member!;
    expect(member.window.usedPercent).toBe(10);
    const model = pool.windows.find(({ label }) => label === 'Weekly · Fable')!;
    expect(model.remainingPercent).toBe(0);
  });
  it('reads any weekly window as the whole week on Codex', () => {
    const session = { ...sessionOf(10), id: 'primary' };
    const week = { ...weekOf(100), id: 'secondary' };
    const pool = poolOf([seatOf('a', [session, week], { provider: ProviderId.codex })]);
    expect(pool.windows.find(({ kind }) => kind === 'session')?.remainingPercent).toBe(0);
  });
  it('does not apply to a provider with no such rule', () => {
    const pool = poolOf([seatOf('a', [sessionOf(10), weekOf(100)], { provider: ProviderId.opencode })]);
    expect(pool.windows.find(({ kind }) => kind === 'session')?.remainingPercent).toBe(90);
  });
});

describe('readings that cannot be read as current', () => {
  it('marks a window whose reset has passed', () => {
    const seat = seatOf('a', [sessionOf(90, -Minute), weekOf(10)]);
    const { windows } = poolOf([seat]);
    expect(windows.find(({ kind }) => kind === 'session')?.isStale).toBe(true);
    expect(windows.find(({ kind }) => kind === 'weekly')?.isStale).toBe(false);
  });
  it('marks every bar kept from before a failed read', () => {
    const failed = { reason: 'probeFailed' as const };
    const seat = seatOf('a', [], { usage: { checkedAt: at(-Minute), windows: [sessionOf(10)], unavailable: failed } });
    expect(firstWindowOf([seat]).isStale).toBe(true);
  });
  it('stays lit while another seat in the window is current', () => {
    const stale = seatOf('a', [sessionOf(90, -Minute)]);
    const current = seatOf('b', [sessionOf(10)]);
    const window = firstWindowOf([stale, current]);
    expect(window.isStale).toBe(false);
    expect(window.columns.map(({ member }) => member?.isStale)).toEqual([true, false]);
  });
});

describe('a reset that has already passed', () => {
  const past = seatOf('a', [sessionOf(90, -Minute)]);
  const current = seatOf('b', [sessionOf(20, 40 * Minute)]);

  it('gives nothing back, because it already happened', () => {
    const [column] = firstWindowOf([past, current]).columns;
    expect(column?.seat.name).toBe('a');
    expect(column?.member?.refillPercent).toBe(0);
  });
  it('is not the next reset of the pool', () => {
    expect(firstWindowOf([past, current]).restoresPercent).toBe(10);
  });
  it('leaves no next reset when every reset has passed', () => {
    const other = seatOf('b', [sessionOf(20, -Minute)]);
    expect(firstWindowOf([past, other]).restoresPercent).toBeUndefined();
  });
});

describe('seats with no bars', () => {
  const unsupported = (displayName: string, provider: ProviderId = ProviderId.opencode) =>
    seatOf(displayName, [], { provider, usage: unavailableLimits(at(0), 'unsupported') });

  it('sums up a provider with no limits in one line', () => {
    const pool = poolOf([unsupported('a'), unsupported('b')]);
    expect(pool.summary).toBe('no limits available');
    expect(pool.windows).toEqual([]);
  });
  it('names each seat when the reasons differ', () => {
    const failed = seatOf('b', [], { usage: unavailableLimits(at(0), 'probeFailed') });
    const pool = poolOf([unsupported('a', ProviderId.claude), failed]);
    expect(pool.summary).toBeUndefined();
    expect(pool.notices).toEqual([
      { name: 'a', message: 'no limits available' },
      { name: 'b', message: 'Could not read limits.' },
    ]);
  });
  it('keeps the bars of the others beside a seat that has none', () => {
    const empty = seatOf('b', []);
    const pool = poolOf([seatOf('a', [sessionOf(10)]), empty]);
    expect(pool.windows).toHaveLength(1);
    expect(pool.seats.map(({ name }) => name)).toEqual(['a']);
    expect(pool.notices).toEqual([{ name: 'b', message: 'No limits reported.' }]);
    expect(pool.summary).toBeUndefined();
  });
  it('has no pools with no seats', () => {
    expect(collectLimitPools([], Now)).toEqual([]);
  });
});
