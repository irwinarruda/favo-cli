import { afterEach, describe, expect, setSystemTime, test } from 'bun:test';
import { DomainError, DomainErrorCode } from '@favo/domain/shared/domain-error';
import { mockDb, TokenSeats, tokenRowOf } from '@/__tests__/db';
import { getApp } from '@/__tests__/utils/getApp';
import { useApp } from '@/shared/stores/app';

const Start = new Date('2026-11-12T15:30:00.000Z');
const Minute = 60_000;
const Day = 24 * 60 * Minute;
const gone = () => new DomainError(DomainErrorCode.machineUnreachable, 'devbox: gone');
const wait = (minutes: number) => setSystemTime(new Date(Start.getTime() + minutes * Minute));

async function settle(app: Awaited<ReturnType<typeof getApp>>) {
  await Bun.sleep(1);
  while (app.state.isLimitsReading || app.state.isTokensReading) await Bun.sleep(1);
  await Bun.sleep(1);
}

async function openApp(prepare?: () => void) {
  setSystemTime(Start);
  mockDb.reset();
  const app = await getApp({ isLoaded: false });
  useApp.setState({ usageTimeZone: 'UTC' });
  prepare?.();
  await app.state.loadFleet();
  await settle(app);
  return app;
}

async function openTokens(prepare?: () => void) {
  const app = await openApp(prepare);
  await app.state.openUsage();
  await app.state.showUsagePage('tokens');
  await settle(app);
  return app;
}

afterEach(() => {
  setSystemTime();
});

describe('reading tokens', () => {
  test('shows what each machine kept the moment the comb loads, without reading the logs', async () => {
    const app = await openApp();
    expect(mockDb.tokenReads.toSorted()).toEqual(['devbox:stored', 'local:stored']);
    expect(app.state.tokenReport.total.tokens).toBe(1_100_000_000);
  });
  test('reads the logs once a day in the background, so no day is lost', async () => {
    await openApp(() => {
      mockDb.tokenUsage.devbox!.readAt = new Date(Start.getTime() - Day - Minute).toISOString();
      mockDb.tokenUsage.local = { rows: [], skippedRecords: 0 };
    });
    expect(mockDb.tokenReads.filter((read) => read.endsWith('fresh')).toSorted()).toEqual([
      'devbox:fresh',
      'local:fresh',
    ]);
  });
  test('reads again when the tab opens, and shows the numbers it had meanwhile', async () => {
    const app = await openApp();
    const { promise, resolve } = Promise.withResolvers<void>();
    mockDb.tokenHold = promise;
    mockDb.tokenReads = [];
    await app.state.openUsage();
    const opening = app.state.showUsagePage('tokens');
    await Bun.sleep(5);
    expect(app.state.isTokensReading).toBe(true);
    expect(app.state.tokenReadingLabel).toBe('reading…');
    expect(app.state.tokenReport.total.tokens).toBe(1_100_000_000);
    expect(app.state.tokenReport.machines.every(({ isFaded }) => isFaded)).toBe(true);
    resolve();
    await opening;
    expect(mockDb.tokenReads.toSorted()).toEqual(['devbox:fresh', 'local:fresh']);
    expect(app.state.tokenReadingLabel).toBe('read just now');
    expect(app.state.tokenReport.machines.map(({ isFaded }) => isFaded)).toEqual([false, false, true]);
  });
  test('does not read again when the tab reopens inside five minutes', async () => {
    const app = await openTokens();
    mockDb.tokenReads = [];
    wait(4);
    await app.state.showUsagePage('limits');
    await app.state.showUsagePage('cost');
    expect(mockDb.tokenReads).toEqual([]);
    wait(6);
    await app.state.showUsagePage('tokens');
    expect(mockDb.tokenReads.toSorted()).toEqual(['devbox:fresh', 'local:fresh']);
  });
  test('refresh reads every machine and fetches the prices, past the wait', async () => {
    const app = await openTokens();
    mockDb.tokenReads = [];
    mockDb.priceReads = [];
    await app.state.refreshUsage();
    expect(mockDb.tokenReads.toSorted()).toEqual(['devbox:fresh', 'local:fresh']);
    expect(mockDb.priceReads.at(-1)).toBe('fresh');
  });
  test('starts counting without waiting for the prices', async () => {
    const app = await openApp();
    const { promise, resolve } = Promise.withResolvers<void>();
    mockDb.priceHold = promise;
    mockDb.tokenReads = [];
    await app.state.openUsage();
    const opening = app.state.showUsagePage('tokens');
    await Bun.sleep(5);
    expect(mockDb.tokenReads.toSorted()).toEqual(['devbox:fresh', 'local:fresh']);
    expect(app.state.tokenReadingLabel).toBe('read just now');
    resolve();
    await opening;
  });
  test('does not try a machine that is down', async () => {
    await openTokens();
    expect(mockDb.tokenReads.some((read) => read.startsWith('studio'))).toBe(false);
  });
  test('keeps what a remote machine answered, on this computer', async () => {
    await openTokens();
    expect(Object.keys(mockDb.keptTokenUsage)).toEqual(['devbox']);
    expect(mockDb.keptTokenUsage.devbox?.rows).toHaveLength(1);
  });
});

describe('a machine that cannot answer', () => {
  test('keeps its line and its last reading, faded, with how old it is', async () => {
    const app = await openTokens(() => {
      const readAt = new Date(Start.getTime() - 3 * Day).toISOString();
      mockDb.keptTokenUsage.studio = { ...mockDb.tokenUsage.devbox!, readAt };
    });
    const studio = app.state.tokenReport.machines.find(({ name }) => name === 'studio');
    expect(studio).toMatchObject({ note: 'offline, last read 3d ago', isFaded: true, tokens: 108_000_000 });
    expect(app.state.tokenReport.total.tokens).toBe(1_208_000_000);
  });
  test('is not blamed when the count arrived and only keeping a copy of it here failed', async () => {
    const app = await openApp();
    await app.state.openUsage();
    mockDb.tokenKeepFailure = new Error('the disk is full');
    await expect(app.state.showUsagePage('tokens')).rejects.toThrow('the disk is full');
    const devbox = app.state.tokenReport.machines.find(({ name }) => name === 'devbox');
    expect(devbox).toMatchObject({ note: undefined, isFaded: false, tokens: 108_000_000 });
    expect(app.state.isTokensReading).toBe(false);
  });
  test('says how long ago it last answered, minute by minute', async () => {
    const app = await openTokens(() => {
      mockDb.keptTokenUsage.studio = {
        ...mockDb.tokenUsage.devbox!,
        readAt: new Date(Start.getTime() - 12 * Minute).toISOString(),
      };
    });
    const noteOf = () => app.state.tokenReport.machines.find(({ name }) => name === 'studio')?.note;
    expect(noteOf()).toBe('offline, last read 12m ago');
    wait(8);
    app.state.tickUsage();
    expect(noteOf()).toBe('offline, last read 20m ago');
  });
  test('never costs the rest of the screen', async () => {
    const app = await openTokens(() => {
      mockDb.tokenFailures.devbox = gone();
    });
    const devbox = app.state.tokenReport.machines.find(({ name }) => name === 'devbox');
    expect(devbox).toMatchObject({ note: 'could not read', isFaded: true, tokens: 0 });
    expect(app.state.tokenReport.total.tokens).toBe(992_000_000);
  });
  test('keeps the numbers it gave before it dropped out', async () => {
    const app = await openTokens();
    mockDb.tokenFailures.devbox = gone();
    await app.state.refreshUsage();
    const devbox = app.state.tokenReport.machines.find(({ name }) => name === 'devbox');
    expect(devbox).toMatchObject({ note: 'could not read, last read just now', tokens: 108_000_000 });
  });
  test('is called an older favo when it does not know the method', async () => {
    const app = await openTokens(() => {
      mockDb.tokenFailures.devbox = new DomainError(DomainErrorCode.unknownMethod, 'nope');
    });
    const devbox = app.state.tokenReport.machines.find(({ name }) => name === 'devbox');
    expect(devbox).toMatchObject({ note: 'older favo', isFaded: true });
  });
  test('recovers on the next good read', async () => {
    const app = await openTokens(() => {
      mockDb.tokenFailures.devbox = gone();
    });
    mockDb.tokenFailures = {};
    await app.state.refreshUsage();
    expect(app.state.tokenReport.machines.find(({ name }) => name === 'devbox')?.note).toBeUndefined();
  });
});

describe('what the page shows', () => {
  test('follows the period', async () => {
    const app = await openTokens();
    expect(app.state.tokenReport.total).toMatchObject({ tokens: 1_100_000_000, sessions: 10 });
    await app.state.showUsagePeriod('24h');
    expect(app.state.tokenReport.total.tokens).toBe(625_000_000);
    await app.state.showUsagePeriod('7d');
    expect(app.state.tokenReport.total.tokens).toBe(1_100_000_000);
    await app.state.showUsagePeriod('90d');
    expect(app.state.tokenReport.total.tokens).toBe(1_500_000_000);
    await app.state.showUsagePeriod('all');
    expect(app.state.tokenReport.total.sessions).toBe(11);
  });
  test('prices the tokens here, with one table for every machine', async () => {
    const app = await openTokens();
    expect(app.state.tokenReport.hasPrices).toBe(true);
    expect(app.state.tokenReport.total.cost).toBeCloseTo(1066.25);
    await app.state.showUsagePage('cost');
    expect(app.state.tokenReport.providers.map(({ name, share }) => [name, share])).toEqual([
      ['Claude Code', 94],
      ['Codex', 6],
    ]);
  });
  test('prices a count that was still running in the background when the page opened', async () => {
    const counted = mockDb.tokenUsage.local!;
    const app = await openApp(() => {
      mockDb.tokenUsage = {};
    });
    const { promise, resolve } = Promise.withResolvers<void>();
    mockDb.tokenUsage.local = counted;
    mockDb.tokenHold = promise;
    const counting = app.state.readMachineTokens(app.state.machines[0]!);
    await app.state.openUsage();
    await app.state.showUsagePage('cost');
    expect(app.state.isTokensReading).toBe(true);
    expect(app.state.tokenReport.hasPrices).toBe(false);
    resolve();
    await counting;
    expect(app.state.tokenReport.hasPrices).toBe(true);
    expect(app.state.tokenReport.total.cost).toBeGreaterThan(0);
  });
  test('works with no price table, and with a model that has no price', async () => {
    const app = await openTokens(() => {
      mockDb.tokenPrices = { source: 'litellm', rates: {} };
    });
    expect(app.state.tokenReport).toMatchObject({ hasPrices: false, total: { tokens: 1_100_000_000, cost: 0 } });
    mockDb.reset();
    const priced = await openTokens(() => {
      mockDb.tokenUsage.local!.rows.push(
        tokenRowOf(2, { ...TokenSeats.personalCodex, model: 'mystery-1' }, [0, 0, 0, 7], 0)
      );
    });
    expect(priced.state.tokenReport.total).toMatchObject({ unpricedTokens: 7_000_000, pricedTokens: 1_100_000_000 });
  });
  test('names the providers favo does not count yet, unless they are filtered out', async () => {
    const app = await openTokens();
    expect(app.state.uncountedProviders).toEqual(['Antigravity']);
    app.state.toggleUsageFilter('providers', 'antigravity');
    expect(app.state.uncountedProviders).toEqual([]);
  });
  test('adds up the records that could not be read, on the machines shown', async () => {
    const app = await openTokens(() => {
      mockDb.tokenUsage.local!.skippedRecords = 2;
      mockDb.tokenUsage.devbox!.skippedRecords = 1;
    });
    expect(app.state.skippedTokenRecords).toBe(3);
    app.state.toggleUsageFilter('machines', 'devbox');
    expect(app.state.skippedTokenRecords).toBe(2);
  });
  test('switches the table between models and days', async () => {
    const app = await openTokens();
    expect(app.state.tokenBreakdown).toBe('models');
    app.state.toggleTokenBreakdown();
    expect(app.state.tokenBreakdown).toBe('days');
    expect(app.state.tokenReport.days.map(({ name }) => name)).toEqual(['Nov 12', 'Nov 11', 'Nov 10', 'Nov 7']);
  });
  test('says how old the oldest reading on screen is', async () => {
    const app = await openTokens();
    wait(12);
    app.state.tickUsage();
    expect(app.state.tokenReadingLabel).toBe('read 12m ago');
  });
});
