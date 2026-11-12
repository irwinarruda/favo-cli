import type { SeatLimitsView } from '@favo/contracts/rpc/views';
import { isOlderFavoError } from '@favo/domain/machines/machine';
import { ownValue } from '@favo/domain/shared/own-value';
import { collectLimitPools, type LimitPool } from '@favo/domain/usage/limit-pool';
import {
  keepLastGoodLimits,
  LimitsFreshForMs,
  LimitsUnavailableReason,
  readingAgeOf,
  unavailableLimits,
} from '@favo/domain/usage/seat-limits';
import type { UsageFilter } from '@favo/domain/usage/usage-view';
import { computeFrom } from '@/libs/zustand';
import type { Machine } from '@/modules/comb/app/entities/Machine';
import { MachinePresence } from '@/modules/comb/app/enums/MachinePresence';
import { container } from '@/shared/container';
import type { ServiceCreator } from '@/shared/stores/app';

export type MachineLimits = {
  seats: SeatLimitsView[];
  readAt: number;
  isReading: boolean;
  isOutdated: boolean;
  problem?: string;
};

export type LimitMachineLine = { id: string; name: string; label: string; isOld: boolean };

export type LimitsService = {
  machineLimits: Record<string, MachineLimits>;
  limitPools: LimitPool[];
  limitMachineLines: LimitMachineLine[];
  isLimitsReading: boolean;
  preloadLimits(machineId: string): Promise<void>;
  openLimits(): Promise<void>;
  refreshLimits(): Promise<void>;
  readMachineLimits(machine: Machine): Promise<void>;
};

export const createLimitsService: ServiceCreator<LimitsService> = (set, get) => ({
  ...computeFrom(
    get,
    (state) => [state.machines, state.machineLimits, state.usageNow, state.usageFilter] as const,
    ({ machines, machineLimits, usageNow, usageFilter }) => {
      const shown = machines.filter((machine) => !usageFilter.machines.includes(machine.id));
      return {
        limitPools: collectLimitPools(_seatsOf(shown, machineLimits, usageFilter), usageNow),
        limitMachineLines: shown.map((machine) =>
          _machineLineOf(machine, ownValue(machineLimits, machine.id), usageNow)
        ),
        isLimitsReading: Object.values(machineLimits).some((limits) => limits.isReading),
      };
    }
  ),
  machineLimits: {},
  async preloadLimits(machineId) {
    const { machines, machineLimits, readMachineLimits } = get();
    const machine = machines.find((candidate) => candidate.id === machineId);
    if (machine && _isDue(machine, machineLimits)) await readMachineLimits(machine);
  },
  async openLimits() {
    const { machines, machineLimits, readMachineLimits } = get();
    const due = machines.filter((machine) => _isDue(machine, machineLimits));
    await Promise.all(due.map(readMachineLimits));
  },
  async refreshLimits() {
    const { machines, machineLimits, readMachineLimits } = get();
    const due = machines.filter((machine) => machine.canRead && !ownValue(machineLimits, machine.id)?.isReading);
    await Promise.all(due.map(readMachineLimits));
  },
  async readMachineLimits(machine) {
    const machineId = machine.id;
    const usageRepository = container.get('IUsageRepository');
    const seats = ownValue(get().machineLimits, machineId)?.seats ?? [];
    const reading = { seats, readAt: Date.now(), isOutdated: false, problem: undefined };
    function finish(result: Partial<MachineLimits>) {
      const usageNow = Date.now();
      const limits = { ...reading, ...result, isReading: false };
      set((state) => ({ usageNow, machineLimits: { ...state.machineLimits, [machineId]: limits } }));
    }
    set((state) => ({ machineLimits: { ...state.machineLimits, [machineId]: { ...reading, isReading: true } } }));
    try {
      finish({ seats: _withLastGood(seats, await usageRepository.readLimits(machineId)) });
    } catch (error) {
      const problem = error instanceof Error ? error.message : String(error);
      finish({ seats: _withFailure(seats, problem), isOutdated: isOlderFavoError(error), problem });
    }
  },
});

function _isDue(machine: Machine, machineLimits: Record<string, MachineLimits>) {
  const limits = ownValue(machineLimits, machine.id);
  return machine.canRead && (!limits || Date.now() - limits.readAt >= LimitsFreshForMs);
}

function _sameSeat(left: SeatLimitsView, right: SeatLimitsView) {
  return left.account === right.account && left.provider === right.provider;
}

function _withLastGood(previous: SeatLimitsView[], next: SeatLimitsView[]) {
  return next.map((seat) => {
    const last = previous.find((candidate) => _sameSeat(candidate, seat));
    const identity = seat.identity ?? last?.identity;
    const plan = seat.plan ?? last?.plan;
    return { ...seat, identity, plan, usage: keepLastGoodLimits(last?.usage, seat.usage) };
  });
}

function _withFailure(previous: SeatLimitsView[], message: string) {
  const failure = unavailableLimits(new Date().toISOString(), LimitsUnavailableReason.probeFailed, message);
  return previous
    .filter((seat) => seat.usage.windows.length > 0)
    .map((seat) => ({ ...seat, usage: keepLastGoodLimits(seat.usage, failure) }));
}

function _seatsOf(machines: Machine[], machineLimits: Record<string, MachineLimits>, filter: UsageFilter) {
  return machines.flatMap((machine) =>
    (ownValue(machineLimits, machine.id)?.seats ?? [])
      .filter((seat) => !filter.accounts.includes(seat.account) && !filter.providers.includes(seat.provider))
      .map((seat) => ({
        ...seat,
        key: `${machine.id}/${seat.account}/${seat.provider}`,
        machineName: machine.name,
      }))
  );
}

function _machineLineOf(machine: Machine, limits: MachineLimits | undefined, now: number): LimitMachineLine {
  const { id, name } = machine;
  if (machine.presence === MachinePresence.outdated || limits?.isOutdated) {
    return { id, name, label: 'older favo', isOld: true };
  }
  if (limits?.isReading) return { id, name, label: 'reading…', isOld: false };
  if (limits?.problem) return { id, name, label: 'could not read', isOld: true };
  if (!machine.isOnline || !limits) return { id, name, label: machine.presenceLabel, isOld: true };
  const newest = limits.seats
    .map((seat) => seat.usage.checkedAt)
    .toSorted()
    .at(-1);
  if (!newest) return { id, name, label: 'no seats signed in', isOld: false };
  return { id, name, label: readingAgeOf(newest, now), isOld: now - Date.parse(newest) >= LimitsFreshForMs };
}
