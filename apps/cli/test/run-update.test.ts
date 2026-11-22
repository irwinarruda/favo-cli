import { describe, expect, it } from 'bun:test';
import { Protocol, type RpcRequest } from '@favo/contracts/rpc/envelope';
import { installHooks } from '@favo/contracts/rpc/hooks/install-hooks';
import { addMachine } from '@favo/contracts/rpc/machines/add-machine';
import { listProviderVersions } from '@favo/contracts/rpc/updates/list-provider-versions';
import { FavoVersion } from '@favo/contracts/version';
import { HookVersion } from '@favo/domain/hooks/provider-hook';
import { installPlanFor } from '@favo/domain/machines/remote-commands';
import { decodeArguments, type TerminalPlan } from '@favo/domain/terminal/terminal-plan';
import { BuiltInThemes } from '@favo/domain/themes/built-in-themes';
import { ProviderRunRepository } from '@favo/server/modules/providers/repositories/provider-run.repository';
import { createTestServer, Home, seedClaudeBase } from '@favo/server/test/support/test-server';
import { createPaint } from '@/paint';
import { parseCommand } from '@/parse-command';
import { runCommand } from '@/run-command';

const HomebrewFavo = '/opt/homebrew/bin/favo';
const CellarFavo = '/opt/homebrew/Cellar/favo-cli/0.4.0/bin/favo';
const Brew = '/opt/homebrew/bin/brew';
const CaskCodex = '/opt/homebrew/Caskroom/codex/0.166.0/bin/codex';
const CaskClaude = '/opt/homebrew/Caskroom/claude-code@latest/2.1.316/claude';
const Settings = `${Home}/.claude/settings.json`;

type Options = {
  exitCodeOf?: (plan: TerminalPlan) => number;
  answer?: boolean;
  onRun?: (plan: TerminalPlan) => void | Promise<void>;
};

async function updater(options: Options = {}, serverOptions: Parameters<typeof createTestServer>[0] = {}) {
  const server = createTestServer({ binary: HomebrewFavo, installed: [], ...serverOptions });
  await server.fileSystem.link(CellarFavo, HomebrewFavo);
  server.processes.install('brew', Brew);
  const lines: string[] = [];
  const plans: TerminalPlan[] = [];
  const questions: string[] = [];
  const holds: string[] = [];
  const context = {
    client: server.client,
    paint: createPaint(false, BuiltInThemes[0]!.colors),
    print: (line: string) => lines.push(line),
    async runPlan(plan: TerminalPlan) {
      plans.push(plan);
      await options.onRun?.(plan);
      return options.exitCodeOf?.(plan) ?? 0;
    },
    async ask(question: string) {
      questions.push(question);
      return options.answer ?? false;
    },
    async hold() {
      holds.push('held');
    },
  };
  const run = (...argv: string[]) => runCommand(parseCommand(argv), context);
  return { ...server, lines, plans, questions, holds, run, text: () => lines.join('\n') };
}

async function withProvider(server: Awaited<ReturnType<typeof updater>>, command: string, target: string) {
  await server.fileSystem.link(target, `/opt/homebrew/bin/${command}`);
  server.processes.install(command, `/opt/homebrew/bin/${command}`);
}

function commandsOf(plans: TerminalPlan[]) {
  return plans.map(({ command, args }) => [command, ...args].join(' '));
}

function remoteAt(versionOf: string | (() => string), onRequest?: (request: RpcRequest) => void) {
  return {
    async send(request: RpcRequest) {
      onRequest?.(request);
      const result = {
        version: typeof versionOf === 'string' ? versionOf : versionOf(),
        protocol: Protocol,
        hostname: 'devbox',
        platform: 'linux',
        arch: 'x64',
        home: '/h',
        directory: '/h',
      };
      if (request.method === 'system.ping') return { id: request.id, ok: true as const, result };
      return { id: request.id, ok: true as const, result: [] };
    },
  };
}

async function withMachine(server: Awaited<ReturnType<typeof updater>>, version: string, name = 'devbox') {
  await server.client.call(addMachine, { target: `bee@${name}` });
  const isUploaded = () => server.ssh.uploads.some(({ target }) => target === `bee@${name}`);
  server.remotes.connect(
    name,
    remoteAt(() => (isUploaded() ? FavoVersion : version))
  );
  await server.fileSystem.writePrivateText(`${server.paths.versionedAssets}/favo-linux-x64`, 'binary');
  server.ssh.reply('uname -sm', { stdout: 'Linux x86_64' });
  server.ssh.reply(installPlanFor('posix', 'Linux x86_64').activate, { stdout: '0.5.0' });
}

describe('favo update, on this computer', () => {
  it('updates favo first, then hands everything else to the new binary', async () => {
    const server = await updater();
    expect(await server.run('update')).toBe(0);
    expect(commandsOf(server.plans)).toEqual([
      `${Brew} upgrade --formula favo-cli`,
      `${HomebrewFavo} update --skip-favo --favo-only`,
    ]);
    expect(server.lines[0]).toContain('Homebrew formula favo-cli');
  });
  it('hands the provider CLIs to the new binary when they were asked for', async () => {
    const server = await updater();
    await server.run('update', '--providers');
    expect(commandsOf(server.plans).at(-1)).toBe(`${HomebrewFavo} update --skip-favo`);
  });
  it('leaves the provider CLIs alone unless asked, and says how to update them', async () => {
    const server = await updater();
    await withProvider(server, 'codex', CaskCodex);
    expect(await server.run('update', '--skip-favo', '--favo-only')).toBe(0);
    expect(server.plans).toEqual([]);
    expect(server.lines.at(-1)).toBe('The provider CLIs were left alone. To update them too: favo update --providers');
  });
  it('still updates the provider CLIs for an older favo that asks the way it always did', async () => {
    const server = await updater();
    await withProvider(server, 'codex', CaskCodex);
    expect(await server.run('update', '--skip-favo', '--machine', 'local', '--hold')).toBe(0);
    expect(commandsOf(server.plans)).toEqual(['/opt/homebrew/bin/codex update']);
  });
  it('touches nothing else when that fails', async () => {
    const server = await updater({ exitCodeOf: () => 1 });
    await withMachine(server, '0.0.1');
    expect(await server.run('update')).toBe(1);
    expect(server.plans).toHaveLength(1);
    expect(server.ssh.uploads).toHaveLength(0);
    expect(server.text()).toContain('favo did not update here, so nothing else was touched.');
  });
  it('touches nothing else when the package manager is gone', async () => {
    const server = createTestServer({ binary: HomebrewFavo, installed: [] });
    await server.fileSystem.link(CellarFavo, HomebrewFavo);
    const lines: string[] = [];
    const plans: TerminalPlan[] = [];
    const context = {
      client: server.client,
      paint: createPaint(false, BuiltInThemes[0]!.colors),
      print: (line: string) => lines.push(line),
      runPlan: async (plan: TerminalPlan) => plans.push(plan),
      ask: async () => false,
      hold: async () => {},
    };
    expect(await runCommand(parseCommand(['update']), context)).toBe(1);
    expect(plans).toEqual([]);
  });
  it('carries the new binary exit code back', async () => {
    const server = await updater({ exitCodeOf: ({ command }) => (command === HomebrewFavo ? 9 : 0) });
    expect(await server.run('update')).toBe(9);
  });
  it('keeps the new binary on this computer when asked to', async () => {
    const server = await updater();
    await server.run('update', '--machine', 'local');
    expect(commandsOf(server.plans).at(-1)).toBe(`${HomebrewFavo} update --skip-favo --favo-only --machine local`);
  });
  it('goes on with what it can when favo is pinned', async () => {
    const server = await updater();
    server.processes.reply(`${Brew} list --pinned`, { stdout: 'favo-cli\n' });
    expect(await server.run('update')).toBe(0);
    expect(server.text()).toContain('stays on');
    expect(commandsOf(server.plans)).not.toContain(`${Brew} upgrade --formula favo-cli`);
  });
  it('goes on with what it can when no package manager holds favo', async () => {
    const server = await updater({}, { binary: `${Home}/.favo/bin/favo` });
    expect(await server.run('update')).toBe(0);
    expect(server.plans).toEqual([]);
    expect(server.text()).toContain('did not come from Homebrew or npm');
  });
  it('never installs hooks where there are none', async () => {
    const server = await updater({}, { installed: ['claude'] });
    await seedClaudeBase(server.fileSystem);
    await server.run('update', '--skip-favo');
    expect(await server.fileSystem.readText(Settings)).toBe('{}');
  });
  it('refreshes hooks that are out of date', async () => {
    const server = await updater({}, { installed: ['claude'] });
    await seedClaudeBase(server.fileSystem);
    await server.client.call(installHooks, {});
    const text = await server.fileSystem.readText(Settings);
    await server.fileSystem.writePrivateText(Settings, text!.replaceAll(`claude:${HookVersion}`, 'claude:0'));
    await server.run('update', '--skip-favo');
    expect(await server.fileSystem.readText(Settings)).toContain(`favo-hook:claude:${HookVersion}`);
  });
  it('keeps a failure on screen when the report is held', async () => {
    const server = await updater();
    expect(await server.run('update', '--machine', 'nope', '--skip-favo', '--hold')).toBe(1);
    expect(server.text()).toContain('favo: No machine named "nope".');
    expect(server.holds).toEqual(['held']);
  });
  it('holds the report on screen only when asked', async () => {
    const server = await updater();
    await server.run('update', '--skip-favo', '--machine', 'local');
    expect(server.holds).toEqual([]);
    await server.run('update', '--skip-favo', '--machine', 'local', '--hold');
    expect(server.holds).toEqual(['held']);
  });
});

describe('favo update, across machines', () => {
  it('updates favo on a machine that is behind, and nothing else there', async () => {
    const server = await updater();
    await withMachine(server, '0.0.1');
    expect(await server.run('update', '--skip-favo', '--favo-only')).toBe(0);
    expect(server.ssh.uploads).toHaveLength(1);
    expect(server.text()).toContain('favo 0.5.0 is running on devbox.');
    expect(server.plans).toEqual([]);
  });
  it('updates a machine that is behind, then runs its provider update attached over ssh', async () => {
    const server = await updater();
    await withMachine(server, '0.0.1');
    expect(await server.run('update', '--skip-favo', '--providers')).toBe(0);
    expect(server.ssh.uploads).toHaveLength(1);
    expect(server.text()).toContain('favo 0.5.0 is running on devbox.');
    const [plan] = server.plans;
    expect(plan?.command).toBe('ssh');
    expect(plan?.args.slice(0, 2)).toEqual(['-t', '--']);
  });
  it('goes on to the next machine after one fails, and reports it', async () => {
    const server = await updater();
    await withMachine(server, '0.0.1', 'broken');
    await withMachine(server, '0.0.1', 'studio');
    server.ssh.unreachable.add('bee@broken');
    expect(await server.run('update', '--skip-favo')).toBe(1);
    expect(server.ssh.uploads.map(({ target }) => target)).toEqual(['bee@studio']);
    expect(server.text()).toContain('broken: Could not reach broken.');
    expect(server.text()).toContain('favo 0.5.0 is running on studio.');
  });
  it('reports a machine it could not reach and goes on', async () => {
    const server = await updater();
    await server.client.call(addMachine, { target: 'bee@offline' });
    await withMachine(server, '0.0.1');
    expect(await server.run('update', '--skip-favo')).toBe(0);
    expect(server.lines).toContain('offline: no route to host. Skipped.');
    expect(server.text()).toContain('favo 0.5.0 is running on devbox.');
  });
  it('reports a machine with no favo as plainly', async () => {
    const server = await updater();
    await server.client.call(addMachine, { target: 'bee@devbox' });
    server.remotes.connectWhenInstalled('devbox', remoteAt(FavoVersion));
    await server.run('update', '--skip-favo');
    expect(server.lines).toContain('favo is not installed on devbox yet. Skipped.');
  });
  it('leaves other machines alone when asked for this computer only', async () => {
    const server = await updater();
    await withMachine(server, '0.0.1');
    await server.run('update', '--skip-favo', '--providers', '--machine', 'local');
    expect(server.ssh.uploads).toHaveLength(0);
    expect(server.plans).toEqual([]);
  });
  it('counts a failed provider update on a machine', async () => {
    const server = await updater({ exitCodeOf: ({ command }) => (command === 'ssh' ? 255 : 0) });
    await withMachine(server, '0.0.1');
    expect(await server.run('update', '--skip-favo', '--providers')).toBe(1);
  });
  it('updates favo on one machine on its own', async () => {
    const server = await updater();
    await withMachine(server, '0.0.1');
    expect(await server.run('update', '--machine', 'devbox')).toBe(0);
    expect(server.ssh.uploads).toHaveLength(1);
    expect(server.plans).toEqual([]);
  });
  it('updates one machine on its own, favo first when it is behind, then its providers', async () => {
    const server = await updater();
    await withMachine(server, '0.0.1');
    expect(await server.run('update', '--providers', '--machine', 'devbox')).toBe(0);
    expect(server.ssh.uploads).toHaveLength(1);
    expect(server.plans).toHaveLength(1);
    expect(server.plans[0]?.command).toBe('ssh');
    const remote = server.plans[0]!.args[3]!.split(' ');
    expect(decodeArguments(remote.at(-1)!)).toEqual(['update', '--skip-favo', '--machine', 'local']);
  });
  it('skips the install on a machine that is current, and says so', async () => {
    const server = await updater();
    await server.client.call(addMachine, { target: 'bee@devbox' });
    server.remotes.connect('devbox', remoteAt('99.0.0'));
    expect(await server.run('update', '--machine', 'devbox')).toBe(0);
    expect(server.ssh.uploads).toHaveLength(0);
    expect(server.lines).toEqual([
      'devbox runs favo 99.0.0 already.',
      'The provider CLIs were left alone. To update them too: favo update --providers --machine devbox',
    ]);
  });
  it('says why one machine it cannot reach was not updated', async () => {
    const server = await updater();
    await server.client.call(addMachine, { target: 'bee@offline' });
    expect(await server.run('update', '--machine', 'offline')).toBe(1);
    expect(server.lines).toEqual(['offline: no route to host. Skipped.']);
  });
  it('does not run anything there when favo failed to update on that machine', async () => {
    const server = await updater();
    await server.client.call(addMachine, { target: 'bee@devbox' });
    server.remotes.connect('devbox', remoteAt('0.0.1'));
    server.ssh.reply('uname -sm', { code: 255 });
    expect(await server.run('update', '--machine', 'devbox')).toBe(1);
    expect(server.plans).toEqual([]);
    expect(server.text()).toContain('devbox: Could not reach devbox.');
  });
  it('leaves the provider work to the favo on that machine', async () => {
    const requests: string[] = [];
    const server = await updater();
    await server.client.call(addMachine, { target: 'bee@devbox' });
    server.remotes.connect(
      'devbox',
      remoteAt('99.0.0', ({ method }) => requests.push(method))
    );
    await server.run('update', '--skip-favo', '--providers');
    expect(requests.every((method) => method === 'system.ping')).toBe(true);
    expect(server.plans).toHaveLength(1);
  });
});

describe('favo update, for the provider CLIs', () => {
  it('shows the version and method before changing anything, then the result', async () => {
    const server = await updater({
      onRun: () => server.processes.reply('/opt/homebrew/bin/codex --version', { stdout: 'codex-cli 0.167.0\n' }),
    });
    await withProvider(server, 'codex', CaskCodex);
    server.processes.reply('/opt/homebrew/bin/codex --version', { stdout: 'codex-cli 0.166.0\n' });
    expect(await server.run('update', '--skip-favo', '--providers')).toBe(0);
    expect(server.lines).toEqual([
      `Every machine runs favo ${FavoVersion}.`,
      'Codex 0.166.0, Homebrew cask codex',
      '⬢ Codex 0.166.0 → 0.167.0',
    ]);
    expect(commandsOf(server.plans)).toEqual(['/opt/homebrew/bin/codex update']);
  });
  it('says so when nothing changed', async () => {
    const server = await updater();
    await withProvider(server, 'codex', CaskCodex);
    server.processes.reply('/opt/homebrew/bin/codex --version', { stdout: 'codex-cli 0.166.0\n' });
    await server.run('update', '--skip-favo', '--providers');
    expect(server.lines.at(-1)).toBe('⬢ Codex is still 0.166.0');
  });
  it('falls back to the package manager when the provider command fails', async () => {
    const server = await updater({ exitCodeOf: ({ args }) => (args[0] === 'update' ? 1 : 0) });
    await withProvider(server, 'codex', CaskCodex);
    expect(await server.run('update', '--skip-favo', '--providers')).toBe(0);
    expect(commandsOf(server.plans)).toEqual(['/opt/homebrew/bin/codex update', `${Brew} upgrade --cask codex`]);
    expect(server.text()).toContain(`That did not work, so favo is trying ${Brew}.`);
  });
  it('takes a clean exit as final, so a refusal is never overridden', async () => {
    const server = await updater();
    await withProvider(server, 'codex', CaskCodex);
    await server.run('update', '--skip-favo', '--providers');
    expect(commandsOf(server.plans)).toEqual(['/opt/homebrew/bin/codex update']);
  });
  it('reports a failure and goes on to the next provider', async () => {
    const server = await updater({ exitCodeOf: (plan) => (commandsOf([plan])[0]!.includes('claude') ? 1 : 0) });
    await withProvider(server, 'claude', CaskClaude);
    await withProvider(server, 'codex', CaskCodex);
    expect(await server.run('update', '--skip-favo', '--providers')).toBe(1);
    expect(commandsOf(server.plans)).toContain('/opt/homebrew/bin/codex update');
    expect(server.text()).toContain('Claude Code did not update (exit 1).');
  });
  it('stops everything on Ctrl-C, without starting the package manager', async () => {
    const server = await updater({ exitCodeOf: () => 130 });
    await withProvider(server, 'codex', CaskCodex);
    await withProvider(server, 'opencode', '/opt/homebrew/Cellar/opencode-v2/2.2.5/bin/opencode');
    await withMachine(server, FavoVersion);
    expect(await server.run('update', '--skip-favo', '--providers')).toBe(130);
    expect(commandsOf(server.plans)).toEqual(['/opt/homebrew/bin/codex update']);
    expect(server.lines.at(-1)).toBe('Stopped. Everything after this was left as it is.');
  });
  it('stops at the machine where Ctrl-C was pressed', async () => {
    const server = await updater({ exitCodeOf: ({ command }) => (command === 'ssh' ? 130 : 0) });
    await withMachine(server, FavoVersion, 'one');
    await withMachine(server, FavoVersion, 'two');
    expect(await server.run('update', '--skip-favo', '--providers')).toBe(130);
    expect(server.plans).toHaveLength(1);
  });
  it('updates each provider once, however many seats use it', async () => {
    const server = await updater();
    await withProvider(server, 'codex', CaskCodex);
    await server.fileSystem.ensureDirectory(`${Home}/.favo/accounts/work/codex`);
    await server.fileSystem.ensureDirectory(`${Home}/.favo/accounts/side/codex`);
    await server.run('update', '--skip-favo', '--providers');
    expect(server.plans).toHaveLength(1);
  });
  it('asks before updating one that runs through favo, and leaves it when told no', async () => {
    const server = await updater({ answer: false });
    await withProvider(server, 'codex', CaskCodex);
    const runs = new ProviderRunRepository(server.fileSystem, server.processes, server.paths);
    await server.fileSystem.writePrivateText(runs.pidFile('work', 'codex', 'launch'), '4242');
    expect(await server.run('update', '--skip-favo', '--providers')).toBe(0);
    expect(server.questions).toEqual(['Codex is running as work. Update it anyway?']);
    expect(server.plans).toEqual([]);
    expect(server.text()).toContain('it is running');
  });
  it('updates one that runs through favo when told yes', async () => {
    const server = await updater({ answer: true });
    await withProvider(server, 'codex', CaskCodex);
    const runs = new ProviderRunRepository(server.fileSystem, server.processes, server.paths);
    await server.fileSystem.writePrivateText(runs.pidFile('work', 'codex', 'launch'), '4242');
    await server.run('update', '--skip-favo', '--providers');
    expect(server.plans).toHaveLength(1);
  });
  it('updates one that runs through favo without asking when the comb already did', async () => {
    const server = await updater({ answer: false });
    await withProvider(server, 'codex', CaskCodex);
    const runs = new ProviderRunRepository(server.fileSystem, server.processes, server.paths);
    await server.fileSystem.writePrivateText(runs.pidFile('work', 'codex', 'launch'), '4242');
    await server.run('update', '--skip-favo', '--machine', 'local', '--update-running');
    expect(server.questions).toEqual([]);
    expect(server.plans).toHaveLength(1);
  });
  it('updates only the provider CLIs it is told to', async () => {
    const server = await updater();
    await withProvider(server, 'codex', CaskCodex);
    await withProvider(server, 'claude', CaskClaude);
    await server.run('update', '--skip-favo', '--machine', 'local', '--provider', 'codex');
    expect(commandsOf(server.plans)).toEqual(['/opt/homebrew/bin/codex update']);
    expect(server.text()).not.toContain('Claude Code');
  });
  it('reports a disabled provider and leaves it', async () => {
    const server = await updater();
    await withProvider(server, 'claude', CaskClaude);
    server.clis.claude.updateOff = 'DISABLE_UPDATES';
    expect(await server.run('update', '--skip-favo', '--providers')).toBe(0);
    expect(server.plans).toEqual([]);
    expect(server.text()).toContain('its updates are turned off by DISABLE_UPDATES');
  });
  it('lists another copy it will not touch', async () => {
    const server = await updater();
    await withProvider(server, 'codex', CaskCodex);
    server.processes.installIn('/usr/bin', 'codex');
    await server.run('update', '--skip-favo', '--providers');
    expect(server.text()).toContain('another copy, left alone: /usr/bin/codex');
  });
  it('updates a standalone Antigravity with agy update, and leaves Homebrew alone when brew is missing', async () => {
    const server = await updater();
    await withProvider(server, 'agy', `${Home}/.local/bin/agy`);
    expect(await server.run('update', '--skip-favo', '--providers')).toBe(0);
    expect(commandsOf(server.plans)).toEqual(['/opt/homebrew/bin/agy update']);
    const withoutBrew = await updater();
    withoutBrew.processes.uninstall('brew');
    await withProvider(
      withoutBrew,
      'agy',
      '/opt/homebrew/Caskroom/antigravity-cli/1.5.14,5302690847260672/.homebrew-command-wrappers/agy'
    );
    expect(await withoutBrew.run('update', '--skip-favo', '--providers')).toBe(0);
    expect(withoutBrew.plans).toEqual([]);
    expect(withoutBrew.text()).toContain('favo could not find brew to update it');
  });
  it('says so when no provider is installed', async () => {
    const server = await updater();
    await server.run('update', '--skip-favo', '--providers');
    expect(server.text()).toContain('No provider CLI is installed here.');
  });
});

describe('favo update, as the comb sees it afterwards', () => {
  async function lastUpdateOf(server: Awaited<ReturnType<typeof updater>>) {
    const [view] = await server.client.call(listProviderVersions, {});
    return view?.lastUpdate;
  }

  it('keeps nothing once an update worked, so only what needs a look stays', async () => {
    const server = await updater({
      onRun: () => server.processes.reply('/opt/homebrew/bin/codex --version', { stdout: 'codex-cli 0.167.0\n' }),
    });
    await withProvider(server, 'codex', CaskCodex);
    server.processes.reply('/opt/homebrew/bin/codex --version', { stdout: 'codex-cli 0.166.0\n' });
    await server.run('update', '--skip-favo', '--providers');
    expect(await lastUpdateOf(server)).toBeUndefined();
    expect(await server.fileSystem.readText(`${server.paths.updates}/codex.json`)).toBeUndefined();
  });
  it('clears an earlier failure once the next update works', async () => {
    let code = 1;
    const server = await updater({ exitCodeOf: () => code });
    await withProvider(server, 'codex', CaskCodex);
    await server.run('update', '--skip-favo', '--providers');
    expect(await lastUpdateOf(server)).toMatchObject({ state: 'failed' });
    code = 0;
    await server.run('update', '--skip-favo', '--providers');
    expect(await lastUpdateOf(server)).toBeUndefined();
  });
  it('records the update as going while it runs', async () => {
    let during: unknown;
    const server = await updater({
      onRun: async () => {
        during = await lastUpdateOf(server);
      },
    });
    await withProvider(server, 'codex', CaskCodex);
    await server.run('update', '--skip-favo', '--providers');
    expect(during).toMatchObject({ state: 'updating' });
  });
  it('records a failure with its exit code', async () => {
    const server = await updater({ exitCodeOf: () => 2 });
    await withProvider(server, 'claude', CaskClaude);
    await server.run('update', '--skip-favo', '--providers');
    expect(await lastUpdateOf(server)).toMatchObject({ state: 'failed', reason: 'exit 2' });
  });
  it('records a stop on Ctrl-C', async () => {
    const server = await updater({ exitCodeOf: () => 130 });
    await withProvider(server, 'codex', CaskCodex);
    await server.run('update', '--skip-favo', '--providers');
    expect(await lastUpdateOf(server)).toMatchObject({ state: 'stopped' });
  });
  it('records a provider it left alone, and why', async () => {
    const server = await updater();
    await withProvider(server, 'claude', CaskClaude);
    server.clis.claude.updateOff = 'DISABLE_UPDATES';
    await server.run('update', '--skip-favo', '--providers');
    expect(await lastUpdateOf(server)).toMatchObject({
      state: 'leftAlone',
      reason: 'its updates are turned off by DISABLE_UPDATES',
    });
  });
  it('records nothing when only favo was updated', async () => {
    const server = await updater();
    await withProvider(server, 'codex', CaskCodex);
    await server.run('update', '--skip-favo', '--favo-only');
    expect(await lastUpdateOf(server)).toBeUndefined();
  });
});
