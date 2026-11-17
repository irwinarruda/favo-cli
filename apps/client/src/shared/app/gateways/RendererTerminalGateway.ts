import type { TerminalPlan, TerminalRunOptions, TerminalRunResult } from '@favo/domain/terminal/terminal-plan';
import type { ITerminalGateway } from '@/shared/app/gateways/ITerminalGateway';

type SuspendableRenderer = { suspend(): Promise<void>; resume(): Promise<void> };

export class RendererTerminalGateway implements ITerminalGateway {
  constructor(
    private readonly renderer: SuspendableRenderer,
    private readonly runPlan: (plan: TerminalPlan, options?: TerminalRunOptions) => Promise<TerminalRunResult>
  ) {}

  async run(plan: TerminalPlan, options?: TerminalRunOptions) {
    try {
      await this.renderer.suspend();
      return await this.runPlan(plan, options);
    } finally {
      await this.renderer.resume();
    }
  }
}
