import { ProviderOrder, Providers } from '@favo/domain/providers/provider';
import {
  DefaultUsageView,
  filterSummaryOf,
  isFiltered,
  isNothingSelected,
  NoUsageFilter,
  onlyFilter,
  stepIn,
  toggledFilter,
  type UsageFilter,
  type UsageFilterChoices,
  type UsageFilterGroup,
  UsageFilterGroups,
  UsagePage,
  UsagePages,
  type UsagePeriod,
  UsagePeriods,
} from '@favo/domain/usage/usage-view';
import { computeFrom } from '@/libs/zustand';
import type { Account } from '@/modules/comb/app/entities/Account';
import type { Machine } from '@/modules/comb/app/entities/Machine';
import type { MachineLimits } from '@/modules/usage/app/services/LimitsService';
import type { MachineTokens } from '@/modules/usage/app/services/TokensService';
import { container } from '@/shared/container';
import type { ServiceCreator } from '@/shared/stores/app';

export type UsageService = {
  isUsageOpen: boolean;
  isUsageViewLoaded: boolean;
  isUsageFilterOpen: boolean;
  usageNow: number;
  usageTimeZone: string;
  usagePage: UsagePage;
  usagePeriod: UsagePeriod;
  usageFilter: UsageFilter;
  usageFilterCursor: number;
  usageFilterChoices: UsageFilterChoices;
  usageFilterSummary: string;
  isUsageFiltered: boolean;
  isUsageSelectionEmpty: boolean;
  loadUsageView(): Promise<void>;
  openUsage(): Promise<void>;
  closeUsage(): void;
  loadUsagePage(): Promise<void>;
  showUsagePage(page: UsagePage): Promise<void>;
  stepUsagePage(step: number): Promise<void>;
  showUsagePeriod(period: UsagePeriod): Promise<void>;
  stepUsagePeriod(step: number): Promise<void>;
  openUsageFilter(): void;
  closeUsageFilter(): void;
  moveUsageFilterCursor(step: number): void;
  toggleUsageFilterAt(index?: number): void;
  keepOnlyUsageFilterAtCursor(): void;
  toggleUsageFilter(group: UsageFilterGroup, id: string): void;
  keepOnlyUsageFilter(group: UsageFilterGroup, id: string): void;
  clearUsageFilter(): void;
  refreshUsage(): Promise<void>;
  tickUsage(): void;
};

export const createUsageService: ServiceCreator<UsageService> = (set, get) => ({
  ...computeFrom(
    get,
    (state) => [state.machines, state.accounts, state.machineLimits, state.machineTokens, state.usageFilter] as const,
    ({ machines, accounts, machineLimits, machineTokens, usageFilter }) => {
      const usageFilterChoices = _choicesOf(machines, accounts, machineLimits, machineTokens, usageFilter);
      return {
        usageFilterChoices,
        usageFilterSummary: filterSummaryOf(usageFilterChoices),
        isUsageFiltered: isFiltered(usageFilterChoices),
        isUsageSelectionEmpty: isNothingSelected(usageFilterChoices),
      };
    }
  ),
  isUsageOpen: false,
  isUsageViewLoaded: false,
  isUsageFilterOpen: false,
  usageNow: 0,
  usageTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  usagePage: DefaultUsageView.page,
  usagePeriod: DefaultUsageView.period,
  usageFilter: NoUsageFilter,
  usageFilterCursor: 0,
  async loadUsageView() {
    const usageRepository = container.get('IUsageRepository');
    const { page, period } = await usageRepository.readView();
    if (get().isUsageViewLoaded || get().isUsageOpen) return;
    set({ usagePage: page, usagePeriod: period, isUsageViewLoaded: true });
  },
  async openUsage() {
    set({
      isUsageOpen: true,
      isUsageViewLoaded: true,
      isUsageFilterOpen: false,
      usageFilter: NoUsageFilter,
      usageNow: Date.now(),
    });
    await get().loadUsagePage();
  },
  closeUsage() {
    set({ isUsageOpen: false, isUsageFilterOpen: false });
  },
  async loadUsagePage() {
    const { usagePage, openLimits, openTokens } = get();
    if (usagePage === UsagePage.limits) await openLimits();
    else await openTokens();
  },
  async showUsagePage(page) {
    const { usagePage, usagePeriod, loadUsagePage } = get();
    if (page === usagePage) return;
    const usageRepository = container.get('IUsageRepository');
    set({ usagePage: page, usageNow: Date.now() });
    await Promise.all([usageRepository.saveView({ page, period: usagePeriod }), loadUsagePage()]);
  },
  async stepUsagePage(step) {
    const { usagePage, showUsagePage } = get();
    await showUsagePage(stepIn(UsagePages, usagePage, step, true));
  },
  async showUsagePeriod(period) {
    const { usagePage, usagePeriod } = get();
    if (usagePage === UsagePage.limits || period === usagePeriod) return;
    const usageRepository = container.get('IUsageRepository');
    set({ usagePeriod: period, usageNow: Date.now() });
    await usageRepository.saveView({ page: usagePage, period });
  },
  async stepUsagePeriod(step) {
    const { usagePeriod, showUsagePeriod } = get();
    await showUsagePeriod(stepIn(UsagePeriods, usagePeriod, step, false));
  },
  openUsageFilter() {
    set({ isUsageFilterOpen: true, usageFilterCursor: 0 });
  },
  moveUsageFilterCursor(step) {
    const last = _filterRowsOf(get().usageFilterChoices).length - 1;
    set((state) => ({ usageFilterCursor: Math.max(0, Math.min(last, state.usageFilterCursor + step)) }));
  },
  toggleUsageFilterAt(index) {
    const { usageFilterChoices, usageFilterCursor, toggleUsageFilter } = get();
    const cursor = index ?? usageFilterCursor;
    const row = _filterRowsOf(usageFilterChoices)[cursor];
    if (!row) return;
    set({ usageFilterCursor: cursor });
    toggleUsageFilter(row.group, row.id);
  },
  keepOnlyUsageFilterAtCursor() {
    const { usageFilterChoices, usageFilterCursor, keepOnlyUsageFilter } = get();
    const row = _filterRowsOf(usageFilterChoices)[usageFilterCursor];
    if (row) keepOnlyUsageFilter(row.group, row.id);
  },
  closeUsageFilter() {
    set({ isUsageFilterOpen: false });
  },
  toggleUsageFilter(group, id) {
    set((state) => ({ usageFilter: toggledFilter(state.usageFilter, group, id) }));
  },
  keepOnlyUsageFilter(group, id) {
    const ids = get().usageFilterChoices[group].map((choice) => choice.id);
    set((state) => ({ usageFilter: onlyFilter(state.usageFilter, group, id, ids) }));
  },
  clearUsageFilter() {
    set({ usageFilter: NoUsageFilter });
  },
  async refreshUsage() {
    const { usagePage, refreshLimits, refreshTokens } = get();
    if (usagePage === UsagePage.limits) await refreshLimits();
    else await refreshTokens();
  },
  tickUsage() {
    set({ usageNow: Date.now() });
  },
});

function _filterRowsOf(choices: UsageFilterChoices) {
  return UsageFilterGroups.flatMap((group) => choices[group].map(({ id }) => ({ group, id })));
}

function _choicesOf(
  machines: Machine[],
  accounts: Account[],
  machineLimits: Record<string, MachineLimits>,
  machineTokens: Record<string, MachineTokens>,
  filter: UsageFilter
): UsageFilterChoices {
  const names = new Map<string, string>();
  const providers = new Set<string>();
  for (const account of accounts) {
    names.set(account.name, account.displayName);
    for (const seat of account.visibleSeats) providers.add(seat.provider);
  }
  for (const { seats } of Object.values(machineLimits)) {
    for (const seat of seats) {
      if (!names.has(seat.account)) names.set(seat.account, seat.displayName);
      providers.add(seat.provider);
    }
  }
  for (const { usage } of Object.values(machineTokens)) {
    for (const row of usage?.rows ?? []) {
      if (!names.has(row.account)) names.set(row.account, row.account);
      providers.add(row.provider);
    }
  }
  return {
    machines: machines.map((machine) => ({
      id: machine.id,
      name: machine.name,
      isOn: !filter.machines.includes(machine.id),
      note: machine.isOnline ? undefined : machine.presenceLabel,
    })),
    accounts: [...names].map(([id, name]) => ({ id, name, isOn: !filter.accounts.includes(id) })),
    providers: ProviderOrder.filter((id) => providers.has(id)).map((id) => ({
      id,
      name: Providers[id].label,
      isOn: !filter.providers.includes(id),
    })),
  };
}
