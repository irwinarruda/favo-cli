import { afterEach, describe, expect, setSystemTime, test } from 'bun:test';
import { DomainError, DomainErrorCode } from '@favo/domain/shared/domain-error';
import { mockDb } from '@/__tests__/db';
import { getApp } from '@/__tests__/utils/getApp';

const Start = new Date('2026-11-01T12:00:00.000Z');
const Minute = 60_000;
const gone = () => new DomainError(DomainErrorCode.machineUnreachable, 'devbox: gone');
const wait = (minutes: number) => setSystemTime(new Date(Start.getTime() + minutes * Minute));

async function openApp(prepare?: () => void) {
  setSystemTime(Start);
  const app = await getApp({ isLoaded: false });
  prepare?.();
  await app.state.loadFleet();
  while (app.state.isLimitsReading) await Bun.sleep(1);
  return app;
}

function poolOf(app: Awaited<ReturnType<typeof getApp>>, label: string) {
  return app.state.limitPools.find((pool) => pool.label === label);
}

function lineOf(app: Awaited<ReturnType<typeof getApp>>, id: string) {
  return app.state.limitMachineLines.find((line) => line.id === id);
}

afterEach(() => {
  setSystemTime();
});

describe('the first read', () => {
  test('happens once after the comb loads, before anyone asks', async () => {
    await openApp();
    expect(mockDb.limitReads.toSorted()).toEqual(['devbox', 'local']);
  });
  test('is ready when the screen opens, with no second read', async () => {
    const app = await openApp();
    await app.state.openUsage();
    expect(app.state.isUsageOpen).toBe(true);
    expect(mockDb.limitReads).toHaveLength(2);
    expect(poolOf(app, 'Claude Code')?.windows[0]?.remainingPercent).toBe(81);
  });
  test('never makes the comb wait for it', async () => {
    setSystemTime(Start);
    const app = await getApp({ isLoaded: false });
    const { promise, resolve } = Promise.withResolvers<void>();
    mockDb.limitsHold = promise;
    await app.state.loadFleet();
    expect(app.state.isFleetLoading).toBe(false);
    expect(app.state.isLimitsReading).toBe(true);
    resolve();
  });
  test('does not try a machine that is down', async () => {
    await openApp();
    expect(mockDb.limitReads).not.toContain('studio');
  });
  test('does not repeat when a machine is refreshed in the comb', async () => {
    const app = await openApp();
    mockDb.limitReads = [];
    await app.state.refreshMachine('local');
    expect(mockDb.limitReads).toEqual([]);
  });
  test('does not repeat when the fleet loads again inside the wait', async () => {
    const app = await openApp();
    mockDb.limitReads = [];
    await app.state.loadFleet();
    expect(mockDb.limitReads).toEqual([]);
  });
  test('shows a read still running when the screen opens early', async () => {
    setSystemTime(Start);
    const app = await getApp({ isLoaded: false });
    const { promise, resolve } = Promise.withResolvers<void>();
    mockDb.limitsHold = promise;
    await app.state.loadFleet();
    await app.state.openUsage();
    expect(lineOf(app, 'local')?.label).toBe('reading…');
    resolve();
    while (app.state.isLimitsReading) await Bun.sleep(1);
    expect(lineOf(app, 'local')?.label).toBe('read just now');
  });
});

describe('pooling what it read', () => {
  test('pools every provider', async () => {
    const app = await openApp();
    expect(app.state.limitPools.map(({ label }) => label)).toEqual(['Claude Code', 'Codex', 'OpenCode']);
    const session = poolOf(app, 'Claude Code')?.windows[0];
    expect(session).toMatchObject({ label: 'Session', remainingPercent: 81, restoresPercent: 16 });
  });
  test('counts the same account on two machines once', async () => {
    const app = await openApp();
    const seat = poolOf(app, 'Claude Code')?.seats.find(({ name }) => name === 'personal');
    expect(seat?.machineNames).toEqual(['macbook', 'devbox']);
  });
  test('sums up a provider with no limits', async () => {
    const app = await openApp();
    expect(poolOf(app, 'OpenCode')?.summary).toBe('no limits available');
  });
  test('copes with a machine named like an inherited property', async () => {
    const id: string = 'constructor';
    const app = await openApp(() => {
      mockDb.machines.push({ id, name: id, target: `bee@${id}`, isLocal: false });
      mockDb.machineStatuses[id] = { state: 'online' };
      mockDb.accounts[id] = mockDb.accounts.devbox!;
    });
    expect(mockDb.limitReads).toContain(id);
    expect(lineOf(app, id)?.label).toBe('no seats signed in');
  });
});

describe('the five minute wait', () => {
  test('does not read again when the screen reopens inside it', async () => {
    const app = await openApp();
    mockDb.limitReads = [];
    wait(4);
    await app.state.openUsage();
    expect(mockDb.limitReads).toEqual([]);
  });
  test('reads again once the wait is over', async () => {
    const app = await openApp();
    mockDb.limitReads = [];
    wait(5);
    await app.state.openUsage();
    expect(mockDb.limitReads.toSorted()).toEqual(['devbox', 'local']);
  });
  test('reads a machine that is still connecting', async () => {
    const app = await openApp();
    wait(5);
    app.state.setMachinePresence('devbox', 'connecting');
    await app.state.openUsage();
    expect(mockDb.limitReads.filter((id) => id === 'devbox')).toHaveLength(2);
  });
  test('waits after a failed read too', async () => {
    const app = await openApp(() => {
      mockDb.limitFailures.devbox = gone();
    });
    mockDb.limitReads = [];
    wait(1);
    await app.state.openUsage();
    expect(mockDb.limitReads).toEqual([]);
  });
  test('waits for each machine on its own', async () => {
    const app = await openApp();
    wait(3);
    await app.state.readMachineLimits(app.state.machines.find(({ id }) => id === 'devbox')!);
    wait(5);
    mockDb.limitReads = [];
    await app.state.openUsage();
    expect(mockDb.limitReads).toEqual(['local']);
  });
  test('refresh skips the wait', async () => {
    const app = await openApp();
    mockDb.limitReads = [];
    await app.state.refreshUsage();
    expect(mockDb.limitReads.toSorted()).toEqual(['devbox', 'local']);
  });
  test('refresh does not start a second read of a machine still reading', async () => {
    const app = await openApp();
    mockDb.limitReads = [];
    const reading = app.state.refreshUsage();
    expect(app.state.isLimitsReading).toBe(true);
    await app.state.refreshUsage();
    await reading;
    expect(mockDb.limitReads.toSorted()).toEqual(['devbox', 'local']);
    expect(app.state.isLimitsReading).toBe(false);
  });
});

describe('failures', () => {
  const failed = { reason: 'probeFailed' as const, message: 'Claude Code did not answer.' };

  test('keeps the last good bars after a failed seat and marks them as old', async () => {
    const app = await openApp();
    wait(6);
    const [personal, ...others] = mockDb.seatLimits.local!;
    const unread = { checkedAt: new Date().toISOString(), windows: [], unavailable: failed };
    mockDb.seatLimits.local = [{ ...personal!, usage: unread }, ...others];
    mockDb.seatLimits.devbox = [];
    await app.state.refreshUsage();
    const session = poolOf(app, 'Claude Code')?.windows[0];
    const column = session?.columns.find(({ seat }) => seat.name === 'personal');
    expect(column?.member?.window.usedPercent).toBe(32);
    expect(column?.member?.isStale).toBe(true);
    expect(column?.seat.usage.checkedAt).toBe(Start.toISOString());
  });
  test('keeps who a seat is when its login could not be read', async () => {
    const app = await openApp();
    const seats = mockDb.seatLimits.local!;
    const { account, displayName, provider } = seats[0]!;
    const unread = { checkedAt: Start.toISOString(), windows: [], unavailable: failed };
    mockDb.seatLimits.local = [{ account, displayName, provider, usage: unread }, ...seats.slice(1)];
    await app.state.refreshUsage();
    const seat = app.state.machineLimits.local?.seats[0];
    expect(seat).toMatchObject({ identity: 'bee@hive.dev', plan: 'max' });
    expect(seat?.usage.windows).toHaveLength(3);
  });
  test('shows a failed seat as a notice the first time, with nothing to keep', async () => {
    const app = await openApp(() => {
      const [personal, ...others] = mockDb.seatLimits.local!;
      const unread = { checkedAt: Start.toISOString(), windows: [], unavailable: failed };
      mockDb.seatLimits.local = [{ ...personal!, usage: unread }, ...others];
      mockDb.seatLimits.devbox = [];
    });
    expect(poolOf(app, 'Claude Code')?.notices).toEqual([{ name: 'personal', message: failed.message }]);
  });
  test('clears the bars when a seat turns out to have no limits', async () => {
    const app = await openApp();
    const message = 'This account has no subscription limits.';
    const unsupported = {
      checkedAt: Start.toISOString(),
      windows: [],
      unavailable: { reason: 'unsupported', message },
    };
    mockDb.seatLimits.local = mockDb.seatLimits.local!.map((seat) =>
      seat.account === 'work' ? { ...seat, usage: unsupported as typeof seat.usage } : seat
    );
    await app.state.refreshUsage();
    expect(poolOf(app, 'Claude Code')?.notices).toEqual([{ name: 'work', message }]);
    expect(poolOf(app, 'Claude Code')?.seats.map(({ name }) => name)).toEqual(['personal']);
  });
  test('keeps the rest of the screen when a machine cannot be read', async () => {
    const app = await openApp(() => {
      mockDb.limitFailures.devbox = gone();
    });
    expect(lineOf(app, 'devbox')).toMatchObject({ label: 'could not read', isOld: true });
    expect(poolOf(app, 'Claude Code')?.seats).toHaveLength(2);
  });
  test('keeps the bars of a machine that dropped out, marked as old', async () => {
    const app = await openApp();
    mockDb.seatLimits.local = [];
    mockDb.limitFailures.devbox = gone();
    await app.state.refreshUsage();
    const session = poolOf(app, 'Claude Code')?.windows[0];
    expect(session?.columns[0]?.member?.isStale).toBe(true);
  });
  test('turns any other failure into the same line, not a crash', async () => {
    const app = await openApp(() => {
      mockDb.limitFailures.devbox = new Error('the wire melted');
    });
    expect(lineOf(app, 'devbox')?.label).toBe('could not read');
    expect(app.state.machineLimits.devbox?.problem).toBe('the wire melted');
  });
  test.each([
    ['an unknown method', DomainErrorCode.unknownMethod],
    ['a reply it cannot read', DomainErrorCode.machineOutdated],
  ])('calls a machine that gives %s an older favo', async (_name, code) => {
    const app = await openApp(() => {
      mockDb.limitFailures.devbox = new DomainError(code, 'nope');
    });
    expect(lineOf(app, 'devbox')?.label).toBe('older favo');
    expect(poolOf(app, 'Claude Code')?.seats).toHaveLength(2);
  });
  test('recovers on the next good read', async () => {
    const app = await openApp(() => {
      mockDb.limitFailures.devbox = new DomainError(DomainErrorCode.unknownMethod, 'nope');
    });
    mockDb.limitFailures = {};
    await app.state.refreshUsage();
    expect(lineOf(app, 'devbox')?.label).toBe('read just now');
  });
});

describe('what each machine says', () => {
  test('says when a reading was taken and dims an old one', async () => {
    const app = await openApp();
    expect(lineOf(app, 'local')).toMatchObject({ label: 'read just now', isOld: false });
    wait(12);
    app.state.tickUsage();
    expect(lineOf(app, 'local')).toMatchObject({ label: 'read 12m ago', isOld: true });
  });
  test('names a machine it did not try to read', async () => {
    const app = await openApp();
    expect(lineOf(app, 'studio')).toMatchObject({ label: 'offline', isOld: true });
  });
  test('shows a machine on an older protocol as older favo, without asking it', async () => {
    const app = await openApp(() => {
      mockDb.machineStatuses.devbox = { state: 'outdated' };
    });
    expect(lineOf(app, 'devbox')?.label).toBe('older favo');
    expect(mockDb.limitReads).toEqual(['local']);
  });
  test('says so when a machine has nothing to read', async () => {
    const app = await openApp(() => {
      mockDb.seatLimits.devbox = [];
    });
    expect(lineOf(app, 'devbox')?.label).toBe('no seats signed in');
  });
  test('recounts the countdown as time passes', async () => {
    const app = await openApp();
    const before = app.state.limitPools;
    wait(1);
    app.state.tickUsage();
    expect(app.state.limitPools).not.toBe(before);
  });
});
