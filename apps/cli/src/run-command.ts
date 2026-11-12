import { adoptAccount } from '@favo/contracts/rpc/accounts/adopt-account';
import { createAccount } from '@favo/contracts/rpc/accounts/create-account';
import { listAccounts } from '@favo/contracts/rpc/accounts/list-accounts';
import { removeAccount } from '@favo/contracts/rpc/accounts/remove-account';
import { renameAccount } from '@favo/contracts/rpc/accounts/rename-account';
import type { RpcClient } from '@favo/contracts/rpc/client';
import { openDesktopApp } from '@favo/contracts/rpc/desktop/open-desktop-app';
import { installHooks } from '@favo/contracts/rpc/hooks/install-hooks';
import { listHooks } from '@favo/contracts/rpc/hooks/list-hooks';
import { uninstallHooks } from '@favo/contracts/rpc/hooks/uninstall-hooks';
import { addMachine } from '@favo/contracts/rpc/machines/add-machine';
import { discoverMachines } from '@favo/contracts/rpc/machines/discover-machines';
import { getMachineStatus, type MachineStatus } from '@favo/contracts/rpc/machines/get-machine-status';
import { installMachine } from '@favo/contracts/rpc/machines/install-machine';
import { listMachines } from '@favo/contracts/rpc/machines/list-machines';
import { removeMachine } from '@favo/contracts/rpc/machines/remove-machine';
import { getSeatStatus } from '@favo/contracts/rpc/seats/get-seat-status';
import { inspectSeat } from '@favo/contracts/rpc/seats/inspect-seat';
import { provisionSeat } from '@favo/contracts/rpc/seats/provision-seat';
import { repairSeats } from '@favo/contracts/rpc/seats/repair-seats';
import { planTerminal } from '@favo/contracts/rpc/terminal/plan-terminal';
import { listThemes } from '@favo/contracts/rpc/themes/list-themes';
import { selectTheme } from '@favo/contracts/rpc/themes/select-theme';
import { listThreads } from '@favo/contracts/rpc/threads/list-threads';
import { type HookView, LoginState, type ThreadView } from '@favo/contracts/rpc/views';
import { FavoVersion } from '@favo/contracts/version';
import { PersonalAccount } from '@favo/domain/accounts/account';
import { DesktopAppSpecs, DesktopLogin, DesktopOpening } from '@favo/domain/desktop/desktop-app';
import { HookState } from '@favo/domain/hooks/provider-hook';
import { isOlderFavoError, type Machine, MachineState } from '@favo/domain/machines/machine';
import { Providers } from '@favo/domain/providers/provider';
import { DomainError } from '@favo/domain/shared/domain-error';
import { TerminalAction, type TerminalPlan } from '@favo/domain/terminal/terminal-plan';
import { ThemeSource } from '@favo/domain/themes/theme';
import { shortThreadId, threadAgeOf } from '@favo/domain/threads/thread';
import { HelpText } from '@/help-text';
import type { Paint } from '@/paint';
import { type Command, CommandKind } from '@/parse-command';
import { runUpdate, updateMachines } from '@/run-update';
import { runUsage } from '@/run-usage';

const HookLabelWidth = 13;
const ThreadAgeWidth = 9;
const GuessNotice =
  "A guess comes from the provider's own list. With two sessions in one folder it can pick the wrong one.";
const HookStateLabels: Record<HookState, string> = {
  [HookState.current]: 'on',
  [HookState.outdated]: 'out of date, run favo sync',
  [HookState.absent]: 'off',
};

export type CommandContext = {
  client: RpcClient;
  paint: Paint;
  print(line: string): void;
  runPlan(plan: TerminalPlan): Promise<number>;
  ask(question: string): Promise<boolean>;
  hold(): Promise<void>;
};

export async function runCommand(parsed: Command, context: CommandContext) {
  const { client, print } = context;
  const command = await withStoredAccount(parsed, client);
  const { machineId, account, provider, args, isJson } = command;
  const options = { machineId };
  switch (command.kind) {
    case CommandKind.help:
      print(HelpText);
      return 0;
    case CommandKind.version:
      print(FavoVersion);
      return 0;
    case CommandKind.launch:
      return runPlanned(context, {
        ...seatOf(command),
        action: TerminalAction.launch,
        args,
        machineId,
        directory: command.directory,
      });
    case CommandKind.login:
      return runPlanned(context, { ...seatOf(command), action: TerminalAction.login, args: [], machineId });
    case CommandKind.logout:
      return runPlanned(context, { ...seatOf(command), action: TerminalAction.logout, args: [], machineId });
    case CommandKind.resume:
      return runPlanned(context, {
        ...seatOf(command),
        action: TerminalAction.resume,
        args,
        machineId,
        directory: command.directory,
        thread: command.target,
      });
    case CommandKind.threads:
      return onCurrentFavo(context, machineId, () => printThreads(context, command));
    case CommandKind.hooksStatus:
      return onCurrentFavo(context, machineId, async () => {
        printHooks(context, await client.call(listHooks, {}, options), isJson);
      });
    case CommandKind.hooksInstall:
      return onCurrentFavo(context, machineId, async () => {
        printHooks(context, await client.call(installHooks, {}, options), isJson);
      });
    case CommandKind.hooksUninstall:
      return onCurrentFavo(context, machineId, async () => {
        printHooks(context, await client.call(uninstallHooks, {}, options), isJson);
      });
    case CommandKind.list:
      await printFleet(context, isJson);
      return 0;
    case CommandKind.usage:
      return runUsage(command, context);
    case CommandKind.add:
      await client.call(createAccount, { name: account! }, options);
      print(`${context.paint.accent('⬢')} ${account} is ready. Sign in with: favo login claude ${account}`);
      return 0;
    case CommandKind.rename: {
      const { displayName } = await client.call(renameAccount, { name: account!, newName: command.name! }, options);
      print(`${context.paint.accent('⬢')} ${parsed.account} is now ${displayName}. Its folder stayed where it was.`);
      return 0;
    }
    case CommandKind.remove: {
      const { trashedTo } = await client.call(removeAccount, { name: account! }, options);
      print(`Moved to ${trashedTo}. Its logins stay there, still signed in, until you delete that folder.`);
      return 0;
    }
    case CommandKind.adopt:
      await client.call(adoptAccount, { name: account!, provider: provider!, from: command.from! }, options);
      print(`${context.paint.accent('⬢')} ${command.from} now lives in ${account}. Sign in again to use it.`);
      return 0;
    case CommandKind.path: {
      await client.call(provisionSeat, seatOf(command), options);
      const accounts = await client.call(listAccounts, {}, options);
      const seat = accounts
        .find(({ name }) => name === account)
        ?.seats.find((candidate) => candidate.provider === provider);
      print(seat?.path ?? '');
      return seat ? 0 : 1;
    }
    case CommandKind.app:
      return openApp(context, parsed, command);
    case CommandKind.sync: {
      const repairs = await client.call(repairSeats, { account }, options);
      if (isJson) print(JSON.stringify(repairs, undefined, 2));
      else for (const repair of repairs) printRepair(context, repair);
      if (!isJson && repairs.length === 0) print('Nothing to repair.');
      return 0;
    }
    case CommandKind.inspect: {
      const inspection = await client.call(inspectSeat, seatOf(command), options);
      if (isJson) print(JSON.stringify(inspection, undefined, 2));
      else {
        for (const item of inspection.items) print(`  ${item.state.padEnd(10)} ${item.name}`);
        print(context.paint.dim(`  private    ${inspection.privateItems.join(', ')}`));
        if (inspection.unclassified.length > 0) {
          print(context.paint.dim(`  unclassified, kept private: ${inspection.unclassified.join(', ')}`));
        }
      }
      return 0;
    }
    case CommandKind.theme:
      await runTheme(context, command);
      return 0;
    case CommandKind.machineList: {
      const machines = await client.call(listMachines, {});
      const statuses = await Promise.all(machines.map(({ id }) => client.call(getMachineStatus, { id })));
      if (isJson)
        print(
          JSON.stringify(
            machines.map((machine, index) => ({ ...machine, ...statuses[index] })),
            undefined,
            2
          )
        );
      else {
        machines.forEach((machine, index) => {
          print(
            `${machine.name.padEnd(20)} ${(machine.target ?? 'this machine').padEnd(28)} ${stateOf(statuses[index]!)}`
          );
        });
      }
      return 0;
    }
    case CommandKind.machineDiscover: {
      const found = await client.call(discoverMachines, {});
      if (isJson) print(JSON.stringify(found, undefined, 2));
      else for (const machine of found) print(`${machine.name.padEnd(24)} ${machine.source}`);
      if (!isJson && found.length === 0) print('Nothing new on ssh or Tailscale.');
      return 0;
    }
    case CommandKind.machineAdd: {
      const machine = await client.call(addMachine, { target: command.target!, name: command.name });
      print(`${context.paint.accent('⬢')} ${machine.name} joined. Installing favo there...`);
      const { version } = await client.call(installMachine, { id: machine.id });
      print(`${context.paint.accent('⬢')} favo ${version} is running on ${machine.name}.`);
      return 0;
    }
    case CommandKind.machineRemove:
      await client.call(removeMachine, { id: command.target! });
      print(`Forgot ${command.target}. favo stays installed there.`);
      return 0;
    case CommandKind.machineInstall: {
      print(`Installing favo on ${command.target}...`);
      const { version } = await client.call(installMachine, { id: command.target! });
      print(`${context.paint.accent('⬢')} favo ${version} is running on ${command.target}.`);
      return 0;
    }
    case CommandKind.machineUpdate:
      return (await updateMachines(context)).exitCode;
    case CommandKind.update:
      return runUpdate(command, context);
    default:
      return 1;
  }
}

async function openApp(context: CommandContext, parsed: Command, command: Command) {
  const { client, print, paint } = context;
  const seat = seatOf(command);
  const { opening, label } = await client.call(openDesktopApp, { ...seat, canClose: command.canClose ?? false });
  if (opening === DesktopOpening.stillOpen) {
    const { executable } = Providers[seat.provider];
    print(`${label} is open. To close it and reopen: favo app ${executable} ${parsed.account} --close`);
    return 1;
  }
  print(`${paint.accent('⬢')} ${label} is opening as ${parsed.account}.`);
  if (DesktopAppSpecs[seat.provider]?.login !== DesktopLogin.separate) return 0;
  const { login } = await client.call(getSeatStatus, seat);
  if (login !== LoginState.signedOut) return 0;
  const { label: provider, executable } = Providers[seat.provider];
  const cli = provider === label ? executable : provider;
  print(`${label} and ${cli} sign in separately, and ${cli} is signed out as ${parsed.account}.`);
  print(`To sign it in too: favo login ${executable} ${parsed.account}`);
  return 0;
}

function stateOf(status: MachineStatus) {
  return status.isBehind ? `${status.state} · older favo ${status.version}` : status.state;
}

function seatOf(command: Command) {
  return { account: command.account!, provider: command.provider! };
}

async function withStoredAccount(command: Command, client: RpcClient) {
  const { account, kind, machineId } = command;
  if (!account || account === PersonalAccount || kind === CommandKind.add) return command;
  const accounts = await client.call(listAccounts, {}, { machineId });
  const found = accounts.find(({ displayName }) => displayName === account);
  return found ? { ...command, account: found.name } : command;
}

async function runPlanned(context: CommandContext, params: Parameters<typeof planFor>[1]) {
  return context.runPlan(await planFor(context.client, params));
}

function planFor(
  client: RpcClient,
  params: {
    account: string;
    provider: Command['provider'] & string;
    action: TerminalAction;
    args: string[];
    machineId?: string;
    directory?: string;
    thread?: string;
  }
) {
  return client.call(planTerminal, params);
}

async function onCurrentFavo(context: CommandContext, machineId: string | undefined, action: () => Promise<void>) {
  try {
    await action();
    return 0;
  } catch (error) {
    if (!isOlderFavoError(error)) throw error;
    context.print(
      `${machineId} runs an older favo, which keeps no threads. To update it: favo machine install ${machineId}`
    );
    return 1;
  }
}

async function printThreads(context: CommandContext, command: Command) {
  const { client, print, paint } = context;
  const params = { ...seatOf(command), directory: command.directory };
  const threads = await client.call(listThreads, params, { machineId: command.machineId });
  if (command.isJson) {
    print(JSON.stringify(threads, undefined, 2));
    return;
  }
  const now = Date.now();
  for (const [index, thread] of threads.entries()) print(threadLine(context, thread, index + 1, now));
  if (threads.some(({ isGuess }) => isGuess)) print(paint.dim(GuessNotice));
  if (threads.length === 0) print('No threads yet.');
}

function threadLine({ paint }: CommandContext, thread: ThreadView, position: number, now: number) {
  const age = threadAgeOf(thread.updatedAt, now).padEnd(ThreadAgeWidth);
  const facts = [
    thread.directory,
    thread.isDirectoryGone ? 'folder gone' : undefined,
    thread.isGuess ? 'a guess' : undefined,
  ];
  return `${String(position).padStart(2)}  ${age} ${paint.accent(shortThreadId(thread.id))}  ${facts.filter(Boolean).join(' · ')}`;
}

function printHooks(context: CommandContext, hooks: HookView[], isJson: boolean) {
  const { print, paint } = context;
  if (isJson) {
    print(JSON.stringify(hooks, undefined, 2));
    return;
  }
  for (const hook of hooks) {
    const label = hook.label.padEnd(HookLabelWidth);
    if (!hook.isProviderInstalled && hook.state === HookState.absent) {
      print(paint.dim(`${label} not installed`));
      continue;
    }
    print(`${hookMark(context, hook)} ${label} ${HookStateLabels[hook.state]}  ${paint.dim(hook.file)}`);
    if (hook.needsTrust && hook.state !== HookState.absent) {
      print(paint.dim(`  ${hook.label} asks each seat once to trust the hook. If you skip that, it never runs.`));
    }
    for (const problem of hook.problems) print(`  ${problem}`);
  }
}

function hookMark({ paint }: CommandContext, hook: HookView) {
  return hook.state === HookState.absent ? paint.dim('⬡') : paint.accent('⬢');
}

function printRepair(
  context: CommandContext,
  repair: { account: string; provider: string; linked: string[]; problems: { name: string; state: string }[] }
) {
  const { paint, print } = context;
  const summary = repair.linked.length > 0 ? `linked ${repair.linked.join(', ')}` : 'ok';
  print(`${paint.accent('⬢')} ${repair.account} ${repair.provider}: ${summary}`);
  for (const problem of repair.problems) print(`  ${problem.state}: ${problem.name} (left untouched)`);
}

async function runTheme(context: CommandContext, command: Command) {
  const { client, print, paint } = context;
  if (command.target) {
    await client.call(selectTheme, { id: command.target });
    print(`${paint.accent('⬢')} ${command.target} it is.`);
    return;
  }
  const { activeId, themes, problems } = await client.call(listThemes, {});
  if (command.isJson) {
    print(JSON.stringify({ activeId, themes, problems }, undefined, 2));
    return;
  }
  for (const theme of themes) {
    const swatches = [theme.colors.accent, theme.colors.accentBright, theme.colors.success, theme.colors.danger];
    const marks = swatches.map((color) => paint.color(color, '■')).join(' ');
    const source = theme.source === ThemeSource.custom ? paint.dim(' custom') : '';
    print(`${theme.id === activeId ? paint.accent('▸') : ' '} ${theme.id.padEnd(30)} ${marks}${source}`);
  }
  for (const problem of problems) print(`${problem.file}: ${problem.message}`);
}

async function printFleet(context: CommandContext, isJson: boolean) {
  const { client, print, paint } = context;
  const machines = await client.call(listMachines, {});
  const report = await Promise.all(
    machines.map(async (machine) => {
      const status = await client.call(getMachineStatus, { id: machine.id });
      if (status.state !== MachineState.online) return { machine, status, accounts: [] };
      return { machine, status, ...(await accountsWithLogins(client, machine)) };
    })
  );
  if (isJson) {
    print(JSON.stringify(report, undefined, 2));
    return;
  }
  for (const { machine, status, accounts, problem } of report) {
    const where = machine.isLocal ? 'this machine' : machine.target;
    const facts = [where, stateOf(status), status.directory].filter(Boolean).join(' · ');
    print(`${paint.bold(machine.name)} ${paint.dim(facts)}`);
    if (problem) print(`  ${problem}`);
    for (const account of accounts) {
      print(`  ${paint.accent(account.displayName)}`);
      for (const seat of account.seats) {
        const isIn = seat.status.login === LoginState.signedIn;
        const mark = isIn ? paint.accent('⬢') : paint.dim('⬡');
        const label = Providers[seat.provider].executable.padEnd(9);
        const detail = [seat.status.identity, seat.status.plan].filter(Boolean).join(' · ');
        print(`    ${mark} ${label} ${detail || paint.dim(loginLabel(seat.status.login))}`);
      }
    }
  }
}

async function accountsWithLogins(client: RpcClient, machine: Machine) {
  try {
    const options = { machineId: machine.id };
    const listed = await client.call(listAccounts, {}, options);
    const accounts = await Promise.all(
      listed.map(async (account) => ({
        ...account,
        seats: await Promise.all(
          account.seats.map(async (seat) => {
            const params = { account: seat.account, provider: seat.provider };
            return { ...seat, status: await client.call(getSeatStatus, params, options) };
          })
        ),
      }))
    );
    return { accounts };
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    return { accounts: [], problem: error.message };
  }
}

function loginLabel(login: LoginState) {
  if (login === LoginState.notInstalled) return 'not installed';
  if (login === LoginState.unknown) return 'unknown';
  return login === LoginState.signedIn ? 'signed in' : 'signed out';
}
