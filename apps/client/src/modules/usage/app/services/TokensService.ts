import { isOlderFavoError } from '@favo/domain/machines/machine';
import { type ProviderId, ProviderOrder, Providers } from '@favo/domain/providers/provider';
import { ownValue } from '@favo/domain/shared/own-value';
import type { ValueOf } from '@favo/domain/shared/value-of';
import { readingAgeOf } from '@favo/domain/usage/seat-limits';
import { NoTokenPrices, type TokenPrices } from '@favo/domain/usage/token-prices';
import {
  PeriodWindows,
  type TokenMachine,
  TokenMetric,
  type TokenReport,
  tokenReportOf,
} from '@favo/domain/usage/token-report';
import { type MachineTokenUsage, TokenProviders, TokenUsageFreshForMs } from '@favo/domain/usage/token-usage';
import { lastReadOf } from '@favo/domain/usage/token-view';
import { UsagePage } from '@favo/domain/usage/usage-view';
import { computeFrom } from '@/libs/zustand';
import type { Account } from '@/modules/comb/app/entities/Account';
import type { Machine } from '@/modules/comb/app/entities/Machine';
import { MachinePresence } from '@/modules/comb/app/enums/MachinePresence';
import { container } from '@/shared/container';
import type { ServiceCreator } from '@/shared/stores/app';

const MinuteMs = 60_000;
const TokensFreshForMs = 5 * 60_000;

export const TokenBreakdown = {
  models: 'models',
  days: 'days',
} as const;
export type TokenBreakdown = ValueOf<typeof TokenBreakdown>;

export type MachineTokens = {
  usage?: MachineTokenUsage;
  readAt?: number;
  isReading: boolean;
  isOutdated: boolean;
  problem?: string;
};

export type TokensService = {
  machineTokens: Record<string, MachineTokens>;
  tokenPrices: TokenPrices;
  tokenBreakdown: TokenBreakdown;
  tokenReport: TokenReport;
  tokenReadingLabel: string;
  uncountedProviders: string[];
  skippedTokenRecords: number;
  isTokensReading: boolean;
  hasTokenReadings: boolean;
  preloadTokens(machineId: string): Promise<void>;
  openTokens(): Promise<void>;
  refreshTokens(): Promise<void>;
  showStoredTokens(machine: Machine): Promise<void>;
  readMachineTokens(machine: Machine): Promise<void>;
  loadTokenPrices(isFresh: boolean): Promise<void>;
  toggleTokenBreakdown(): void;
};

export const createTokensService: ServiceCreator<TokensService> = (set, get) => ({
  ...computeFrom(
    get,
    (state) =>
      [
        state.machines,
        state.accounts,
        state.machineTokens,
        state.tokenPrices,
        state.usageFilter,
        state.usagePeriod,
        state.usagePage === UsagePage.cost,
        Math.floor(state.usageNow / MinuteMs),
        state.usageTimeZone,
      ] as const,
    ({
      machines,
      accounts,
      machineTokens,
      tokenPrices,
      usageFilter,
      usagePeriod,
      usagePage,
      usageNow,
      usageTimeZone,
    }) => {
      const shown = machines.filter((machine) => !usageFilter.machines.includes(machine.id));
      return {
        tokenReport: tokenReportOf({
          machines: machines.map((machine) => _tokenMachineOf(machine, ownValue(machineTokens, machine.id), usageNow)),
          prices: tokenPrices,
          filter: usageFilter,
          window: PeriodWindows[usagePeriod],
          metric: usagePage === UsagePage.cost ? TokenMetric.cost : TokenMetric.tokens,
          now: usageNow,
          timeZone: usageTimeZone,
          accountNames: Object.fromEntries(accounts.map((account) => [account.name, account.displayName])),
        }),
        uncountedProviders: _uncountedProviders(accounts, usageFilter.providers),
        skippedTokenRecords: shown.reduce(
          (total, machine) => total + (ownValue(machineTokens, machine.id)?.usage?.skippedRecords ?? 0),
          0
        ),
        hasTokenReadings: Object.values(machineTokens).some(({ usage }) => usage?.readAt !== undefined),
      };
    }
  ),
  ...computeFrom(
    get,
    (state) => [state.machines, state.machineTokens, state.usageNow, state.usageFilter] as const,
    ({ machines, machineTokens, usageNow, usageFilter }) => {
      const isTokensReading = Object.values(machineTokens).some((tokens) => tokens.isReading);
      const shown = machines.filter((machine) => machine.canRead && !usageFilter.machines.includes(machine.id));
      const readings = shown.flatMap((machine) => {
        const tokens = ownValue(machineTokens, machine.id);
        return tokens?.problem === undefined ? (_readAtOf(tokens) ?? []) : [];
      });
      const oldest = readings.length > 0 ? new Date(Math.min(...readings)).toISOString() : undefined;
      return { isTokensReading, tokenReadingLabel: _readingLabelOf(isTokensReading, oldest, usageNow) };
    }
  ),
  machineTokens: {},
  tokenPrices: NoTokenPrices,
  tokenBreakdown: TokenBreakdown.models,
  async preloadTokens(machineId) {
    const { machines, showStoredTokens, readMachineTokens } = get();
    const machine = machines.find((candidate) => candidate.id === machineId);
    if (!machine?.canRead) return;
    await showStoredTokens(machine);
    if (_isDue(machine, get().machineTokens, TokenUsageFreshForMs)) await readMachineTokens(machine);
  },
  async openTokens() {
    const { machines, showStoredTokens, readMachineTokens, loadTokenPrices } = get();
    await Promise.all(machines.map(showStoredTokens));
    const due = machines.filter((machine) => _isDue(machine, get().machineTokens, TokensFreshForMs));
    await Promise.all([loadTokenPrices(false), ...due.map(readMachineTokens)]);
  },
  async refreshTokens() {
    const { machines, machineTokens, readMachineTokens, loadTokenPrices } = get();
    const idle = machines.filter((machine) => machine.canRead && !ownValue(machineTokens, machine.id)?.isReading);
    await Promise.all(idle.map(readMachineTokens));
    await loadTokenPrices(true);
  },
  async showStoredTokens(machine) {
    const machineId = machine.id;
    const held = ownValue(get().machineTokens, machineId);
    if (held?.usage || held?.isReading) return;
    const tokens = await _storedTokensOf(machine);
    const isStillEmpty = !ownValue(get().machineTokens, machineId)?.usage;
    if (isStillEmpty) set((state) => ({ machineTokens: { ...state.machineTokens, [machineId]: tokens } }));
  },
  async readMachineTokens(machine) {
    const machineId = machine.id;
    const usageRepository = container.get('IUsageRepository');
    const held = ownValue(get().machineTokens, machineId)?.usage;
    function finish(tokens: Omit<MachineTokens, 'isReading'>) {
      const next = { ...tokens, isReading: false };
      set((state) => ({ usageNow: Date.now(), machineTokens: { ...state.machineTokens, [machineId]: next } }));
    }
    const reading = { usage: held, isReading: true, isOutdated: false };
    set((state) => ({ machineTokens: { ...state.machineTokens, [machineId]: reading } }));
    const counted = await _countedTokensOf(machineId, held);
    finish(counted);
    if (counted.problem !== undefined || !counted.usage) return;
    if (!machine.isLocal) await usageRepository.keepTokens(machineId, counted.usage);
    const { isUsageOpen, usagePage, loadTokenPrices } = get();
    if (isUsageOpen && usagePage !== UsagePage.limits) await loadTokenPrices(false);
  },
  async loadTokenPrices(isFresh) {
    const usageRepository = container.get('IUsageRepository');
    const rows = Object.values(get().machineTokens).flatMap(({ usage }) => usage?.rows ?? []);
    const models = [...new Set(rows.map((row) => row.model))];
    if (models.length === 0) return;
    set({ tokenPrices: await usageRepository.readPrices(models, isFresh) });
  },
  toggleTokenBreakdown() {
    const isByModel = get().tokenBreakdown === TokenBreakdown.models;
    set({ tokenBreakdown: isByModel ? TokenBreakdown.days : TokenBreakdown.models });
  },
});

async function _countedTokensOf(machineId: string, held: MachineTokenUsage | undefined) {
  const usageRepository = container.get('IUsageRepository');
  try {
    const usage = await usageRepository.readTokens(machineId, true);
    return { usage, readAt: Date.now(), isOutdated: false, problem: undefined };
  } catch (error) {
    const problem = error instanceof Error ? error.message : String(error);
    const usage = held ?? (await usageRepository.readKeptTokens(machineId).catch(() => undefined));
    return { usage, isOutdated: isOlderFavoError(error), problem };
  }
}

function _readingLabelOf(isReading: boolean, oldest: string | undefined, now: number) {
  if (isReading) return 'reading…';
  return oldest ? readingAgeOf(oldest, now) : '';
}

async function _storedTokensOf(machine: Machine): Promise<MachineTokens> {
  const usageRepository = container.get('IUsageRepository');
  try {
    const usage = machine.canRead
      ? await usageRepository.readTokens(machine.id, false)
      : await usageRepository.readKeptTokens(machine.id);
    return { usage, isReading: false, isOutdated: false };
  } catch (error) {
    const problem = error instanceof Error ? error.message : String(error);
    const usage = await usageRepository.readKeptTokens(machine.id).catch(() => undefined);
    return { usage, isReading: false, isOutdated: isOlderFavoError(error), problem };
  }
}

function _isDue(machine: Machine, machineTokens: Record<string, MachineTokens>, freshForMs: number) {
  const tokens = ownValue(machineTokens, machine.id);
  if (!machine.canRead || tokens?.isReading) return false;
  const readAt = _readAtOf(tokens);
  return readAt === undefined || Date.now() - readAt >= freshForMs;
}

function _readAtOf(tokens: MachineTokens | undefined) {
  const stamped = tokens?.usage?.readAt;
  return tokens?.readAt ?? (stamped === undefined ? undefined : Date.parse(stamped));
}

function _tokenMachineOf(machine: Machine, tokens: MachineTokens | undefined, now: number): TokenMachine {
  const { id, name } = machine;
  const rows = tokens?.usage?.rows ?? [];
  const age = lastReadOf(tokens?.usage?.readAt, now);
  if (machine.presence === MachinePresence.outdated || tokens?.isOutdated) {
    return { id, name, rows, note: 'older favo', isFaded: true };
  }
  if (tokens?.isReading) return { id, name, rows, isFaded: true };
  if (tokens?.problem) return { id, name, rows, note: `could not read${age}`, isFaded: true };
  if (!machine.isOnline) return { id, name, rows, note: `${machine.presenceLabel}${age}`, isFaded: true };
  return { id, name, rows };
}

function _uncountedProviders(accounts: Account[], hidden: string[]) {
  const installed = new Set<ProviderId>(
    accounts.flatMap((account) => account.visibleSeats.map((seat) => seat.provider))
  );
  return ProviderOrder.filter((id) => installed.has(id) && !TokenProviders.includes(id) && !hidden.includes(id)).map(
    (id) => Providers[id].label
  );
}
