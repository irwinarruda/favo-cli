import { PersonalAccount } from '@favo/domain/accounts/account';
import { LocalMachineId } from '@favo/domain/machines/machine';
import { findProvider, type ProviderId } from '@favo/domain/providers/provider';
import { assertDomain, DomainError, DomainErrorCode } from '@favo/domain/shared/domain-error';
import type { ValueOf } from '@favo/domain/shared/value-of';
import {
  decodeArguments,
  EncodedArgumentsFlag,
  FavoOnlyFlag,
  HoldFlag,
  hasProvidersIn,
  ProviderFlag,
  ProvidersFlag,
  SkipFavoFlag,
  UpdateRunningFlag,
} from '@favo/domain/terminal/terminal-plan';
import { UsagePage } from '@favo/domain/usage/usage-view';

const MaximumDays = 3650;

export const CommandKind = {
  tui: 'tui',
  help: 'help',
  version: 'version',
  serve: 'serve',
  launch: 'launch',
  login: 'login',
  logout: 'logout',
  resume: 'resume',
  threads: 'threads',
  list: 'list',
  usage: 'usage',
  add: 'add',
  rename: 'rename',
  remove: 'remove',
  adopt: 'adopt',
  path: 'path',
  app: 'app',
  sync: 'sync',
  inspect: 'inspect',
  theme: 'theme',
  update: 'update',
  hooksStatus: 'hooksStatus',
  hooksInstall: 'hooksInstall',
  hooksUninstall: 'hooksUninstall',
  machineList: 'machineList',
  machineAdd: 'machineAdd',
  machineRemove: 'machineRemove',
  machineInstall: 'machineInstall',
  machineUpdate: 'machineUpdate',
  machineDiscover: 'machineDiscover',
} as const;
export type CommandKind = ValueOf<typeof CommandKind>;

export type Command = {
  kind: CommandKind;
  machineId?: string;
  isJson: boolean;
  account?: string;
  provider?: ProviderId;
  args: string[];
  from?: string;
  target?: string;
  name?: string;
  directory?: string;
  canClose?: boolean;
  isFavoSkipped?: boolean;
  hasProviders?: boolean;
  isHeld?: boolean;
  providers?: ProviderId[];
  isRunningIncluded?: boolean;
  usagePage?: UsagePage;
  days?: number;
  isAllTime?: boolean;
  machines?: string[];
  accounts?: string[];
};

export function parseCommand(rawArgv: string[]): Command {
  const { words, flags, passthrough } = readArguments(decodedArgv(rawArgv));
  const base = { isJson: flags.isJson, machineId: flags.machine, directory: flags.directory, args: passthrough };
  const [first, second, third, fourth] = words;
  if (flags.isVersion) return { ...base, kind: CommandKind.version };
  if (flags.isHelp || first === 'help') return { ...base, kind: CommandKind.help };
  if (first === undefined) return { ...base, kind: CommandKind.tui };
  const provider = findProvider(first);
  if (provider) return { ...base, kind: CommandKind.launch, provider: provider.id, account: second ?? PersonalAccount };
  switch (first) {
    case 'serve':
      return { ...base, kind: CommandKind.serve };
    case 'list':
    case 'ls':
      return { ...base, kind: CommandKind.list };
    case 'usage':
      return {
        ...base,
        kind: CommandKind.usage,
        ...usageOf(flags),
        machines: flags.machines,
        accounts: flags.accounts,
        providers: flags.providers,
      };
    case 'add':
      return { ...base, kind: CommandKind.add, account: required(second, 'favo add <account>') };
    case 'rename':
      return {
        ...base,
        kind: CommandKind.rename,
        account: required(second, 'favo rename <account> <new name>'),
        name: required(third, 'favo rename <account> <new name>'),
      };
    case 'rm':
    case 'remove':
      return { ...base, kind: CommandKind.remove, account: required(second, 'favo rm <account>') };
    case 'login':
      return { ...base, kind: CommandKind.login, ...seatOf(second, third, 'favo login <provider> <account>') };
    case 'logout':
      return { ...base, kind: CommandKind.logout, ...seatOf(second, third, 'favo logout <provider> <account>') };
    case 'resume':
      return {
        ...base,
        kind: CommandKind.resume,
        target: fourth,
        ...seatOf(second, third, 'favo resume <provider> <account> [thread]'),
      };
    case 'threads':
      return { ...base, kind: CommandKind.threads, ...seatOf(second, third, 'favo threads <provider> <account>') };
    case 'hooks':
      return parseHooks(base, second);
    case 'path':
      return { ...base, kind: CommandKind.path, ...seatOf(second, third, 'favo path <provider> <account>') };
    case 'app':
      assertDomain(
        flags.machine === undefined || flags.machine === LocalMachineId,
        DomainErrorCode.invalidParams,
        'favo app opens a window on this computer, so it takes no --machine.'
      );
      return {
        ...base,
        kind: CommandKind.app,
        canClose: flags.canClose,
        ...seatOf(second, third, 'favo app <provider> <account> [--close]'),
      };
    case 'inspect':
      return { ...base, kind: CommandKind.inspect, ...seatOf(second, third, 'favo inspect <provider> <account>') };
    case 'adopt':
      return {
        ...base,
        kind: CommandKind.adopt,
        ...seatOf(second, third, 'favo adopt <provider> <account> <folder>'),
        from: required(fourth, 'favo adopt <provider> <account> <folder>'),
      };
    case 'sync':
      return { ...base, kind: CommandKind.sync, account: second };
    case 'theme':
      return { ...base, kind: CommandKind.theme, target: second };
    case 'update':
      assertDomain(
        second === undefined,
        DomainErrorCode.invalidParams,
        'favo update takes no name. For one machine: favo update --machine <machine>'
      );
      return {
        ...base,
        kind: CommandKind.update,
        isFavoSkipped: flags.isFavoSkipped,
        hasProviders: hasProvidersIn(flags),
        isHeld: flags.isHeld,
        providers: flags.providers.length > 0 ? flags.providers : undefined,
        isRunningIncluded: flags.isRunningIncluded,
      };
    case 'machine':
      return parseMachine(base, flags.name, second, third);
    default:
      throw new DomainError(DomainErrorCode.invalidParams, `Unknown command "${first}". Try: favo --help`);
  }
}

function usageOf(flags: { pages: UsagePage[]; days?: string; isAllTime: boolean }) {
  const { pages, isAllTime } = flags;
  assertDomain(pages.length <= 1, DomainErrorCode.invalidParams, 'Pick one of --limits, --tokens and --cost.');
  const usagePage = pages[0] ?? UsagePage.limits;
  const hasPeriod = flags.days !== undefined || isAllTime;
  assertDomain(
    usagePage !== UsagePage.limits || !hasPeriod,
    DomainErrorCode.invalidParams,
    'Limits have no period. --days and --all go with --tokens or --cost.'
  );
  assertDomain(flags.days === undefined || !isAllTime, DomainErrorCode.invalidParams, 'Pick one of --days and --all.');
  const days = flags.days === undefined ? undefined : Number(flags.days);
  assertDomain(
    days === undefined || (Number.isInteger(days) && days > 0 && days <= MaximumDays),
    DomainErrorCode.invalidParams,
    'Usage: --days <a number of days>, such as --days 7'
  );
  return { usagePage, days, isAllTime };
}

function decodedArgv(argv: string[]) {
  if (argv[0] !== EncodedArgumentsFlag) return argv;
  assertDomain(argv.length === 2, DomainErrorCode.invalidParams, `Usage: favo ${EncodedArgumentsFlag} <base64url>`);
  return decodeArguments(argv[1]!);
}

function parseHooks(base: Omit<Command, 'kind'>, action?: string): Command {
  switch (action) {
    case undefined:
    case 'status':
      return { ...base, kind: CommandKind.hooksStatus };
    case 'install':
      return { ...base, kind: CommandKind.hooksInstall };
    case 'uninstall':
      return { ...base, kind: CommandKind.hooksUninstall };
    default:
      throw new DomainError(DomainErrorCode.invalidParams, `Unknown hooks command "${action}".`);
  }
}

function parseMachine(base: Omit<Command, 'kind'>, name: string | undefined, action?: string, value?: string): Command {
  switch (action) {
    case undefined:
    case 'list':
      return { ...base, kind: CommandKind.machineList };
    case 'add':
      return { ...base, kind: CommandKind.machineAdd, name, target: required(value, 'favo machine add <user@host>') };
    case 'rm':
    case 'remove':
      return { ...base, kind: CommandKind.machineRemove, target: required(value, 'favo machine rm <machine>') };
    case 'install':
      return { ...base, kind: CommandKind.machineInstall, target: required(value, 'favo machine install <machine>') };
    case 'update':
      return { ...base, kind: CommandKind.machineUpdate };
    case 'discover':
      return { ...base, kind: CommandKind.machineDiscover };
    default:
      throw new DomainError(DomainErrorCode.invalidParams, `Unknown machine command "${action}".`);
  }
}

function readArguments(argv: string[]) {
  const words: string[] = [];
  const flags = {
    isJson: false,
    isHelp: false,
    isVersion: false,
    canClose: false,
    isFavoSkipped: false,
    hasProviders: false,
    isFavoOnly: false,
    isHeld: false,
    isRunningIncluded: false,
    providers: [] as ProviderId[],
    pages: [] as UsagePage[],
    isAllTime: false,
    days: undefined as string | undefined,
    machines: [] as string[],
    accounts: [] as string[],
    machine: undefined as string | undefined,
    name: undefined as string | undefined,
    directory: undefined as string | undefined,
  };
  for (let index = 0; index < argv.length; index++) {
    const word = argv[index]!;
    if (word === '--') return { words, flags, passthrough: argv.slice(index + 1) };
    if (isSeatRead(words, word)) return { words, flags, passthrough: argv.slice(index) };
    if (word === '--json') flags.isJson = true;
    else if (word === '--help' || word === '-h') flags.isHelp = true;
    else if (word === '--version' || word === '-v') flags.isVersion = true;
    else if (word === '--close') flags.canClose = true;
    else if (word === SkipFavoFlag) flags.isFavoSkipped = true;
    else if (word === ProvidersFlag) flags.hasProviders = true;
    else if (word === FavoOnlyFlag) flags.isFavoOnly = true;
    else if (word === HoldFlag) flags.isHeld = true;
    else if (word === UpdateRunningFlag) flags.isRunningIncluded = true;
    else if (word === ProviderFlag) flags.providers.push(providerIdOf(argv[++index]));
    else if (word === '--stdio') continue;
    else if (word === '--limits') flags.pages.push(UsagePage.limits);
    else if (word === '--tokens') flags.pages.push(UsagePage.tokens);
    else if (word === '--cost') flags.pages.push(UsagePage.cost);
    else if (word === '--all') flags.isAllTime = true;
    else if (word === '--days') flags.days = required(argv[++index], '--days <days>');
    else if (word === '--account') flags.accounts.push(required(argv[++index], '--account <account>'));
    else if (word === '--machine' || word === '-m') {
      flags.machine = required(argv[++index], '--machine <machine>');
      flags.machines.push(flags.machine);
    } else if (word === '--name') flags.name = required(argv[++index], '--name <name>');
    else if (word === '--dir') flags.directory = required(argv[++index], '--dir <folder>');
    else if (word.startsWith('-')) throw new DomainError(DomainErrorCode.invalidParams, `Unknown flag "${word}".`);
    else words.push(word);
  }
  return { words, flags, passthrough: [] };
}

function isSeatRead(words: string[], next: string) {
  const [first] = words;
  const isFlag = next.startsWith('-');
  if (first !== undefined && findProvider(first)) return words.length === 2 || (words.length === 1 && isFlag);
  if (first === 'resume') return words.length === 4 || (words.length === 3 && isFlag);
  return false;
}

function seatOf(provider: string | undefined, account: string | undefined, usage: string) {
  const spec = findProvider(required(provider, usage));
  if (!spec) throw new DomainError(DomainErrorCode.unknownProvider, `Unknown provider "${provider}". Usage: ${usage}`);
  return { provider: spec.id, account: required(account, usage) };
}

function providerIdOf(value: string | undefined) {
  const spec = findProvider(required(value, `${ProviderFlag} <provider>`));
  if (!spec) throw new DomainError(DomainErrorCode.unknownProvider, `Unknown provider "${value}".`);
  return spec.id;
}

function required(value: string | undefined, usage: string) {
  if (value === undefined) throw new DomainError(DomainErrorCode.invalidParams, `Usage: ${usage}`);
  return value;
}
