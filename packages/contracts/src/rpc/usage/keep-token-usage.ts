import { MachineTokenUsage } from '@favo/domain/usage/token-usage';
import { z } from 'zod';
import { defineMethod, MethodRouting } from '#contracts/rpc/method';

export const keepTokenUsage = defineMethod({
  name: 'usage.keepTokens',
  routing: MethodRouting.hub,
  params: z.strictObject({ id: z.string(), usage: MachineTokenUsage }),
  result: z.strictObject({}),
});
