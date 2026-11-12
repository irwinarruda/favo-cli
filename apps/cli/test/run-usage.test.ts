import { afterEach, beforeEach, describe, expect, it, setSystemTime } from 'bun:test';
import { createAccount } from '@favo/contracts/rpc/accounts/create-account';
import { renameAccount } from '@favo/contracts/rpc/accounts/rename-account';
import { addMachine } from '@favo/contracts/rpc/machines/add-machine';
import { LoginState } from '@favo/contracts/rpc/views';
import { BuiltInThemes } from '@favo/domain/themes/built-in-themes';
import { createTestServer, Home, seedClaudeBase } from '@favo/server/test/support/test-server';
import { createPaint } from '@/paint';
import { parseCommand } from '@/parse-command';
import { runCommand } from '@/run-command';

const Million = 1_000_000;
const HourMs = 3_600_000;
const Table = {
  'claude-test-1': {
    input_cost_per_token: 0.000003,
    output_cost_per_token: 0.000015,
    cache_read_input_token_cost: 0.0000003,
    cache_creation_input_token_cost: 0.00000375,
  },
  'openai/gpt-test-1': { input_cost_per_token: 0.000002, output_cost_per_token: 0.000008 },
};

function harness(server = createTestServer()) {
  const lines: string[] = [];
  const context = {
    client: server.client,
    paint: createPaint(false, BuiltInThemes[0]!.colors),
    print: (line: string) => lines.push(line),
    runPlan: async () => 0,
    ask: async () => false,
    hold: async () => {},
  };
  const run = (...argv: string[]) => runCommand(parseCommand(argv), context);
  return { ...server, lines, run, output: () => lines.join('\n') };
}

const Noon = new Date('2026-11-12T15:30:00.000Z');

beforeEach(() => setSystemTime(Noon));
afterEach(() => setSystemTime());

function hoursAgo(hours: number) {
  return new Date(Date.now() - hours * HourMs).toISOString();
}

function claudeLine(id: string, hours: number, model = 'claude-test-1') {
  return {
    type: 'assistant',
    timestamp: hoursAgo(hours),
    requestId: `req_${id}`,
    sessionId: `session-${id}`,
    message: {
      id: `msg_${id}`,
      model,
      usage: {
        input_tokens: Million,
        cache_read_input_tokens: 20 * Million,
        cache_creation_input_tokens: 2 * Million,
        output_tokens: Million,
      },
    },
  };
}

function codexRollout(hours: number) {
  const usage = {
    input_tokens: 10 * Million,
    cached_input_tokens: 8 * Million,
    output_tokens: 2 * Million,
    total_tokens: 12 * Million,
  };
  const at = Date.parse(hoursAgo(hours));
  return [
    { timestamp: new Date(at).toISOString(), type: 'session_meta', payload: { id: 'session-codex' } },
    { timestamp: new Date(at + 1000).toISOString(), type: 'turn_context', payload: { model: 'gpt-test-1' } },
    {
      timestamp: new Date(at + 9000).toISOString(),
      type: 'event_msg',
      payload: { type: 'token_count', info: { last_token_usage: usage, total_token_usage: usage } },
    },
  ];
}

function withLogs(server = createTestServer()) {
  server.priceSource.table = Table;
  server.tokenLogs.write(`${Home}/.claude/projects/hive/one.jsonl`, [claudeLine('one', 2)]);
  server.tokenLogs.write(`${Home}/.codex/sessions/2026/rollout-a.jsonl`, codexRollout(3));
  return harness(server);
}

describe('favo usage and its pages', () => {
  it('prints limits by default, and the same with --limits', async () => {
    const mac = harness();
    await seedClaudeBase(mac.fileSystem);
    mac.clis.claude.login = { login: LoginState.signedIn, identity: 'mac@bee.dev' };
    mac.clis.claude.limitsReading = {
      windows: [{ id: 'five_hour', kind: 'session', label: 'Session', usedPercent: 32 }],
    };
    await mac.run('usage');
    const byDefault = mac.output();
    mac.lines.length = 0;
    await mac.run('usage', '--limits');
    expect(mac.output()).toBe(byDefault);
    expect(byDefault).toContain('68% left');
    mac.lines.length = 0;
    await mac.run('usage', '--limits', '--json');
    expect(JSON.parse(mac.output())[0].seats[0].usage.windows[0].usedPercent).toBe(32);
  });
  it('takes one page at a time', () => {
    expect(() => parseCommand(['usage', '--tokens', '--cost'])).toThrow('Pick one of --limits, --tokens and --cost.');
    expect(() => parseCommand(['usage', '--limits', '--tokens'])).toThrow('Pick one of');
    expect(parseCommand(['usage']).usagePage).toBe('limits');
    expect(parseCommand(['usage', '--cost']).usagePage).toBe('cost');
  });
  it('refuses a period on limits, where it means nothing', () => {
    const message = 'Limits have no period. --days and --all go with --tokens or --cost.';
    expect(() => parseCommand(['usage', '--days', '7'])).toThrow(message);
    expect(() => parseCommand(['usage', '--limits', '--all'])).toThrow(message);
  });
  it('takes a number of days or everything, not both', () => {
    expect(parseCommand(['usage', '--tokens', '--days', '7'])).toMatchObject({ days: 7, isAllTime: false });
    expect(parseCommand(['usage', '--cost', '--all'])).toMatchObject({ days: undefined, isAllTime: true });
    expect(() => parseCommand(['usage', '--tokens', '--days', '7', '--all'])).toThrow('Pick one of --days and --all.');
    expect(() => parseCommand(['usage', '--tokens', '--days', 'week'])).toThrow('Usage: --days');
    expect(() => parseCommand(['usage', '--tokens', '--days', '0'])).toThrow('Usage: --days');
    expect(() => parseCommand(['usage', '--tokens', '--days'])).toThrow('Usage: --days <days>');
  });
  it('takes each filter more than once', () => {
    const argv = ['usage', '--tokens', '-m', 'local', '--machine', 'devbox', '--account', 'work', '--account', 'side'];
    expect(parseCommand([...argv, '--provider', 'claude', '--provider', 'codex'])).toMatchObject({
      machines: ['local', 'devbox'],
      accounts: ['work', 'side'],
      providers: ['claude', 'codex'],
    });
  });
  it('narrows limits to some accounts and providers too', async () => {
    const mac = harness();
    await seedClaudeBase(mac.fileSystem);
    mac.clis.claude.login = { login: LoginState.signedIn, identity: 'mac@bee.dev' };
    mac.clis.claude.limitsReading = {
      windows: [{ id: 'five_hour', kind: 'session', label: 'Session', usedPercent: 32 }],
    };
    await mac.run('usage', '--provider', 'codex');
    expect(mac.lines).toEqual(['No signed in seat reports limits.']);
    mac.lines.length = 0;
    await mac.run('usage', '--account', 'personal', '--provider', 'claude');
    expect(mac.output()).toContain('68% left');
  });
  it('refuses an account it does not know, on every page', async () => {
    const mac = harness();
    for (const page of ['--limits', '--tokens', '--cost']) {
      const call = mac.run('usage', page, '--account', 'wrok');
      await expect(call).rejects.toMatchObject({ code: 'accountNotFound', message: 'No account named "wrok".' });
    }
  });
});

describe('favo usage --tokens', () => {
  it('prints what every seat used, with the shape of the period', async () => {
    const mac = withLogs();
    expect(await mac.run('usage', '--tokens')).toBe(0);
    const output = mac.output();
    expect(mac.lines[0]).toBe('Tokens   last 30 days · all machines · all accounts · all providers');
    expect(output).toContain('  36M tokens   2 sessions   $67.50 at API prices');
    expect(output).toMatch(
      /\n +██\n +██\n {2}▁+██\n {2}[A-Z][a-z]{2} \d+ +busiest day [A-Z][a-z]{2} \d+, 36M +[A-Z][a-z]{2} \d+\n/
    );
    expect(output).toMatch(
      /Providers\n {2}Claude Code +▄{13}▂{7} +24M +67% +\$31\.50\n {2}Codex +▄{7}▂{13} +12M +33% +\$36\.00/
    );
    expect(output).toMatch(/Accounts\n {2}personal +▄{20} +36M +100% +\$67\.50/);
    expect(output).toMatch(/Machines\n {2}macbook +▄{20} +36M +100% +\$67\.50/);
    expect(output).toMatch(/Models\n {2}claude-test-1 +24M +67% +\$31\.50\n {2}gpt-test-1 +12M +33% +\$36\.00/);
    expect(output).toContain('Types\n  cache read 28M · input 3M · output 3M · cache write 2M');
    expect(output).toContain('85% of the input came from cache');
  });
  it('covers 30 days unless told otherwise', async () => {
    const mac = withLogs();
    mac.tokenLogs.write(`${Home}/.claude/projects/hive/old.jsonl`, [claudeLine('old', 60 * 24)]);
    await mac.run('usage', '--tokens');
    expect(mac.output()).toContain('36M tokens');
    mac.lines.length = 0;
    await mac.run('usage', '--tokens', '--days', '90');
    expect(mac.lines[0]).toContain('last 90 days');
    expect(mac.output()).toContain('60M tokens   3 sessions');
    mac.lines.length = 0;
    await mac.run('usage', '--tokens', '--all');
    expect(mac.lines[0]).toContain('all time');
    expect(mac.output()).toContain('60M tokens');
  });
  it('narrows to a provider, and to an account by the name you gave it', async () => {
    const mac = withLogs();
    await mac.client.call(createAccount, { name: 'work' });
    await mac.client.call(renameAccount, { name: 'work', newName: 'side' });
    mac.tokenLogs.write(`${Home}/.favo/accounts/work/claude/projects/hive/two.jsonl`, [claudeLine('two', 4)]);
    await mac.run('usage', '--tokens', '--provider', 'codex');
    expect(mac.lines[0]).toBe('Tokens   last 30 days · all machines · all accounts · 1 of 2 providers');
    expect(mac.output()).toContain('12M tokens   1 session ');
    mac.lines.length = 0;
    await mac.run('usage', '--tokens', '--account', 'side');
    expect(mac.lines[0]).toContain('1 of 2 accounts');
    expect(mac.output()).toMatch(/Accounts\n {2}side +▄{20} +24M/);
    await expect(mac.run('usage', '--tokens', '--account', 'ghost')).rejects.toMatchObject({ code: 'accountNotFound' });
  });
  it('adds up every machine, or only the ones named', async () => {
    const mac = withLogs();
    const devbox = withLogs(createTestServer({ hostname: 'devbox' }));
    await mac.client.call(addMachine, { target: 'bee@devbox' });
    mac.remotes.connect('devbox', devbox.router);
    await mac.run('usage', '--tokens');
    expect(mac.output()).toContain('72M tokens   4 sessions');
    expect(mac.output()).toMatch(/personal +▄{20} +72M +100%/);
    mac.lines.length = 0;
    await mac.run('usage', '--tokens', '--machine', 'devbox');
    expect(mac.lines[0]).toContain('1 of 2 machines');
    expect(mac.output()).toContain('36M tokens   2 sessions');
    await expect(mac.run('usage', '--tokens', '--machine', 'ghost')).rejects.toMatchObject({ code: 'machineNotFound' });
  });
  it('keeps going when a machine cannot answer, with what it said last time', async () => {
    const mac = withLogs();
    const devbox = withLogs(createTestServer({ hostname: 'devbox' }));
    await mac.client.call(addMachine, { target: 'bee@devbox' });
    mac.remotes.connect('devbox', devbox.router);
    await mac.run('usage', '--tokens');
    mac.remotes.connect('devbox', {
      send: async ({ id }) => ({ id, ok: false, error: { code: 'machineUnreachable', message: 'devbox: gone' } }),
    });
    mac.lines.length = 0;
    expect(await mac.run('usage', '--tokens')).toBe(0);
    expect(mac.output()).toContain('72M tokens');
    expect(mac.output()).toMatch(
      /devbox +▄{10}▂{10} +36M +50% +\$67\.50 {2}could not read, last read (just now|\d+[dhm] ago)\n/
    );
    expect(mac.lines.at(-1)).toBe('devbox: devbox: gone');
  });
  it('calls a machine that does not know the method an older favo, and fails when no machine answered', async () => {
    const mac = withLogs();
    await mac.client.call(addMachine, { target: 'bee@devbox' });
    mac.remotes.connect('devbox', {
      send: async ({ id, method }) => ({
        id,
        ok: false,
        error: { code: 'unknownMethod', message: `Unknown method "${method}".` },
      }),
    });
    expect(await mac.run('usage', '--tokens')).toBe(0);
    expect(mac.output()).toMatch(/devbox +older favo/);
    expect(mac.lines.at(-1)).toBe('devbox: older favo');
    expect(await mac.run('usage', '--tokens', '--machine', 'devbox')).toBe(1);
    expect(await mac.run('usage', '--cost', '--machine', 'devbox', '--json')).toBe(1);
  });
  it('names the providers it does not count yet', async () => {
    const mac = withLogs();
    await mac.run('usage', '--tokens');
    expect(mac.output()).toContain('\n  Antigravity, OpenCode  not counted yet\n');
  });
  it('says how many records it could not read', async () => {
    const mac = withLogs();
    mac.tokenLogs.write(`${Home}/.claude/projects/hive/broken.jsonl`, ['{"message":{"usage":']);
    await mac.run('usage', '--tokens');
    expect(mac.output()).toContain('1 record could not be read, so these numbers may be low.');
  });
  it('works with no price table, with no cost column', async () => {
    const mac = withLogs();
    mac.priceSource.table = undefined;
    await mac.run('usage', '--tokens');
    expect(mac.output()).toContain('  36M tokens   2 sessions\n');
    expect(mac.output()).not.toContain('$');
  });
  it('says so when the period holds nothing', async () => {
    const mac = harness();
    await mac.run('usage', '--tokens');
    expect(mac.output()).toContain('0 tokens   0 sessions');
    expect(mac.output()).toContain('No tokens counted in this period.');
  });
});

describe('favo usage --cost', () => {
  it('prints the same sections in dollars, and says they are not a bill', async () => {
    const mac = withLogs();
    await mac.run('usage', '--cost');
    const output = mac.output();
    expect(mac.lines[0]).toBe('Cost     last 30 days · all machines · all accounts · all providers');
    expect(output).toContain('  $67.50 at API prices   36M tokens   $54.00 saved by cache');
    expect(output).toContain('  what the API would charge for these tokens, not your subscription bill');
    expect(output).toMatch(/busiest day [A-Z][a-z]{2} \d+, \$67\.50/);
    expect(output).toMatch(
      /Providers\n {2}Codex +▄{11}▂{9} +\$36\.00 +53% +12M\n {2}Claude Code +▄{9}▂{11} +\$31\.50 +47% +24M/
    );
    expect(output).toContain('Types\n  output $31.00 · cache read $22.00 · cache write $7.50 · input $7.00');
  });
  it('lists a model with no list price as unpriced, and says what that leaves out', async () => {
    const mac = withLogs();
    mac.tokenLogs.write(`${Home}/.claude/projects/hive/two.jsonl`, [claudeLine('two', 5, 'mystery-1')]);
    await mac.run('usage', '--cost');
    expect(mac.output()).toMatch(/mystery-1 +unpriced +24M/);
    expect(mac.output()).toContain('24M tokens have no list price, and are left out of every dollar.');
  });
  it('says there is no price table yet when this computer was never online', async () => {
    const mac = withLogs();
    mac.priceSource.table = undefined;
    await mac.run('usage', '--cost');
    expect(mac.output()).toContain('No price table yet. favo fetches it the next time this computer is online.');
  });
});

describe('favo usage --tokens --json', () => {
  it('prints one document a site can draw a calendar from, the same for both pages', async () => {
    const mac = withLogs();
    await mac.run('usage', '--tokens', '--json');
    const document = JSON.parse(mac.output());
    mac.lines.length = 0;
    await mac.run('usage', '--cost', '--json');
    const { machines: _machines, ...forCost } = JSON.parse(mac.output());
    const { machines, ...forTokens } = document;
    expect(forCost).toEqual(forTokens);
    expect(Object.keys(document)).toEqual(['since', 'until', 'timeZone', 'machines', 'prices', 'days']);
    expect(document.since < document.until).toBe(true);
    expect(document.timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(machines).toEqual([{ id: 'local', name: 'macbook', readAt: '2026-10-31T12:00:00.000Z' }]);
    expect(document.prices).toEqual({ source: 'litellm', fetchedAt: '2026-10-31T12:00:00.000Z' });
    expect(document.days).toHaveLength(2);
    expect(document.days.find((day: { provider: string }) => day.provider === 'claude')).toEqual({
      day: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      machine: 'macbook',
      account: 'personal',
      provider: 'claude',
      model: 'claude-test-1',
      input: Million,
      cacheRead: 20 * Million,
      cacheWrite: 2 * Million,
      output: Million,
      sessions: 1,
      cost: 31.5,
    });
  });
  it('leaves the cost out of an unpriced model, and names a machine that failed', async () => {
    const mac = withLogs();
    mac.tokenLogs.write(`${Home}/.claude/projects/hive/two.jsonl`, [claudeLine('two', 5, 'mystery-1')]);
    await mac.client.call(addMachine, { target: 'bee@devbox' });
    expect(await mac.run('usage', '--tokens', '--json', '--provider', 'claude')).toBe(0);
    const document = JSON.parse(mac.output());
    expect(document.days.map((day: { model: string }) => day.model).toSorted()).toEqual(['claude-test-1', 'mystery-1']);
    expect(document.days.find((day: { model: string }) => day.model === 'mystery-1')).not.toHaveProperty('cost');
    expect(document.machines[1]).toMatchObject({ id: 'devbox', name: 'devbox' });
    expect(document.machines[1].problem).toContain('devbox');
  });
});
