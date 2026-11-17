import { rm } from 'node:fs/promises';
import { mergeEnvironment } from '@favo/domain/shared/environment';
import { herdrSequenceOf } from '@favo/domain/terminal/herdr';
import {
  spawnCommandOf,
  type TerminalPlan,
  type TerminalRunOptions,
  type TerminalRunResult,
  type TerminalStep,
} from '@favo/domain/terminal/terminal-plan';
import { ProviderLimitDetector } from '@/provider-limit';

const AfterExitTimeoutMs = 1_000;

export async function runTerminalPlan(
  plan: TerminalPlan,
  baseEnv: Record<string, string | undefined>,
  options: TerminalRunOptions = {}
): Promise<TerminalRunResult> {
  const isCaseInsensitive = process.platform === 'win32';
  const detector = options.monitorLimits ? new ProviderLimitDetector(options.monitorLimits) : undefined;
  let rateLimitDetected = false;
  const isInteractive = !!detector && process.stdin.isTTY && process.stdout.isTTY;
  const captureOutput = !!detector && !isInteractive;
  const child = Bun.spawn(spawnCommandOf(plan.command, plan.args), {
    cwd: plan.cwd,
    env: mergeEnvironment({ base: baseEnv, overrides: plan.env, unset: plan.unsetEnv, isCaseInsensitive }),
    ...(isInteractive
      ? {
          terminal: {
            cols: process.stdout.columns ?? 80,
            rows: process.stdout.rows ?? 24,
            data(_terminal, data) {
              process.stdout.write(data);
              if (!rateLimitDetected && detector?.write(data)) {
                rateLimitDetected = true;
                child.kill('SIGINT');
              }
            },
          },
        }
      : {
          stdin: 'inherit' as const,
          stdout: captureOutput ? ('pipe' as const) : ('inherit' as const),
          stderr: captureOutput ? ('pipe' as const) : ('inherit' as const),
        }),
  });
  const forwardOutput = async (
    stream: ReadableStream<Uint8Array> | null | undefined,
    write: (data: Uint8Array) => void
  ) => {
    if (!stream) return;
    for await (const data of stream) {
      write(data);
      if (!rateLimitDetected && detector?.write(data)) {
        rateLimitDetected = true;
        child.kill('SIGINT');
      }
    }
  };
  const outputDone = captureOutput
    ? Promise.all([
        forwardOutput(child.stdout, (data) => process.stdout.write(data)),
        forwardOutput(child.stderr, (data) => process.stderr.write(data)),
      ])
    : Promise.resolve();
  const ignoreSignal = () => {};
  process.on('SIGINT', ignoreSignal);
  const forwardInput = (data: Buffer) => child.terminal?.write(data);
  const resize = () => child.terminal?.resize(process.stdout.columns ?? 80, process.stdout.rows ?? 24);
  if (isInteractive && child.terminal) {
    process.stdin.setRawMode(true);
    process.stdin.on('data', forwardInput);
    process.stdout.on('resize', resize);
  }
  if (plan.pidFile) await Bun.write(plan.pidFile, String(child.pid)).catch(() => {});
  let code = 1;
  try {
    code = await child.exited;
    await outputDone;
  } finally {
    process.off('SIGINT', ignoreSignal);
    if (isInteractive && child.terminal) {
      process.stdin.off('data', forwardInput);
      process.stdout.off('resize', resize);
      process.stdin.setRawMode(false);
      child.terminal.close();
    }
    if (plan.pidFile) await rm(plan.pidFile, { force: true }).catch(() => {});
    if (plan.afterExit) await runAfterExit(plan.afterExit);
  }
  return { exitCode: code, rateLimitDetected };
}

async function runAfterExit({ command, args, stampFlag }: TerminalStep) {
  try {
    const stamp = stampFlag ? [stampFlag, String(herdrSequenceOf(Date.now()))] : [];
    const step = Bun.spawn([command, ...args, ...stamp], { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' });
    const timer = setTimeout(() => step.kill(), AfterExitTimeoutMs);
    await step.exited;
    clearTimeout(timer);
  } catch {}
}
