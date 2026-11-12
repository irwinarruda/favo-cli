import { ProviderOrder, Providers } from '#domain/providers/provider';
import { ownValue } from '#domain/shared/own-value';
import type { ValueOf } from '#domain/shared/value-of';
import {
  cacheSavingsOf,
  findTokenRate,
  type TokenPrices,
  type TokenRate,
  typeCostsOf,
} from '#domain/usage/token-prices';
import { processedTokensOf, type TokenCounts, type TokenUsageRow } from '#domain/usage/token-usage';
import { type UsageFilter, UsagePeriod } from '#domain/usage/usage-view';

const HourMs = 3_600_000;
const DayMs = 24 * HourMs;
const WeekDays = 7;
const QuarterDayHours = 6;
const ChartLevels = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
const MonthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const DefaultTokenDays = 30;
export const TokenChartRows = 3;

export const TokenMetric = {
  tokens: 'tokens',
  cost: 'cost',
} as const;
export type TokenMetric = ValueOf<typeof TokenMetric>;

export const TokenWindowUnit = {
  hours: 'hours',
  days: 'days',
  all: 'all',
} as const;
export type TokenWindowUnit = ValueOf<typeof TokenWindowUnit>;

export type TokenWindow = { unit: TokenWindowUnit; length: number };

export const PeriodWindows: Record<UsagePeriod, TokenWindow> = {
  [UsagePeriod.day]: { unit: TokenWindowUnit.hours, length: 24 },
  [UsagePeriod.week]: { unit: TokenWindowUnit.days, length: 7 },
  [UsagePeriod.month]: { unit: TokenWindowUnit.days, length: 30 },
  [UsagePeriod.quarter]: { unit: TokenWindowUnit.days, length: 90 },
  [UsagePeriod.all]: { unit: TokenWindowUnit.all, length: 0 },
};

export type TokenMachine = { id: string; name: string; rows: TokenUsageRow[]; note?: string; isFaded?: boolean };

export type TokenSums = TokenCounts & {
  tokens: number;
  sessions: number;
  cost: number;
  pricedTokens: number;
  unpricedTokens: number;
  savings: number;
  typeCosts: TokenCounts;
};

export type TokenGroup = TokenSums & { id: string; name: string; share?: number; note?: string; isFaded: boolean };

export type TokenSlot = { at: number; day: string; hour: number; tokens: number; cost: number };

export type TokenDayRow = TokenCounts & {
  day: string;
  machine: string;
  account: string;
  provider: string;
  model: string;
  sessions: number;
  cost?: number;
};

export type TokenReportInput = {
  machines: TokenMachine[];
  prices: TokenPrices;
  filter: UsageFilter;
  window: TokenWindow;
  metric: TokenMetric;
  now: number;
  timeZone: string;
  accountNames: Record<string, string>;
};

export type TokenReport = {
  metric: TokenMetric;
  window: TokenWindow;
  now: number;
  since: string;
  until: string;
  hasPrices: boolean;
  total: TokenSums;
  providers: TokenGroup[];
  accounts: TokenGroup[];
  machines: TokenGroup[];
  models: TokenGroup[];
  days: TokenGroup[];
  slots: TokenSlot[];
};

export const TokenChartUnit = {
  hour: 'hour',
  quarterDay: 'six hours',
  day: 'day',
  week: 'week',
  month: 'month',
} as const;
export type TokenChartUnit = ValueOf<typeof TokenChartUnit>;

export type TokenChart = {
  unit: TokenChartUnit;
  lines: string[];
  start: string;
  end: string;
  busiest?: { label: string; value: number };
};

type Hit = { machine: TokenMachine; row: TokenUsageRow; at: number; day: string; hour: number; rate?: TokenRate };
type Bucket = { label: string; value: number };
type Buckets = { unit: TokenChartUnit; buckets: Bucket[] };

export function tokenReportOf(input: TokenReportInput): TokenReport {
  const { machines, filter, window, metric, now, prices, accountNames } = input;
  const total = emptySums();
  const groups = {
    providers: new Map<string, TokenGroup>(),
    accounts: new Map<string, TokenGroup>(),
    machines: new Map<string, TokenGroup>(),
    models: new Map<string, TokenGroup>(),
    days: new Map<string, TokenGroup>(),
  };
  const slots = new Map<number, TokenSlot>();
  for (const { id, name, note, isFaded } of machines) {
    if (!filter.machines.includes(id)) groups.machines.set(id, groupOf(id, name, { note, isFaded: isFaded ?? false }));
  }
  const { until } = scan(input, ({ machine, row, at, day, hour, rate }) => {
    const account = ownValue(accountNames, row.account);
    addRow(total, row, rate);
    addRow(heldGroup(groups.providers, row.provider, Providers[row.provider].label), row, rate);
    addRow(heldGroup(groups.accounts, row.account, account ?? row.account, account === undefined), row, rate);
    addRow(heldGroup(groups.machines, machine.id, machine.name), row, rate);
    addRow(heldGroup(groups.models, row.model, row.model), row, rate);
    addRow(heldGroup(groups.days, day, day), row, rate);
    const slot = slots.get(at) ?? { at, day, hour, tokens: 0, cost: 0 };
    slot.tokens += processedTokensOf(row);
    slot.cost += rate ? processedTokensOf(typeCostsOf(row, rate)) : 0;
    slots.set(at, slot);
  });
  const days = [...groups.days.values()].toSorted((left, right) => right.id.localeCompare(left.id));
  const firstDay = days.at(-1)?.id ?? until;
  const since = window.unit === TokenWindowUnit.days ? shiftDay(until, 1 - window.length) : firstDay;
  const isOneYear = since.slice(0, 4) === until.slice(0, 4);
  return {
    metric,
    window,
    now,
    since,
    until,
    hasPrices: prices.fetchedAt !== undefined,
    total,
    providers: ranked(groups.providers, metric).toSorted(
      (left, right) =>
        metricValueOf(right, metric) - metricValueOf(left, metric) || providerRank(left.id) - providerRank(right.id)
    ),
    accounts: ranked(groups.accounts, metric),
    machines: ranked(groups.machines, metric),
    models: ranked(groups.models, metric),
    days: withShares(days, metric).map((day) => ({ ...day, name: dayLabelOf(day.id, isOneYear) })),
    slots: [...slots.values()].toSorted((left, right) => left.at - right.at),
  };
}

export function tokenDayRowsOf(input: Omit<TokenReportInput, 'metric' | 'accountNames'>) {
  const rows = new Map<string, TokenDayRow>();
  scan(input, ({ machine, row, day, rate }) => {
    const key = [day, machine.id, row.account, row.provider, row.model].join('\n');
    const held = rows.get(key) ?? {
      day,
      machine: machine.name,
      account: row.account,
      provider: row.provider,
      model: row.model,
      input: 0,
      cacheRead: 0,
      cacheWrite: 0,
      output: 0,
      sessions: 0,
      cost: rate ? 0 : undefined,
    };
    held.input += row.input;
    held.cacheRead += row.cacheRead;
    held.cacheWrite += row.cacheWrite;
    held.output += row.output;
    held.sessions += row.sessions;
    if (rate) held.cost = (held.cost ?? 0) + processedTokensOf(typeCostsOf(row, rate));
    rows.set(key, held);
  });
  return [...rows.entries()].toSorted(([left], [right]) => left.localeCompare(right)).map(([, row]) => row);
}

export function tokenChartOf(input: {
  report: TokenReport;
  columns: number;
  rows: number;
  timeZone: string;
}): TokenChart | undefined {
  const { report, columns, rows, timeZone } = input;
  const { unit, buckets } = bucketsOf(report, columns, timeZone);
  if (buckets.length === 0) return undefined;
  const highest = Math.max(...buckets.map(({ value }) => value));
  const busiest = highest > 0 ? buckets.find(({ value }) => value === highest) : undefined;
  const steps = ChartLevels.length;
  const top = rows * steps - 1;
  const levels = buckets.map(({ value }) =>
    value <= 0 || highest <= 0 ? 0 : Math.max(1, Math.round((value / highest) * top))
  );
  const lines = Array.from({ length: rows }, (_, index) => {
    const floor = (rows - 1 - index) * steps;
    return levels.map((level) => (level < floor ? ' ' : ChartLevels[Math.min(level - floor, steps - 1)])).join('');
  });
  return { unit, lines, start: buckets[0]!.label, end: buckets.at(-1)!.label, busiest };
}

export function metricValueOf(sums: TokenSums, metric: TokenMetric) {
  return metric === TokenMetric.cost ? sums.cost : sums.tokens;
}

export function cachedPercentOf({ input, cacheRead, cacheWrite }: TokenCounts) {
  const prompt = input + cacheRead + cacheWrite;
  return prompt > 0 ? (cacheRead / prompt) * 100 : undefined;
}

export function perMillionOf({ cost, pricedTokens }: TokenSums) {
  return pricedTokens > 0 ? (cost / pricedTokens) * 1_000_000 : undefined;
}

export function sharesOf(values: number[]) {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return values.map(() => 0);
  const exact = values.map((value) => (value / total) * 100);
  const shares = exact.map(Math.floor);
  const missing = 100 - shares.reduce((sum, share) => sum + share, 0);
  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .toSorted((left, right) => right.remainder - left.remainder || left.index - right.index);
  for (const { index } of byRemainder.slice(0, missing)) shares[index]! += 1;
  return shares;
}

export function dayLabelOf(day: string, isOneYear = true) {
  const [year, month, date] = day.split('-').map(Number);
  const label = `${MonthNames[month! - 1]} ${date}`;
  return isOneYear ? label : `${label} ${year}`;
}

function scan(input: Omit<TokenReportInput, 'metric' | 'accountNames'>, visit: (hit: Hit) => void) {
  const { machines, filter, window, now, timeZone, prices } = input;
  const localOf = localClockOf(timeZone);
  const thisHour = Math.floor(now / HourMs) * HourMs;
  const until = localOf(thisHour).day;
  const since = window.unit === TokenWindowUnit.days ? shiftDay(until, 1 - window.length) : '';
  const firstHour = window.unit === TokenWindowUnit.hours ? thisHour - (window.length - 1) * HourMs : 0;
  const rates = new Map<string, TokenRate | undefined>();
  for (const machine of machines) {
    if (filter.machines.includes(machine.id)) continue;
    for (const row of machine.rows) {
      if (filter.accounts.includes(row.account) || filter.providers.includes(row.provider)) continue;
      const at = Date.parse(row.hour);
      const { day, hour } = localOf(at);
      const isInside = window.unit === TokenWindowUnit.hours ? at >= firstHour && at <= thisHour : day >= since;
      if (!isInside || day > until) continue;
      if (!rates.has(row.model)) rates.set(row.model, findTokenRate(prices.rates, row.model));
      visit({ machine, row, at, day, hour, rate: rates.get(row.model) });
    }
  }
  return { until };
}

function localClockOf(timeZone: string) {
  const format = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  });
  const known = new Map<number, { day: string; hour: number }>();
  return (at: number) => {
    const held = known.get(at);
    if (held) return held;
    const parts = Object.fromEntries(format.formatToParts(new Date(at)).map(({ type, value }) => [type, value]));
    const local = { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
    known.set(at, local);
    return local;
  };
}

function bucketsOf(report: TokenReport, columns: number, timeZone: string): Buckets {
  const { window, slots, metric, since, until, now } = report;
  function amountOf(slot: TokenSlot) {
    return metric === TokenMetric.cost ? slot.cost : slot.tokens;
  }
  const isOneYear = since.slice(0, 4) === until.slice(0, 4);
  function filled(unit: TokenChartUnit, labels: string[], indexOf: (slot: TokenSlot) => number) {
    const buckets = labels.map((label) => ({ label, value: 0 }));
    for (const slot of slots) {
      const bucket = buckets[indexOf(slot)];
      if (bucket) bucket.value += amountOf(slot);
    }
    return { unit, buckets };
  }
  if (window.unit === TokenWindowUnit.hours) {
    const localOf = localClockOf(timeZone);
    const first = Math.floor(now / HourMs) * HourMs - (window.length - 1) * HourMs;
    const labels = Array.from({ length: window.length }, (_, index) => {
      const { day, hour } = localOf(first + index * HourMs);
      return hourLabelOf(day, hour);
    });
    return filled(TokenChartUnit.hour, labels, (slot) => Math.round((slot.at - first) / HourMs));
  }
  if (slots.length === 0 && window.unit === TokenWindowUnit.all) return { unit: TokenChartUnit.day, buckets: [] };
  const days = daysBetween(since, until) + 1;
  function dayOf(index: number) {
    return shiftDay(since, index);
  }
  const quarters = (days * 24) / QuarterDayHours;
  if (days <= WeekDays && quarters <= columns) {
    const perDay = 24 / QuarterDayHours;
    const labels = Array.from({ length: quarters }, (_, index) =>
      hourLabelOf(dayOf(Math.floor(index / perDay)), (index % perDay) * QuarterDayHours)
    );
    return filled(
      TokenChartUnit.quarterDay,
      labels,
      (slot) => daysBetween(since, slot.day) * perDay + Math.floor(slot.hour / QuarterDayHours)
    );
  }
  if (days <= columns) {
    const labels = Array.from({ length: days }, (_, index) => dayLabelOf(dayOf(index), isOneYear));
    return filled(TokenChartUnit.day, labels, (slot) => daysBetween(since, slot.day));
  }
  const weeks = Math.ceil(days / WeekDays);
  if (weeks <= columns) {
    const offset = weeks * WeekDays - days;
    const labels = Array.from({ length: weeks }, (_, index) =>
      dayLabelOf(dayOf(Math.max(0, index * WeekDays - offset)), isOneYear)
    );
    return filled(TokenChartUnit.week, labels, (slot) =>
      Math.floor((daysBetween(since, slot.day) + offset) / WeekDays)
    );
  }
  const months = monthsBetween(since, until).slice(-Math.max(columns, 1));
  return filled(
    TokenChartUnit.month,
    months.map((month) => monthLabelOf(month)),
    (slot) => months.indexOf(slot.day.slice(0, 7))
  );
}

function hourLabelOf(day: string, hour: number) {
  return `${dayLabelOf(day)} ${String(hour).padStart(2, '0')}:00`;
}

function monthLabelOf(month: string) {
  const [year, index] = month.split('-').map(Number);
  return `${MonthNames[index! - 1]} ${year}`;
}

function monthsBetween(since: string, until: string) {
  const months: string[] = [];
  let [year, month] = since.split('-').map(Number) as [number, number];
  const last = until.slice(0, 7);
  for (;;) {
    const key = `${year}-${String(month).padStart(2, '0')}`;
    months.push(key);
    if (key >= last) return months;
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
}

function utcOf(day: string) {
  const [year, month, date] = day.split('-').map(Number);
  return Date.UTC(year!, month! - 1, date!);
}

function shiftDay(day: string, days: number) {
  return new Date(utcOf(day) + days * DayMs).toISOString().slice(0, 10);
}

function daysBetween(since: string, until: string) {
  return Math.round((utcOf(until) - utcOf(since)) / DayMs);
}

function emptyCounts(): TokenCounts {
  return { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
}

function emptySums(): TokenSums {
  return {
    ...emptyCounts(),
    tokens: 0,
    sessions: 0,
    cost: 0,
    pricedTokens: 0,
    unpricedTokens: 0,
    savings: 0,
    typeCosts: emptyCounts(),
  };
}

function groupOf(id: string, name: string, extra: { note?: string; isFaded: boolean }): TokenGroup {
  return { ...emptySums(), id, name, ...extra };
}

function heldGroup(groups: Map<string, TokenGroup>, id: string, name: string, isFaded = false) {
  const held = groups.get(id);
  if (held) return held;
  const group = groupOf(id, name, { isFaded });
  groups.set(id, group);
  return group;
}

function addRow(sums: TokenSums, row: TokenUsageRow, rate: TokenRate | undefined) {
  const tokens = processedTokensOf(row);
  sums.input += row.input;
  sums.cacheRead += row.cacheRead;
  sums.cacheWrite += row.cacheWrite;
  sums.output += row.output;
  sums.tokens += tokens;
  sums.sessions += row.sessions;
  if (!rate) {
    sums.unpricedTokens += tokens;
    return;
  }
  const costs = typeCostsOf(row, rate);
  sums.typeCosts.input += costs.input;
  sums.typeCosts.cacheRead += costs.cacheRead;
  sums.typeCosts.cacheWrite += costs.cacheWrite;
  sums.typeCosts.output += costs.output;
  sums.cost += processedTokensOf(costs);
  sums.pricedTokens += tokens;
  sums.savings += cacheSavingsOf(row, rate);
}

function ranked(groups: Map<string, TokenGroup>, metric: TokenMetric) {
  const sorted = [...groups.values()].toSorted(
    (left, right) =>
      metricValueOf(right, metric) - metricValueOf(left, metric) ||
      right.tokens - left.tokens ||
      left.name.localeCompare(right.name)
  );
  return withShares(sorted, metric);
}

function withShares(groups: TokenGroup[], metric: TokenMetric) {
  const shares = sharesOf(groups.map((group) => metricValueOf(group, metric)));
  return groups.map((group, index) => {
    const isUnpriced = metric === TokenMetric.cost && group.pricedTokens === 0;
    return { ...group, share: isUnpriced ? undefined : shares[index] };
  });
}

function providerRank(id: string) {
  return ProviderOrder.map(String).indexOf(id);
}
