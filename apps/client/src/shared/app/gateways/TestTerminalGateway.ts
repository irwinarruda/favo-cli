import type { TerminalPlan } from '@favo/domain/terminal/terminal-plan';
import { mockDb } from '@/__tests__/db';
import type { ITerminalGateway } from '@/shared/app/gateways/ITerminalGateway';

export class TestTerminalGateway implements ITerminalGateway {
  async run(plan: TerminalPlan) {
    mockDb.terminalRuns.push(plan);
    return { exitCode: mockDb.terminalExitCode, rateLimitDetected: mockDb.terminalRateLimitDetected };
  }
}
