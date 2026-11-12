import { formatDollars, formatPercent, formatTokens } from '#domain/usage/token-format';
import { NoPriceTableMessage } from '#domain/usage/token-prices';
import {
  cachedPercentOf,
  type TokenChart,
  TokenChartUnit,
  type TokenGroup,
  TokenMetric,
  type TokenReport,
  type TokenSums,
} from '#domain/usage/token-report';
import type { TokenCounts } from '#domain/usage/token-usage';

const TypeLabels: Record<keyof TokenCounts, string> = {
  input: 'input',
  cacheRead: 'cache read',
  cacheWrite: 'cache write',
  output: 'output',
};
const BucketNames: Record<TokenChartUnit, string> = {
  [TokenChartUnit.hour]: 'hour',
  [TokenChartUnit.quarterDay]: '6 hours',
  [TokenChartUnit.day]: 'day',
  [TokenChartUnit.week]: 'week',
  [TokenChartUnit.month]: 'month',
};
const CaptionGap = '      ';
const CaptionMargin = 3;
const ColumnGap = 3;

const TypeSeparator = ' · ';
const AgeUnits = [
  { size: 86_400_000, suffix: 'd' },
  { size: 3_600_000, suffix: 'h' },
  { size: 60_000, suffix: 'm' },
];

export const UnpricedLabel = 'unpriced';
export const NotCountedLabel = 'not counted yet';
export const NothingSelectedMessage = 'Nothing is selected.';
export const NoTokensMessage = 'No tokens counted in this period.';

export function lastReadOf(readAt: string | undefined, now: number) {
  if (readAt === undefined) return '';
  const age = Math.max(0, now - Date.parse(readAt));
  const unit = AgeUnits.find(({ size }) => age >= size);
  return unit ? `, last read ${Math.floor(age / unit.size)}${unit.suffix} ago` : ', last read just now';
}

export function tokenHeadlineOf({ metric, total, hasPrices }: TokenReport) {
  const tokens = `${formatTokens(total.tokens)} tokens`;
  const cost = `${formatDollars(total.cost)} at API prices`;
  if (metric === TokenMetric.cost) {
    if (!hasPrices) return { lead: NoPriceTableMessage, facts: [tokens] };
    return { lead: cost, facts: [tokens, `${formatDollars(total.savings)} saved by cache`] };
  }
  const sessions = `${total.sessions.toLocaleString('en-US')} ${total.sessions === 1 ? 'session' : 'sessions'}`;
  return { lead: tokens, facts: hasPrices ? [sessions, cost] : [sessions] };
}

export function tokenAmountOf(sums: TokenSums, metric: TokenMetric) {
  if (metric === TokenMetric.tokens) return formatTokens(sums.tokens);
  return sums.pricedTokens === 0 && sums.tokens > 0 ? UnpricedLabel : formatDollars(sums.cost);
}

export function tokenRowOf(group: TokenGroup, { metric, hasPrices }: TokenReport) {
  const other = metric === TokenMetric.cost ? TokenMetric.tokens : TokenMetric.cost;
  return {
    amount: tokenAmountOf(group, metric),
    share: formatPercent(group.share),
    other: other === TokenMetric.cost && !hasPrices ? '' : tokenAmountOf(group, other),
  };
}

export type TokenColumns = { name: number; amount: number; share: number; other: number };

export function tokenColumnsOf(groups: TokenGroup[], report: TokenReport, maximumName: number): TokenColumns {
  const rows = groups.map((group) => tokenRowOf(group, report));
  function widthOf(cells: string[]) {
    const longest = Math.max(0, ...cells.map((cell) => cell.length));
    return longest === 0 ? 0 : longest + ColumnGap;
  }
  return {
    name: Math.min(Math.max(0, ...groups.map((group) => group.name.length)), maximumName),
    amount: widthOf(rows.map((row) => row.amount)),
    share: widthOf(rows.map((row) => row.share)),
    other: widthOf(rows.map((row) => row.other)),
  };
}

export function barColumnsOf(report: TokenReport, maximumName: number) {
  return tokenColumnsOf([...report.providers, ...report.accounts, ...report.machines], report, maximumName);
}

export function tokenNumbersOf(group: TokenGroup, report: TokenReport, columns: TokenColumns) {
  const { amount, share, other } = tokenRowOf(group, report);
  return {
    lead: `${amount.padStart(columns.amount)}${share.padStart(columns.share)}`,
    other: other.padStart(columns.other),
  };
}

export function tokenBarOf(share: number | undefined, width: number) {
  const filled = share === undefined || share <= 0 ? 0 : Math.max(1, Math.round((share / 100) * width));
  return { filled: Math.min(filled, width), rest: width - Math.min(filled, width) };
}

export function tokenTypesOf({ metric, total }: TokenReport) {
  const isCost = metric === TokenMetric.cost;
  const amounts = isCost ? total.typeCosts : total;
  const types = (Object.keys(TypeLabels) as (keyof TokenCounts)[])
    .filter((type) => amounts[type] > 0)
    .toSorted((left, right) => amounts[right] - amounts[left])
    .map((type) => `${TypeLabels[type]} ${isCost ? formatDollars(amounts[type]) : formatTokens(amounts[type])}`);
  const cached = cachedPercentOf(total);
  return {
    types,
    cached: isCost || cached === undefined ? undefined : `${formatPercent(cached)} of the input came from cache`,
  };
}

export function tokenTypeLinesOf(types: { types: string[]; cached?: string }, width: number) {
  const line = types.types.join(TypeSeparator);
  const cached = types.cached === undefined ? [] : [types.cached];
  const together = [line, ...cached].join(CaptionGap);
  if (together.length <= width) return [together];
  if (line.length <= width) return [line, ...cached];
  const half = Math.ceil(types.types.length / 2);
  const halves = [types.types.slice(0, half), types.types.slice(half)];
  return [...halves.map((part) => part.join(TypeSeparator)), ...cached];
}

export function busiestOf(chart: TokenChart, metric: TokenMetric) {
  if (!chart.busiest) return '';
  const { label, value } = chart.busiest;
  const amount = metric === TokenMetric.cost ? formatDollars(value) : formatTokens(value);
  return `busiest ${BucketNames[chart.unit]} ${label}, ${amount}`;
}

export function chartCaptionsOf(input: { chart: TokenChart; barsWidth: number; metric: TokenMetric; width: number }) {
  const { chart, barsWidth, metric, width } = input;
  const range = chart.end.padStart(Math.max(barsWidth - chart.start.length, chart.end.length + 2));
  const labels = `${chart.start}${range}`;
  const busiest = busiestOf(chart, metric);
  if (busiest === '') return [labels];
  const between = barsWidth - chart.start.length - chart.end.length - busiest.length;
  if (between >= 2 * CaptionMargin) {
    const before = Math.floor(between / 2);
    return [`${chart.start}${' '.repeat(before)}${busiest}${' '.repeat(between - before)}${chart.end}`];
  }
  const line = `${labels}${CaptionGap}${busiest}`;
  return line.length <= width ? [line] : [labels, busiest];
}

export function unpricedNoteOf({ total }: TokenReport) {
  if (total.unpricedTokens === 0) return undefined;
  return `${formatTokens(total.unpricedTokens)} tokens have no list price, and are left out of every dollar.`;
}

export function skippedNoteOf(skippedRecords: number) {
  if (skippedRecords === 0) return undefined;
  const records = skippedRecords === 1 ? '1 record' : `${skippedRecords.toLocaleString('en-US')} records`;
  return `${records} could not be read, so these numbers may be low.`;
}
