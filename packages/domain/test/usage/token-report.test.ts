import { describe, expect, it } from 'bun:test';
import { formatDollars, formatPercent, formatTokens } from '#domain/usage/token-format';
import type { TokenPrices } from '#domain/usage/token-prices';
import {
  cachedPercentOf,
  PeriodWindows,
  perMillionOf,
  sharesOf,
  type TokenMachine,
  TokenMetric,
  type TokenReportInput,
  tokenChartOf,
  tokenDayRowsOf,
  tokenReportOf,
} from '#domain/usage/token-report';
import type { TokenUsageRow } from '#domain/usage/token-usage';
import { NoUsageFilter } from '#domain/usage/usage-view';

const Now = Date.parse('2026-11-12T15:30:00.000Z');
const TimeZone = 'America/Sao_Paulo';
const Prices: TokenPrices = {
  source: 'litellm',
  fetchedAt: '2026-11-12T09:00:00.000Z',
  rates: {
    'claude-test-1': { input: 0.000003, output: 0.000015, cacheRead: 0.0000003, cacheWrite: 0.00000375 },
    'gpt-test-1': { input: 0.000002, output: 0.000008, cacheRead: 0.0000002, cacheWrite: 0.000002 },
  },
};

function rowOf(hour: string, overrides: Partial<TokenUsageRow> = {}): TokenUsageRow {
  return {
    hour: `${hour}:00:00.000Z`,
    account: 'work',
    provider: 'claude',
    model: 'claude-test-1',
    input: 100,
    cacheRead: 800,
    cacheWrite: 50,
    output: 50,
    sessions: 1,
    ...overrides,
  };
}

function machineOf(id: string, rows: TokenUsageRow[], extra: Partial<TokenMachine> = {}): TokenMachine {
  return { id, name: id, rows, ...extra };
}

function reportOf(machines: TokenMachine[], overrides: Partial<TokenReportInput> = {}) {
  return tokenReportOf({
    machines,
    prices: Prices,
    filter: NoUsageFilter,
    window: PeriodWindows['30d'],
    metric: TokenMetric.tokens,
    now: Now,
    timeZone: TimeZone,
    accountNames: { work: 'work', personal: 'personal' },
    ...overrides,
  });
}

describe('periods', () => {
  const rows = [
    rowOf('2026-11-12T15'),
    rowOf('2026-11-11T16'),
    rowOf('2026-11-11T15'),
    rowOf('2026-11-06T03'),
    rowOf('2026-11-06T02'),
    rowOf('2026-10-14T03'),
    rowOf('2026-10-14T02'),
    rowOf('2026-08-15T03'),
    rowOf('2026-08-15T02'),
    rowOf('2025-12-31T12'),
  ];
  const sessionsIn = (period: keyof typeof PeriodWindows) =>
    reportOf([machineOf('macbook', rows)], { window: PeriodWindows[period] }).total.sessions;

  it('counts the last 24 hours by the hour, with the one in progress', () => {
    expect(sessionsIn('24h')).toBe(2);
  });
  it('counts 7, 30 and 90 days ending today, in the time zone of this computer', () => {
    expect(sessionsIn('7d')).toBe(4);
    expect(sessionsIn('30d')).toBe(6);
    expect(sessionsIn('90d')).toBe(8);
  });
  it('starts all at the first row', () => {
    const report = reportOf([machineOf('macbook', rows)], { window: PeriodWindows.all });
    expect(report.total.sessions).toBe(10);
    expect(report.since).toBe('2025-12-31');
    expect(report.until).toBe('2026-11-12');
  });
  it('puts an hour on the local day it fell on, which can be another UTC date', () => {
    const late = [rowOf('2026-11-12T01'), rowOf('2026-11-12T04')];
    const { days } = reportOf([machineOf('macbook', late)]);
    expect(days.map(({ id, name, sessions }) => [id, name, sessions])).toEqual([
      ['2026-11-12', 'Nov 12', 1],
      ['2026-11-11', 'Nov 11', 1],
    ]);
  });
  it('leaves out an hour that has not happened yet', () => {
    expect(reportOf([machineOf('macbook', [rowOf('2026-11-13T05')])]).total.tokens).toBe(0);
  });
});

describe('totals', () => {
  const mac = machineOf('macbook', [
    rowOf('2026-11-10T14'),
    rowOf('2026-11-10T15', { account: 'personal', provider: 'codex', model: 'gpt-test-1', cacheRead: 2800 }),
  ]);
  const devbox = machineOf('devbox', [rowOf('2026-11-11T14'), rowOf('2026-11-11T15', { model: 'mystery-1' })]);

  it('adds processed tokens, sessions and what the API would charge', () => {
    const { total } = reportOf([mac, devbox]);
    expect(total.tokens).toBe(6000);
    expect(total.sessions).toBe(4);
    expect(total.cost).toBeCloseTo(2 * 0.0014775 + 0.00126);
  });
  it('counts the same account on two machines on both', () => {
    const { accounts, machines } = reportOf([mac, devbox]);
    expect(accounts.map(({ name, tokens }) => [name, tokens])).toEqual([
      ['personal', 3000],
      ['work', 3000],
    ]);
    expect(machines.map(({ name, tokens }) => [name, tokens])).toEqual([
      ['macbook', 4000],
      ['devbox', 2000],
    ]);
  });
  it('gives shares that add up to 100', () => {
    const thirds = machineOf('macbook', [
      rowOf('2026-11-10T14'),
      rowOf('2026-11-10T14', { model: 'gpt-test-1' }),
      rowOf('2026-11-10T14', { model: 'mystery-1' }),
    ]);
    const shares = reportOf([thirds]).models.map(({ share }) => share ?? 0);
    expect(shares.reduce((sum, share) => sum + share, 0)).toBe(100);
    expect(sharesOf([1, 1, 1])).toEqual([34, 33, 33]);
    expect(sharesOf([0, 0])).toEqual([0, 0]);
  });
  it('counts an unpriced model, and leaves it out of every dollar', () => {
    const { total, models } = reportOf([devbox], { metric: TokenMetric.cost });
    expect(total.unpricedTokens).toBe(1000);
    expect(total.pricedTokens).toBe(1000);
    expect(models.map(({ id, share }) => [id, share])).toEqual([
      ['claude-test-1', 100],
      ['mystery-1', undefined],
    ]);
  });
  it('orders by the number of the tab', () => {
    const byTokens = reportOf([mac]).providers.map(({ name }) => name);
    const byCost = reportOf([mac], { metric: TokenMetric.cost }).providers.map(({ name }) => name);
    expect(byTokens).toEqual(['Codex', 'Claude Code']);
    expect(byCost).toEqual(['Claude Code', 'Codex']);
  });
  it('says how much of the input came from cache, and the cost per million', () => {
    const { total } = reportOf([machineOf('macbook', [rowOf('2026-11-10T14')])]);
    expect(cachedPercentOf(total)).toBeCloseTo((800 / 950) * 100);
    expect(perMillionOf(total)).toBeCloseTo(1.4775);
    expect(cachedPercentOf({ input: 0, cacheRead: 0, cacheWrite: 0, output: 9 })).toBeUndefined();
  });
  it('works with no price table at all', () => {
    const report = reportOf([mac], { prices: { source: 'litellm', rates: {} } });
    expect(report.hasPrices).toBe(false);
    expect(report.total).toMatchObject({ tokens: 4000, cost: 0, pricedTokens: 0 });
  });
});

describe('filters', () => {
  const mac = machineOf('macbook', [
    rowOf('2026-11-10T14'),
    rowOf('2026-11-10T15', { account: 'personal', provider: 'codex', model: 'gpt-test-1' }),
  ]);
  const devbox = machineOf('devbox', [rowOf('2026-11-11T14')], { note: 'offline', isFaded: true });
  const tokensWith = (filter: Partial<typeof NoUsageFilter>) =>
    reportOf([mac, devbox], { filter: { ...NoUsageFilter, ...filter } }).total.tokens;

  it('leave out a machine, an account or a provider', () => {
    expect(tokensWith({})).toBe(3000);
    expect(tokensWith({ machines: ['devbox'] })).toBe(2000);
    expect(tokensWith({ accounts: ['work'] })).toBe(1000);
    expect(tokensWith({ providers: ['codex'] })).toBe(2000);
    expect(tokensWith({ machines: ['macbook', 'devbox'] })).toBe(0);
  });
  it('keep the line of a machine that cannot answer, and drop a machine left out', () => {
    const idle = machineOf('pi', [], { note: 'offline, last read 3d ago', isFaded: true });
    const shown = reportOf([mac, idle]).machines.map(({ name, note, tokens }) => [name, note, tokens]);
    expect(shown).toEqual([
      ['macbook', undefined, 2000],
      ['pi', 'offline, last read 3d ago', 0],
    ]);
    const filter = { ...NoUsageFilter, machines: ['pi'] };
    expect(reportOf([mac, idle], { filter }).machines).toHaveLength(1);
  });
  it('fade an account favo no longer has, under the name its folder had', () => {
    const old = machineOf('macbook', [rowOf('2026-11-10T14', { account: 'old-client' })]);
    expect(reportOf([old]).accounts[0]).toMatchObject({ name: 'old-client', isFaded: true });
  });
});

describe('the chart', () => {
  const rows = [
    rowOf('2026-11-12T15', { output: 850 }),
    rowOf('2026-11-12T14'),
    rowOf('2026-11-05T14'),
    rowOf('2026-10-20T14'),
    rowOf('2026-01-20T14'),
  ];
  function chartOf(period: keyof typeof PeriodWindows, columns: number, metric: TokenMetric = TokenMetric.tokens) {
    const report = reportOf([machineOf('macbook', rows)], { window: PeriodWindows[period], metric });
    const chart = tokenChartOf({ report, columns, rows: 1, timeZone: TimeZone });
    return chart && { ...chart, bars: chart.lines[0]! };
  }

  it('grows taller with more rows, each bar filling from the bottom', () => {
    const report = reportOf([machineOf('macbook', rows)], { window: PeriodWindows['7d'] });
    const chart = tokenChartOf({ report, columns: 20, rows: 3, timeZone: TimeZone });
    expect(chart?.lines).toEqual(['      █', '      █', '▁▁▁▁▁▁█']);
    const day = [
      rowOf('2026-11-12T15'),
      rowOf('2026-11-11T15', { input: 0, cacheRead: 450, cacheWrite: 0 }),
      rowOf('2026-11-10T15', { input: 0, cacheRead: 0, cacheWrite: 0, output: 10 }),
    ];
    const uneven = reportOf([machineOf('macbook', day)], { window: PeriodWindows['7d'] });
    expect(tokenChartOf({ report: uneven, columns: 20, rows: 3, timeZone: TimeZone })?.lines).toEqual([
      '      █',
      '     ▅█',
      '▁▁▁▁▂██',
    ]);
  });

  it('draws one bar per hour for 24h', () => {
    const chart = chartOf('24h', 120);
    expect(chart?.bars).toHaveLength(24);
    expect(chart?.bars.endsWith('▅█')).toBe(true);
    expect(chart).toMatchObject({ start: 'Nov 11 13:00', end: 'Nov 12 12:00' });
    expect(chart?.busiest).toEqual({ label: 'Nov 12 12:00', value: 1800 });
  });
  it('draws six hours per bar for 7d, and days when that does not fit', () => {
    expect(chartOf('7d', 120)?.bars).toHaveLength(28);
    expect(chartOf('7d', 20)).toMatchObject({ bars: '▁▁▁▁▁▁█', start: 'Nov 6', end: 'Nov 12' });
  });
  it('draws days for 30d and 90d, and weeks when the screen is narrow', () => {
    expect(chartOf('30d', 120)?.bars).toHaveLength(30);
    expect(chartOf('90d', 120)?.bars).toHaveLength(90);
    const narrow = chartOf('90d', 60);
    expect(narrow?.bars).toHaveLength(13);
    expect(narrow?.end).toBe('Nov 6');
    expect(narrow?.busiest?.value).toBe(2800);
  });
  it('draws all by day, then by week, then by month', () => {
    expect(chartOf('all', 300)?.bars).toHaveLength(297);
    expect(chartOf('all', 120)?.bars).toHaveLength(43);
    const months = chartOf('all', 30);
    expect(months).toMatchObject({ start: 'Jan 2026', end: 'Nov 2026' });
    expect(months?.bars).toHaveLength(11);
  });
  it('keeps the newest months when even months do not fit', () => {
    const old = [rowOf('2026-11-12T15'), rowOf('2019-03-01T10')];
    const report = reportOf([machineOf('macbook', old)], { window: PeriodWindows.all });
    const chart = tokenChartOf({ report, columns: 60, rows: 1, timeZone: TimeZone });
    expect(chart?.lines[0]).toHaveLength(60);
    expect(chart).toMatchObject({ start: 'Dec 2021', end: 'Nov 2026' });
    expect(chart?.lines[0]?.endsWith('█')).toBe(true);
  });
  it('follows dollars on the Cost tab', () => {
    expect(chartOf('30d', 120, TokenMetric.cost)?.busiest?.value).toBeCloseTo(0.0134775 + 0.0014775);
  });
  it('has nothing to draw before the first row', () => {
    const report = reportOf([], { window: PeriodWindows.all });
    const empty = tokenChartOf({ report, columns: 80, rows: 3, timeZone: TimeZone });
    expect(empty).toBeUndefined();
  });
});

describe('the rows a site would draw', () => {
  it('are one per day, machine, account, provider and model, with the cost', () => {
    const rows = [rowOf('2026-11-10T14'), rowOf('2026-11-10T15'), rowOf('2026-11-10T16', { model: 'mystery-1' })];
    const days = tokenDayRowsOf({
      machines: [machineOf('macbook', rows)],
      prices: Prices,
      filter: NoUsageFilter,
      window: PeriodWindows['30d'],
      now: Now,
      timeZone: TimeZone,
    });
    expect(days).toHaveLength(2);
    expect(days[0]).toMatchObject({ day: '2026-11-10', machine: 'macbook', account: 'work', input: 200, sessions: 2 });
    expect(days[0]?.cost).toBeCloseTo(0.002955);
    expect(days[1]?.cost).toBeUndefined();
  });
});

describe('numbers', () => {
  it('shows tokens in three digits at most', () => {
    const shown = [12_400_000_000, 310_000_000, 66_000, 1_100_000_000, 999, 1_234, 999_950, 0].map(formatTokens);
    expect(shown).toEqual(['12.4B', '310M', '66K', '1.1B', '999', '1.2K', '1M', '0']);
  });
  it('always shows the cents, so a comma is never taken for the decimal mark', () => {
    expect([14984, 5700.4, 855, 57.81, 0.333, 99.999, 0].map(formatDollars)).toEqual([
      '$14,984.00',
      '$5,700.40',
      '$855.00',
      '$57.81',
      '$0.33',
      '$100.00',
      '$0.00',
    ]);
  });
  it('shows a share as a whole percent, and nothing for none', () => {
    expect([formatPercent(63.6), formatPercent(undefined)]).toEqual(['64%', '']);
  });
});
