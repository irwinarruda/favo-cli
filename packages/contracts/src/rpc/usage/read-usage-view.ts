import { UsageView } from '@favo/domain/usage/usage-view';
import { z } from 'zod';
import { defineMethod, MethodRouting } from '#contracts/rpc/method';

export const readUsageView = defineMethod({
  name: 'usage.view',
  routing: MethodRouting.hub,
  params: z.strictObject({}),
  result: UsageView,
});
