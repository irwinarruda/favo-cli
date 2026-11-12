import { z } from 'zod';
import type { ValueOf } from '#domain/shared/value-of';

export const UsagePage = {
  limits: 'limits',
  tokens: 'tokens',
  cost: 'cost',
} as const;
export type UsagePage = ValueOf<typeof UsagePage>;

export const UsagePeriod = {
  day: '24h',
  week: '7d',
  month: '30d',
  quarter: '90d',
  all: 'all',
} as const;
export type UsagePeriod = ValueOf<typeof UsagePeriod>;

export const UsagePages: UsagePage[] = [UsagePage.limits, UsagePage.tokens, UsagePage.cost];
export const UsagePeriods: UsagePeriod[] = [
  UsagePeriod.day,
  UsagePeriod.week,
  UsagePeriod.month,
  UsagePeriod.quarter,
  UsagePeriod.all,
];
export const UsagePageLabels: Record<UsagePage, string> = { limits: 'Limits', tokens: 'Tokens', cost: 'Cost' };

export const UsageView = z.strictObject({ page: z.enum(UsagePage), period: z.enum(UsagePeriod) });
export type UsageView = z.infer<typeof UsageView>;

export const DefaultUsageView: UsageView = { page: UsagePage.limits, period: UsagePeriod.month };

export const UsageFilterGroup = {
  machines: 'machines',
  accounts: 'accounts',
  providers: 'providers',
} as const;
export type UsageFilterGroup = ValueOf<typeof UsageFilterGroup>;

export const UsageFilterGroups: UsageFilterGroup[] = [
  UsageFilterGroup.machines,
  UsageFilterGroup.accounts,
  UsageFilterGroup.providers,
];

export type UsageFilter = Record<UsageFilterGroup, string[]>;
export type UsageFilterChoice = { id: string; name: string; isOn: boolean; note?: string };
export type UsageFilterChoices = Record<UsageFilterGroup, UsageFilterChoice[]>;

export const NoUsageFilter: UsageFilter = { machines: [], accounts: [], providers: [] };

export function stepIn<Value>(values: Value[], current: Value, step: number, wraps: boolean) {
  const next = values.indexOf(current) + step;
  if (wraps) return values[(next + values.length) % values.length]!;
  return values[Math.max(0, Math.min(values.length - 1, next))]!;
}

export function toggledFilter(filter: UsageFilter, group: UsageFilterGroup, id: string): UsageFilter {
  const hidden = filter[group];
  return { ...filter, [group]: hidden.includes(id) ? hidden.filter((other) => other !== id) : [...hidden, id] };
}

export function onlyFilter(filter: UsageFilter, group: UsageFilterGroup, id: string, ids: string[]): UsageFilter {
  return { ...filter, [group]: ids.filter((other) => other !== id) };
}

export function hiddenFor(ids: string[], shown: string[]) {
  return shown.length === 0 ? [] : ids.filter((id) => !shown.includes(id));
}

export function isNothingSelected(choices: UsageFilterChoices) {
  return UsageFilterGroups.some((group) => choices[group].length > 0 && choices[group].every(({ isOn }) => !isOn));
}

export function isFiltered(choices: UsageFilterChoices) {
  return UsageFilterGroups.some((group) => choices[group].some(({ isOn }) => !isOn));
}

export function filterSummaryOf(choices: UsageFilterChoices) {
  return UsageFilterGroups.map((group) => {
    const all = choices[group];
    const on = all.filter(({ isOn }) => isOn).length;
    return on === all.length ? `all ${group}` : `${on} of ${all.length} ${group}`;
  }).join(' · ');
}
