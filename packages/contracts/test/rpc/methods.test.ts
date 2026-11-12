import { describe, expect, it } from 'bun:test';
import { BuiltInThemes } from '@favo/domain/themes/built-in-themes';
import { createAccount } from '#contracts/rpc/accounts/create-account';
import { listAccounts } from '#contracts/rpc/accounts/list-accounts';
import { createRpcClient } from '#contracts/rpc/client';
import { getAppLogin } from '#contracts/rpc/desktop/get-app-login';
import { listDesktopApps } from '#contracts/rpc/desktop/list-desktop-apps';
import { openDesktopApp } from '#contracts/rpc/desktop/open-desktop-app';
import type { RpcResponse } from '#contracts/rpc/envelope';
import { Protocol, RpcRequest, RpcResponse as RpcResponseSchema } from '#contracts/rpc/envelope';
import { installHooks } from '#contracts/rpc/hooks/install-hooks';
import { listHooks } from '#contracts/rpc/hooks/list-hooks';
import { refreshHooks } from '#contracts/rpc/hooks/refresh-hooks';
import { uninstallHooks } from '#contracts/rpc/hooks/uninstall-hooks';
import { addMachine } from '#contracts/rpc/machines/add-machine';
import { getSeatStatus } from '#contracts/rpc/seats/get-seat-status';
import { readLimits } from '#contracts/rpc/seats/read-limits';
import { ping } from '#contracts/rpc/system/ping';
import { planTerminal } from '#contracts/rpc/terminal/plan-terminal';
import { listThemes } from '#contracts/rpc/themes/list-themes';
import { selectTheme } from '#contracts/rpc/themes/select-theme';
import { listThreads } from '#contracts/rpc/threads/list-threads';
import { recordThread } from '#contracts/rpc/threads/record-thread';
import { reportThread } from '#contracts/rpc/threads/report-thread';
import { listProviderUpdates } from '#contracts/rpc/updates/list-provider-updates';
import { listProviderVersions } from '#contracts/rpc/updates/list-provider-versions';
import { planFavoUpdate } from '#contracts/rpc/updates/plan-favo-update';
import { planUpdate } from '#contracts/rpc/updates/plan-update';
import { recordProviderUpdate } from '#contracts/rpc/updates/record-provider-update';
import { startProviderUpdates } from '#contracts/rpc/updates/start-provider-updates';
import { keepTokenUsage } from '#contracts/rpc/usage/keep-token-usage';
import { readKeptTokenUsage } from '#contracts/rpc/usage/read-kept-token-usage';
import { readTokenPrices } from '#contracts/rpc/usage/read-token-prices';
import { readTokenUsage } from '#contracts/rpc/usage/read-token-usage';
import { readUsageView } from '#contracts/rpc/usage/read-usage-view';
import { saveUsageView } from '#contracts/rpc/usage/save-usage-view';

const seat = {
  account: 'work',
  provider: 'claude',
  label: 'Claude Code',
  path: '/h/.favo/accounts/work/claude',
  pathHint: 'CLAUDE_CONFIG_DIR path',
  loginScope: 'perAccount',
  isInstalled: true,
  isProvisioned: true,
  canLogout: true,
};

describe('threads', () => {
  const thread = { id: 'a', directory: '/code', updatedAt: 'now', isGuess: false, isDirectoryGone: false };

  it('lives on the machine that ran it', () => {
    expect(listThreads.routing).toBe('machine');
    expect(listThreads.params.safeParse({ account: 'work', provider: 'claude' }).success).toBe(true);
    expect(listThreads.params.safeParse({ account: 'work', provider: 'gemini' }).success).toBe(false);
    expect(listThreads.result.safeParse([thread]).success).toBe(true);
    expect(listThreads.result.safeParse([{ ...thread, id: 1 }]).success).toBe(false);
  });
  it('is recorded and reported by the favo inside the provider, never forwarded', () => {
    expect(recordThread.routing).toBe('hub');
    expect(reportThread.routing).toBe('hub');
    const event = { provider: 'claude', id: 'a', directory: '/code', isFresh: true };
    expect(recordThread.params.safeParse(event).success).toBe(true);
    expect(recordThread.params.safeParse({ ...event, isFresh: 'yes' }).success).toBe(false);
    expect(reportThread.params.safeParse({ provider: 'claude', id: 'a' }).success).toBe(true);
    expect(reportThread.params.safeParse({ id: 'a' }).success).toBe(false);
  });
  it('can be picked when planning a terminal', () => {
    const plan = { action: 'resume', account: 'work', provider: 'claude', args: [], thread: 'a' };
    expect(planTerminal.params.safeParse(plan).success).toBe(true);
    expect(planTerminal.params.safeParse({ ...plan, action: 'continue' }).success).toBe(false);
  });
});

describe('hooks', () => {
  const hook = {
    provider: 'claude',
    label: 'Claude Code',
    state: 'current',
    isProviderInstalled: true,
    needsTrust: false,
    file: '/h/.claude/settings.json',
    problems: [],
  };

  it('are changed on the machine asked for', () => {
    for (const method of [listHooks, installHooks, uninstallHooks]) {
      expect(method.routing).toBe('machine');
      expect(method.params.safeParse({}).success).toBe(true);
      expect(method.params.safeParse({ force: true }).success).toBe(false);
      expect(method.result.safeParse([hook]).success).toBe(true);
      expect(method.result.safeParse([{ ...hook, state: 'maybe' }]).success).toBe(false);
    }
  });
});

describe('method descriptors', () => {
  it('accepts a valid seat status request and refuses an unknown provider', () => {
    expect(getSeatStatus.params.safeParse({ account: 'work', provider: 'claude' }).success).toBe(true);
    expect(getSeatStatus.params.safeParse({ account: 'work', provider: 'gemini' }).success).toBe(false);
  });
  it('refuses an unknown key in params', () => {
    expect(createAccount.params.safeParse({ name: 'side', admin: true }).success).toBe(false);
  });
  it('parses an account list and refuses a seat with a missing path', () => {
    const account = { name: 'work', displayName: 'side', isPersonal: false, seats: [seat] };
    expect(listAccounts.result.safeParse([account]).success).toBe(true);
    const { path: _path, ...withoutPath } = seat;
    expect(listAccounts.result.safeParse([{ ...account, seats: [withoutPath] }]).success).toBe(false);
  });
  it('takes a login shared by the whole computer, and still the unverified one older machines send', () => {
    for (const loginScope of ['perComputer', 'unverified']) {
      const account = { name: 'work', displayName: 'work', isPersonal: false, seats: [{ ...seat, loginScope }] };
      expect(listAccounts.result.safeParse([account]).success).toBe(true);
    }
    const account = {
      name: 'work',
      displayName: 'work',
      isPersonal: false,
      seats: [{ ...seat, loginScope: 'shared' }],
    };
    expect(listAccounts.result.safeParse([account]).success).toBe(false);
  });
  it('requires a target to add a machine', () => {
    expect(addMachine.params.safeParse({ target: 'bee@devbox' }).success).toBe(true);
    expect(addMachine.params.safeParse({}).success).toBe(false);
  });
  it('accepts a terminal plan request for another machine', () => {
    const params = { machineId: 'devbox', action: 'login', account: 'work', provider: 'codex', args: [] };
    expect(planTerminal.params.safeParse(params).success).toBe(true);
    expect(planTerminal.params.safeParse({ ...params, action: 'delete' }).success).toBe(false);
  });
});

describe('usage', () => {
  const window = { id: 'five_hour', kind: 'session', label: 'Session', usedPercent: 32 };
  const reading = { account: 'work', displayName: 'side', provider: 'claude' };
  const usage = { checkedAt: '2026-11-01T12:00:00.000Z', windows: [window] };

  it('is forwarded to the machine, because the seats live there', () => {
    expect(readLimits.routing).toBe('machine');
  });
  it('takes no parameters, and refuses a stray one', () => {
    expect(readLimits.params.safeParse({}).success).toBe(true);
    expect(readLimits.params.safeParse({ account: 'work' }).success).toBe(false);
  });
  it('parses a reading and refuses a window of an unknown kind', () => {
    expect(readLimits.result.safeParse([{ ...reading, usage }]).success).toBe(true);
    const unknownKind = { ...usage, windows: [{ ...window, kind: 'daily' }] };
    expect(readLimits.result.safeParse([{ ...reading, usage: unknownKind }]).success).toBe(false);
  });
  it('accepts a seat that could not be read, with no bars', () => {
    const failed = { checkedAt: usage.checkedAt, windows: [], unavailable: { reason: 'probeFailed' } };
    expect(readLimits.result.safeParse([{ ...reading, usage: failed }]).success).toBe(true);
  });
});

describe('token usage', () => {
  const row = {
    hour: '2026-11-10T14:00:00.000Z',
    account: 'work',
    provider: 'claude',
    model: 'claude-test-1',
    input: 10,
    cacheRead: 2000,
    cacheWrite: 300,
    output: 40,
    sessions: 1,
  };
  const usage = { readAt: '2026-11-12T12:00:00.000Z', rows: [row], skippedRecords: 0 };

  it('is counted on the machine that holds the logs, and kept and priced on this one', () => {
    expect(readTokenUsage.routing).toBe('machine');
    expect(keepTokenUsage.routing).toBe('hub');
    expect(readKeptTokenUsage.routing).toBe('hub');
    expect(readTokenPrices.routing).toBe('hub');
  });
  it('says whether to read the logs again, and refuses a stray parameter', () => {
    expect(readTokenUsage.params.safeParse({ isFresh: true }).success).toBe(true);
    expect(readTokenUsage.params.safeParse({}).success).toBe(false);
    expect(readTokenUsage.params.safeParse({ isFresh: true, account: 'work' }).success).toBe(false);
  });
  it('parses a record, one never read, and refuses a row that is not counts', () => {
    expect(readTokenUsage.result.safeParse(usage).success).toBe(true);
    expect(readTokenUsage.result.safeParse({ rows: [], skippedRecords: 0 }).success).toBe(true);
    expect(readTokenUsage.result.safeParse({ ...usage, rows: [{ ...row, output: 1.5 }] }).success).toBe(false);
    expect(readTokenUsage.result.safeParse({ ...usage, rows: [{ ...row, text: 'hello' }] }).success).toBe(false);
    expect(keepTokenUsage.params.safeParse({ id: 'devbox', usage }).success).toBe(true);
    expect(keepTokenUsage.params.safeParse({ usage }).success).toBe(false);
  });
  it('asks for the prices of some models, and parses rates or none at all', () => {
    const rate = { input: 0.000003, output: 0.000015, cacheRead: 0.0000003, cacheWrite: 0.00000375 };
    expect(readTokenPrices.params.safeParse({ models: ['claude-test-1'], isFresh: false }).success).toBe(true);
    expect(readTokenPrices.params.safeParse({ models: 'claude-test-1', isFresh: false }).success).toBe(false);
    expect(readTokenPrices.result.safeParse({ source: 'litellm', rates: {} }).success).toBe(true);
    const priced = { source: 'litellm', fetchedAt: usage.readAt, rates: { 'claude-test-1': rate } };
    expect(readTokenPrices.result.safeParse(priced).success).toBe(true);
    expect(readTokenPrices.result.safeParse({ ...priced, rates: { x: { ...rate, input: -1 } } }).success).toBe(false);
  });
});

describe('the usage view', () => {
  it('lives on the computer you are at', () => {
    expect(readUsageView.routing).toBe('hub');
    expect(saveUsageView.routing).toBe('hub');
  });
  it('is one of three pages and one of five periods', () => {
    expect(saveUsageView.params.safeParse({ page: 'cost', period: '24h' }).success).toBe(true);
    expect(saveUsageView.params.safeParse({ page: 'cost', period: '2d' }).success).toBe(false);
    expect(saveUsageView.params.safeParse({ page: 'graphs', period: '7d' }).success).toBe(false);
    expect(readUsageView.result.safeParse({ page: 'limits', period: 'all' }).success).toBe(true);
  });
});

describe('desktop apps', () => {
  it('open on the computer you are at, because that is where the window opens', () => {
    expect(openDesktopApp.routing).toBe('hub');
  });
  it('are listed and read on the machine that holds the seat, so a remote hive shows its app', () => {
    expect(listDesktopApps.routing).toBe('machine');
    expect(getAppLogin.routing).toBe('machine');
  });
  it('accepts an open request and refuses one for an unknown provider', () => {
    const params = { account: 'work', provider: 'claude', canClose: false };
    expect(openDesktopApp.params.safeParse(params).success).toBe(true);
    expect(openDesktopApp.params.safeParse({ ...params, provider: 'gemini' }).success).toBe(false);
  });
  it('requires the caller to say whether the app may be closed', () => {
    expect(openDesktopApp.params.safeParse({ account: 'work', provider: 'claude' }).success).toBe(false);
  });
  it('parses the apps found and refuses one with no label', () => {
    const chatgpt = { provider: 'codex', label: 'ChatGPT', login: 'sharedWithCli', canOpen: true };
    expect(listDesktopApps.result.safeParse([chatgpt]).success).toBe(true);
    const { label: _label, ...unlabeled } = chatgpt;
    expect(listDesktopApps.result.safeParse([unlabeled]).success).toBe(false);
  });
  it('says whether this machine can open the app, which an older favo does not, so it reads as none', () => {
    const claude = { provider: 'claude', label: 'Claude', login: 'separate', canOpen: false };
    const { canOpen: _canOpen, ...older } = claude;
    expect(listDesktopApps.result.safeParse([claude]).success).toBe(true);
    expect(listDesktopApps.result.safeParse([older]).success).toBe(false);
  });
  it('says whether an app signs in on its own', () => {
    const claude = { provider: 'claude', label: 'Claude', login: 'separate', canOpen: true };
    expect(listDesktopApps.result.safeParse([claude]).success).toBe(true);
    expect(listDesktopApps.result.safeParse([{ ...claude, login: 'sometimes' }]).success).toBe(false);
  });
  it('asks for the login of a seat app and parses it', () => {
    expect(getAppLogin.params.safeParse({ account: 'work', provider: 'claude' }).success).toBe(true);
    expect(getAppLogin.params.safeParse({ account: 'work', provider: 'claude', token: 'x' }).success).toBe(false);
    expect(getAppLogin.result.safeParse({ login: 'signedIn', isOtherAccount: true }).success).toBe(true);
    expect(getAppLogin.result.safeParse({ login: 'notInstalled', isOtherAccount: false }).success).toBe(false);
  });
});

describe('the protocol', () => {
  it('is at least 5, the first one whose machines read --argv-b64', () => {
    expect(Protocol).toBeGreaterThanOrEqual(5);
  });
});

describe('errors from the other side', () => {
  it.each(['constructor', '__proto__', 'toString'])('treats the code %s as an internal error', async (code) => {
    const client = createRpcClient({
      send: async ({ id }) => ({ id, ok: false, error: { code, message: 'boom' } }),
    });
    await expect(client.call(listAccounts, {})).rejects.toMatchObject({ code: 'internal', message: 'boom' });
  });
  it('keeps a code it knows', async () => {
    const client = createRpcClient({
      send: async ({ id }) => ({ id, ok: false, error: { code: 'accountExists', message: 'taken' } }),
    });
    await expect(client.call(listAccounts, {})).rejects.toMatchObject({ code: 'accountExists' });
  });
});

describe('themes', () => {
  it('requires a theme id to select one', () => {
    expect(selectTheme.params.safeParse({ id: 'honey' }).success).toBe(true);
    expect(selectTheme.params.safeParse({}).success).toBe(false);
  });
  it('refuses a theme with a bad color', () => {
    const theme = BuiltInThemes[0]!;
    const list = { activeId: 'honey', problems: [] };
    expect(listThemes.result.safeParse({ ...list, themes: [theme] }).success).toBe(true);
    const broken = { ...theme, colors: { ...theme.colors, accent: 'orange' } };
    expect(listThemes.result.safeParse({ ...list, themes: [broken] }).success).toBe(false);
  });
});

describe('envelope', () => {
  it('round-trips a request and both kinds of response through JSON', () => {
    const request = { id: 1, method: 'system.ping', params: {}, machineId: 'devbox' };
    expect(RpcRequest.parse(JSON.parse(JSON.stringify(request)))).toEqual(request);
    expect(RpcResponseSchema.parse({ id: 1, ok: true, result: {} }).ok).toBe(true);
    expect(RpcResponseSchema.safeParse({ id: 1, ok: false }).success).toBe(false);
  });
});

describe('rpc client', () => {
  const pingResult = {
    version: '1',
    protocol: 4,
    hostname: 'h',
    platform: 'linux',
    arch: 'x64',
    home: '/h',
    directory: '/h',
  };

  it('sends the machine in the envelope and parses the result', async () => {
    const seen: unknown[] = [];
    const client = createRpcClient({
      async send(request) {
        seen.push(request.machineId);
        return { id: request.id, ok: true, result: pingResult };
      },
    });
    expect((await client.call(ping, {}, { machineId: 'devbox' })).hostname).toBe('h');
    expect(seen).toEqual(['devbox']);
  });
  it('turns an error response into a domain error with its code', async () => {
    const client = createRpcClient({
      async send(request): Promise<RpcResponse> {
        return { id: request.id, ok: false, error: { code: 'accountExists', message: 'taken' } };
      },
    });
    await expect(client.call(ping, {})).rejects.toMatchObject({ code: 'accountExists', message: 'taken' });
  });
  it('refuses a result that does not work the contract', async () => {
    const client = createRpcClient({
      async send(request): Promise<RpcResponse> {
        return { id: request.id, ok: true, result: { version: 1 } };
      },
    });
    await expect(client.call(ping, {})).rejects.toThrow();
  });
});

describe('updates', () => {
  const step = { command: 'brew', args: ['upgrade'], env: {}, unsetEnv: [] };
  const update = {
    provider: 'claude',
    label: 'Claude Code',
    version: '2.1.316',
    installedWith: 'Homebrew cask claude-code',
    otherCopies: [],
    runningAccounts: ['work'],
    steps: [step],
  };

  it('are listed on the machine that holds the providers', () => {
    expect(listProviderUpdates.routing).toBe('machine');
    expect(listProviderUpdates.params.safeParse({ provider: 'codex' }).success).toBe(true);
    expect(listProviderUpdates.params.safeParse({ provider: 'gemini' }).success).toBe(false);
    expect(listProviderUpdates.result.safeParse([update]).success).toBe(true);
    expect(listProviderUpdates.result.safeParse([{ ...update, steps: 'brew' }]).success).toBe(false);
  });
  it('are planned by the favo you talk to', () => {
    expect(planFavoUpdate.routing).toBe('hub');
    expect(planFavoUpdate.result.safeParse({ version: '0.5.0', upgrade: step, restart: step }).success).toBe(true);
    expect(planFavoUpdate.result.safeParse({ upgrade: step }).success).toBe(false);
    expect(planUpdate.routing).toBe('hub');
    expect(planUpdate.params.safeParse({ machineId: 'devbox' }).success).toBe(true);
    expect(planUpdate.params.safeParse({ machine: 'devbox' }).success).toBe(false);
  });
  it('show the installed version of each provider on the machine that has it', () => {
    const version = { provider: 'claude', label: 'Claude Code', version: '2.1.316', installedWith: 'npm in /usr' };
    const lastUpdate = { state: 'failed', from: '2.1.300', reason: 'exit 1', at: '2026-11-04T12:00:00.000Z' };
    expect(listProviderVersions.routing).toBe('machine');
    expect(listProviderVersions.params.safeParse({}).success).toBe(true);
    expect(listProviderVersions.result.safeParse([version, { ...version, lastUpdate }]).success).toBe(true);
    expect(listProviderVersions.result.safeParse([{ ...version, lastUpdate: { state: 'done' } }]).success).toBe(false);
  });
  it('are recorded by the favo that ran them, never forwarded', () => {
    expect(recordProviderUpdate.routing).toBe('hub');
    const outcome = { state: 'leftAlone', from: '2.1.316', reason: 'it is pinned in Homebrew' };
    expect(recordProviderUpdate.params.safeParse({ provider: 'claude', outcome }).success).toBe(true);
    expect(recordProviderUpdate.params.safeParse({ provider: 'claude' }).success).toBe(true);
    expect(
      recordProviderUpdate.params.safeParse({ provider: 'claude', outcome: { ...outcome, at: 'now' } }).success
    ).toBe(false);
  });
  it('start on the machine whose provider CLIs they update, and answer at once', () => {
    expect(startProviderUpdates.routing).toBe('machine');
    expect(startProviderUpdates.params.safeParse({}).success).toBe(true);
    expect(
      startProviderUpdates.params.safeParse({ providers: ['claude', 'codex'], isRunningIncluded: true }).success
    ).toBe(true);
    expect(startProviderUpdates.params.safeParse({ providers: ['vim'] }).success).toBe(false);
    expect(
      startProviderUpdates.result.safeParse({ started: [{ provider: 'claude', version: '2.1.290' }] }).success
    ).toBe(true);
    expect(startProviderUpdates.result.safeParse({}).success).toBe(false);
  });
  it('refresh hooks on the machine that has them', () => {
    expect(refreshHooks.routing).toBe('machine');
    expect(refreshHooks.params.safeParse({}).success).toBe(true);
    expect(refreshHooks.params.safeParse({ provider: 'claude' }).success).toBe(false);
  });
});
