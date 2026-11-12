import { ProviderId } from '@favo/domain/providers/provider';
import { BuiltInThemes } from '@favo/domain/themes/built-in-themes';
import { accountOf, mockDb, tokenRowOf } from '@/__tests__/db';

const MacHome = '/Users/bee';
const RemoteHome = '/home/bee';
const NotInstalled = { isInstalled: false };
const OlderFavo = { state: 'online', version: '0.2.0', isBehind: true, directory: RemoteHome } as const;

export const Key = { up: '\u001b[A', down: '\u001b[B', right: '\u001b[C', left: '\u001b[D', tab: '\t', enter: '\r' };

type TypeCounts = [input: number, cacheRead: number, cacheWrite: number, output: number];

const Million = 1_000_000;
const TotalTokens = 12_400 * Million;
const DayShape = [1, 2, 1, 3, 2, 1, 1, 4, 3, 2, 5, 3, 1, 1, 2, 6, 8, 5, 3, 2, 1, 3, 4, 2, 1, 2, 5, 3, 2, 4];
const ShapeTotal = DayShape.reduce((total, level) => total + level, 0);
const TypeMix = [0.01, 0.96, 0.025, 0.005];
const TokenMix = [
  { seat: { account: 'work', provider: ProviderId.claude, model: 'claude-opus-5-5' }, share: 0.34, sessions: 130 },
  { seat: { account: 'work', provider: ProviderId.claude, model: 'claude-fable-5-2' }, share: 0.06, sessions: 30 },
  { seat: { account: 'work', provider: ProviderId.codex, model: 'gpt-6-astra' }, share: 0.1, sessions: 46 },
  { seat: { account: 'personal', provider: ProviderId.claude, model: 'claude-opus-5-5' }, share: 0.2, sessions: 86 },
  { seat: { account: 'personal', provider: ProviderId.codex, model: 'gpt-6-astra' }, share: 0.15, sessions: 60 },
  { seat: { account: 'client', provider: ProviderId.claude, model: 'claude-opus-5-5' }, share: 0.1, sessions: 40 },
  { seat: { account: 'client', provider: ProviderId.claude, model: 'claude-fable-5-2' }, share: 0.05, sessions: 20 },
];

export type Scene = {
  themeId: string;
  previewThemeId?: string;
  keys: string[];
  stage?(): void;
};

export const Scenes: Record<string, Scene> = {
  'favo-honey': {
    themeId: 'honey',
    keys: [],
  },
  'favo-wax': {
    themeId: 'wax',
    keys: [],
  },
  'favo-remote': {
    themeId: 'honey',
    keys: [Key.tab, 'd', ...'code/', Key.down],
  },
  'favo-themes': {
    themeId: 'honey',
    previewThemeId: 'tokyo-night',
    keys: ['t', ...Array<string>(11).fill(Key.down)],
  },
  'favo-desktop': {
    themeId: 'honey',
    keys: [Key.right, 'p'],
    stage() {
      mockDb.runningDesktopApps = [ProviderId.claude];
    },
  },
  'favo-usage-limits': {
    themeId: 'honey',
    keys: ['u'],
    stage: stageUsage,
  },
  'favo-usage-tokens': {
    themeId: 'honey',
    keys: ['u', 't'],
    stage: stageUsage,
  },
  'favo-usage-cost': {
    themeId: 'honey',
    keys: ['u', 'c'],
    stage: stageUsage,
  },
  'favo-usage-filters': {
    themeId: 'honey',
    keys: ['u', 't', 'f', Key.down, Key.down, ' ', ...Array<string>(4).fill(Key.down), ' '],
    stage: stageUsage,
  },
  'favo-threads': {
    themeId: 'honey',
    keys: ['b'],
    stage: stageThreads,
  },
  'favo-update': {
    themeId: 'honey',
    keys: [Key.tab],
    stage() {
      mockDb.machineStatuses.devbox = OlderFavo;
      mockDb.machineStatuses.studio = OlderFavo;
      mockDb.desktopApps.studio = [];
    },
  },
};

function stageHive() {
  mockDb.machines = [
    { id: 'local', name: 'macbook', isLocal: true },
    { id: 'devbox', name: 'devbox', target: 'bee@devbox', isLocal: false },
    { id: 'studio', name: 'studio', target: 'bee@studio', isLocal: false },
    { id: 'pi', name: 'pi', target: 'bee@pi', isLocal: false },
  ];
  mockDb.machineStatuses = {
    local: { state: 'online', hostname: 'macbook', directory: `${MacHome}/code/hive` },
    devbox: { state: 'online', directory: RemoteHome },
    studio: { state: 'online', directory: RemoteHome },
    pi: { state: 'offline' },
  };
  mockDb.accounts = {
    local: [
      accountOf(MacHome, 'personal'),
      accountOf(MacHome, 'work', { antigravity: NotInstalled }),
      accountOf(MacHome, 'client', { antigravity: NotInstalled, opencode: NotInstalled }),
    ],
    devbox: [
      accountOf(RemoteHome, 'personal', { antigravity: NotInstalled }),
      accountOf(RemoteHome, 'work', { antigravity: NotInstalled, opencode: NotInstalled }),
    ],
    studio: [accountOf(RemoteHome, 'personal', { codex: NotInstalled, opencode: NotInstalled })],
  };
  mockDb.seatStatuses = {
    'seat:local/personal/claude': { login: 'signedIn', identity: 'bee@hive.dev', plan: 'max', problems: 0 },
    'seat:local/personal/codex': { login: 'signedIn', identity: 'bee@hive.dev', plan: 'plus', problems: 0 },
    'seat:local/personal/antigravity': { login: 'signedIn', identity: 'bee@hive.dev', problems: 0 },
    'seat:local/personal/opencode': { login: 'signedIn', identity: '4 logins', problems: 0 },
    'seat:local/work/claude': { login: 'signedIn', identity: 'bee@acme.dev', plan: 'team', problems: 0 },
    'seat:local/work/codex': { login: 'signedIn', identity: 'bee@acme.dev', plan: 'team', problems: 0 },
    'seat:local/client/claude': { login: 'signedIn', identity: 'bee@orchard.co', plan: 'pro', problems: 0 },
    'seat:devbox/personal/claude': { login: 'signedIn', identity: 'bee@hive.dev', plan: 'max', problems: 0 },
    'seat:devbox/personal/codex': { login: 'signedIn', identity: 'bee@hive.dev', plan: 'plus', problems: 0 },
    'seat:devbox/personal/opencode': { login: 'signedIn', identity: '2 logins', problems: 0 },
    'seat:devbox/work/claude': { login: 'signedIn', identity: 'bee@acme.dev', plan: 'team', problems: 0 },
    'seat:studio/personal/claude': { login: 'signedIn', identity: 'bee@hive.dev', plan: 'max', problems: 0 },
  };
  mockDb.directoryTrees.devbox = {
    [RemoteHome]: ['code'],
    [`${RemoteHome}/code`]: ['api', 'hive', 'infra', 'mobile', 'web'],
    ...Object.fromEntries(
      ['api', 'hive', 'infra', 'mobile', 'web'].map((name) => [`${RemoteHome}/code/${name}`, [] as string[]])
    ),
  };
  mockDb.desktopApps = {
    local: [
      { provider: ProviderId.claude, label: 'Claude', login: 'separate', canOpen: true },
      { provider: ProviderId.codex, label: 'ChatGPT', login: 'sharedWithCli', canOpen: true },
    ],
    studio: [{ provider: ProviderId.claude, label: 'Claude', login: 'separate', canOpen: false }],
  };
  mockDb.appLogins = {
    'seat:local/personal/claude': { login: 'signedIn', isOtherAccount: false },
    'seat:local/work/claude': { login: 'signedIn', isOtherAccount: false },
    'seat:studio/personal/claude': { login: 'signedIn', isOtherAccount: false },
  };
}

function stageThreads() {
  const thread = (id: string, minutes: number, folder: string) => ({
    id,
    directory: `${MacHome}/code/${folder}`,
    updatedAt: new Date(Date.now() - minutes * 60_000).toISOString(),
    isGuess: false,
    isDirectoryGone: false,
  });
  mockDb.threads['seat:local/personal/claude'] = [
    thread('b7e4c1a0-3f62-4d18-9a55-1c0e7d2f4a86', 12, 'hive'),
    thread('5d20f9be-81c7-4e3a-b6f4-72a9c3e1d05f', 180, 'hive'),
    thread('e1c37a94-6b0d-42f5-8c19-d4f86b2a7e31', 1560, 'web'),
    thread('29fa6d13-c4e8-4b70-a3d2-0b97e5c8f164', 4380, 'api'),
  ];
}

function stageUsage() {
  const [personal, work, codex, opencode] = mockDb.seatLimits.local!;
  const inMinutes = (minutes: number) => new Date(Date.now() + (minutes + 0.5) * 60_000).toISOString();
  const session = { ...personal!.usage.windows[0]!, usedPercent: 12, resetsAt: inMinutes(272) };
  const week = { ...personal!.usage.windows[1]!, usedPercent: 45, resetsAt: inMinutes(3480) };
  const client = {
    ...work!,
    account: 'client',
    displayName: 'client',
    identity: 'bee@orchard.co',
    plan: 'pro',
    usage: { ...work!.usage, windows: [session, week] },
  };
  mockDb.seatLimits = {
    local: [personal!, work!, client, codex!, opencode!],
    devbox: [personal!],
    studio: [personal!],
  };
  stageTokens();
}

function stageTokens() {
  const rowsOf = (share: number) =>
    DayShape.flatMap((level, index) => {
      const daysAgo = DayShape.length - 1 - index;
      const tokens = (TotalTokens * share * level) / ShapeTotal;
      const before = DayShape.slice(0, index).reduce((total, each) => total + each, 0);
      return TokenMix.map(({ seat, share: seatShare, sessions }) => {
        const counted = (levels: number) => Math.round((sessions * share * levels) / ShapeTotal);
        const types = TypeMix.map((type) => (tokens * seatShare * type) / Million) as TypeCounts;
        return tokenRowOf(daysAgo * 24, seat, types, counted(before + level) - counted(before));
      });
    });
  const readAt = new Date().toISOString();
  mockDb.tokenUsage = {
    local: { readAt, skippedRecords: 0, rows: rowsOf(0.6) },
    devbox: { readAt, skippedRecords: 0, rows: rowsOf(0.3) },
    studio: { readAt, skippedRecords: 0, rows: rowsOf(0.1) },
  };
  mockDb.keptTokenUsage = {
    pi: { readAt: new Date(Date.now() - 3 * 24 * 3_600_000).toISOString(), skippedRecords: 0, rows: [] },
  };
  mockDb.tokenPrices = {
    source: 'litellm',
    fetchedAt: readAt,
    rates: {
      'claude-opus-5-5': { input: 0.000002, output: 0.00001, cacheRead: 0.0000002, cacheWrite: 0.0000025 },
      'claude-fable-5-2': { input: 0.000005, output: 0.000025, cacheRead: 0.0000005, cacheWrite: 0.00000625 },
      'gpt-6-astra': { input: 0.000004, output: 0.00002, cacheRead: 0.0000004, cacheWrite: 0.000004 },
    },
  };
}

export function stageScene(name: string) {
  const scene = Scenes[name];
  if (!scene) throw new Error(`No scene called ${name}. Scenes: ${Object.keys(Scenes).join(', ')}`);
  stageHive();
  scene.stage?.();
  mockDb.themeList = { ...mockDb.themeList, activeId: scene.themeId };
  return scene;
}

export function windowColorsOf(scene: Scene) {
  const id = scene.previewThemeId ?? scene.themeId;
  const theme = BuiltInThemes.find((candidate) => candidate.id === id);
  if (!theme) throw new Error(`No built-in theme called ${id}.`);
  return theme.colors;
}
