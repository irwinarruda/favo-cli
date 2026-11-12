import { TokenPrices } from '@favo/domain/usage/token-prices';
import { z } from 'zod';
import { defineMethod, MethodRouting } from '#contracts/rpc/method';

export const readTokenPrices = defineMethod({
  name: 'usage.prices',
  routing: MethodRouting.hub,
  params: z.strictObject({ models: z.array(z.string()), isFresh: z.boolean() }),
  result: TokenPrices,
});
