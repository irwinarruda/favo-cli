import { describe, expect, it } from 'bun:test';
import { createAccount } from '@favo/contracts/rpc/accounts/create-account';
import { renameAccount } from '@favo/contracts/rpc/accounts/rename-account';
import { Protocol, type RpcRequest } from '@favo/contracts/rpc/envelope';
import { addMachine } from '@favo/contracts/rpc/machines/add-machine';
import { provisionSeat } from '@favo/contracts/rpc/seats/provision-seat';
import { recordThread } from '@favo/contracts/rpc/threads/record-thread';
import { LoginState } from '@favo/contracts/rpc/views';
import { installPlanFor } from '@favo/domain/machines/remote-commands';
import type { TerminalPlan } from '@favo/domain/terminal/terminal-plan';
import { BuiltInThemes } from '@favo/domain/themes/built-in-themes';
import { SshRemoteBackends } from '@favo/server/modules/machines/gateways/ssh.remote-backends';
import { ReplyingSsh } from '@favo/server/test/support/replying-ssh';
import { createTestServer, Home, seedClaudeBase } from '@favo/server/test/support/test-server';
import { createPaint } from '@/paint';
import { parseCommand } from '@/parse-command';
import { runCommand } from '@/run-command';

function harness(server = createTestServer(), isPainted = false) {
  const lines: string[] = [];
  const plans: TerminalPlan[] = [];
  const questions: string[] = [];
  const holds: string[] = [];
  const context = {
    client: server.client,
    paint: createPaint(isPainted, BuiltInThemes[0]!.colors),
    print: (line: string) => lines.push(line),
    async runPlan(plan: TerminalPlan) {
      plans.push(plan);
      return 7;
    },
    async ask(question: string) {
      questions.push(question);
      return false;
    },
    async hold() {
      holds.push('held');
    },
  };
  const run = (...argv: string[]) => runCommand(parseCommand(argv), context);
  return { ...server, lines, plans, questions, holds, context, run };
}

describe('usage', () => {
  const inMinutes = (minutes: number) => new Date(Date.now() + (minutes + 0.5) * 60_000).toISOString();
  const session = (usedPercent: number, minutes: number) => ({
    id: 'five_hour',
    kind: 'session' as const,
    label: 'Session',
    usedPercent,
    windowDurationMins: 300,
    resetsAt: inMinutes(minutes),
  });

  async function signedIn(
    server: ReturnType<typeof createTestServer>,
    identity: string,
    usedPercent: number,
    resetMinutes = 44
  ) {
    await seedClaudeBase(server.fileSystem);
    server.clis.claude.login = { login: LoginState.signedIn, identity };
    server.clis.claude.limitsReading = { windows: [session(usedPercent, resetMinutes)] };
  }

  it('pools the seats of every machine', async () => {
    const mac = harness();
    const devbox = createTestServer({ hostname: 'devbox' });
    await signedIn(mac, 'mac@bee.dev', 32);
    await signedIn(devbox, 'devbox@bee.dev', 7, 54);
    await mac.client.call(addMachine, { target: 'bee@devbox' });
    mac.remotes.connect('devbox', devbox.router);
    expect(await mac.run('usage')).toBe(0);
    const output = mac.lines.join('\n');
    expect(output).toContain('Claude Code');
    expect(output).toContain('  Session    81% left  ↘   ↻ +16%');
    expect(output).toMatch(/personal · macbook {2}[▄█]+▂+ {2}68% {2}↻ 44m/);
    expect(output).toMatch(/personal · devbox {3}[▄█]+▂* {2}93% {2}↻ 54m/);
  });
  it('does not repeat the percentage for a single seat', async () => {
    const mac = harness();
    await signedIn(mac, 'mac@bee.dev', 32);
    await mac.run('usage');
    const output = mac.lines.join('\n');
    expect(output).toContain('68% left');
    expect(output).not.toMatch(/▂ +68%/);
  });
  it('reads one machine when told to', async () => {
    const mac = harness();
    const devbox = createTestServer({ hostname: 'devbox' });
    await signedIn(mac, 'mac@bee.dev', 32);
    await signedIn(devbox, 'devbox@bee.dev', 7);
    await mac.client.call(addMachine, { target: 'bee@devbox' });
    mac.remotes.connect('devbox', devbox.router);
    await mac.run('usage', '--machine', 'devbox');
    expect(mac.clis.claude.limitsSessions).toEqual([]);
    expect(mac.lines.join('\n')).toContain('93% left');
  });
  it('refuses a machine it does not know', async () => {
    const { run } = harness();
    await expect(run('usage', '--machine', 'ghost')).rejects.toMatchObject({ code: 'machineNotFound' });
  });
  it('prints machine readable output, with what each machine said', async () => {
    const mac = harness();
    await signedIn(mac, 'mac@bee.dev', 32);
    await mac.client.call(addMachine, { target: 'bee@devbox' });
    await mac.run('usage', '--json');
    const report = JSON.parse(mac.lines.join('\n'));
    expect(report[0].machine.id).toBe('local');
    expect(report[0].seats[0]).toMatchObject({ account: 'personal', provider: 'claude', identity: 'mac@bee.dev' });
    expect(report[0].seats[0].usage.windows[0].usedPercent).toBe(32);
    expect(report[1].machine.id).toBe('devbox');
    expect(report[1].seats).toEqual([]);
    expect(report[1].problem).toContain('devbox');
  });
  it('keeps reading when a machine runs an older favo', async () => {
    const mac = harness();
    await signedIn(mac, 'mac@bee.dev', 32);
    await mac.client.call(addMachine, { target: 'bee@devbox' });
    mac.remotes.connect('devbox', {
      send: async ({ id, method }) => ({
        id,
        ok: false,
        error: { code: 'unknownMethod', message: `Unknown method "${method}".` },
      }),
    });
    expect(await mac.run('usage')).toBe(0);
    const output = mac.lines.join('\n');
    expect(output).toContain('68% left');
    expect(output).toContain('devbox: older favo');
  });
  it('exits with an error when the one machine it was asked for gave nothing', async () => {
    const mac = harness();
    await mac.client.call(addMachine, { target: 'bee@devbox' });
    expect(await mac.run('usage', '--machine', 'devbox')).toBe(1);
    expect(await mac.run('usage', '--machine', 'devbox', '--json')).toBe(1);
  });
  it('exits cleanly when another machine answered', async () => {
    const mac = harness();
    await mac.client.call(addMachine, { target: 'bee@devbox' });
    expect(await mac.run('usage')).toBe(0);
  });
  it('dims a headline it cannot present as current', async () => {
    const mac = harness(createTestServer(), true);
    await signedIn(mac, 'mac@bee.dev', 32, -2);
    await mac.run('usage');
    const headline = mac.lines.find((line) => line.includes('68% left'));
    expect(headline).toContain(createPaint(true, BuiltInThemes[0]!.colors).dim('68% left'));
  });
  it('sums up a provider with no limits', async () => {
    const mac = harness();
    await signedIn(mac, 'mac@bee.dev', 32);
    mac.clis.claude.limitsReading = undefined;
    await mac.run('usage');
    expect(mac.lines.join('\n')).toMatch(/Claude Code +no limits available/);
  });
  it('explains a seat with no bars beside one with bars', async () => {
    const mac = harness();
    const devbox = createTestServer({ hostname: 'devbox' });
    await signedIn(mac, 'mac@bee.dev', 32);
    await signedIn(devbox, 'devbox@bee.dev', 7);
    const unavailable = { reason: 'probeFailed' as const, message: 'Claude Code did not answer.' };
    devbox.clis.claude.limitsReading = { windows: [], unavailable };
    await mac.client.call(addMachine, { target: 'bee@devbox' });
    mac.remotes.connect('devbox', devbox.router);
    await mac.run('usage');
    const output = mac.lines.join('\n');
    expect(output).toContain('68% left');
    expect(output).toContain('personal · devbox: Claude Code did not answer.');
  });
  it('says so when nothing is signed in', async () => {
    const { run, lines } = harness();
    await run('usage');
    expect(lines).toEqual(['No signed in seat reports limits.']);
  });
});

describe('commands', () => {
  it('prints the whole fleet in one list', async () => {
    const mac = harness();
    const devbox = createTestServer({ hostname: 'devbox' });
    await seedClaudeBase(mac.fileSystem);
    await seedClaudeBase(devbox.fileSystem);
    await mac.client.call(addMachine, { target: 'bee@devbox' });
    mac.remotes.connect('devbox', devbox.router);
    mac.clis.claude.login = { login: LoginState.signedIn, identity: 'mac@bee.dev' };
    devbox.clis.claude.login = { login: LoginState.signedIn, identity: 'devbox@bee.dev', plan: 'max' };
    await mac.run('list');
    const output = mac.lines.join('\n');
    expect(output).toContain('macbook this machine · online');
    expect(output).toContain('devbox bee@devbox · online');
    expect(output).toContain('⬢ claude    mac@bee.dev');
    expect(output).toContain('⬢ claude    devbox@bee.dev · max');
  });
  it('says which directory a launch runs in on each machine', async () => {
    const mac = harness(createTestServer({ directory: '/Users/bee/code/app' }));
    const devbox = createTestServer({ hostname: 'devbox', directory: '/home/bee' });
    await mac.client.call(addMachine, { target: 'bee@devbox' });
    mac.remotes.connect('devbox', devbox.router);
    await mac.run('list');
    const output = mac.lines.join('\n');
    expect(output).toContain('macbook this machine · online · /Users/bee/code/app');
    expect(output).toContain('devbox bee@devbox · online · /home/bee');
  });
  it('opens a desktop app as an account', async () => {
    const { run, lines, client, desktopApps } = harness();
    desktopApps.install('codex');
    await client.call(createAccount, { name: 'work' });
    expect(await run('app', 'codex', 'work')).toBe(0);
    expect(lines).toEqual(['⬢ ChatGPT is opening as work.']);
    expect(desktopApps.opened[0]?.provider).toBe('codex');
  });
  it('says the app signs in apart from Claude Code when that seat is signed out', async () => {
    const { run, lines, client, desktopApps, clis } = harness();
    desktopApps.install('claude');
    clis.claude.login = { login: LoginState.signedOut };
    await client.call(createAccount, { name: 'work' });
    expect(await run('app', 'claude', 'work')).toBe(0);
    expect(lines).toEqual([
      '⬢ Claude is opening as work.',
      'Claude and Claude Code sign in separately, and Claude Code is signed out as work.',
      'To sign it in too: favo login claude work',
    ]);
  });
  it('names agy when the Antigravity app and its CLI share a name', async () => {
    const { run, lines, client, desktopApps } = harness();
    desktopApps.install('antigravity');
    await client.call(createAccount, { name: 'work' });
    expect(await run('app', 'agy', 'work')).toBe(0);
    expect(lines).toEqual([
      '⬢ Antigravity is opening as work.',
      'Antigravity and agy sign in separately, and agy is signed out as work.',
      'To sign it in too: favo login agy work',
    ]);
  });
  it('says nothing more when that seat is signed in', async () => {
    const { run, lines, client, desktopApps, clis } = harness();
    desktopApps.install('claude');
    clis.claude.login = { login: LoginState.signedIn, identity: 'bee@work.dev' };
    await client.call(createAccount, { name: 'work' });
    expect(await run('app', 'claude', 'work')).toBe(0);
    expect(lines).toEqual(['⬢ Claude is opening as work.']);
  });
  it('says so when the app is not installed', async () => {
    const { run, client } = harness();
    await client.call(createAccount, { name: 'work' });
    await expect(run('app', 'claude', 'work')).rejects.toThrow('The Claude app is not installed here.');
  });
  it('tells you how to replace an app that is already open, and leaves it alone', async () => {
    const { run, lines, client, desktopApps } = harness();
    desktopApps.install('claude');
    desktopApps.run('claude');
    await client.call(createAccount, { name: 'work' });
    expect(await run('app', 'claude', 'work')).toBe(1);
    expect(lines).toEqual(['Claude is open. To close it and reopen: favo app claude work --close']);
    expect(desktopApps.quitCalls).toEqual([]);
  });
  it('closes an open app when told to', async () => {
    const { run, client, desktopApps } = harness();
    desktopApps.install('claude');
    desktopApps.run('claude');
    await client.call(createAccount, { name: 'work' });
    expect(await run('app', 'claude', 'work', '--close')).toBe(0);
    expect(desktopApps.quitCalls).toEqual(['claude']);
  });
  it('lists themes and marks the active one', async () => {
    const { run, lines, fileSystem, paths } = harness();
    await fileSystem.writePrivateText(`${paths.themes}/mine.json`, JSON.stringify({ colors: {} }));
    await run('theme');
    expect(lines.find((line) => line.includes('honey'))).toStartWith('▸ honey');
    expect(lines.find((line) => line.includes('mine'))).toContain('custom');
  });
  it('sets a theme and keeps the rest of the config', async () => {
    const { run, lines, fileSystem, paths } = harness();
    await fileSystem.writePrivateText(paths.configFile, JSON.stringify({ providers: {} }));
    await run('theme', 'nord');
    expect(lines).toEqual(['⬢ nord it is.']);
    expect(JSON.parse((await fileSystem.readText(paths.configFile))!)).toEqual({ providers: {}, theme: 'nord' });
  });
  it('keeps listing when a machine is down', async () => {
    const mac = harness();
    await mac.client.call(addMachine, { target: 'bee@devbox' });
    await mac.run('list');
    expect(mac.lines.join('\n')).toContain('devbox bee@devbox · offline');
  });
  it('keeps listing when one machine sends a reply it cannot read', async () => {
    const mac = harness();
    const devbox = createTestServer({ hostname: 'devbox' });
    await seedClaudeBase(devbox.fileSystem);
    await mac.client.call(addMachine, { target: 'bee@devbox' });
    await mac.client.call(addMachine, { target: 'bee@evil' });
    mac.remotes.connect('devbox', devbox.router);
    mac.remotes.connect('evil', {
      send: async (request) => {
        if (request.method === 'system.ping') return devbox.router.send(request);
        return { id: request.id, ok: true, result: { nope: true } };
      },
    });
    devbox.clis.claude.login = { login: LoginState.signedIn, identity: 'devbox@bee.dev' };
    await mac.run('list');
    const output = mac.lines.join('\n');
    expect(output).toContain('devbox@bee.dev');
    expect(output).toContain('evil sent a reply favo could not read.');
    await mac.run('list', '--json');
    const report = JSON.parse(mac.lines.at(-1)!);
    expect(report.at(-1)).toMatchObject({ accounts: [], problem: 'evil sent a reply favo could not read.' });
  });
  it('keeps listing when a machine drops out halfway', async () => {
    const mac = harness();
    const devbox = createTestServer({ hostname: 'devbox' });
    await mac.client.call(addMachine, { target: 'bee@devbox' });
    mac.remotes.connect('devbox', {
      send: async (request) => {
        if (request.method === 'system.ping') return devbox.router.send(request);
        return { id: request.id, ok: false, error: { code: 'machineUnreachable', message: 'devbox: gone' } };
      },
    });
    await mac.run('list');
    expect(mac.lines.join('\n')).toContain('  devbox: gone');
    expect(mac.lines.join('\n')).toContain('macbook this machine');
  });
  it('keeps its own colors while a machine can send none', async () => {
    const mac = harness(createTestServer(), true);
    await mac.client.call(addMachine, { target: 'bee@devbox' });
    const sequence = '\u001b]0;pwned\u0007\u001b[2J\u009b31m';
    const facts = { version: '0.1.0', protocol: Protocol, hostname: 'evil', platform: 'x', arch: 'x', home: '/h' };
    const ping = { ...facts, directory: `/srv${sequence}` };
    const accounts = [{ name: 'boss', displayName: `boss${sequence}`, isPersonal: false, seats: [] }];
    const reply = ({ id, method }: RpcRequest) =>
      JSON.stringify({ id, ok: true, result: method === 'system.ping' ? ping : accounts });
    const backends = new SshRemoteBackends(new ReplyingSsh(reply));
    const machine = { id: 'devbox', name: 'devbox', target: 'bee@devbox', isLocal: false };
    mac.remotes.connect('devbox', { send: (request) => backends.request(machine, request) });
    await mac.run('list');
    const output = mac.lines.join('\n');
    const ownColor = new RegExp(`${String.fromCharCode(27)}\\[(?:0|1|38;2;\\d+;\\d+;\\d+)m`, 'g');
    const withoutOwnColors = output.replaceAll(ownColor, '');
    expect(output).toContain('\u001b[1mdevbox\u001b[0m');
    expect(output).toContain('\u001b[38;2;');
    expect(withoutOwnColors).toContain('boss]0;pwned[2J31m');
    expect(withoutOwnColors).not.toMatch(/\p{Cc}(?<!\n)/u);
  });
  it('says where a removed account went and that its logins are still there', async () => {
    const { run, lines, client } = harness();
    await client.call(createAccount, { name: 'work' });
    await run('rm', 'work');
    expect(lines.at(-1)).toStartWith(`Moved to ${Home}/.favo/trash/work-`);
    expect(lines.at(-1)).toEndWith('Its logins stay there, still signed in, until you delete that folder.');
  });
  it('prints machine readable output', async () => {
    const { run, lines } = harness();
    await run('list', '--json');
    expect(JSON.parse(lines.join('\n'))[0].machine.id).toBe('local');
  });
  it('runs the plan and passes its exit code on', async () => {
    const { run, plans, client, fileSystem } = harness();
    await seedClaudeBase(fileSystem);
    await client.call(createAccount, { name: 'work' });
    expect(await run('claude', 'work', '--', '-c')).toBe(7);
    expect(plans[0]?.args).toEqual(['-c']);
    expect(plans[0]?.env.CLAUDE_CONFIG_DIR).toBe(`${Home}/.favo/accounts/work/claude`);
  });
  it('renames a cell and answers to both names, on the same folder', async () => {
    const { run, lines, plans, client, fileSystem } = harness();
    await seedClaudeBase(fileSystem);
    await client.call(createAccount, { name: 'work' });
    await run('rename', 'work', 'side');
    expect(lines.at(-1)).toContain('work is now side');
    await run('list');
    expect(lines.join('\n')).toContain('  side');
    await run('claude', 'side');
    await run('claude', 'work');
    const folder = `${Home}/.favo/accounts/work/claude`;
    expect(plans.map((plan) => plan.env.CLAUDE_CONFIG_DIR)).toEqual([folder, folder]);
    await run('rename', 'side', 'hive');
    expect(lines.at(-1)).toContain('side is now hive');
    await run('path', 'claude', 'hive');
    expect(lines.at(-1)).toBe(folder);
  });
  it('renames the base and still runs it by default', async () => {
    const { run, plans, fileSystem } = harness();
    await seedClaudeBase(fileSystem);
    await run('rename', 'personal', 'bee');
    await run('claude', 'bee');
    await run('claude');
    expect(plans).toHaveLength(2);
    const { FAVO_LAUNCH: firstLaunch, ...firstEnv } = plans[0]!.env;
    const { FAVO_LAUNCH: secondLaunch, ...secondEnv } = plans[1]!.env;
    expect(firstEnv).toEqual(secondEnv);
    expect(firstLaunch).not.toBe(secondLaunch);
    await expect(run('rm', 'bee')).rejects.toMatchObject({ code: 'accountIsPersonal' });
  });
  it('prints a stable path and makes sure it exists', async () => {
    const { run, lines, client, fileSystem } = harness();
    await seedClaudeBase(fileSystem);
    await client.call(createAccount, { name: 'work' });
    await run('path', 'claude', 'work');
    expect(lines).toEqual([`${Home}/.favo/accounts/work/claude`]);
    expect((await fileSystem.entry(lines[0]!)).kind).toBe('directory');
  });
  it('adds a machine and installs favo on it in one step', async () => {
    const { run, lines, ssh, fileSystem } = harness();
    await fileSystem.writePrivateText('/assets/favo-linux-x64', 'binary');
    ssh.reply('uname -sm', { stdout: 'Linux x86_64' });
    ssh.reply(installPlanFor('posix', 'Linux x86_64').activate, { stdout: '0.1.0' });
    await run('machine', 'add', 'bee@devbox');
    expect(ssh.uploads).toHaveLength(1);
    expect(lines.at(-1)).toContain('running on devbox');
  });
  it('flags a machine on an older favo and updates every one that is behind', async () => {
    const mac = harness();
    await mac.client.call(addMachine, { target: 'bee@devbox' });
    mac.remotes.connect('devbox', {
      async send(request: RpcRequest) {
        const result = {
          version: '0.0.1',
          protocol: Protocol,
          hostname: 'devbox',
          platform: 'linux',
          arch: 'x64',
          home: '/h',
          directory: '/h',
        };
        if (request.method === 'system.ping') return { id: request.id, ok: true, result };
        return { id: request.id, ok: true, result: [] };
      },
    });
    await mac.run('machine', 'list');
    expect(mac.lines.join('\n')).toContain('online · older favo 0.0.1');
    await mac.fileSystem.writePrivateText('/assets/favo-linux-x64', 'binary');
    mac.ssh.reply('uname -sm', { stdout: 'Linux x86_64' });
    mac.ssh.reply(installPlanFor('posix', 'Linux x86_64').activate, { stdout: '0.1.0' });
    expect(await mac.run('machine', 'update')).toBe(0);
    expect(mac.ssh.uploads).toHaveLength(1);
    expect(mac.lines.at(-1)).toContain('favo 0.1.0 is running on devbox.');
  });
  it('says so when every machine is up to date', async () => {
    const { run, lines } = harness();
    expect(await run('machine', 'update')).toBe(0);
    expect(lines.at(-1)).toMatch(/^Every machine runs favo \d+\.\d+\.\d+\.$/);
  });
  it('explains shared and private for a seat', async () => {
    const { run, lines, client, fileSystem } = harness();
    await seedClaudeBase(fileSystem);
    await client.call(createAccount, { name: 'work' });
    await run('sync');
    await run('path', 'claude', 'work');
    await run('inspect', 'claude', 'work');
    const output = lines.join('\n');
    expect(output).toContain('linked     skills');
    expect(output).toContain('private    .claude.json');
  });
});

describe('threads', () => {
  const WorkEnv = {
    FAVO_ACCOUNT: 'work',
    FAVO_LAUNCH: 'l1',
    CLAUDE_CONFIG_DIR: `${Home}/.favo/accounts/work/claude`,
  };
  const Project = `${Home}/projects/hive`;

  async function withThread() {
    const server = harness(createTestServer({ callerEnv: WorkEnv }));
    await seedClaudeBase(server.fileSystem);
    await server.fileSystem.ensureDirectory(Project);
    await server.client.call(createAccount, { name: 'work' });
    const event = { provider: 'claude', directory: Project, isFresh: true } as const;
    await server.client.call(recordThread, { ...event, id: '11111111-aaaa-bbbb-cccc-00000000abcd' });
    return server;
  }

  it('lists what a seat kept, by position', async () => {
    const { run, lines } = await withThread();
    expect(await run('threads', 'claude', 'work')).toBe(0);
    expect(lines.join('\n')).toMatch(new RegExp(`^ 1  .+ 0000abcd  ${Project}$`));
  });
  it('finds a cell by the name you gave it', async () => {
    const { run, lines, client } = await withThread();
    await client.call(renameAccount, { name: 'work', newName: 'side' });
    await run('threads', 'claude', 'side');
    expect(lines.at(-1)).toContain('0000abcd');
  });
  it('says when a seat has none', async () => {
    const { run, lines } = await withThread();
    await run('threads', 'claude', 'personal');
    expect(lines).toEqual(['No threads yet.']);
  });
  it('warns about a guess and a folder that is gone', async () => {
    const { run, lines, clis, client } = await withThread();
    clis.codex.foundThreads = [{ id: 'found-1', directory: '/gone', updatedAt: '2026-10-30T12:00:00.000Z' }];
    await client.call(provisionSeat, { account: 'work', provider: 'codex' });
    await run('threads', 'codex', 'work');
    expect(lines[0]).toContain('/gone · folder gone · a guess');
    expect(lines[1]).toContain('With two sessions in one folder it can pick the wrong one.');
  });
  it('gives machine readable output', async () => {
    const { run, lines } = await withThread();
    await run('threads', 'claude', 'work', '--json');
    expect(JSON.parse(lines[0]!)[0]).toMatchObject({ isGuess: false, directory: Project });
  });
  it('explains a machine on an older favo instead of printing a raw error', async () => {
    const { run, lines, client, remotes } = await withThread();
    await client.call(addMachine, { target: 'bee@old' });
    const older = createTestServer({ hostname: 'old' });
    remotes.connect('old', {
      async send(request) {
        if (!/^(?:threads|hooks)\./.test(request.method)) return older.router.send(request);
        const error = { code: 'unknownMethod', message: `Unknown method "${request.method}".` };
        return { id: request.id, ok: false, error };
      },
    });
    expect(await run('threads', 'claude', 'work', '-m', 'old')).toBe(1);
    expect(await run('hooks', '-m', 'old')).toBe(1);
    expect(lines).toEqual(
      Array(2).fill('old runs an older favo, which keeps no threads. To update it: favo machine install old')
    );
  });
  it('resumes through a plan', async () => {
    const { run, plans } = await withThread();
    await run('resume', 'claude', 'work');
    expect(plans[0]?.args.slice(0, 2)).toEqual(['--resume', '11111111-aaaa-bbbb-cccc-00000000abcd']);
    expect(plans[0]?.cwd).toBe(Project);
  });
  it('passes what follows -- on to the resumed provider', async () => {
    const { run, plans } = await withThread();
    await run('resume', 'claude', 'work', '--', '--model', 'x');
    expect(plans[0]?.args.slice(-2)).toEqual(['--model', 'x']);
  });
});

describe('favo hooks', () => {
  it('reports each provider', async () => {
    const { run, lines } = harness(createTestServer({ installed: ['claude'] }));
    await run('hooks');
    expect(lines[0]).toContain('off');
    expect(lines[1]).toBe('Codex         not installed');
  });
  it('installs, and warns about the trust Codex asks for', async () => {
    const { run, lines, fileSystem } = harness();
    await run('hooks', 'install');
    expect(lines.join('\n')).toContain('Codex asks each seat once to trust the hook.');
    expect(await fileSystem.readText(`${Home}/.claude/settings.json`)).toContain('favo-hook');
  });
  it('uninstalls', async () => {
    const { run, lines, fileSystem } = harness();
    await run('hooks', 'install');
    lines.length = 0;
    await run('hooks', 'uninstall');
    expect(lines[0]).toContain('off');
    expect(await fileSystem.readText(`${Home}/.claude/settings.json`)).not.toContain('favo-hook');
  });
  it('gives machine readable output', async () => {
    const { run, lines } = harness();
    await run('hooks', '--json');
    expect(JSON.parse(lines[0]!)).toHaveLength(4);
  });
  it('explains a hook an older favo wrote', async () => {
    const { run, lines, fileSystem } = harness();
    await run('hooks', 'install');
    const path = `${Home}/.claude/settings.json`;
    await fileSystem.writePrivateText(path, (await fileSystem.readText(path))!.replace('claude:1', 'claude:0'));
    lines.length = 0;
    await run('hooks');
    expect(lines[0]).toContain('out of date, run favo sync');
  });
  it('lists every problem of a seat under its provider', async () => {
    const { run, lines, fileSystem } = harness();
    await fileSystem.writePrivateText(`${Home}/.claude/settings.json`, '{"disableAllHooks":true}');
    await run('hooks', 'install');
    expect(lines.join('\n')).toContain('disableAllHooks is on in settings.json, so hooks never run.');
  });
});
