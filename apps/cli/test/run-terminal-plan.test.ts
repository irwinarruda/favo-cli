import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { runTerminalPlan } from '@/run-terminal-plan';
import { removeFolder } from './support/remove-folder';

let root: string;

beforeEach(() => {
  root = mkdtempSync(`${tmpdir()}/favo-plan-`).replaceAll('\\', '/');
});

afterEach(() => removeFolder(root));

function planWith(pidFile: string) {
  return { command: process.execPath, args: ['--version'], env: {}, unsetEnv: [], pidFile };
}

describe('the pid file around a provider', () => {
  it('is gone once the provider has exited', async () => {
    const pidFile = `${root}/running/work/claude/launch`;
    expect(await runTerminalPlan(planWith(pidFile), process.env)).toEqual({ exitCode: 0, rateLimitDetected: false });
    expect(existsSync(pidFile)).toBe(false);
  });
  it('never gets in the way of the launch when it cannot be written', async () => {
    writeFileSync(`${root}/running`, 'a file where a folder should be');
    expect(await runTerminalPlan(planWith(`${root}/running/work/claude/launch`), process.env)).toEqual({
      exitCode: 0,
      rateLimitDetected: false,
    });
  });
  it('detects a usage limit from captured output when there is no terminal', async () => {
    const result = await runTerminalPlan(
      {
        command: process.execPath,
        args: ['-e', "console.log('You have hit your usage limit'); setInterval(() => {}, 1000)"],
        env: {},
        unsetEnv: [],
      },
      process.env,
      { monitorLimits: 'claude' }
    );
    expect(result.rateLimitDetected).toBe(true);
  });
});
