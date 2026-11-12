import { describe, expect, it } from 'bun:test';
import type { TokenRates } from '#domain/usage/token-prices';
import { PeriodWindows, TokenMetric, tokenChartOf, tokenReportOf } from '#domain/usage/token-report';
import type { TokenUsageRow } from '#domain/usage/token-usage';
import {
  barColumnsOf,
  busiestOf,
  chartCaptionsOf,
  lastReadOf,
  skippedNoteOf,
  tokenBarOf,
  tokenHeadlineOf,
  tokenNumbersOf,
  tokenRowOf,
  tokenTypeLinesOf,
  tokenTypesOf,
  unpricedNoteOf,
} from '#domain/usage/token-view';
import {
  filterSummaryOf,
  hiddenFor,
  isFiltered,
  isNothingSelected,
  NoUsageFilter,
  onlyFilter,
  stepIn,
  toggledFilter,
  UsagePeriods,
} from '#domain/usage/usage-view';

const Now = Date.parse('2026-11-12T15:30:00.000Z');
const Million = 1_000_000;
const Rates: TokenRates = {
  'claude-test-1': { input: 0.000003, output: 0.000015, cacheRead: 0.0000003, cacheWrite: 0.00000375 },
};
const Row: TokenUsageRow = {
  hour: '2026-11-10T14:00:00.000Z',
  account: 'work',
  provider: 'claude',
  model: 'claude-test-1',
  input: Million,
  cacheRead: 20 * Million,
  cacheWrite: 2 * Million,
  output: Million,
  sessions: 1,
};

function reportOf(metric: TokenMetric, rows = [Row], rates = Rates) {
  return tokenReportOf({
    machines: [{ id: 'local', name: 'macbook', rows }],
    prices: {
      source: 'litellm',
      fetchedAt: Object.keys(rates).length > 0 ? '2026-11-12T09:00:00.000Z' : undefined,
      rates,
    },
    filter: NoUsageFilter,
    window: PeriodWindows['30d'],
    metric,
    now: Now,
    timeZone: 'UTC',
    accountNames: { work: 'work' },
  });
}

describe('the headline', () => {
  it('leads with tokens, then sessions and what the API would charge', () => {
    expect(tokenHeadlineOf(reportOf(TokenMetric.tokens))).toEqual({
      lead: '24M tokens',
      facts: ['1 session', '$31.50 at API prices'],
    });
  });
  it('leads with dollars on Cost, with what the cache saved', () => {
    expect(tokenHeadlineOf(reportOf(TokenMetric.cost))).toEqual({
      lead: '$31.50 at API prices',
      facts: ['24M tokens', '$54.00 saved by cache'],
    });
  });
  it('drops the dollars with no price table, and says why on Cost', () => {
    expect(tokenHeadlineOf(reportOf(TokenMetric.tokens, [Row], {})).facts).toEqual(['1 session']);
    expect(tokenHeadlineOf(reportOf(TokenMetric.cost, [Row], {})).lead).toContain('No price table yet.');
  });
});

describe('a row', () => {
  it('shows the number of the tab first, then the share, then the other number', () => {
    const tokens = reportOf(TokenMetric.tokens);
    expect(tokenRowOf(tokens.models[0]!, tokens)).toEqual({ amount: '24M', share: '100%', other: '$31.50' });
    const cost = reportOf(TokenMetric.cost);
    expect(tokenRowOf(cost.models[0]!, cost)).toEqual({ amount: '$31.50', share: '100%', other: '24M' });
  });
  it('calls a model with no list price unpriced, with no share of the dollars', () => {
    const cost = reportOf(TokenMetric.cost, [Row, { ...Row, model: 'mystery-1' }]);
    expect(tokenRowOf(cost.models[1]!, cost)).toEqual({ amount: 'unpriced', share: '', other: '24M' });
    expect(unpricedNoteOf(cost)).toBe('24M tokens have no list price, and are left out of every dollar.');
    expect(unpricedNoteOf(reportOf(TokenMetric.cost))).toBeUndefined();
  });
  it('draws a bar as wide as the share, never empty for something used', () => {
    expect(tokenBarOf(75, 40)).toEqual({ filled: 30, rest: 10 });
    expect(tokenBarOf(0.4, 20)).toEqual({ filled: 1, rest: 19 });
    expect(tokenBarOf(0, 20)).toEqual({ filled: 0, rest: 20 });
    expect(tokenBarOf(undefined, 20)).toEqual({ filled: 0, rest: 20 });
  });
});

describe('the lines under the bars', () => {
  it('list the types largest first, without the empty ones, and the part that came from cache', () => {
    const { types, cached } = tokenTypesOf(reportOf(TokenMetric.tokens, [{ ...Row, cacheWrite: 0 }]));
    expect(types).toEqual(['cache read 20M', 'input 1M', 'output 1M']);
    expect(cached).toBe('95% of the input came from cache');
  });
  it('list the types in dollars on Cost', () => {
    const { types, cached } = tokenTypesOf(reportOf(TokenMetric.cost));
    expect(types).toEqual(['output $15.00', 'cache write $7.50', 'cache read $6.00', 'input $3.00']);
    expect(cached).toBeUndefined();
  });
  it('share one line with the cache note when there is room, and break when there is not', () => {
    const types = ['cache read 20M', 'cache write 2M', 'input 1M', 'output 1M'];
    const cached = '95% of the input came from cache';
    const line = 'cache read 20M · cache write 2M · input 1M · output 1M';
    expect(tokenTypeLinesOf({ types, cached }, 120)).toEqual([`${line}      ${cached}`]);
    expect(tokenTypeLinesOf({ types, cached }, 80)).toEqual([line, cached]);
    expect(tokenTypeLinesOf({ types }, 80)).toEqual([line]);
    expect(tokenTypeLinesOf({ types, cached }, 40)).toEqual([
      'cache read 20M · cache write 2M',
      'input 1M · output 1M',
      cached,
    ]);
  });
  it('name the busiest bar of the chart by what a bar is, under its two ends', () => {
    const report = reportOf(TokenMetric.tokens);
    const byDay = tokenChartOf({ report, columns: 120, rows: 3, timeZone: 'UTC' })!;
    const inDollars = reportOf(TokenMetric.cost);
    const byWeek = tokenChartOf({ report: inDollars, columns: 20, rows: 3, timeZone: 'UTC' })!;
    expect(busiestOf(byDay, TokenMetric.tokens)).toBe('busiest day Nov 10, 24M');
    expect(busiestOf(byWeek, TokenMetric.cost)).toBe('busiest week Nov 6, $31.50');
    const caption = { chart: byDay, barsWidth: 30, metric: TokenMetric.tokens };
    expect(chartCaptionsOf({ ...caption, barsWidth: 60, width: 80 })).toEqual([
      'Oct 14            busiest day Nov 10, 24M             Nov 12',
    ]);
    expect(chartCaptionsOf({ ...caption, width: 80 })).toEqual([
      'Oct 14                  Nov 12      busiest day Nov 10, 24M',
    ]);
    expect(chartCaptionsOf({ ...caption, width: 40 })).toEqual([
      'Oct 14                  Nov 12',
      'busiest day Nov 10, 24M',
    ]);
  });
  it('give the bar sections one set of columns, as wide as their widest cell', () => {
    const report = reportOf(TokenMetric.cost, [
      Row,
      { ...Row, account: 'a-very-long-account-name', output: 99 * Million },
    ]);
    const columns = barColumnsOf(report, 18);
    expect(columns).toEqual({ name: 18, amount: 12, share: 7, other: 7 });
    expect(tokenNumbersOf(report.accounts[0]!, report, columns)).toEqual({
      lead: '   $1,501.50    98%',
      other: '   122M',
    });
  });
  it('say how many records could not be read, and when a machine last answered', () => {
    expect(skippedNoteOf(0)).toBeUndefined();
    expect(skippedNoteOf(1)).toBe('1 record could not be read, so these numbers may be low.');
    expect(skippedNoteOf(2)).toBe('2 records could not be read, so these numbers may be low.');
    expect(lastReadOf(undefined, Now)).toBe('');
    expect(lastReadOf('2026-11-12T15:29:40.000Z', Now)).toBe(', last read just now');
    expect(lastReadOf('2026-11-12T15:18:00.000Z', Now)).toBe(', last read 12m ago');
    expect(lastReadOf('2026-11-12T10:00:00.000Z', Now)).toBe(', last read 5h ago');
    expect(lastReadOf('2026-11-09T14:00:00.000Z', Now)).toBe(', last read 3d ago');
  });
});

describe('filters and steps', () => {
  const choices = (hidden: string[]) => ({
    machines: ['macbook', 'devbox'].map((id) => ({ id, name: id, isOn: !hidden.includes(id) })),
    accounts: [{ id: 'work', name: 'work', isOn: true }],
    providers: [],
  });

  it('toggle one row, keep only one, and hide what was not asked for', () => {
    const hidden = toggledFilter(NoUsageFilter, 'machines', 'devbox');
    expect(hidden.machines).toEqual(['devbox']);
    expect(toggledFilter(hidden, 'machines', 'devbox')).toEqual(NoUsageFilter);
    expect(onlyFilter(NoUsageFilter, 'accounts', 'work', ['personal', 'work', 'client']).accounts).toEqual([
      'personal',
      'client',
    ]);
    expect(hiddenFor(['a', 'b', 'c'], ['b'])).toEqual(['a', 'c']);
    expect(hiddenFor(['a', 'b', 'c'], [])).toEqual([]);
  });
  it('sum up what is on, and notice a group with nothing left', () => {
    expect(filterSummaryOf(choices([]))).toBe('all machines · all accounts · all providers');
    expect(filterSummaryOf(choices(['devbox']))).toBe('1 of 2 machines · all accounts · all providers');
    expect(isFiltered(choices([]))).toBe(false);
    expect(isFiltered(choices(['devbox']))).toBe(true);
    expect(isNothingSelected(choices(['devbox']))).toBe(false);
    expect(isNothingSelected(choices(['devbox', 'macbook']))).toBe(true);
  });
  it('step through a list, around it or up to its ends', () => {
    expect(stepIn(UsagePeriods, '30d', 1, false)).toBe('90d');
    expect(stepIn(UsagePeriods, 'all', 1, false)).toBe('all');
    expect(stepIn(UsagePeriods, '24h', -1, false)).toBe('24h');
    expect(stepIn(UsagePeriods, 'all', 1, true)).toBe('24h');
    expect(stepIn(UsagePeriods, '24h', -1, true)).toBe('all');
  });
});
