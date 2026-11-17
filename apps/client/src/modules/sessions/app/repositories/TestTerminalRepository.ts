import { DomainError, DomainErrorCode } from '@favo/domain/shared/domain-error';
import type { TerminalAction } from '@favo/domain/terminal/terminal-plan';
import type { Seat } from '@/modules/comb/app/entities/Seat';
import type { ITerminalRepository } from '@/modules/sessions/app/repositories/ITerminalRepository';

export class TestTerminalRepository implements ITerminalRepository {
  async plan(seat: Seat, action: TerminalAction, directory?: string, thread?: string, extraArgs: string[] = []) {
    if (action === 'logout' && !seat.view.canLogout) {
      throw new DomainError(DomainErrorCode.logoutUnsupported, `${seat.label} has no sign-out command.`);
    }
    const args = [action, seat.account, ...(thread ? [thread] : []), ...extraArgs];
    return { command: seat.command, args, env: {}, unsetEnv: [], cwd: directory };
  }
}
