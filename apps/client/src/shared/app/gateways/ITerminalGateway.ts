import type { TerminalPlan, TerminalRunOptions, TerminalRunResult } from '@favo/domain/terminal/terminal-plan';

export type ITerminalGateway = {
  run(plan: TerminalPlan, options?: TerminalRunOptions): Promise<TerminalRunResult>;
};
