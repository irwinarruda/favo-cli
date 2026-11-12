import { ownValue } from '@favo/domain/shared/own-value';
import { ratesFor } from '@favo/domain/usage/token-prices';
import type { MachineTokenUsage } from '@favo/domain/usage/token-usage';
import type { UsageView } from '@favo/domain/usage/usage-view';
import { mockDb } from '@/__tests__/db';
import type { IUsageRepository } from '@/modules/usage/app/repositories/IUsageRepository';

const NeverRead: MachineTokenUsage = { rows: [], skippedRecords: 0 };

export class TestUsageRepository implements IUsageRepository {
  async readLimits(machineId: string) {
    mockDb.limitReads.push(machineId);
    await mockDb.limitsHold;
    const failure = ownValue(mockDb.limitFailures, machineId);
    if (failure) throw failure;
    return ownValue(mockDb.seatLimits, machineId) ?? [];
  }

  async readTokens(machineId: string, isFresh: boolean) {
    mockDb.tokenReads.push(`${machineId}:${isFresh ? 'fresh' : 'stored'}`);
    if (isFresh) await mockDb.tokenHold;
    const failure = ownValue(mockDb.tokenFailures, machineId);
    if (failure) throw failure;
    const stored = ownValue(mockDb.tokenUsage, machineId) ?? NeverRead;
    if (!isFresh) return stored;
    const read = { ...stored, readAt: new Date().toISOString() };
    mockDb.tokenUsage[machineId] = read;
    return read;
  }

  async keepTokens(machineId: string, usage: MachineTokenUsage) {
    if (mockDb.tokenKeepFailure) throw mockDb.tokenKeepFailure;
    mockDb.keptTokenUsage[machineId] = usage;
  }

  async readKeptTokens(machineId: string) {
    return ownValue(mockDb.keptTokenUsage, machineId) ?? NeverRead;
  }

  async readPrices(models: string[], isFresh: boolean) {
    mockDb.priceReads.push(isFresh ? 'fresh' : 'stored');
    await mockDb.priceHold;
    return { ...mockDb.tokenPrices, rates: ratesFor(mockDb.tokenPrices.rates, models) };
  }

  async readView() {
    return mockDb.usageView;
  }

  async saveView(view: UsageView) {
    mockDb.usageView = view;
  }
}
