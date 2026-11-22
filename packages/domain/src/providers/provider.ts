import { DomainError, DomainErrorCode } from '#domain/shared/domain-error';
import type { ValueOf } from '#domain/shared/value-of';
import { InstallMethod, type InstallSource } from '#domain/updates/install-source';

export const ProviderId = {
  claude: 'claude',
  codex: 'codex',
  antigravity: 'antigravity',
  opencode: 'opencode',
} as const;
export type ProviderId = ValueOf<typeof ProviderId>;

export const ProviderHomeKind = {
  variable: 'variable',
  privateHome: 'privateHome',
  xdg: 'xdg',
} as const;
export type ProviderHomeKind = ValueOf<typeof ProviderHomeKind>;

export const LoginScope = {
  perAccount: 'perAccount',
  perComputer: 'perComputer',
  unverified: 'unverified',
} as const;
export type LoginScope = ValueOf<typeof LoginScope>;

export const HookKind = {
  eventGroups: 'eventGroups',
  namedBlock: 'namedBlock',
  plugin: 'plugin',
} as const;
export type HookKind = ValueOf<typeof HookKind>;

export type ProviderHook = {
  kind: HookKind;
  file: string;
  sharedItem?: string;
  event?: string;
  matcher?: string;
  needsTrust?: boolean;
};

export type ProviderUpdateSpec = {
  packages: string[];
  arguments?: string[];
  refusedOn?: InstallMethod[];
  switches?: string[];
};

export type ProviderSpec = {
  id: ProviderId;
  label: string;
  executable: string;
  aliases: string[];
  homeKind: ProviderHomeKind;
  homeVariable?: string;
  seatVariables?: Record<string, string>;
  personalHome: string;
  shared: string[];
  private: string[];
  mirrorsHome: boolean;
  loginScope: LoginScope;
  pathHint: string;
  resumeArguments: string[];
  hook: ProviderHook;
  update: ProviderUpdateSpec;
  herdrAgent?: string;
};

export const Providers: Record<ProviderId, ProviderSpec> = {
  claude: {
    id: ProviderId.claude,
    label: 'Claude Code',
    executable: 'claude',
    aliases: ['claude'],
    homeKind: ProviderHomeKind.variable,
    homeVariable: 'CLAUDE_CONFIG_DIR',
    personalHome: '.claude',
    shared: [
      'CLAUDE.md',
      'settings.json',
      'keybindings.json',
      'statusline-command.sh',
      'skills',
      'agents',
      'agent-memory',
      'commands',
      'hooks',
      'plugins',
      'output-styles',
    ],
    private: ['.claude.json', 'projects', 'sessions', 'history.jsonl', 'file-history', 'session-env', 'todos'],
    mirrorsHome: false,
    loginScope: LoginScope.perAccount,
    pathHint: 'CLAUDE_CONFIG_DIR path',
    resumeArguments: ['--resume'],
    hook: {
      kind: HookKind.eventGroups,
      file: '.claude/settings.json',
      sharedItem: 'settings.json',
      event: 'SessionStart',
      matcher: '^(startup|resume|clear|compact|fork)$',
    },
    update: {
      packages: ['@anthropic-ai/claude-code', 'claude-code', 'claude-code@latest'],
      arguments: ['update'],
      refusedOn: [InstallMethod.homebrew],
      switches: ['DISABLE_UPDATES', 'DISABLE_AUTOUPDATER'],
    },
    herdrAgent: 'claude',
  },
  codex: {
    id: ProviderId.codex,
    label: 'Codex',
    executable: 'codex',
    aliases: ['codex'],
    homeKind: ProviderHomeKind.variable,
    homeVariable: 'CODEX_HOME',
    personalHome: '.codex',
    shared: ['AGENTS.md', 'config.toml', 'hooks.json', 'instructions.md', 'skills', 'agents', 'rules', 'prompts'],
    private: ['auth.json', 'sessions', 'archived_sessions', 'history.jsonl', 'memories', 'plugins'],
    mirrorsHome: false,
    loginScope: LoginScope.perAccount,
    pathHint: 'CODEX_HOME path',
    resumeArguments: ['resume'],
    hook: {
      kind: HookKind.eventGroups,
      file: '.codex/hooks.json',
      sharedItem: 'hooks.json',
      event: 'SessionStart',
      needsTrust: true,
    },
    update: { packages: ['@openai/codex', 'codex'], arguments: ['update'] },
    herdrAgent: 'codex',
  },
  antigravity: {
    id: ProviderId.antigravity,
    label: 'Antigravity',
    executable: 'agy',
    aliases: ['antigravity', 'agy'],
    homeKind: ProviderHomeKind.privateHome,
    seatVariables: { WSL_INTEROP: 'favo' },
    personalHome: '.gemini/antigravity-cli',
    shared: [
      '.gemini/GEMINI.md',
      '.gemini/config',
      '.gemini/antigravity-cli/skills',
      '.gemini/antigravity-cli/plugins',
    ],
    private: [
      '.gemini/antigravity-cli/conversations',
      '.gemini/antigravity-cli/brain',
      '.gemini/antigravity-cli/settings.json',
      '.gemini/antigravity-cli/keybindings.json',
    ],
    mirrorsHome: true,
    loginScope: LoginScope.perAccount,
    pathHint: 'HOME for agy',
    resumeArguments: ['--conversation'],
    hook: {
      kind: HookKind.namedBlock,
      file: '.gemini/config/hooks.json',
      sharedItem: '.gemini/config',
      event: 'PreInvocation',
    },
    update: {
      packages: ['antigravity-cli'],
      arguments: ['update'],
      refusedOn: [InstallMethod.homebrew],
      switches: ['AGY_CLI_DISABLE_AUTO_UPDATE'],
    },
  },
  opencode: {
    id: ProviderId.opencode,
    label: 'OpenCode',
    executable: 'opencode',
    aliases: ['opencode'],
    homeKind: ProviderHomeKind.xdg,
    personalHome: '.local/share/opencode',
    shared: [],
    private: ['auth.json', 'opencode.db', 'storage', 'snapshot'],
    mirrorsHome: false,
    loginScope: LoginScope.perAccount,
    pathHint: 'XDG_DATA_HOME for opencode',
    resumeArguments: ['--session'],
    hook: { kind: HookKind.plugin, file: 'opencode/plugins/favo-threads.js' },
    update: {
      packages: [
        'opencode-ai',
        '@opencode-ai/cli',
        '@opencode-ai/cli-node',
        'opencode',
        'opencode-beta',
        'opencode-v2',
      ],
      arguments: ['upgrade'],
      switches: ['OPENCODE_DISABLE_AUTOUPDATE'],
    },
  },
};

export const UpdateVariables = [
  ...Object.values(Providers).flatMap(({ update }) => update.switches ?? []),
  Providers.claude.homeVariable!,
];

export const ProviderOrder: ProviderId[] = [
  ProviderId.claude,
  ProviderId.codex,
  ProviderId.antigravity,
  ProviderId.opencode,
];

export function findProvider(name: string) {
  return ProviderOrder.map((id) => Providers[id]).find((spec) => spec.aliases.includes(name));
}

export function requireProvider(name: string) {
  const spec = findProvider(name);
  if (!spec) {
    throw new DomainError(
      DomainErrorCode.unknownProvider,
      `Unknown provider "${name}". Use claude, codex, antigravity or opencode.`
    );
  }
  return spec;
}

export function canUpdateItself({ update }: ProviderSpec, source?: InstallSource) {
  if (!update.arguments) return false;
  return source === undefined || !update.refusedOn?.includes(source.method);
}

export function isolationEnvironment(
  spec: ProviderSpec,
  seatHome: string,
  inherited: Record<string, string | undefined> = {}
): Record<string, string> {
  const seatVariables = Object.fromEntries(
    Object.entries(spec.seatVariables ?? {}).map(([name, value]) => [name, inherited[name] ?? value])
  );
  if (spec.homeKind === ProviderHomeKind.variable) return { [spec.homeVariable!]: seatHome, ...seatVariables };
  if (spec.homeKind === ProviderHomeKind.privateHome) {
    return { HOME: seatHome, USERPROFILE: seatHome, ...seatVariables };
  }
  return { XDG_DATA_HOME: seatHome, XDG_STATE_HOME: `${seatHome}/state`, ...seatVariables };
}
