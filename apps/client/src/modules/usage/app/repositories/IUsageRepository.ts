import type { SeatLimitsView } from '@favo/contracts/rpc/views';
import type { TokenPrices } from '@favo/domain/usage/token-prices';
import type { MachineTokenUsage } from '@favo/domain/usage/token-usage';
import type { UsageView } from '@favo/domain/usage/usage-view';

export type IUsageRepository = {
  readLimits(machineId: string): Promise<SeatLimitsView[]>;
  readTokens(machineId: string, isFresh: boolean): Promise<MachineTokenUsage>;
  keepTokens(machineId: string, usage: MachineTokenUsage): Promise<void>;
  readKeptTokens(machineId: string): Promise<MachineTokenUsage>;
  readPrices(models: string[], isFresh: boolean): Promise<TokenPrices>;
  readView(): Promise<UsageView>;
  saveView(view: UsageView): Promise<void>;
};
