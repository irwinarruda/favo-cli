import { MachineTokenUsage } from '@favo/domain/usage/token-usage';
import { z } from 'zod';
import { defineMethod, MethodRouting } from '#contracts/rpc/method';

const Params = z.strictObject({ isFresh: z.boolean() });

export const readTokenUsage = defineMethod({
  name: 'usage.tokens',
  routing: MethodRouting.machine,
  params: Params,
  result: MachineTokenUsage,
});

export function isTokenCount(request: { method: string; params?: unknown }) {
  const params = Params.safeParse(request.params);
  return request.method === readTokenUsage.name && params.success && params.data.isFresh;
}
