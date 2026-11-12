import type { DiscoveredMachine } from '@favo/contracts/rpc/machines/discover-machines';
import type { MachineStatus } from '@favo/contracts/rpc/machines/get-machine-status';
import type { ThemeList } from '@favo/contracts/rpc/themes/list-themes';
import type { StartProviderUpdatesParams } from '@favo/contracts/rpc/updates/start-provider-updates';
import type {
  AccountView,
  AppLoginStatus,
  DesktopAppView,
  HookView,
  ProviderVersionView,
  SeatInspection,
  SeatLimitsView,
  SeatStatus,
  SeatView,
  ThreadView,
} from '@favo/contracts/rpc/views';
import type { Machine } from '@favo/domain/machines/machine';
import { ProviderId, ProviderOrder, Providers } from '@favo/domain/providers/provider';
import type { DomainError } from '@favo/domain/shared/domain-error';
import type { TerminalPlan } from '@favo/domain/terminal/terminal-plan';
import { BuiltInThemes } from '@favo/domain/themes/built-in-themes';
import { type Theme, ThemeSource } from '@favo/domain/themes/theme';
import type { TokenPrices } from '@favo/domain/usage/token-prices';
import type { MachineTokenUsage, TokenUsageRow } from '@favo/domain/usage/token-usage';
import { DefaultUsageView, type UsageView } from '@favo/domain/usage/usage-view';

function seatOf(home: string, account: string, provider: ProviderId, overrides: Partial<SeatView> = {}): SeatView {
  const spec = Providers[provider];
  const isPersonal = account === 'personal';
  return {
    account,
    provider,
    label: spec.label,
    path: isPersonal ? `${home}/${spec.personalHome}` : `${home}/.favo/accounts/${account}/${provider}`,
    pathHint: spec.pathHint,
    loginScope: spec.loginScope,
    isInstalled: true,
    isProvisioned: isPersonal,
    canLogout: provider !== ProviderId.antigravity,
    ...overrides,
  };
}

export function accountOf(
  home: string,
  name: string,
  overrides: Partial<Record<ProviderId, Partial<SeatView>>> = {}
): AccountView {
  const seats = ProviderOrder.map((provider) => seatOf(home, name, provider, overrides[provider]));
  return { name, displayName: name, isPersonal: name === 'personal', seats };
}

const MacHome = '/Users/bee';
const DevboxHome = '/home/bee';

function seedMachines(): Machine[] {
  return [
    { id: 'local', name: 'macbook', isLocal: true },
    { id: 'devbox', name: 'devbox', target: 'bee@devbox', isLocal: false },
    { id: 'studio', name: 'studio', target: 'bee@studio', isLocal: false },
  ];
}

function seedMachineStatuses(): Record<string, MachineStatus> {
  return {
    local: { state: 'online', hostname: 'macbook', directory: '/Users/bee/code/hive' },
    devbox: { state: 'online', version: '0.1.0', directory: '/home/bee' },
    studio: { state: 'offline', message: 'studio: Connection timed out' },
  };
}

function seedAccounts(): Record<string, AccountView[]> {
  return {
    local: [
      accountOf(MacHome, 'personal', { antigravity: { isInstalled: false } }),
      accountOf(MacHome, 'work', { antigravity: { isInstalled: false } }),
    ],
    devbox: [accountOf(DevboxHome, 'personal', { antigravity: { loginScope: 'perAccount' } })],
  };
}

function seedSeatStatuses(): Record<string, SeatStatus> {
  return {
    'seat:local/personal/claude': { login: 'signedIn', identity: 'bee@hive.dev', plan: 'max', problems: 0 },
    'seat:local/personal/codex': { login: 'signedIn', identity: 'bee@hive.dev', plan: 'plus', problems: 0 },
    'seat:local/personal/opencode': { login: 'signedIn', identity: '4 logins', problems: 0 },
    'seat:local/work/claude': { login: 'signedIn', identity: 'bee@work.dev', plan: 'team', problems: 1 },
    'seat:local/work/codex': { login: 'signedOut', problems: 0 },
    'seat:local/work/opencode': { login: 'signedOut', problems: 0 },
    'seat:devbox/personal/claude': { login: 'signedIn', identity: 'bee@hive.dev', plan: 'max', problems: 0 },
    'seat:devbox/personal/codex': { login: 'signedIn', identity: 'bee@hive.dev', problems: 0 },
    'seat:devbox/personal/antigravity': { login: 'signedOut', problems: 0 },
    'seat:devbox/personal/opencode': { login: 'signedOut', problems: 0 },
  };
}

function seedSeatLimits(): Record<string, SeatLimitsView[]> {
  const checkedAt = new Date().toISOString();
  const inMinutes = (minutes: number) => new Date(Date.now() + (minutes + 0.5) * 60_000).toISOString();
  const session = (usedPercent: number, minutes: number) => ({
    id: 'five_hour',
    kind: 'session' as const,
    label: 'Session',
    usedPercent,
    windowDurationMins: 300,
    resetsAt: inMinutes(minutes),
  });
  const weekly = (usedPercent: number, minutes: number) => ({
    id: 'seven_day',
    kind: 'weekly' as const,
    label: 'Weekly',
    usedPercent,
    windowDurationMins: 10080,
    resetsAt: inMinutes(minutes),
  });
  const fable = (minutes: number) => ({
    ...weekly(0, minutes),
    id: 'seven_day_fable',
    label: 'Weekly · Fable',
  });
  const personalClaude = {
    account: 'personal',
    displayName: 'personal',
    provider: ProviderId.claude,
    identity: 'bee@hive.dev',
    plan: 'max',
    usage: { checkedAt, windows: [session(32, 44), weekly(25, 3600), fable(3600)] },
  };
  return {
    local: [
      personalClaude,
      {
        account: 'work',
        displayName: 'work',
        provider: ProviderId.claude,
        identity: 'bee@work.dev',
        plan: 'team',
        usage: { checkedAt, windows: [session(7, 54), weekly(65, 2100), fable(2100)] },
      },
      {
        account: 'personal',
        displayName: 'personal',
        provider: ProviderId.codex,
        identity: 'bee@hive.dev',
        plan: 'plus',
        usage: {
          checkedAt,
          windows: [
            { ...session(10, 120), id: 'primary' },
            { ...weekly(75, 4000), id: 'secondary' },
          ],
        },
      },
      {
        account: 'personal',
        displayName: 'personal',
        provider: ProviderId.opencode,
        identity: '4 logins',
        usage: { checkedAt, windows: [], unavailable: { reason: 'unsupported' } },
      },
    ],
    devbox: [personalClaude],
  };
}

const Million = 1_000_000;
const HourMs = 3_600_000;

export function tokenRowOf(
  hoursAgo: number,
  seat: Pick<TokenUsageRow, 'account' | 'provider' | 'model'>,
  millions: [input: number, cacheRead: number, cacheWrite: number, output: number],
  sessions: number
): TokenUsageRow {
  const [input, cacheRead, cacheWrite, output] = millions.map((count) => Math.round(count * Million));
  const hour = new Date(Math.floor(Date.now() / HourMs) * HourMs - hoursAgo * HourMs).toISOString();
  return { hour, ...seat, input: input!, cacheRead: cacheRead!, cacheWrite: cacheWrite!, output: output!, sessions };
}

export const TokenSeats = {
  personalClaude: { account: 'personal', provider: ProviderId.claude, model: 'claude-opus-5-5' },
  workClaude: { account: 'work', provider: ProviderId.claude, model: 'claude-fable-5-2' },
  personalCodex: { account: 'personal', provider: ProviderId.codex, model: 'gpt-6-astra' },
};

function seedTokenUsage(): Record<string, MachineTokenUsage> {
  const readAt = new Date(Date.now() - HourMs).toISOString();
  return {
    local: {
      readAt,
      skippedRecords: 0,
      rows: [
        tokenRowOf(40 * 24, TokenSeats.personalClaude, [1, 390, 6, 3], 1),
        tokenRowOf(50, TokenSeats.personalCodex, [5, 150, 0, 2], 4),
        tokenRowOf(26, TokenSeats.workClaude, [1, 200, 8, 1], 2),
        tokenRowOf(3, TokenSeats.personalClaude, [2, 600, 20, 3], 3),
      ],
    },
    devbox: {
      readAt,
      skippedRecords: 0,
      rows: [tokenRowOf(5 * 24, TokenSeats.personalClaude, [1, 100, 5, 2], 1)],
    },
  };
}

function seedTokenPrices(): TokenPrices {
  return {
    source: 'litellm',
    fetchedAt: new Date(Date.now() - HourMs).toISOString(),
    rates: {
      'claude-opus-5-5': { input: 0.000005, output: 0.000025, cacheRead: 0.0000005, cacheWrite: 0.00000625 },
      'claude-fable-5-2': { input: 0.00001, output: 0.00005, cacheRead: 0.000001, cacheWrite: 0.0000125 },
      'gpt-6-astra': { input: 0.000002, output: 0.00001, cacheRead: 0.0000002, cacheWrite: 0.000002 },
    },
  };
}

function seedProviderVersions(): Record<string, ProviderVersionView[]> {
  const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
  return {
    local: [
      {
        provider: ProviderId.claude,
        label: 'Claude Code',
        version: '2.1.316',
        installedWith: 'Homebrew cask claude-code',
      },
      { provider: ProviderId.codex, label: 'Codex', version: '0.166.0', installedWith: 'Homebrew cask codex' },
      {
        provider: ProviderId.opencode,
        label: 'OpenCode',
        version: '2.2.5',
        installedWith: 'Homebrew formula opencode',
        lastUpdate: { state: 'leftAlone', reason: 'it is pinned in Homebrew', at: hoursAgo(3) },
      },
    ],
    devbox: [
      {
        provider: ProviderId.claude,
        label: 'Claude Code',
        version: '2.1.290',
        installedWith: 'npm in /home/bee/.nvm/versions/node/v24.16.0',
        lastUpdate: { state: 'failed', from: '2.1.290', reason: 'exit 1', at: hoursAgo(26) },
      },
      { provider: ProviderId.codex, label: 'Codex', version: '0.166.0', installedWith: 'npm in /usr/local' },
      {
        provider: ProviderId.antigravity,
        label: 'Antigravity',
        version: '1.4.12',
        installedWith: 'own install at /home/bee/.local/bin/antigravity',
      },
    ],
  };
}

function hookOf(provider: ProviderId, state: HookView['state'], overrides: Partial<HookView> = {}): HookView {
  const { label, hook } = Providers[provider];
  return {
    provider,
    label,
    state,
    isProviderInstalled: true,
    needsTrust: hook.needsTrust === true,
    file: `${MacHome}/${hook.file}`,
    problems: [],
    ...overrides,
  };
}

function seedHooks(): Record<string, HookView[]> {
  return {
    local: [
      hookOf(ProviderId.claude, 'current'),
      hookOf(ProviderId.codex, 'absent'),
      hookOf(ProviderId.antigravity, 'absent', { isProviderInstalled: false }),
      hookOf(ProviderId.opencode, 'current'),
    ],
    devbox: ProviderOrder.map((provider) => hookOf(provider, 'absent')),
  };
}

function seedThreads(): Record<string, ThreadView[]> {
  const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
  const thread = (id: string, minutes: number, overrides: Partial<ThreadView> = {}) => ({
    id,
    directory: '/Users/bee/code/hive',
    updatedAt: minutesAgo(minutes),
    isGuess: false,
    isDirectoryGone: false,
    ...overrides,
  });
  return {
    'seat:local/personal/claude': [
      thread('11111111-2222-4333-8444-5555aaaa0001', 12),
      thread('11111111-2222-4333-8444-5555aaaa0002', 180),
      thread('11111111-2222-4333-8444-5555aaaa0003', 2880, { directory: '/Users/bee/old', isDirectoryGone: true }),
    ],
    'seat:local/work/claude': [thread('22222222-2222-4333-8444-5555bbbb0001', 44)],
    'seat:local/personal/opencode': [thread('ses_cccc0001', 30, { isGuess: true })],
  };
}

function seedInspection(): SeatInspection {
  return {
    items: [
      { name: 'CLAUDE.md', state: 'linked' },
      { name: 'settings.json', state: 'linked' },
      { name: 'skills', state: 'linked' },
      { name: 'commands', state: 'notInBase' },
      { name: 'hooks', state: 'conflict' },
    ],
    privateItems: ['.claude.json', 'projects', 'sessions'],
    unclassified: [],
    mirrored: 0,
  };
}

function seedThemeList(): ThemeList {
  const custom: Theme = {
    ...BuiltInThemes[0]!,
    id: 'midnight',
    name: 'Midnight',
    source: ThemeSource.custom,
    colors: { ...BuiltInThemes[0]!.colors, accent: '#7788FF' },
  };
  return { activeId: 'honey', themes: [...BuiltInThemes, custom], problems: [] };
}

function seedDirectoryTrees(): Record<string, Record<string, string[]>> {
  const manyFolders = Array.from({ length: 14 }, (_, index) => `project-${String(index).padStart(2, '0')}`);
  return {
    local: {
      '/Users/bee': ['Desktop', 'Developer', 'Documents', 'Downloads', 'code'],
      '/Users/bee/Desktop': [],
      '/Users/bee/Developer': [],
      '/Users/bee/Documents': ['notes', 'projects'],
      '/Users/bee/Documents/notes': [],
      '/Users/bee/Documents/projects': [],
      '/Users/bee/Downloads': [],
      '/Users/bee/code': ['hive', ...manyFolders],
      '/Users/bee/code/hive': ['apps', 'packages'],
      ...Object.fromEntries(manyFolders.map((name) => [`/Users/bee/code/${name}`, []])),
    },
    devbox: {
      '/home/bee': ['srv', 'projects'],
      '/home/bee/srv': [],
      '/home/bee/projects': [],
    },
  };
}

function seedDesktopApps(): Record<string, DesktopAppView[]> {
  return { local: [{ provider: ProviderId.claude, label: 'Claude', login: 'separate', canOpen: true }] };
}

function seedDiscovered(): DiscoveredMachine[] {
  return [
    { name: 'pi', target: 'pi', source: 'tailscale', isOnline: true },
    { name: 'buildbox', target: 'buildbox', source: 'sshConfig' },
  ];
}

export const mockDb = {
  machines: seedMachines(),
  machineStatuses: seedMachineStatuses(),
  accounts: seedAccounts(),
  seatStatuses: seedSeatStatuses(),
  seatLimits: seedSeatLimits(),
  limitFailures: {} as Record<string, Error>,
  limitReads: [] as string[],
  limitsHold: undefined as Promise<void> | undefined,
  tokenUsage: seedTokenUsage(),
  keptTokenUsage: {} as Record<string, MachineTokenUsage>,
  tokenFailures: {} as Record<string, Error>,
  tokenReads: [] as string[],
  tokenHold: undefined as Promise<void> | undefined,
  tokenKeepFailure: undefined as Error | undefined,
  priceHold: undefined as Promise<void> | undefined,
  tokenPrices: seedTokenPrices(),
  priceReads: [] as string[],
  usageView: DefaultUsageView as UsageView,
  providerVersions: seedProviderVersions(),
  providerVersionFailures: {} as Record<string, Error>,
  providerVersionReads: [] as string[],
  providerVersionHold: undefined as Promise<void> | undefined,
  providerUpdateStarts: [] as ({ machineId: string } & StartProviderUpdatesParams)[],
  providerUpdateFailures: {} as Record<string, Error>,
  providerUpdateOutcomes: {} as Record<string, Record<string, Partial<ProviderVersionView>>>,
  threads: seedThreads(),
  hooks: seedHooks(),
  threadFailures: {} as Record<string, Error>,
  inspection: seedInspection(),
  themeList: seedThemeList(),
  directoryTrees: seedDirectoryTrees(),
  discovered: seedDiscovered(),
  desktopApps: seedDesktopApps(),
  desktopAppFailures: {} as Record<string, Error>,
  runningDesktopApps: [] as ProviderId[],
  desktopOpenings: [] as string[],
  desktopFailure: undefined as DomainError | undefined,
  appLogins: {} as Record<string, AppLoginStatus>,
  appLoginReads: [] as string[],
  unreachableTargets: ['down@host'],
  clipboard: [] as string[],
  terminalRuns: [] as TerminalPlan[],
  terminalExitCode: 0,
  provisioned: [] as string[],
  repaired: [] as string[],
  repairedLinks: 0,
  installed: [] as string[],
  installFailures: {} as Record<string, Error>,
  reset() {
    this.machines = seedMachines();
    this.machineStatuses = seedMachineStatuses();
    this.accounts = seedAccounts();
    this.seatStatuses = seedSeatStatuses();
    this.seatLimits = seedSeatLimits();
    this.limitFailures = {};
    this.limitReads = [];
    this.limitsHold = undefined;
    this.tokenUsage = seedTokenUsage();
    this.keptTokenUsage = {};
    this.tokenFailures = {};
    this.tokenReads = [];
    this.tokenHold = undefined;
    this.tokenKeepFailure = undefined;
    this.priceHold = undefined;
    this.tokenPrices = seedTokenPrices();
    this.priceReads = [];
    this.usageView = DefaultUsageView;
    this.providerVersions = seedProviderVersions();
    this.providerVersionFailures = {};
    this.providerVersionReads = [];
    this.providerVersionHold = undefined;
    this.providerUpdateStarts = [];
    this.providerUpdateFailures = {};
    this.providerUpdateOutcomes = {};
    this.threads = seedThreads();
    this.hooks = seedHooks();
    this.threadFailures = {};
    this.inspection = seedInspection();
    this.themeList = seedThemeList();
    this.directoryTrees = seedDirectoryTrees();
    this.discovered = seedDiscovered();
    this.desktopApps = seedDesktopApps();
    this.desktopAppFailures = {};
    this.runningDesktopApps = [];
    this.desktopOpenings = [];
    this.desktopFailure = undefined;
    this.appLogins = {};
    this.appLoginReads = [];
    this.unreachableTargets = ['down@host'];
    this.clipboard = [];
    this.terminalRuns = [];
    this.terminalExitCode = 0;
    this.provisioned = [];
    this.repaired = [];
    this.repairedLinks = 0;
    this.installed = [];
    this.installFailures = {};
  },
};
