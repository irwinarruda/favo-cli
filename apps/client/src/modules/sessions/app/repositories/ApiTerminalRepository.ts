import type { RpcClient } from '@favo/contracts/rpc/client';
import { planTerminal } from '@favo/contracts/rpc/terminal/plan-terminal';
import type { TerminalAction } from '@favo/domain/terminal/terminal-plan';
import type { Seat } from '@/modules/comb/app/entities/Seat';
import type { ITerminalRepository } from '@/modules/sessions/app/repositories/ITerminalRepository';

export class ApiTerminalRepository implements ITerminalRepository {
  constructor(private readonly client: RpcClient) {}

  plan(seat: Seat, action: TerminalAction, directory?: string, thread?: string, args: string[] = []) {
    return this.client.call(planTerminal, {
      machineId: seat.machineId,
      action,
      account: seat.account,
      provider: seat.provider,
      args,
      directory,
      thread,
    });
  }
}
