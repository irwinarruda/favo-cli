import type { TerminalAction, TerminalPlan } from '@favo/domain/terminal/terminal-plan';
import type { Seat } from '@/modules/comb/app/entities/Seat';

export type ITerminalRepository = {
  plan(seat: Seat, action: TerminalAction, directory?: string, thread?: string, args?: string[]): Promise<TerminalPlan>;
};
