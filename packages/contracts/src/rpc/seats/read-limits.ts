import { z } from 'zod';
import { defineMethod, MethodRouting } from '#contracts/rpc/method';
import { SeatLimitsView } from '#contracts/rpc/views';

export const readLimits = defineMethod({
  name: 'seats.usage',
  routing: MethodRouting.machine,
  params: z.strictObject({}),
  result: z.array(SeatLimitsView),
});
