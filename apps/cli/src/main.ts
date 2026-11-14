import { createRpcClient } from '@favo/contracts/rpc/client';
import { listThemes } from '@favo/contracts/rpc/themes/list-themes';
import { DomainError } from '@favo/domain/shared/domain-error';
import { BuiltInThemes } from '@favo/domain/themes/built-in-themes';
import { createProductionServer } from '@favo/server/production';
import { serveStdio } from '@favo/server/shared/rpc/stdio-server';
import { createPaint } from '@/paint';
import { CommandKind, parseCommand } from '@/parse-command';
import { runCommand } from '@/run-command';
import { HookCommand, runHook } from '@/run-hook';
import { runTerminalPlan } from '@/run-terminal-plan';
import { createStandardOutput } from '@/standard-output';

async function main() {
  try {
    if (process.argv[2] === HookCommand) return await runHook(process.argv.slice(3), process.env);
    const command = parseCommand(process.argv.slice(2));
    const server = createProductionServer(process.env);
    await server.prepare();
    if (command.kind === CommandKind.serve) {
      await serveStdio(server.router, Bun.stdin.stream(), (line) => process.stdout.write(`${line}\n`), server.close);
      return 0;
    }
    if (command.kind === CommandKind.tui) {
      const { startTui } = await import('@favo/client/main');
      await startTui({
        transport: server.router,
        runPlan: (plan) => runTerminalPlan(plan, process.env),
        env: process.env,
      });
      server.close();
      return 0;
    }
    const client = createRpcClient(server.router);
    const { activeId, themes } = await client.call(listThemes, {});
    const colors = themes.find((theme) => theme.id === activeId)?.colors ?? BuiltInThemes[0]!.colors;
    const output = createStandardOutput(process.stdout);
    const code = await runCommand(command, {
      client,
      paint: createPaint(process.stdout.isTTY === true && process.env.NO_COLOR === undefined, colors),
      print: output.print,
      runPlan: (plan) => runTerminalPlan(plan, process.env),
      ask: async (question) => process.stdin.isTTY === true && confirm(question),
      hold: async () => {
        if (process.stdin.isTTY === true) prompt('Press enter to go back.');
      },
    });
    server.close();
    await output.flushed();
    return code;
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    console.error(`favo: ${error.message}`);
    return 1;
  }
}

process.exit(await main());
