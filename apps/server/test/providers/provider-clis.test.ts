import { describe, expect, it } from 'bun:test';
import { AntigravityProviderCli } from '@/modules/providers/gateways/antigravity.provider-cli';
import { ClaudeProviderCli } from '@/modules/providers/gateways/claude.provider-cli';
import { CodexProviderCli } from '@/modules/providers/gateways/codex.provider-cli';
import { OpencodeProviderCli } from '@/modules/providers/gateways/opencode.provider-cli';
import { MemoryFileSystem } from '@/modules/system/gateways/memory.file-system';
import { ScriptedProcessRunner } from '@/modules/system/gateways/scripted.process-runner';

function sessionOf(binary: string) {
  return { binary, env: { PATH: '/usr/bin' } };
}

describe('Claude Code shim', () => {
  const status = 'claude auth status';

  it('reads who is signed in', async () => {
    const processes = new ScriptedProcessRunner();
    const stdout = JSON.stringify({ loggedIn: true, email: 'bee@hive.dev', orgName: 'Hive', subscriptionType: 'max' });
    processes.reply(status, { stdout });
    expect(await new ClaudeProviderCli(processes).status(sessionOf('claude'))).toEqual({
      login: 'signedIn',
      identity: 'bee@hive.dev',
      plan: 'max · Hive',
    });
  });
  it('turns the null a claude.ai login can report into no identity', async () => {
    const processes = new ScriptedProcessRunner();
    processes.reply(status, { stdout: JSON.stringify({ loggedIn: true, email: null, subscriptionType: 'max' }) });
    expect(await new ClaudeProviderCli(processes).status(sessionOf('claude'))).toEqual({
      login: 'signedIn',
      identity: undefined,
      plan: 'max',
    });
  });
  it('leaves out the organization every personal plan has', async () => {
    const processes = new ScriptedProcessRunner();
    const stdout = JSON.stringify({ loggedIn: true, orgName: "bee@hive.dev's Organization", subscriptionType: 'max' });
    processes.reply(status, { stdout });
    expect((await new ClaudeProviderCli(processes).status(sessionOf('claude'))).plan).toBe('max');
  });
  it('reads a signed out seat', async () => {
    const processes = new ScriptedProcessRunner();
    processes.reply(status, { code: 1, stdout: '{"loggedIn":false}' });
    expect((await new ClaudeProviderCli(processes).status(sessionOf('claude'))).login).toBe('signedOut');
  });
  it('does not guess when the output is unreadable', async () => {
    const processes = new ScriptedProcessRunner();
    processes.reply(status, { stdout: 'surprise' });
    expect((await new ClaudeProviderCli(processes).status(sessionOf('claude'))).login).toBe('unknown');
  });
  it('keeps the tmux paste fix the claude wrapper had', () => {
    const cli = new ClaudeProviderCli(new ScriptedProcessRunner());
    expect(cli.launchEnvironment({ TMUX: '/tmp/x' })).toEqual({ env: { TERM: 'xterm-256color' }, unsetEnv: ['TMUX'] });
    expect(cli.launchEnvironment({})).toEqual({ env: {}, unsetEnv: [] });
  });
});

describe('Claude Code usage', () => {
  const server =
    'claude -p --input-format stream-json --output-format stream-json --verbose --no-session-persistence --setting-sources local';
  const CheckedAt = '2026-11-01T12:00:00.000Z';
  const session = { ...sessionOf('claude'), cwd: '/home/bee/.favo/empty' };
  const answerLine = (response: unknown) =>
    JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: 'usage', response } });
  const fiveHour = { utilization: 32, resets_at: '2026-11-01T22:40:00.766659+00:00' };

  async function read(response: unknown) {
    const processes = new ScriptedProcessRunner();
    processes.converse(server, [answerLine(response)]);
    return new ClaudeProviderCli(processes).limits(session, CheckedAt);
  }

  it('reads the session and the week, and ignores every codenamed field', async () => {
    const usage = await read({
      subscription_type: 'max',
      rate_limits_available: true,
      rate_limits: {
        five_hour: { ...fiveHour, limit_dollars: null, locked_reason: null },
        seven_day: { utilization: 75, resets_at: '2026-11-04T05:00:00+00:00' },
        cinder_cove: null,
        wattle_ember: { utilization: 99 },
        limits: [{ kind: 'session', percent: 0 }],
      },
    });
    expect(usage).toEqual({
      checkedAt: CheckedAt,
      windows: [
        {
          id: 'five_hour',
          kind: 'session',
          label: 'Session',
          windowDurationMins: 300,
          usedPercent: 32,
          resetsAt: '2026-11-01T22:40:00.766Z',
        },
        {
          id: 'seven_day',
          kind: 'weekly',
          label: 'Weekly',
          windowDurationMins: 10080,
          usedPercent: 75,
          resetsAt: '2026-11-04T05:00:00.000Z',
        },
      ],
    });
  });
  it('makes a weekly window of each model limit', async () => {
    const scoped = { display_name: 'Fable 5', utilization: 10, resets_at: '2026-11-03T04:00:00+00:00' };
    const { windows } = await read({ rate_limits_available: true, rate_limits: { model_scoped: [scoped] } });
    expect(windows[0]).toMatchObject({ id: 'seven_day_fable_5', kind: 'weekly', label: 'Weekly · Fable 5' });
  });
  it('skips a window with no number, and a broken model entry', async () => {
    const rate_limits = {
      five_hour: { utilization: null, resets_at: null },
      model_scoped: ['nonsense', null, { display_name: 'Fable', utilization: 'lots' }],
    };
    expect((await read({ rate_limits_available: true, rate_limits })).windows).toEqual([]);
  });
  it('reads monthly spend when the money compares', async () => {
    const money = (amount_minor: number, currency = 'USD', exponent = 2) => ({ amount_minor, currency, exponent });
    const spend = { enabled: true, used: money(2500), limit: money(10000) };
    const { windows } = await read({ rate_limits_available: true, rate_limits: { spend } });
    expect(windows).toEqual([{ id: 'monthly_spend', kind: 'monthly', label: 'Monthly spend', usedPercent: 25 }]);
  });
  it('falls back to extra usage when the currencies differ, and skips it when neither applies', async () => {
    const money = (amount_minor: number, currency: string) => ({ amount_minor, currency, exponent: 2 });
    const spend = { enabled: true, used: money(2500, 'USD'), limit: money(10000, 'BRL') };
    const extra_usage = { is_enabled: true, used_credits: 10, monthly_limit: 40, utilization: 99 };
    const withExtra = await read({ rate_limits_available: true, rate_limits: { spend, extra_usage } });
    expect(withExtra.windows[0]?.usedPercent).toBe(25);
    const without = { spend: { enabled: false }, extra_usage: { is_enabled: false } };
    expect((await read({ rate_limits_available: true, rate_limits: without })).windows).toEqual([]);
  });
  it('says so when no plan limits apply', async () => {
    expect((await read({ rate_limits_available: false })).unavailable).toEqual({
      reason: 'unsupported',
      message: 'This account has no subscription limits.',
    });
  });
  it.each([
    ['limits promised but missing', { rate_limits_available: true }],
    ['limits that are not an object', { rate_limits_available: true, rate_limits: 'lots' }],
    ['no flag at all', { rate_limits: {} }],
    ['no response at all', undefined],
  ])('fails softly on %s', async (_name, response) => {
    const usage = await read(response);
    expect(usage.unavailable?.reason).toBe('probeFailed');
    expect(usage.windows).toEqual([]);
  });
  it('fails softly and kills a process that never answers', async () => {
    const processes = new ScriptedProcessRunner();
    processes.converse(server, []);
    const usage = await new ClaudeProviderCli(processes, 5).limits(session, CheckedAt);
    expect(usage.unavailable).toEqual({ reason: 'probeFailed', message: 'Claude Code did not answer.' });
    expect(processes.killed).toHaveLength(1);
  });
  it('fails softly on a malformed reply, and does not take another answer for its own', async () => {
    const processes = new ScriptedProcessRunner();
    const otherAnswer = JSON.stringify({ type: 'control_response', response: { request_id: 'init' } });
    processes.converse(server, ['not json', 'null', '7', otherAnswer]);
    const usage = await new ClaudeProviderCli(processes, 5).limits(session, CheckedAt);
    expect(usage.unavailable?.reason).toBe('probeFailed');
  });
  it('kills the process once it has its answer', async () => {
    const processes = new ScriptedProcessRunner();
    processes.converse(server, [answerLine({ rate_limits_available: true, rate_limits: {} })]);
    await new ClaudeProviderCli(processes).limits(session, CheckedAt);
    expect(processes.killed).toHaveLength(1);
  });
  it('fails softly when the process dies', async () => {
    const usage = await new ClaudeProviderCli(new ScriptedProcessRunner()).limits(session, CheckedAt);
    expect(usage.unavailable?.reason).toBe('probeFailed');
  });
  it('starts in the empty folder, so no project settings load', async () => {
    const processes = new ScriptedProcessRunner();
    processes.converse(server, [answerLine({ rate_limits_available: false })]);
    await new ClaudeProviderCli(processes).limits(session, CheckedAt);
    expect(processes.calls[0]?.cwd).toBe('/home/bee/.favo/empty');
  });
  it('clears what could make a subscription look like an API key, and what it launches with', () => {
    const cli = new ClaudeProviderCli(new ScriptedProcessRunner());
    const current = {
      TMUX: '/tmp/x',
      ANTHROPIC_API_KEY: 'key',
      CLAUDE_CODE_ENTRYPOINT: 'cli',
      HERDR_SESSION: 'x',
      PATH: '/usr/bin',
    };
    const { env, unsetEnv } = cli.limitsEnvironment(current);
    expect(env).toEqual({ TERM: 'xterm-256color' });
    expect(unsetEnv.toSorted()).toEqual(['ANTHROPIC_API_KEY', 'CLAUDE_CODE_ENTRYPOINT', 'HERDR_SESSION', 'TMUX']);
  });
});

describe('Codex usage', () => {
  const CheckedAt = '2026-11-01T12:00:00.000Z';
  const Reset = 1793572973;
  const ResetIso = new Date(Reset * 1000).toISOString();
  const session = sessionOf('codex');
  const answerLine = (result: unknown) => JSON.stringify({ id: 2, result });
  const position = (usedPercent: number, windowDurationMins?: number) => ({
    usedPercent,
    windowDurationMins,
    resetsAt: Reset,
  });

  async function read(result: unknown) {
    const processes = new ScriptedProcessRunner();
    processes.converse('codex app-server', [answerLine(result)]);
    return new CodexProviderCli(processes).limits(session, CheckedAt);
  }

  it('turns epoch seconds into a date and the length into a kind', async () => {
    const rateLimits = { primary: position(10, 300), secondary: position(75, 10080), planType: 'team', unknown: 1 };
    expect((await read({ rateLimits })).windows).toEqual([
      {
        id: 'primary',
        kind: 'session',
        label: 'Session',
        usedPercent: 10,
        windowDurationMins: 300,
        resetsAt: ResetIso,
      },
      {
        id: 'secondary',
        kind: 'weekly',
        label: 'Weekly',
        usedPercent: 75,
        windowDurationMins: 10080,
        resetsAt: ResetIso,
      },
    ]);
  });
  it('prefers the codex entry over the top level', async () => {
    const rateLimits = { limitId: 'gpt-5-spark', primary: position(99, 300) };
    const rateLimitsByLimitId = { codex: { limitId: 'codex', primary: position(10, 300) } };
    const { windows } = await read({ rateLimits, rateLimitsByLimitId });
    expect(windows[0]?.usedPercent).toBe(10);
  });
  it('ignores a snapshot for one model, so it cannot replace the main allowance', async () => {
    const usage = await read({ rateLimits: { limitId: 'gpt-5-spark', primary: position(99, 300) } });
    expect(usage.windows).toEqual([]);
    expect(usage.unavailable).toBeUndefined();
  });
  it('reads a window by its length, not by its position', async () => {
    const { windows } = await read({ rateLimits: { primary: position(10, 43200) } });
    expect(windows[0]).toMatchObject({ kind: 'monthly', label: 'Monthly' });
  });
  it.each([
    ['plus', 'session'],
    ['free', 'monthly'],
    ['go', 'monthly'],
  ])('reads a first window with no length on a %s plan as %s', async (planType, kind) => {
    const { windows } = await read({ rateLimits: { planType, primary: { usedPercent: 10 } } });
    expect(windows[0]?.kind).toBe(kind as 'session');
  });
  it('reads a second window with no length as the week', async () => {
    const { windows } = await read({ rateLimits: { secondary: { usedPercent: 10 } } });
    expect(windows[0]).toMatchObject({ kind: 'weekly', windowDurationMins: 10080 });
  });
  it('turns what the individual limit has left into what is spent', async () => {
    const { windows } = await read({ rateLimits: { individualLimit: { remainingPercent: 30, resetsAt: Reset } } });
    expect(windows).toEqual([
      {
        id: 'individual',
        kind: 'monthly',
        label: 'Monthly credit limit',
        usedPercent: 70,
        resetsAt: ResetIso,
      },
    ]);
  });
  it('leaves banked credits out', async () => {
    const usage = await read({ rateLimits: {}, rateLimitResetCredits: { availableCount: 1 } });
    expect(usage).toEqual({ checkedAt: CheckedAt, windows: [] });
  });
  it.each([
    ['nothing', undefined],
    ['a number', 7],
    ['no limits', {}],
  ])('fails softly on %s', async (_name, result) => {
    expect((await read(result)).unavailable?.reason).toBe('probeFailed');
  });
  it('says an API key seat has no limits, because retrying can never help', async () => {
    const processes = new ScriptedProcessRunner();
    const refused = JSON.stringify({ id: 2, error: { code: -32600, message: 'chatgpt authentication required' } });
    const apiKey = JSON.stringify({ id: 2, result: { account: { type: 'apiKey' } } });
    processes.converseInTurn('codex app-server', [[refused], [apiKey]]);
    expect((await new CodexProviderCli(processes).limits(session, CheckedAt)).unavailable).toEqual({
      reason: 'unsupported',
      message: 'This account has no subscription limits.',
    });
  });
  it('asks what kind of account it is only when the read was refused', async () => {
    const processes = new ScriptedProcessRunner();
    processes.converse('codex app-server', [answerLine({ rateLimits: {} })]);
    await new CodexProviderCli(processes).limits(session, CheckedAt);
    expect(processes.calls).toHaveLength(1);
  });
  it('clears CODEX_HOME, so a read from inside another seat cannot follow it', () => {
    const cli = new CodexProviderCli(new ScriptedProcessRunner());
    expect(cli.limitsEnvironment()).toEqual({ env: {}, unsetEnv: ['CODEX_HOME'] });
  });
  it('fails softly when the app server refuses', async () => {
    const processes = new ScriptedProcessRunner();
    processes.converse('codex app-server', [JSON.stringify({ id: 2, error: { code: -32600, message: 'no' } })]);
    const usage = await new CodexProviderCli(processes).limits(session, CheckedAt);
    expect(usage.unavailable).toEqual({ reason: 'probeFailed', message: 'Codex could not read usage.' });
  });
  it('fails softly and kills a process that never answers', async () => {
    const processes = new ScriptedProcessRunner();
    processes.converse('codex app-server', []);
    const usage = await new CodexProviderCli(processes, 5).limits(session, CheckedAt);
    expect(usage.unavailable).toEqual({ reason: 'probeFailed', message: 'Codex did not answer.' });
    expect(processes.killed).toHaveLength(1);
  });
  it('fails softly on a malformed reply', async () => {
    const processes = new ScriptedProcessRunner();
    processes.converse('codex app-server', ['not json', '{"method":"remoteControl/status/changed"}']);
    const usage = await new CodexProviderCli(processes, 5).limits(session, CheckedAt);
    expect(usage.unavailable?.reason).toBe('probeFailed');
  });
});

describe('Codex shim', () => {
  const accountLine = (account: unknown) => JSON.stringify({ id: 2, result: { account } });

  it('asks the app server who is signed in instead of reading a token', async () => {
    const processes = new ScriptedProcessRunner();
    processes.converse('codex app-server', [accountLine({ type: 'chatgpt', email: 'bee@hive.dev', planType: 'team' })]);
    expect(await new CodexProviderCli(processes).status(sessionOf('codex'))).toEqual({
      login: 'signedIn',
      identity: 'bee@hive.dev',
      plan: 'team',
    });
  });
  it('reads a signed out seat from the app server', async () => {
    const processes = new ScriptedProcessRunner();
    processes.converse('codex app-server', [accountLine(null)]);
    expect((await new CodexProviderCli(processes).status(sessionOf('codex'))).login).toBe('signedOut');
  });
  it('trusts the app server over login status when the token was revoked', async () => {
    const processes = new ScriptedProcessRunner();
    const revoked = { id: 2, error: { code: -32603, message: 'your refresh token was revoked' } };
    processes.converse('codex app-server', [JSON.stringify(revoked)]);
    processes.reply('codex login status', { stdout: 'Logged in using ChatGPT' });
    expect(await new CodexProviderCli(processes).status(sessionOf('codex'))).toEqual({
      login: 'signedOut',
      plan: 'login expired',
    });
  });
  it('signs in with a device code over ssh, where a localhost callback cannot reach', () => {
    const cli = new CodexProviderCli(new ScriptedProcessRunner());
    expect(cli.loginArguments({ isOverSsh: false })).toEqual(['login']);
    expect(cli.loginArguments({ isOverSsh: true })).toEqual(['login', '--device-auth']);
  });
  it('falls back to login status when the app server is not there', async () => {
    const processes = new ScriptedProcessRunner();
    processes.reply('codex login status', { stdout: 'Logged in using ChatGPT' });
    expect((await new CodexProviderCli(processes).status(sessionOf('codex'))).login).toBe('signedIn');
    processes.reply('codex login status', { stdout: 'Not logged in' });
    expect((await new CodexProviderCli(processes).status(sessionOf('codex'))).login).toBe('signedOut');
  });
});

describe('Antigravity shim', () => {
  it('reads sign-in from the models command because agy has no status command', async () => {
    const processes = new ScriptedProcessRunner();
    const cli = new AntigravityProviderCli(processes);
    processes.reply('agy models', { code: 1, stderr: 'Error: Please sign in to view available models.' });
    expect((await cli.status(sessionOf('agy'))).login).toBe('signedOut');
    processes.reply('agy models', { stdout: 'gemini-3' });
    expect((await cli.status(sessionOf('agy'))).login).toBe('signedIn');
  });
  it('reports no limits, because it has no source that needs no token', async () => {
    const cli = new AntigravityProviderCli(new ScriptedProcessRunner());
    expect(await cli.limits(sessionOf('agy'), 'now')).toEqual({
      checkedAt: 'now',
      windows: [],
      unavailable: { reason: 'unsupported', message: undefined },
    });
  });
  it('signs in by launching and has no sign-out', () => {
    const cli = new AntigravityProviderCli(new ScriptedProcessRunner());
    expect(cli.loginArguments()).toEqual([]);
    expect(cli.logoutArguments()).toBeUndefined();
  });
});

describe('OpenCode shim', () => {
  const help = 'opencode --help';

  it('reports no limits, because it has no source that needs no token', async () => {
    const usage = await new OpencodeProviderCli(new ScriptedProcessRunner()).limits(sessionOf('opencode'), 'now');
    expect(usage.unavailable?.reason).toBe('unsupported');
  });

  it('uses standalone when this version has it, and asks only once', async () => {
    const processes = new ScriptedProcessRunner();
    processes.reply(help, { stdout: '--standalone  Run with a private server' });
    processes.reply('opencode auth list --standalone', { stdout: 'OpenAI  OAuth  stored\n' });
    const cli = new OpencodeProviderCli(processes);
    expect((await cli.status(sessionOf('opencode'))).identity).toBe('1 login');
    await cli.status(sessionOf('opencode'));
    expect(processes.calls.filter((call) => call.args[0] === '--help')).toHaveLength(1);
  });
  it('works with a version that has no standalone, as npm ships today', async () => {
    const processes = new ScriptedProcessRunner();
    processes.reply(help, { stdout: 'opencode providers  manage AI providers' });
    processes.reply('opencode auth list', { stdout: '\u001b[90m—\u001b[39m  2 credentials\n' });
    const cli = new OpencodeProviderCli(processes);
    expect(await cli.isolationArguments(sessionOf('opencode'))).toEqual([]);
    expect((await cli.status(sessionOf('opencode'))).identity).toBe('2 logins');
  });
  it('counts the logins, through colors', async () => {
    const processes = new ScriptedProcessRunner();
    processes.reply(help, { stdout: '--standalone' });
    const stdout = '\u001b[32mGitHub Copilot\u001b[0m  OAuth  stored\nOpenAI  API  stored\n';
    processes.reply('opencode auth list --standalone', { stdout });
    expect((await new OpencodeProviderCli(processes).status(sessionOf('opencode'))).identity).toBe('2 logins');
  });
  it('reads an empty seat from either version', async () => {
    const processes = new ScriptedProcessRunner();
    processes.reply('opencode auth list', { stdout: 'No authenticated integrations' });
    expect((await new OpencodeProviderCli(processes).status(sessionOf('opencode'))).login).toBe('signedOut');
    processes.reply('opencode auth list', { stdout: '0 credentials' });
    expect((await new OpencodeProviderCli(processes).status(sessionOf('opencode'))).login).toBe('signedOut');
  });
});

describe('finding threads with no hook', () => {
  const Sessions = '/seat/sessions';
  const Id = (tail: string) => `01a198ab-c6e8-7962-bebd-a5735000${tail}`;
  const search = { session: sessionOf('codex'), seatHome: '/seat', directory: '/code/hive' };

  function rolloutOf(id: string, cwd: string, extra = '"thread_source":"user"') {
    const meta = { id, cwd };
    return `{"timestamp":"2026-11-01T19:52:40.944Z","ordinal":0,"type":"session_meta","payload":{"session_id":"${meta.id}","id":"${meta.id}","cwd":${JSON.stringify(cwd)},${extra},"base_instructions":{"text":"${'x'.repeat(50_000)}`;
  }

  async function write(fileSystem: MemoryFileSystem, day: string, time: string, id: string, text: string) {
    await fileSystem.writePrivateText(`${Sessions}/${day}/rollout-2026-11-01T${time}-${id}.jsonl`, text);
  }

  it('reads Codex rollouts for this folder, from the start of each file', async () => {
    const fileSystem = new MemoryFileSystem();
    await write(fileSystem, '2026/11/01', '10-00-00', Id('0001'), rolloutOf(Id('0001'), '/code/hive'));
    await write(fileSystem, '2026/11/01', '11-00-00', Id('0002'), rolloutOf(Id('0002'), '/code/other'));
    const threads = await new CodexProviderCli(new ScriptedProcessRunner()).recentThreads(search, fileSystem);
    expect(threads).toEqual([{ id: Id('0001'), directory: '/code/hive', updatedAt: '2026-11-01T19:52:40.944Z' }]);
  });
  it('reads a folder name with an escape in it', async () => {
    const fileSystem = new MemoryFileSystem();
    const directory = 'C:\\code\\"quoted"';
    await write(fileSystem, '2026/11/01', '10-00-00', Id('0001'), rolloutOf(Id('0001'), directory));
    const cli = new CodexProviderCli(new ScriptedProcessRunner());
    const threads = await cli.recentThreads({ ...search, directory }, fileSystem);
    expect(threads[0]?.directory).toBe(directory);
  });
  it('leaves out a subagent', async () => {
    const fileSystem = new MemoryFileSystem();
    const text = rolloutOf(Id('0001'), '/code/hive', '"source":{"subagent":{"thread_spawn":{}}}');
    await write(fileSystem, '2026/11/01', '10-00-00', Id('0001'), text);
    const cli = new CodexProviderCli(new ScriptedProcessRunner());
    expect(await cli.recentThreads(search, fileSystem)).toEqual([]);
  });
  it('skips a file that is not a rollout it can read', async () => {
    const fileSystem = new MemoryFileSystem();
    await fileSystem.writePrivateText(`${Sessions}/2026/11/01/notes.txt`, 'hello');
    await write(fileSystem, '2026/11/01', '10-00-00', Id('0001'), 'garbage');
    const cli = new CodexProviderCli(new ScriptedProcessRunner());
    expect(await cli.recentThreads(search, fileSystem)).toEqual([]);
  });
  it('finds nothing in a seat that never ran', async () => {
    const cli = new CodexProviderCli(new ScriptedProcessRunner());
    expect(await cli.recentThreads(search, new MemoryFileSystem())).toEqual([]);
  });
  it('looks at the newest rollouts only, across days', async () => {
    const fileSystem = new MemoryFileSystem();
    for (let index = 0; index < 45; index++) {
      const id = Id(String(index).padStart(4, '0'));
      const day = index < 30 ? '2026/10/31' : '2026/11/01';
      await write(fileSystem, day, `10-00-${String(index).padStart(2, '0')}`, id, rolloutOf(id, '/code/hive'));
    }
    const threads = await new CodexProviderCli(new ScriptedProcessRunner()).recentThreads(search, fileSystem);
    expect(threads).toHaveLength(40);
    expect(threads[0]?.id).toBe(Id('0044'));
    expect(threads.at(-1)?.id).toBe(Id('0005'));
  });

  describe('on OpenCode', () => {
    const list = 'opencode session list --format json --standalone';
    const opencodeSearch = { ...search, session: sessionOf('opencode') };

    function scripted() {
      const processes = new ScriptedProcessRunner();
      processes.reply('opencode --help', { stdout: '--standalone' });
      return processes;
    }

    it('asks its own list, from the folder, on a private server', async () => {
      const processes = scripted();
      const session = { id: 'ses_1', title: 'hi', updated: 1793562844915, created: 1, directory: '/code/hive' };
      processes.reply(list, { stdout: JSON.stringify([session]) });
      const threads = await new OpencodeProviderCli(processes).recentThreads(opencodeSearch);
      expect(threads).toEqual([{ id: 'ses_1', directory: '/code/hive', updatedAt: '2026-11-01T19:54:04.915Z' }]);
      expect(processes.calls.at(-1)?.cwd).toBe('/code/hive');
    });
    it('finds nothing when the answer is not a list', async () => {
      const processes = scripted();
      processes.reply(list, { stdout: 'Error: not a project' });
      expect(await new OpencodeProviderCli(processes).recentThreads(opencodeSearch)).toEqual([]);
    });
  });
  it('is nothing for a provider with no list of its own', async () => {
    const cli = new ClaudeProviderCli(new ScriptedProcessRunner());
    expect(await cli.recentThreads(search, new MemoryFileSystem())).toEqual([]);
  });
});

describe('whether a provider turned its updates off', () => {
  const search = { env: {}, home: '/home/bee', configHome: '/home/bee/.config' };

  it('reads either Claude Code variable from the environment', async () => {
    const cli = new ClaudeProviderCli(new ScriptedProcessRunner());
    const fileSystem = new MemoryFileSystem();
    expect(await cli.updateSwitch(search, fileSystem)).toBeUndefined();
    expect(await cli.updateSwitch({ ...search, env: { DISABLE_UPDATES: '1' } }, fileSystem)).toBe('DISABLE_UPDATES');
    expect(await cli.updateSwitch({ ...search, env: { DISABLE_AUTOUPDATER: '1' } }, fileSystem)).toBe(
      'DISABLE_AUTOUPDATER'
    );
  });
  it('reads the env block of Claude Code settings, in the folder it is pointed at', async () => {
    const cli = new ClaudeProviderCli(new ScriptedProcessRunner());
    const fileSystem = new MemoryFileSystem();
    const settings = JSON.stringify({ env: { DISABLE_UPDATES: '1' } });
    await fileSystem.writePrivateText('/home/bee/.claude/settings.json', settings);
    await fileSystem.writePrivateText('/seat/settings.json', '{}');
    expect(await cli.updateSwitch(search, fileSystem)).toBe('DISABLE_UPDATES');
    expect(await cli.updateSwitch({ ...search, env: { CLAUDE_CONFIG_DIR: '/seat' } }, fileSystem)).toBeUndefined();
  });
  it('survives Claude Code settings it cannot read', async () => {
    const fileSystem = new MemoryFileSystem();
    await fileSystem.writePrivateText('/home/bee/.claude/settings.json', '{ not json');
    expect(await new ClaudeProviderCli(new ScriptedProcessRunner()).updateSwitch(search, fileSystem)).toBeUndefined();
  });
  it('never opens the file that holds the Claude Code login', async () => {
    const fileSystem = new MemoryFileSystem();
    const read: string[] = [];
    const readText = fileSystem.readText.bind(fileSystem);
    fileSystem.readText = (path) => {
      read.push(path);
      return readText(path);
    };
    await new ClaudeProviderCli(new ScriptedProcessRunner()).updateSwitch(search, fileSystem);
    expect(read).toEqual(['/home/bee/.claude/settings.json']);
  });
  it('reads the OpenCode variable and both spellings of its config', async () => {
    const cli = new OpencodeProviderCli(new ScriptedProcessRunner());
    const fileSystem = new MemoryFileSystem();
    expect(await cli.updateSwitch(search, fileSystem)).toBeUndefined();
    expect(await cli.updateSwitch({ ...search, env: { OPENCODE_DISABLE_AUTOUPDATE: 'TRUE' } }, fileSystem)).toBe(
      'OPENCODE_DISABLE_AUTOUPDATE'
    );
    await fileSystem.writePrivateText('/home/bee/.config/opencode/opencode.json', '{ "update": "disable" }');
    expect(await cli.updateSwitch(search, fileSystem)).toBe('/home/bee/.config/opencode/opencode.json');
    await fileSystem.writePrivateText('/home/bee/.config/opencode/opencode.json', '{ "update": "notify" }');
    await fileSystem.writePrivateText('/home/bee/.config/opencode/opencode.jsonc', '{ "autoupdate": false }');
    expect(await cli.updateSwitch(search, fileSystem)).toBe('/home/bee/.config/opencode/opencode.jsonc');
  });
  it('takes a Claude Code switch set to no as not set, as Claude Code does', async () => {
    const cli = new ClaudeProviderCli(new ScriptedProcessRunner());
    const fileSystem = new MemoryFileSystem();
    for (const value of ['0', 'false', 'no']) {
      expect(await cli.updateSwitch({ ...search, env: { DISABLE_UPDATES: value } }, fileSystem)).toBeUndefined();
    }
    for (const value of ['1', 'TRUE', 'yes', 'on']) {
      expect(await cli.updateSwitch({ ...search, env: { DISABLE_UPDATES: value } }, fileSystem)).toBe(
        'DISABLE_UPDATES'
      );
    }
  });
  it('reads OpenCode config as OpenCode does', async () => {
    const cli = new OpencodeProviderCli(new ScriptedProcessRunner());
    const fileSystem = new MemoryFileSystem();
    const path = '/home/bee/.config/opencode/opencode.jsonc';
    const schema = '"$schema": "https://opencode.ai/config.json"';
    await fileSystem.writePrivateText(path, `{ ${schema}, // "autoupdate": false,\n}`);
    expect(await cli.updateSwitch(search, fileSystem)).toBeUndefined();
    await fileSystem.writePrivateText(path, `{ ${schema}, "agent": { "update": "disable" } }`);
    expect(await cli.updateSwitch(search, fileSystem)).toBeUndefined();
    await fileSystem.writePrivateText(path, `{ ${schema}, /* on */ "autoupdate": false, }`);
    expect(await cli.updateSwitch(search, fileSystem)).toBe(path);
    await fileSystem.writePrivateText(path, '{ "update": "notify", "autoupdate": false }');
    expect(await cli.updateSwitch(search, fileSystem)).toBeUndefined();
  });
  it('lets the last OpenCode config file that says anything decide', async () => {
    const cli = new OpencodeProviderCli(new ScriptedProcessRunner());
    const fileSystem = new MemoryFileSystem();
    await fileSystem.writePrivateText('/home/bee/.config/opencode/config.json', '{ "update": "disable" }');
    await fileSystem.writePrivateText('/home/bee/.config/opencode/opencode.json', '{ "update": "auto" }');
    expect(await cli.updateSwitch(search, fileSystem)).toBeUndefined();
  });
  it('reads the Antigravity variable', async () => {
    const cli = new AntigravityProviderCli(new ScriptedProcessRunner());
    const fileSystem = new MemoryFileSystem();
    expect(await cli.updateSwitch(search)).toBeUndefined();
    expect(await cli.updateSwitch({ ...search, env: { AGY_CLI_DISABLE_AUTO_UPDATE: '1' } })).toBe(
      'AGY_CLI_DISABLE_AUTO_UPDATE'
    );
    expect(await fileSystem.list('/home/bee')).toEqual([]);
  });
  it('finds nothing for Codex, which has no such switch', async () => {
    const cli = new CodexProviderCli(new ScriptedProcessRunner());
    expect(await cli.updateSwitch(search, new MemoryFileSystem())).toBeUndefined();
  });
});
