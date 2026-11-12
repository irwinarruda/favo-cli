import type { RpcClient } from '@favo/contracts/rpc/client';
import { readLimits } from '@favo/contracts/rpc/seats/read-limits';
import { keepTokenUsage } from '@favo/contracts/rpc/usage/keep-token-usage';
import { readKeptTokenUsage } from '@favo/contracts/rpc/usage/read-kept-token-usage';
import { readTokenPrices } from '@favo/contracts/rpc/usage/read-token-prices';
import { readTokenUsage } from '@favo/contracts/rpc/usage/read-token-usage';
import { readUsageView } from '@favo/contracts/rpc/usage/read-usage-view';
import { saveUsageView } from '@favo/contracts/rpc/usage/save-usage-view';
import type { MachineTokenUsage } from '@favo/domain/usage/token-usage';
import type { UsageView } from '@favo/domain/usage/usage-view';
import type { IUsageRepository } from '@/modules/usage/app/repositories/IUsageRepository';

export class ApiUsageRepository implements IUsageRepository {
  constructor(private readonly client: RpcClient) {}

  readLimits(machineId: string) {
    return this.client.call(readLimits, {}, { machineId });
  }

  readTokens(machineId: string, isFresh: boolean) {
    return this.client.call(readTokenUsage, { isFresh }, { machineId });
  }

  async keepTokens(machineId: string, usage: MachineTokenUsage) {
    await this.client.call(keepTokenUsage, { id: machineId, usage });
  }

  readKeptTokens(machineId: string) {
    return this.client.call(readKeptTokenUsage, { id: machineId });
  }

  readPrices(models: string[], isFresh: boolean) {
    return this.client.call(readTokenPrices, { models, isFresh });
  }

  readView() {
    return this.client.call(readUsageView, {});
  }

  async saveView(view: UsageView) {
    await this.client.call(saveUsageView, view);
  }
}
