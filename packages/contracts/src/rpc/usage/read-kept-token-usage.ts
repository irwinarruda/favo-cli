import { MachineTokenUsage } from '@favo/domain/usage/token-usage';
import { z } from 'zod';
import { defineMethod, MethodRouting } from '#contracts/rpc/method';

export const readKeptTokenUsage = defineMethod({
  name: 'usage.keptTokens',
  routing: MethodRouting.hub,
  params: z.strictObject({ id: z.string() }),
  result: MachineTokenUsage,
});
