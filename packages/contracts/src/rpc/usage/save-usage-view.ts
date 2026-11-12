import { UsageView } from '@favo/domain/usage/usage-view';
import { defineMethod, MethodRouting } from '#contracts/rpc/method';

export const saveUsageView = defineMethod({
  name: 'usage.saveView',
  routing: MethodRouting.hub,
  params: UsageView,
  result: UsageView,
});
