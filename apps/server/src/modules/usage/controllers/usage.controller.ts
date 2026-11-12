import { readLimits } from '@favo/contracts/rpc/seats/read-limits';
import { keepTokenUsage } from '@favo/contracts/rpc/usage/keep-token-usage';
import { readKeptTokenUsage } from '@favo/contracts/rpc/usage/read-kept-token-usage';
import { readTokenPrices } from '@favo/contracts/rpc/usage/read-token-prices';
import { readTokenUsage } from '@favo/contracts/rpc/usage/read-token-usage';
import { readUsageView } from '@favo/contracts/rpc/usage/read-usage-view';
import { saveUsageView } from '@favo/contracts/rpc/usage/save-usage-view';
import type { LimitsService } from '@/modules/usage/services/limits.service';
import type { PricesService } from '@/modules/usage/services/prices.service';
import type { TokensService } from '@/modules/usage/services/tokens.service';
import type { UsageViewService } from '@/modules/usage/services/usage-view.service';
import type { RpcRouter } from '@/shared/rpc/rpc-router';

export function registerUsageController(
  router: RpcRouter,
  limits: LimitsService,
  tokens: TokensService,
  prices: PricesService,
  view: UsageViewService
) {
  router.handle(readLimits, () => limits.read());
  router.handle(readTokenUsage, ({ isFresh }) => tokens.read(isFresh));
  router.handle(keepTokenUsage, ({ id, usage }) => tokens.keep(id, usage));
  router.handle(readKeptTokenUsage, ({ id }) => tokens.kept(id));
  router.handle(readTokenPrices, ({ models, isFresh }) => prices.read(models, isFresh));
  router.handle(readUsageView, () => view.read());
  router.handle(saveUsageView, (params) => view.save(params));
}
