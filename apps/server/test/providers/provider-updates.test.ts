import { describe, expect, it } from 'bun:test';
import { listProviderUpdates } from '@favo/contracts/rpc/updates/list-provider-updates';
import { listProviderVersions } from '@favo/contracts/rpc/updates/list-provider-versions';
import { recordProviderUpdate } from '@favo/contracts/rpc/updates/record-provider-update';
import { createTestServer, Home, UpdaterPid } from '#test/support/test-server';
import { ProviderRunRepository } from '@/modules/providers/repositories/provider-run.repository';

const Brew = '/opt/homebrew/bin/brew';
const CaskClaude = '/opt/homebrew/Caskroom/claude-code@latest/2.1.316/claude';
const FormulaOpencode = '/opt/homebrew/Cellar/opencode-v2/2.2.5/bin/opencode';
const NvmNode = `${Home}/.nvm/versions/node/v24.16.0`;
const NpmCodex = `${NvmNode}/lib/node_modules/@openai/codex/bin/codex.js`;

async function serverWith(links: Record<string, string>, options: Parameters<typeof createTestServer>[0] = {}) {
  const server = createTestServer({ installed: [], ...options });
  for (const [command, target] of Object.entries(links)) {
    const path = `/opt/homebrew/bin/${command}`;
    await server.fileSystem.link(target, path);
    server.processes.install(command, path);
  }
  server.processes.install('brew', Brew);
  return server;
}

function stepsOf(view: { steps: { command: string; args: string[] }[] } | undefined) {
  return view?.steps.map(({ command, args }) => [command, ...args].join(' '));
}

describe('what favo shows before updating', () => {
  it('reports the version and how each provider got here', async () => {
    const server = await serverWith({ claude: CaskClaude, opencode: FormulaOpencode });
    server.processes.reply('/opt/homebrew/bin/claude --version', { stdout: '2.1.316 (Claude Code)\n' });
    server.processes.reply('/opt/homebrew/bin/opencode --version', { stdout: 'opencode v2.2.5\n' });
    const [claude, opencode] = await server.client.call(listProviderUpdates, {});
    expect(claude).toMatchObject({
      provider: 'claude',
      version: '2.1.316',
      installedWith: 'Homebrew cask claude-code@latest',
    });
    expect(opencode).toMatchObject({ version: '2.2.5', installedWith: 'Homebrew formula opencode-v2' });
  });
  it('leaves out a provider that is not installed', async () => {
    const server = await serverWith({ claude: CaskClaude });
    expect((await server.client.call(listProviderUpdates, {})).map(({ provider }) => provider)).toEqual(['claude']);
  });
  it('names a real path when no package manager holds it', async () => {
    const server = await serverWith({ claude: `${Home}/.local/share/claude/versions/2.1.316` });
    const [claude] = await server.client.call(listProviderUpdates, {});
    expect(claude?.installedWith).toBe(`own install at ${Home}/.local/share/claude/versions/2.1.316`);
  });
  it('reports another copy on the PATH without touching it', async () => {
    const server = await serverWith({ claude: CaskClaude });
    server.processes.installIn('/usr/bin', 'claude');
    const [claude] = await server.client.call(listProviderUpdates, {});
    expect(claude?.otherCopies).toEqual(['/usr/bin/claude']);
    expect(claude?.steps.every(({ command }) => command !== '/usr/bin/claude')).toBe(true);
  });
  it('counts a link to the same install as one copy', async () => {
    const server = await serverWith({ claude: CaskClaude });
    await server.fileSystem.link(CaskClaude, '/usr/bin/claude');
    server.processes.installIn('/usr/bin', 'claude');
    const [claude] = await server.client.call(listProviderUpdates, {});
    expect(claude?.otherCopies).toEqual([]);
  });
});

describe('the way each provider updates', () => {
  it('uses the provider, from the binary favo launches', async () => {
    const server = await serverWith({ codex: NpmCodex });
    const [codex] = await server.client.call(listProviderUpdates, {});
    expect(stepsOf(codex)?.[0]).toBe('/opt/homebrew/bin/codex update');
  });
  it('goes straight to Homebrew for Claude Code, which only prints the command there', async () => {
    const server = await serverWith({ claude: CaskClaude });
    const [claude] = await server.client.call(listProviderUpdates, {});
    expect(stepsOf(claude)).toEqual([`${Brew} upgrade --cask claude-code@latest`]);
  });
  it('has Homebrew fetch its taps first, for the provider command and for Homebrew itself', async () => {
    const server = await serverWith({ opencode: FormulaOpencode });
    const [opencode] = await server.client.call(listProviderUpdates, {});
    for (const step of opencode?.steps ?? []) {
      expect(step.env.HOMEBREW_AUTO_UPDATE_SECS).toBe('0');
      expect(step.unsetEnv).toEqual(['HOMEBREW_NO_AUTO_UPDATE']);
    }
  });
  it('keeps the package manager as the fallback', async () => {
    const server = await serverWith({ opencode: FormulaOpencode });
    const [opencode] = await server.client.call(listProviderUpdates, {});
    expect(stepsOf(opencode)).toEqual(['/opt/homebrew/bin/opencode upgrade', `${Brew} upgrade --formula opencode-v2`]);
  });
  it('has only the own command when no package manager holds it', async () => {
    const server = await serverWith({ codex: `${Home}/.codex/packages/standalone/codex` });
    const [codex] = await server.client.call(listProviderUpdates, {});
    expect(stepsOf(codex)).toEqual(['/opt/homebrew/bin/codex update']);
  });
  it('goes straight to Homebrew for Antigravity, whose cask wrapper asks for Homebrew', async () => {
    const server = await serverWith({
      agy: '/opt/homebrew/Caskroom/antigravity-cli/1.5.14,5302690847260672/.homebrew-command-wrappers/agy',
    });
    const [agy] = await server.client.call(listProviderUpdates, {});
    expect(stepsOf(agy)).toEqual([`${Brew} upgrade --cask antigravity-cli`]);
  });
  it('uses agy update for a standalone Antigravity no package manager holds', async () => {
    const server = await serverWith({ agy: `${Home}/.local/bin/agy` });
    const [agy] = await server.client.call(listProviderUpdates, {});
    expect(stepsOf(agy)).toEqual(['/opt/homebrew/bin/agy update']);
  });
  it('never treats a version manager shim as the thing it runs', async () => {
    const server = await serverWith({ claude: '/opt/homebrew/Cellar/mise/2026.10.0/bin/mise' });
    const [claude] = await server.client.call(listProviderUpdates, {});
    expect(stepsOf(claude)).toEqual(['/opt/homebrew/bin/claude update']);
    expect(claude?.installedWith).toStartWith('own install at');
  });
  it('sees through a Windows npm script to the package behind it', async () => {
    const npmFolder = '/Users/bee/AppData/Roaming/npm';
    const server = createTestServer({ installed: [], isWindows: true });
    const shim = '"%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*\r\n';
    await server.fileSystem.writePrivateText(`${npmFolder}/codex.cmd`, shim);
    server.processes.install('codex', `${npmFolder}/codex.cmd`);
    server.processes.install('npm', `${npmFolder}/npm.cmd`);
    const [codex] = await server.client.call(listProviderUpdates, {});
    expect(codex?.installedWith).toBe(`npm in ${npmFolder}`);
    expect(stepsOf(codex)?.[1]).toBe(`${npmFolder}/npm.cmd install --global @openai/codex@latest`);
  });
  it('sees through a pnpm script to the package behind it', async () => {
    const pnpmFolder = `${Home}/Library/pnpm`;
    const server = createTestServer({ installed: [] });
    const shim = '#!/bin/sh\nexec node "$basedir/global/5/node_modules/@openai/codex/bin/codex.js" "$@"\n';
    await server.fileSystem.writePrivateText(`${pnpmFolder}/codex`, shim);
    server.processes.install('codex', `${pnpmFolder}/codex`);
    server.processes.install('pnpm', `${pnpmFolder}/pnpm`);
    const [codex] = await server.client.call(listProviderUpdates, {});
    expect(codex?.installedWith).toBe('pnpm');
    expect(stepsOf(codex)?.[1]).toBe(`${pnpmFolder}/pnpm add --global @openai/codex@latest`);
  });
  it('uses the npm of the Node version that holds the install', async () => {
    const server = await serverWith({ codex: NpmCodex });
    server.processes.install('npm', `${NvmNode}/bin/npm`);
    const [codex] = await server.client.call(listProviderUpdates, {});
    expect(stepsOf(codex)?.[1]).toBe(`${NvmNode}/bin/npm install --global @openai/codex@latest`);
    expect(codex?.steps[0]?.env.PATH).toStartWith(`${NvmNode}/bin:`);
    expect(codex?.steps[1]?.env.PATH).toStartWith(`${NvmNode}/bin:`);
  });
  it('joins folders with a semicolon on Windows', async () => {
    const server = await serverWith({ codex: NpmCodex }, { isWindows: true });
    const [codex] = await server.client.call(listProviderUpdates, {});
    expect(codex?.steps[0]?.env.PATH).toContain(`${NvmNode}/bin;${NvmNode};`);
  });
});

describe('what favo leaves alone', () => {
  it('holds back a provider whose updates are off', async () => {
    const server = await serverWith({ claude: CaskClaude });
    server.clis.claude.updateOff = 'DISABLE_UPDATES';
    const [claude] = await server.client.call(listProviderUpdates, {});
    expect(claude?.heldBack).toBe('its updates are turned off by DISABLE_UPDATES');
  });
  it('hears a switch set in the login shell of this machine', async () => {
    const server = await serverWith({ claude: CaskClaude }, { shellVariables: { DISABLE_UPDATES: '1' } });
    server.clis.claude.updateOffUnless = ({ env }) => (env.DISABLE_UPDATES ? 'DISABLE_UPDATES' : undefined);
    const [claude] = await server.client.call(listProviderUpdates, {});
    expect(claude?.heldBack).toBe('its updates are turned off by DISABLE_UPDATES');
  });
  it('holds back a formula pinned in Homebrew', async () => {
    const server = await serverWith({ opencode: FormulaOpencode });
    server.processes.reply(`${Brew} list --pinned`, { stdout: 'neovim@0.11.7\nopencode-v2\n' });
    const [opencode] = await server.client.call(listProviderUpdates, {});
    expect(opencode?.heldBack).toBe('it is pinned in Homebrew');
  });
  it('does not mistake another pinned formula for this one', async () => {
    const server = await serverWith({ opencode: FormulaOpencode });
    server.processes.reply(`${Brew} list --pinned`, { stdout: 'opencode\n' });
    const [opencode] = await server.client.call(listProviderUpdates, {});
    expect(opencode?.heldBack).toBeUndefined();
  });
});

describe('a provider running through favo', () => {
  async function running(pid: number) {
    const server = await serverWith({ claude: CaskClaude });
    const runs = new ProviderRunRepository(server.fileSystem, server.processes, server.paths);
    await server.fileSystem.writePrivateText(runs.pidFile('work', 'claude', 'launch-1'), String(pid));
    return { server, runs };
  }

  it('names the accounts it runs as', async () => {
    const { server } = await running(4242);
    const [claude] = await server.client.call(listProviderUpdates, {});
    expect(claude?.runningAccounts).toEqual(['work']);
  });
  it('forgets a launch whose process is gone', async () => {
    const { server, runs } = await running(4242);
    server.processes.gone.add(4242);
    const [claude] = await server.client.call(listProviderUpdates, {});
    expect(claude?.runningAccounts).toEqual([]);
    expect(await server.fileSystem.readText(runs.pidFile('work', 'claude', 'launch-1'))).toBeUndefined();
  });
  it('uses the name you gave the account', async () => {
    const { server } = await running(4242);
    await server.fileSystem.writePrivateText(
      server.paths.configFile,
      JSON.stringify({ accountNames: { work: 'office' } })
    );
    const [claude] = await server.client.call(listProviderUpdates, {});
    expect(claude?.runningAccounts).toEqual(['office']);
  });
  it('survives a launch that ends while favo looks at it', async () => {
    const { server, runs } = await running(4242);
    const list = server.fileSystem.list.bind(server.fileSystem);
    server.fileSystem.list = async (path) => [...(await list(path)), ...(path.endsWith('/claude') ? ['ended'] : [])];
    server.fileSystem.unlink = async () => {
      throw new Error('already gone');
    };
    server.processes.gone.add(4242);
    const [claude] = await server.client.call(listProviderUpdates, {});
    expect(claude?.runningAccounts).toEqual([]);
    expect(await server.fileSystem.readText(runs.pidFile('work', 'claude', 'launch-1'))).toBe('4242');
  });
  it('does not count one provider as another', async () => {
    const { server, runs } = await running(4242);
    await server.fileSystem.link(NpmCodex, '/opt/homebrew/bin/codex');
    server.processes.install('codex', '/opt/homebrew/bin/codex');
    await server.fileSystem.writePrivateText(runs.pidFile('side', 'codex', 'launch-2'), '4343');
    const [claude, codex] = await server.client.call(listProviderUpdates, {});
    expect(claude?.runningAccounts).toEqual(['work']);
    expect(codex?.runningAccounts).toEqual(['side']);
  });
});

describe('the versions the comb shows', () => {
  it('reads each installed version and how it got there, and nothing about pins or steps', async () => {
    const server = await serverWith({ claude: CaskClaude, opencode: FormulaOpencode });
    server.processes.reply('/opt/homebrew/bin/claude --version', { stdout: '2.1.316 (Claude Code)\n' });
    server.processes.reply('/opt/homebrew/bin/opencode --version', { stdout: 'opencode v2.2.5\n' });
    expect(await server.client.call(listProviderVersions, {})).toEqual([
      {
        provider: 'claude',
        label: 'Claude Code',
        version: '2.1.316',
        installedWith: 'Homebrew cask claude-code@latest',
      },
      { provider: 'opencode', label: 'OpenCode', version: '2.2.5', installedWith: 'Homebrew formula opencode-v2' },
    ]);
    expect(server.processes.calls.map(({ args }) => args.join(' '))).toEqual(['--version', '--version']);
  });
  it('reads one provider when asked', async () => {
    const server = await serverWith({ claude: CaskClaude, opencode: FormulaOpencode });
    const versions = await server.client.call(listProviderVersions, { provider: 'opencode' });
    expect(versions.map(({ provider }) => provider)).toEqual(['opencode']);
  });
  it('carries the last update, stamped when it was recorded', async () => {
    const server = await serverWith({ claude: CaskClaude });
    const outcome = { state: 'failed' as const, from: '2.1.300', reason: 'exit 1' };
    await server.client.call(recordProviderUpdate, { provider: 'claude', outcome });
    const [claude] = await server.client.call(listProviderVersions, {});
    expect(claude?.lastUpdate).toEqual({ ...outcome, at: '2026-10-31T12:00:00.000Z' });
  });
  it('forgets the last update when there is nothing left to report', async () => {
    const server = await serverWith({ claude: CaskClaude });
    await server.client.call(recordProviderUpdate, { provider: 'claude', outcome: { state: 'updating' } });
    await server.client.call(recordProviderUpdate, { provider: 'claude' });
    const [claude] = await server.client.call(listProviderVersions, {});
    expect(claude?.lastUpdate).toBeUndefined();
    expect(await server.fileSystem.readText(`${server.paths.updates}/claude.json`)).toBeUndefined();
  });
  it('has nothing to forget for a provider never updated', async () => {
    const server = await serverWith({ claude: CaskClaude });
    expect(await server.client.call(recordProviderUpdate, { provider: 'claude' })).toEqual({});
  });
  it('replaces the last update with the next one', async () => {
    const server = await serverWith({ claude: CaskClaude });
    await server.client.call(recordProviderUpdate, { provider: 'claude', outcome: { state: 'updating' } });
    const outcome = { state: 'leftAlone' as const, reason: 'it is running' };
    await server.client.call(recordProviderUpdate, { provider: 'claude', outcome });
    const [claude] = await server.client.call(listProviderVersions, {});
    expect(claude?.lastUpdate).toMatchObject(outcome);
  });
  it('shows an update as going while the favo that runs it is alive', async () => {
    const server = await serverWith({ claude: CaskClaude });
    await server.client.call(recordProviderUpdate, { provider: 'claude', outcome: { state: 'updating' } });
    const [claude] = await server.client.call(listProviderVersions, {});
    expect(claude?.lastUpdate?.state).toBe('updating');
  });
  it('shows an update as stopped once the favo that ran it is gone', async () => {
    const server = await serverWith({ claude: CaskClaude });
    await server.client.call(recordProviderUpdate, { provider: 'claude', outcome: { state: 'updating' } });
    server.processes.gone.add(UpdaterPid);
    const [claude] = await server.client.call(listProviderVersions, {});
    expect(claude?.lastUpdate?.state).toBe('stopped');
  });
  it('keeps the record of each provider apart', async () => {
    const server = await serverWith({ claude: CaskClaude, opencode: FormulaOpencode });
    await server.client.call(recordProviderUpdate, {
      provider: 'claude',
      outcome: { state: 'failed', reason: 'exit 1' },
    });
    const [claude, opencode] = await server.client.call(listProviderVersions, {});
    expect(claude?.lastUpdate?.state).toBe('failed');
    expect(opencode?.lastUpdate).toBeUndefined();
  });
  it('ignores a record it cannot read', async () => {
    const server = await serverWith({ claude: CaskClaude });
    await server.fileSystem.writePrivateText(`${server.paths.updates}/claude.json`, '{"state":');
    const [claude] = await server.client.call(listProviderVersions, {});
    expect(claude?.lastUpdate).toBeUndefined();
  });
});
