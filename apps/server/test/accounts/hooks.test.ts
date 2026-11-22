import { describe, expect, it } from 'bun:test';
import { createAccount } from '@favo/contracts/rpc/accounts/create-account';
import { installHooks } from '@favo/contracts/rpc/hooks/install-hooks';
import { listHooks } from '@favo/contracts/rpc/hooks/list-hooks';
import { uninstallHooks } from '@favo/contracts/rpc/hooks/uninstall-hooks';
import { addMachine } from '@favo/contracts/rpc/machines/add-machine';
import { installMachine } from '@favo/contracts/rpc/machines/install-machine';
import { provisionSeat } from '@favo/contracts/rpc/seats/provision-seat';
import { repairSeats } from '@favo/contracts/rpc/seats/repair-seats';
import { HookVersion } from '@favo/domain/hooks/provider-hook';
import { installPlanFor } from '@favo/domain/machines/remote-commands';
import { DomainError, DomainErrorCode } from '@favo/domain/shared/domain-error';
import { EntryKind } from '@favo/domain/sharing/shared-item';
import { createTestServer, Home, seedClaudeBase } from '#test/support/test-server';

const Settings = `${Home}/.claude/settings.json`;
const CodexHooks = `${Home}/.codex/hooks.json`;
const Plugin = `${Home}/.config/opencode/plugins/favo-threads.js`;
const AntigravityHooks = `${Home}/.gemini/config/hooks.json`;
const Seat = { account: 'work', provider: 'claude' } as const;

async function serverWithSeat(options?: Parameters<typeof createTestServer>[0]) {
  const server = createTestServer(options);
  await seedClaudeBase(server.fileSystem);
  await server.client.call(createAccount, { name: 'work' });
  await server.client.call(provisionSeat, Seat);
  return server;
}

function stateOf(hooks: { provider: string; state: string }[], provider: string) {
  return hooks.find((hook) => hook.provider === provider)?.state;
}

describe('favo hooks install', () => {
  it('touches nothing until it is asked', async () => {
    const { client, fileSystem } = await serverWithSeat();
    const hooks = await client.call(listHooks, {});
    expect(hooks.every(({ state }) => state === 'absent')).toBe(true);
    expect(await fileSystem.readText(Settings)).toBe('{}');
    expect((await fileSystem.entry(CodexHooks)).kind).toBe(EntryKind.missing);
  });
  it('adds the hook to every provider installed here', async () => {
    const { client, fileSystem } = await serverWithSeat();
    const hooks = await client.call(installHooks, {});
    expect(hooks.map(({ state }) => state)).toEqual(['current', 'current', 'current', 'current']);
    expect(await fileSystem.readText(Settings)).toContain('favo-hook:claude');
    expect(await fileSystem.readText(CodexHooks)).toContain('favo-hook:codex');
    expect(await fileSystem.readText(AntigravityHooks)).toContain('favo-hook:antigravity');
    expect(await fileSystem.readText(Plugin)).toContain(`favo-hook:opencode:${HookVersion}`);
  });
  it('skips a provider that is not installed, and says so', async () => {
    const { client, fileSystem } = await serverWithSeat({ installed: ['claude'] });
    const hooks = await client.call(installHooks, {});
    expect(stateOf(hooks, 'codex')).toBe('absent');
    expect(hooks.find(({ provider }) => provider === 'codex')?.isProviderInstalled).toBe(false);
    expect((await fileSystem.entry(CodexHooks)).kind).toBe(EntryKind.missing);
  });
  it('follows XDG_CONFIG_HOME for OpenCode, which favo never moves', async () => {
    const { client, fileSystem, paths } = await serverWithSeat();
    paths.configHome = '/custom/config';
    await client.call(installHooks, {});
    expect(await fileSystem.readText('/custom/config/opencode/plugins/favo-threads.js')).toContain('favo-hook');
  });
  it('tells you Codex will ask to trust the hook', async () => {
    const { client } = await serverWithSeat();
    const hooks = await client.call(installHooks, {});
    expect(hooks.filter(({ needsTrust }) => needsTrust).map(({ provider }) => provider)).toEqual(['codex']);
  });
  it('never writes a trust entry for Codex', async () => {
    const { client, fileSystem } = await serverWithSeat();
    await fileSystem.writePrivateText(`${Home}/.codex/config.toml`, '# mine\nmodel = "x"\n');
    await client.call(installHooks, {});
    expect(await fileSystem.readText(`${Home}/.codex/config.toml`)).toBe('# mine\nmodel = "x"\n');
  });
  it('keeps the link of every seat, because it writes to the base', async () => {
    const { client, fileSystem, paths } = await serverWithSeat();
    await client.call(installHooks, {});
    const seatSettings = `${paths.accounts}/work/claude/settings.json`;
    expect(await fileSystem.entry(seatSettings)).toMatchObject({ kind: EntryKind.link, target: Settings });
    expect(await fileSystem.readText(seatSettings)).toContain('favo-hook:claude');
  });
  it('writes through a base that is itself a link, as a dotfiles repository makes it', async () => {
    const { client, fileSystem } = await serverWithSeat();
    await fileSystem.unlink(Settings);
    await fileSystem.writePrivateText('/dotfiles/settings.json', '{"model":"opus"}');
    await fileSystem.link('/dotfiles/settings.json', Settings);
    await client.call(installHooks, {});
    expect((await fileSystem.entry(Settings)).kind).toBe(EntryKind.link);
    const saved = JSON.parse((await fileSystem.readText('/dotfiles/settings.json'))!);
    expect(saved.model).toBe('opus');
    expect(saved.hooks.SessionStart).toHaveLength(1);
  });
  it('leaves a file it cannot read exactly as it was', async () => {
    const { client, fileSystem } = await serverWithSeat();
    await fileSystem.writePrivateText(Settings, '{ // mine\n}');
    await expect(client.call(installHooks, {})).rejects.toMatchObject({ code: 'invalidConfig' });
    expect(await fileSystem.readText(Settings)).toBe('{ // mine\n}');
  });
  it('refuses a config it could not read, instead of treating it as empty', async () => {
    const { client, fileSystem } = await serverWithSeat();
    await fileSystem.unlink(Settings);
    await fileSystem.link('/dotfiles/not-checked-out.json', Settings);
    await expect(client.call(installHooks, {})).rejects.toThrow('so it left it alone');
    expect((await fileSystem.entry(Settings)).kind).toBe(EntryKind.brokenLink);
  });
  it('installs for the other providers when one config is broken, and still says so', async () => {
    const { client, fileSystem } = await serverWithSeat();
    await fileSystem.writePrivateText(Settings, '{,}');
    await expect(client.call(installHooks, {})).rejects.toMatchObject({ code: 'invalidConfig' });
    expect(await fileSystem.readText(CodexHooks)).toContain('favo-hook:codex');
  });
  it('writes the Windows form on Windows', async () => {
    const { client, fileSystem } = await serverWithSeat({ isWindows: true });
    await client.call(installHooks, {});
    expect(await fileSystem.readText(Settings)).toContain('-EncodedCommand');
  });
});

describe('favo hooks uninstall', () => {
  it('takes out only what favo added', async () => {
    const { client, fileSystem } = await serverWithSeat();
    await fileSystem.writePrivateText(Settings, '{"model":"opus"}');
    await client.call(installHooks, {});
    const hooks = await client.call(uninstallHooks, {});
    expect(hooks.every(({ state }) => state === 'absent')).toBe(true);
    expect(JSON.parse((await fileSystem.readText(Settings))!)).toEqual({ model: 'opus' });
  });
  it('deletes the plugin, which is all favo', async () => {
    const { client, fileSystem } = await serverWithSeat();
    await client.call(installHooks, {});
    await client.call(uninstallHooks, {});
    expect((await fileSystem.entry(Plugin)).kind).toBe(EntryKind.missing);
  });
  it('leaves a plugin of the same name that favo did not write', async () => {
    const { client, fileSystem } = await serverWithSeat();
    await fileSystem.writePrivateText(Plugin, 'export default {};');
    await client.call(uninstallHooks, {});
    expect(await fileSystem.readText(Plugin)).toBe('export default {};');
  });
  it('takes out every other hook when one config is broken, and still says so', async () => {
    const { client, fileSystem } = await serverWithSeat();
    await client.call(installHooks, {});
    await fileSystem.writePrivateText(Settings, '{,}');
    await expect(client.call(uninstallHooks, {})).rejects.toMatchObject({ code: 'invalidConfig' });
    expect(await fileSystem.readText(CodexHooks)).not.toContain('favo-hook');
  });
  it('does nothing where nothing was installed', async () => {
    const { client, fileSystem } = await serverWithSeat();
    await client.call(uninstallHooks, {});
    expect(await fileSystem.readText(Settings)).toBe('{}');
  });
});

describe('favo sync', () => {
  async function serverWithOldHook() {
    const server = await serverWithSeat();
    await server.client.call(installHooks, {});
    const text = await server.fileSystem.readText(Settings);
    await server.fileSystem.writePrivateText(Settings, text!.replaceAll(`claude:${HookVersion}`, 'claude:0'));
    return server;
  }

  it('shows a hook an older favo wrote', async () => {
    const { client } = await serverWithOldHook();
    expect(stateOf(await client.call(listHooks, {}), 'claude')).toBe('outdated');
  });
  it('refreshes a hook that is out of date', async () => {
    const { client } = await serverWithOldHook();
    await client.call(repairSeats, {});
    expect(stateOf(await client.call(listHooks, {}), 'claude')).toBe('current');
  });
  it('never installs a hook you did not ask for', async () => {
    const { client, fileSystem } = await serverWithSeat();
    await client.call(repairSeats, {});
    expect(await fileSystem.readText(Settings)).toBe('{}');
  });
  it('still repairs links when a config cannot be read', async () => {
    const { client, fileSystem } = await serverWithSeat();
    await fileSystem.writePrivateText(CodexHooks, 'not json');
    await expect(client.call(repairSeats, {})).resolves.toBeDefined();
  });
  it('still repairs links when a hook cannot be refreshed', async () => {
    const { client, fileSystem } = await serverWithOldHook();
    const refreshing = fileSystem.replaceText.bind(fileSystem);
    fileSystem.replaceText = async () => {
      throw new DomainError(DomainErrorCode.invalidConfig, 'disk full');
    };
    await expect(client.call(repairSeats, {})).resolves.toBeArray();
    fileSystem.replaceText = refreshing;
  });
});

describe('hooks that never run', () => {
  async function problemsOf(server: Awaited<ReturnType<typeof serverWithSeat>>, provider = 'claude') {
    const hooks = await server.client.call(listHooks, {});
    return hooks.find((hook) => hook.provider === provider)?.problems ?? [];
  }

  it('reports a seat whose shared file is a real file', async () => {
    const server = await serverWithSeat();
    await server.client.call(installHooks, {});
    const seatSettings = `${server.paths.accounts}/work/claude/settings.json`;
    await server.fileSystem.unlink(seatSettings);
    await server.fileSystem.writePrivateText(seatSettings, '{}');
    expect(await problemsOf(server)).toEqual([
      'work: settings.json is not shared here, so this seat never runs the hook.',
    ]);
  });
  it('does not report a link the next launch will make', async () => {
    const server = await serverWithSeat();
    await server.client.call(installHooks, {});
    await server.fileSystem.unlink(`${server.paths.accounts}/work/claude/settings.json`);
    expect(await problemsOf(server)).toEqual([]);
  });
  it('ignores a seat that was never set up', async () => {
    const server = await serverWithSeat();
    await server.client.call(installHooks, {});
    expect(await problemsOf(server, 'codex')).toEqual([]);
  });
  it('reports disableAllHooks and a disabled Antigravity block', async () => {
    const server = await serverWithSeat();
    await server.client.call(installHooks, {});
    const text = JSON.parse((await server.fileSystem.readText(Settings))!);
    await server.fileSystem.writePrivateText(Settings, JSON.stringify({ ...text, disableAllHooks: true }));
    expect(await problemsOf(server)).toEqual(['disableAllHooks is on in settings.json, so hooks never run.']);
    const agyHooks = JSON.parse((await server.fileSystem.readText(AntigravityHooks))!);
    agyHooks.favo.enabled = false;
    await server.fileSystem.writePrivateText(AntigravityHooks, JSON.stringify(agyHooks));
    expect(await problemsOf(server, 'antigravity')).toEqual([
      "favo's hook is disabled in .gemini/config/hooks.json, so hooks never run.",
    ]);
    await server.fileSystem.writePrivateText(AntigravityHooks, JSON.stringify({ ...agyHooks, disableAllHooks: true }));
    expect(await problemsOf(server, 'antigravity')).toEqual([
      'disableAllHooks is on in .gemini/config/hooks.json, so hooks never run.',
    ]);
  });
  it('reports a config it cannot read, and keeps listing the others', async () => {
    const server = await serverWithSeat();
    await server.fileSystem.writePrivateText(Settings, 'not json');
    const hooks = await server.client.call(listHooks, {});
    expect(hooks).toHaveLength(4);
    expect(hooks[0]?.problems[0]).toContain('left it alone');
  });
});

describe('another machine', () => {
  async function fleet({ hasFavo = true } = {}) {
    const mac = await serverWithSeat();
    const devbox = await serverWithSeat({ hostname: 'devbox' });
    await mac.client.call(addMachine, { target: 'bee@devbox' });
    if (hasFavo) mac.remotes.connect('devbox', devbox.router);
    else mac.remotes.connectWhenInstalled('devbox', devbox.router);
    mac.ssh.reply('uname -sm', { stdout: 'Linux x86_64\n' });
    mac.ssh.reply(installPlanFor('posix', 'Linux x86_64').activate, { stdout: '0.1.0\n' });
    await mac.fileSystem.writePrivateText(`${mac.paths.versionedAssets}/favo-linux-x64`, 'binary');
    return { mac, devbox };
  }

  it('can be asked directly', async () => {
    const { mac, devbox } = await fleet();
    await mac.client.call(installHooks, {}, { machineId: 'devbox' });
    expect(await devbox.fileSystem.readText(Settings)).toContain('favo-hook:claude');
    expect(await mac.fileSystem.readText(Settings)).toBe('{}');
  });
  it('gets the hooks when favo installs itself there, if you turned them on here', async () => {
    const { mac, devbox } = await fleet({ hasFavo: false });
    await mac.client.call(installHooks, {});
    await mac.client.call(installMachine, { id: 'devbox' });
    expect(await devbox.fileSystem.readText(Settings)).toContain('favo-hook:claude');
  });
  it('keeps the hooks current when favo updates itself on a machine that has them', async () => {
    const { mac, devbox } = await fleet();
    await mac.client.call(installHooks, {});
    await devbox.client.call(installHooks, {});
    const text = await devbox.fileSystem.readText(Settings);
    await devbox.fileSystem.writePrivateText(Settings, text!.replaceAll(`claude:${HookVersion}`, 'claude:0'));
    await mac.client.call(installMachine, { id: 'devbox' });
    expect(await devbox.fileSystem.readText(Settings)).toContain(`favo-hook:claude:${HookVersion}`);
  });
  it('does not put back hooks you took out there when favo updates itself', async () => {
    const { mac, devbox } = await fleet();
    await mac.client.call(installHooks, {});
    await mac.client.call(installMachine, { id: 'devbox' });
    expect(await devbox.fileSystem.readText(Settings)).toBe('{}');
  });
  it('gets nothing if you never turned them on', async () => {
    const { mac, devbox } = await fleet();
    await mac.client.call(installMachine, { id: 'devbox' });
    expect(await devbox.fileSystem.readText(Settings)).toBe('{}');
  });
  it('refreshes hooks a machine has even if this one has none', async () => {
    const { mac, devbox } = await fleet();
    await devbox.client.call(installHooks, {});
    const text = await devbox.fileSystem.readText(Settings);
    await devbox.fileSystem.writePrivateText(Settings, text!.replaceAll(`claude:${HookVersion}`, 'claude:0'));
    await mac.client.call(installMachine, { id: 'devbox' });
    expect(await devbox.fileSystem.readText(Settings)).toContain(`favo-hook:claude:${HookVersion}`);
  });
  it('adds no hook to a provider that has none when favo updates itself', async () => {
    const { mac, devbox } = await fleet();
    await mac.client.call(installHooks, {});
    await devbox.client.call(installHooks, {});
    await devbox.fileSystem.writePrivateText(Settings, '{}');
    const codex = await devbox.fileSystem.readText(CodexHooks);
    await mac.client.call(installMachine, { id: 'devbox' });
    expect(await devbox.fileSystem.readText(Settings)).toBe('{}');
    expect(await devbox.fileSystem.readText(CodexHooks)).toBe(codex);
  });
  it('adds no hook when it could not ask a machine that has favo', async () => {
    const { mac, devbox } = await fleet();
    await mac.client.call(installHooks, {});
    mac.remotes.connect('devbox', {
      async send(request) {
        if (request.method === 'hooks.list') throw new DomainError(DomainErrorCode.machineUnreachable, 'timed out');
        return devbox.router.send(request);
      },
    });
    await mac.client.call(installMachine, { id: 'devbox' });
    expect(await devbox.fileSystem.readText(Settings)).toBe('{}');
  });
  it('adds no hook to a machine too old to have had one', async () => {
    const { mac, devbox } = await fleet();
    await mac.client.call(installHooks, {});
    mac.remotes.connect('devbox', {
      async send(request) {
        const unknown = { code: 'unknownMethod', message: `Unknown method ${request.method}` };
        if (request.method === 'hooks.list') return { id: request.id, ok: false, error: unknown };
        return devbox.router.send(request);
      },
    });
    await mac.client.call(installMachine, { id: 'devbox' });
    expect(await devbox.fileSystem.readText(Settings)).toBe('{}');
  });
});
