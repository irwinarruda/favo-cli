import { describe, expect, it } from 'bun:test';
import { createAccount } from '@favo/contracts/rpc/accounts/create-account';
import { addMachine } from '@favo/contracts/rpc/machines/add-machine';
import { provisionSeat } from '@favo/contracts/rpc/seats/provision-seat';
import { readLimits } from '@favo/contracts/rpc/seats/read-limits';
import { LoginState } from '@favo/contracts/rpc/views';
import { createTestServer, Home, seedClaudeBase } from '#test/support/test-server';

const signedIn = { login: LoginState.signedIn, identity: 'bee@hive.dev', plan: 'max' };
const session = { id: 'five_hour', kind: 'session' as const, label: 'Session', usedPercent: 32 };

async function serverWithWork(options: Parameters<typeof createTestServer>[0] = {}) {
  const server = createTestServer(options);
  await seedClaudeBase(server.fileSystem);
  await server.client.call(createAccount, { name: 'work' });
  await server.client.call(provisionSeat, { account: 'work', provider: 'claude' });
  server.clis.claude.login = signedIn;
  server.clis.claude.limitsReading = { windows: [session] };
  return server;
}

describe('reading usage', () => {
  it('reads each signed in seat, with who it belongs to', async () => {
    const { client } = await serverWithWork();
    const seats = await client.call(readLimits, {});
    expect(seats.map(({ account }) => account).toSorted()).toEqual(['personal', 'work']);
    expect(seats[0]).toMatchObject({
      displayName: 'personal',
      provider: 'claude',
      identity: 'bee@hive.dev',
      plan: 'max',
    });
    expect(seats[0]?.usage.windows).toEqual([session]);
  });
  it('uses the name you gave a cell', async () => {
    const { client, fileSystem, paths } = await serverWithWork();
    await fileSystem.writePrivateText(paths.configFile, JSON.stringify({ accountNames: { work: 'side' } }));
    const seats = await client.call(readLimits, {});
    expect(seats.map(({ displayName }) => displayName).toSorted()).toEqual(['personal', 'side']);
  });
  it('leaves out a seat that is not signed in, and never starts a read for it', async () => {
    const { client, clis } = await serverWithWork();
    clis.claude.login = { login: LoginState.signedOut };
    expect(await client.call(readLimits, {})).toEqual([]);
    expect(clis.claude.limitsSessions).toEqual([]);
  });
  it('leaves out a seat that was never set up', async () => {
    const { client, clis } = await serverWithWork();
    clis.codex.login = signedIn;
    await client.call(readLimits, {});
    expect(clis.codex.limitsSessions).toEqual([]);
  });
  it('leaves out a provider that is not installed here', async () => {
    const { client, clis } = await serverWithWork({ installed: ['codex'] });
    expect(await client.call(readLimits, {})).toEqual([]);
    expect(clis.claude.limitsSessions).toEqual([]);
  });
  it('reports a provider with no source as unsupported, with no code of its own', async () => {
    const { client, clis, fileSystem } = await serverWithWork();
    await fileSystem.ensureDirectory(`${Home}/.local/share/opencode`);
    clis.opencode.login = { login: LoginState.signedIn, identity: '1 login' };
    const seats = await client.call(readLimits, {});
    const opencode = seats.find(({ provider }) => provider === 'opencode');
    expect(opencode?.usage.unavailable?.reason).toBe('unsupported');
  });
});

describe('the environment of a read', () => {
  async function readSessions(callerEnv: Record<string, string | undefined>) {
    const { client, clis } = await serverWithWork({ callerEnv });
    await client.call(readLimits, {});
    return clis.claude.limitsSessions;
  }

  it('reads each seat from its own folder, in the empty folder', async () => {
    const sessions = await readSessions({});
    const folders = sessions.map(({ env }) => env.CLAUDE_CONFIG_DIR);
    expect(folders).toContain(`${Home}/.favo/accounts/work/claude`);
    expect(sessions.every(({ cwd }) => cwd === `${Home}/.favo/empty`)).toBe(true);
  });
  it('creates the empty folder', async () => {
    const { client, fileSystem } = await serverWithWork();
    await client.call(readLimits, {});
    expect((await fileSystem.entry(`${Home}/.favo/empty`)).kind).toBe('directory');
  });
  it('checks the login in the same clean environment as the read', async () => {
    const { client, clis } = await serverWithWork({ callerEnv: { ANTHROPIC_API_KEY: 'key' } });
    clis.claude.limitsEnvironment = () => ({ env: {}, unsetEnv: ['ANTHROPIC_API_KEY', 'CLAUDE_CONFIG_DIR'] });
    await client.call(readLimits, {});
    const sessions = clis.claude.sessions.slice(-2);
    expect(sessions).toEqual(clis.claude.limitsSessions.slice(-2));
    expect(sessions.every(({ env }) => Object.hasOwn(env, 'ANTHROPIC_API_KEY') && !env.ANTHROPIC_API_KEY)).toBe(true);
    const folders = sessions.map(({ env }) => env.CLAUDE_CONFIG_DIR);
    expect(folders.toSorted()).toEqual([`${Home}/.favo/accounts/work/claude`, undefined].toSorted());
  });
  it('clears a variable the launch environment says to clear', async () => {
    const { client, clis } = await serverWithWork({ callerEnv: { TMUX: '/tmp/x' } });
    clis.claude.limitsEnvironment = () => ({ env: { TERM: 'dumb' }, unsetEnv: ['TMUX', 'CLAUDE_CONFIG_DIR'] });
    await client.call(readLimits, {});
    const { env } = clis.claude.limitsSessions.at(-1)!;
    expect(Object.hasOwn(env, 'TMUX')).toBe(true);
    expect(env.TMUX).toBeUndefined();
    expect(env.TERM).toBe('dumb');
    expect(clis.claude.limitsSessions.map(({ env }) => env.CLAUDE_CONFIG_DIR)).toContain(
      `${Home}/.favo/accounts/work/claude`
    );
  });
});

describe('a read that goes wrong', () => {
  it('turns a crash into a failed reading and keeps the rest of the screen', async () => {
    const { client, clis, fileSystem } = await serverWithWork();
    clis.claude.limitsReading = new Error('boom');
    clis.codex.login = signedIn;
    clis.codex.limitsReading = { windows: [session] };
    await fileSystem.ensureDirectory(`${Home}/.codex`);
    const seats = await client.call(readLimits, {});
    expect(seats.find(({ provider }) => provider === 'claude')?.usage).toMatchObject({
      windows: [],
      unavailable: { reason: 'probeFailed' },
    });
    expect(seats.find(({ provider }) => provider === 'codex')?.usage.windows).toEqual([session]);
  });
  it('shows a seat whose login check crashed as a failed read, so its last bars can stay', async () => {
    const { client, clis, fileSystem } = await serverWithWork();
    clis.codex.status = async () => {
      throw new Error('boom');
    };
    await fileSystem.ensureDirectory(`${Home}/.codex`);
    const seats = await client.call(readLimits, {});
    expect(seats.find(({ provider }) => provider === 'codex')?.usage.unavailable?.reason).toBe('probeFailed');
    expect(seats.filter(({ provider }) => provider === 'claude')).toHaveLength(2);
  });
  it('shows a seat whose login cannot be told as a failed read, and never starts the read', async () => {
    const { client, clis } = await serverWithWork();
    clis.claude.login = { login: LoginState.unknown };
    const seats = await client.call(readLimits, {});
    expect(seats.map(({ usage }) => usage.unavailable?.reason)).toEqual(['probeFailed', 'probeFailed']);
    expect(clis.claude.limitsSessions).toEqual([]);
  });
  it('costs only that seat when a reading is one the wire would refuse', async () => {
    const { client, clis, fileSystem } = await serverWithWork();
    clis.codex.login = signedIn;
    clis.codex.limitsReading = { windows: [{ ...session, resetsAt: 'in a while' }] };
    await fileSystem.ensureDirectory(`${Home}/.codex`);
    const seats = await client.call(readLimits, {});
    expect(seats.find(({ provider }) => provider === 'codex')?.usage.unavailable?.reason).toBe('probeFailed');
    expect(seats.find(({ provider }) => provider === 'claude')?.usage.windows).toEqual([session]);
  });
  it('costs only that seat when its login has a value the wire would refuse', async () => {
    const { client, clis, fileSystem } = await serverWithWork();
    clis.codex.login = { login: LoginState.signedIn, plan: 7 as unknown as string };
    clis.codex.limitsReading = { windows: [session] };
    await fileSystem.ensureDirectory(`${Home}/.codex`);
    const seats = await client.call(readLimits, {});
    expect(seats.find(({ provider }) => provider === 'codex')?.usage.unavailable?.reason).toBe('probeFailed');
    expect(seats.filter(({ provider }) => provider === 'claude')).toHaveLength(2);
  });
});

describe('many seats', () => {
  it('runs only a few reads at once', async () => {
    const { client, clis } = await serverWithWork();
    for (const name of ['one', 'two', 'three', 'four', 'five', 'six']) {
      await client.call(createAccount, { name });
      await client.call(provisionSeat, { account: name, provider: 'claude' });
    }
    const seats = await client.call(readLimits, {});
    expect(seats).toHaveLength(8);
    expect(clis.claude.mostReadsAtOnce).toBeGreaterThan(1);
    expect(clis.claude.mostReadsAtOnce).toBeLessThanOrEqual(4);
  });
  it('keeps the order of the accounts, whichever read ends first', async () => {
    const { client } = await serverWithWork();
    await client.call(createAccount, { name: 'side' });
    await client.call(provisionSeat, { account: 'side', provider: 'claude' });
    expect((await client.call(readLimits, {})).map(({ account }) => account)).toEqual(['personal', 'side', 'work']);
  });
});

describe('another machine', () => {
  async function fleet() {
    const mac = createTestServer();
    await mac.client.call(addMachine, { target: 'bee@devbox' });
    return mac;
  }

  it('reads the seats that live there', async () => {
    const mac = await fleet();
    const devbox = await serverWithWork({ hostname: 'devbox' });
    mac.remotes.connect('devbox', devbox.router);
    const seats = await mac.client.call(readLimits, {}, { machineId: 'devbox' });
    expect(seats).toHaveLength(2);
    expect(mac.clis.claude.limitsSessions).toEqual([]);
  });
  it('answers unknownMethod from an older favo, for the front end to explain', async () => {
    const mac = await fleet();
    mac.remotes.connect('devbox', {
      send: async ({ id, method }) => ({
        id,
        ok: false,
        error: { code: 'unknownMethod', message: `Unknown method "${method}".` },
      }),
    });
    await expect(mac.client.call(readLimits, {}, { machineId: 'devbox' })).rejects.toMatchObject({
      code: 'unknownMethod',
    });
  });
  it('refuses a reply it cannot read', async () => {
    const mac = await fleet();
    mac.remotes.connect('devbox', { send: async ({ id }) => ({ id, ok: true, result: [{ nope: true }] }) });
    await expect(mac.client.call(readLimits, {}, { machineId: 'devbox' })).rejects.toMatchObject({
      code: 'machineOutdated',
    });
  });
});

describe('closing', () => {
  it('starts no more seats once it closes', async () => {
    const { client, clis, close } = await serverWithWork();
    for (const name of ['one', 'two', 'three', 'four', 'five', 'six']) {
      await client.call(createAccount, { name });
      await client.call(provisionSeat, { account: name, provider: 'claude' });
    }
    const reading = client.call(readLimits, {});
    close();
    await reading;
    expect(clis.claude.limitsSessions.length).toBeLessThanOrEqual(4);
  });
  it('stops every process still open, so a quit leaves no read behind', async () => {
    const { close, processes } = createTestServer();
    close();
    expect(processes.killOpenCount).toBe(1);
  });
});
