import type { RpcTransport } from '@favo/contracts/rpc/envelope';
import type { TerminalPlan, TerminalRunOptions, TerminalRunResult } from '@favo/domain/terminal/terminal-plan';
import { createCliRenderer } from '@opentui/core';
import { createRoot } from '@opentui/react';
import { App } from '@/App';
import { RendererTerminalGateway } from '@/shared/app/gateways/RendererTerminalGateway';
import { SystemClipboardGateway } from '@/shared/app/gateways/SystemClipboardGateway';
import { bootstrapAppContainer } from '@/shared/container/app';
import { useApp } from '@/shared/stores/app';

export type TuiOptions = {
  transport: RpcTransport;
  runPlan(plan: TerminalPlan, options?: TerminalRunOptions): Promise<TerminalRunResult>;
  env: Record<string, string | undefined>;
};

export async function startTui({ transport, runPlan, env }: TuiOptions) {
  const renderer = await createCliRenderer({ exitOnCtrlC: false, useMouse: true });
  bootstrapAppContainer({
    transport,
    clipboardGateway: new SystemClipboardGateway(renderer, env.SSH_CONNECTION !== undefined),
    terminalGateway: new RendererTerminalGateway(renderer, runPlan),
  });
  await useApp.getState().loadThemes();
  renderer.setBackgroundColor(useApp.getState().colors.background);
  const closed = new Promise<void>((resolve) => renderer.once('destroy', resolve));
  createRoot(renderer).render(<App onQuit={() => renderer.destroy()} />);
  await closed;
}
