import { listAccounts } from '@favo/contracts/rpc/accounts/list-accounts';
import type { RpcClient } from '@favo/contracts/rpc/client';
import { listMachines } from '@favo/contracts/rpc/machines/list-machines';
import { readLimits } from '@favo/contracts/rpc/seats/read-limits';
import { keepTokenUsage } from '@favo/contracts/rpc/usage/keep-token-usage';
import { readKeptTokenUsage } from '@favo/contracts/rpc/usage/read-kept-token-usage';
import { readTokenPrices } from '@favo/contracts/rpc/usage/read-token-prices';
import { readTokenUsage } from '@favo/contracts/rpc/usage/read-token-usage';
import type { SeatLimitsView } from '@favo/contracts/rpc/views';
import { isOlderFavoError, type Machine } from '@favo/domain/machines/machine';
import { ProviderOrder, Providers } from '@favo/domain/providers/provider';
import { assertDomain, DomainError, DomainErrorCode } from '@favo/domain/shared/domain-error';
import { LimitBarPart, limitHeadlineOf, limitRowOf } from '@favo/domain/usage/limit-bar';
import { collectLimitPools, type LimitPool, type LimitPoolColumn } from '@favo/domain/usage/limit-pool';
import { NotABillMessage } from '@favo/domain/usage/token-prices';
import {
  DefaultTokenDays,
  TokenChartRows,
  type TokenGroup,
  TokenMetric,
  type TokenReport,
  type TokenWindow,
  TokenWindowUnit,
  tokenChartOf,
  tokenDayRowsOf,
  tokenReportOf,
} from '@favo/domain/usage/token-report';
import { type MachineTokenUsage, TokenProviders } from '@favo/domain/usage/token-usage';
import {
  barColumnsOf,
  chartCaptionsOf,
  lastReadOf,
  NoTokensMessage,
  NotCountedLabel,
  skippedNoteOf,
  type TokenColumns,
  tokenBarOf,
  tokenColumnsOf,
  tokenHeadlineOf,
  tokenNumbersOf,
  tokenTypesOf,
  unpricedNoteOf,
} from '@favo/domain/usage/token-view';
import { filterSummaryOf, hiddenFor, type UsageFilter, UsagePage } from '@favo/domain/usage/usage-view';
import type { Paint } from '@/paint';
import type { Command } from '@/parse-command';
import type { CommandContext } from '@/run-command';

const LimitBarWidth = 20;
const LimitLabelWidth = 16;
const TokenBarWidth = 20;
const MaximumNameWidth = 40;
const TokenChartColumns = 60;
const OutputWidth = 100;
const MaximumBarStretch = 2;
const TitleWidth = 9;
const FactGap = '   ';

type MachineTokens = { machine: Machine; usage: MachineTokenUsage; problem?: string; isOutdated: boolean };

export async function runUsage(command: Command, context: CommandContext) {
  const machines = await context.client.call(listMachines, {});
  const wanted = command.machines ?? [];
  for (const id of wanted) {
    assertDomain(
      machines.some((machine) => machine.id === id),
      DomainErrorCode.machineNotFound,
      `No machine named "${id}".`
    );
  }
  const chosen = machines.filter(({ id }) => wanted.length === 0 || wanted.includes(id));
  if (command.usagePage === UsagePage.tokens || command.usagePage === UsagePage.cost) {
    return printTokens(context, command, machines, chosen);
  }
  return printLimits(context, command, chosen);
}

async function printLimits(context: CommandContext, command: Command, chosen: Machine[]) {
  const { client, print } = context;
  const wanted = command.accounts ?? [];
  const providers: string[] = command.providers ?? [];
  const names = wanted.length > 0 ? (await accountsOf(client, chosen)).names : {};
  const accounts = shownAccountsOf(wanted, Object.keys(names), names);
  function isShown(seat: SeatLimitsView) {
    const isAccountShown = accounts.length === 0 || accounts.includes(seat.account);
    return isAccountShown && (providers.length === 0 || providers.includes(seat.provider));
  }
  const read = await Promise.all(chosen.map((machine) => machineLimitsOf(client, machine)));
  const report = read.map((reading) => ({ ...reading, seats: reading.seats.filter(isShown) }));
  const exitCode = report.every(({ problem }) => problem !== undefined) ? 1 : 0;
  if (command.isJson) {
    print(JSON.stringify(report, undefined, 2));
    return exitCode;
  }
  const now = Date.now();
  const seats = report.flatMap(({ machine, seats }) =>
    seats.map((seat) => ({
      ...seat,
      key: `${machine.id}/${seat.account}/${seat.provider}`,
      machineName: machine.name,
    }))
  );
  const pools = collectLimitPools(seats, now);
  for (const pool of pools) printPool(context, pool, now);
  const problems = report.flatMap(({ machine, problem }) => (problem ? [`${machine.name}: ${problem}`] : []));
  for (const problem of problems) print(problem);
  if (pools.length === 0 && problems.length === 0) print('No signed in seat reports limits.');
  return exitCode;
}

async function machineLimitsOf(client: RpcClient, machine: Machine) {
  try {
    return { machine, seats: await client.call(readLimits, {}, { machineId: machine.id }) };
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    return { machine, seats: [], problem: isOlderFavoError(error) ? 'older favo' : error.message };
  }
}

function printPool({ print, paint }: CommandContext, pool: LimitPool, now: number) {
  if (pool.summary) {
    print(`${paint.bold(pool.label.padEnd(LimitLabelWidth))}${paint.dim(pool.summary)}`);
    return;
  }
  const nameWidth = Math.max(0, ...pool.seats.map(({ name }) => name.length));
  const context = { paint, nameWidth, showPercent: pool.seats.length > 1, now };
  print(paint.bold(pool.label));
  for (const window of pool.windows) {
    const { label, remaining, facts } = limitHeadlineOf(window);
    print('');
    const shownRemaining = window.isStale ? paint.dim(remaining) : paint.accent(remaining);
    print(`  ${label}${shownRemaining}${paint.dim(facts)}`);
    for (const column of window.columns) print(`    ${limitRowText(column, context)}`);
  }
  for (const { name, message } of pool.notices) print(paint.dim(`\n  ${name}: ${message}`));
  print('');
}

function limitRowText(
  { seat, member }: LimitPoolColumn,
  context: { paint: Paint; nameWidth: number; showPercent: boolean; now: number }
) {
  const { paint, nameWidth, showPercent, now } = context;
  const name = seat.name.padEnd(nameWidth);
  if (!member) return paint.dim(`${name}  not reported`);
  const { bar, percent, facts } = limitRowOf(member, LimitBarWidth, now);
  const barText = bar.map(({ part, text }) => {
    if (member.isStale || part === LimitBarPart.refill || part === LimitBarPart.track) return paint.dim(text);
    return part === LimitBarPart.left ? paint.accent(text) : text;
  });
  const shownPercent = showPercent ? ` ${percent}` : '';
  const row = `${shownPercent}  ${facts}`.trimEnd();
  return `${name}  ${barText.join('')}${member.isStale ? paint.dim(row) : row}`;
}

async function printTokens(context: CommandContext, command: Command, machines: Machine[], chosen: Machine[]) {
  const { client, print } = context;
  const now = Date.now();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const metric = command.usagePage === UsagePage.cost ? TokenMetric.cost : TokenMetric.tokens;
  const [readings, { names, installed }] = await Promise.all([
    Promise.all(chosen.map((machine) => machineTokensOf(client, machine))),
    accountsOf(client, chosen),
  ]);
  const rows = readings.flatMap(({ usage }) => usage.rows);
  const accountIds = [...new Set([...Object.keys(names), ...rows.map((row) => row.account)])];
  const shownAccounts = shownAccountsOf(command.accounts ?? [], accountIds, names);
  const providerIds = ProviderOrder.filter((id) => rows.some((row) => row.provider === id));
  const filter: UsageFilter = {
    machines: [],
    accounts: hiddenFor(accountIds, shownAccounts),
    providers: hiddenFor([...ProviderOrder], command.providers ?? []),
  };
  const models = [...new Set(rows.map((row) => row.model))];
  const prices = await client.call(readTokenPrices, { models, isFresh: false });
  const window: TokenWindow = command.isAllTime
    ? { unit: TokenWindowUnit.all, length: 0 }
    : { unit: TokenWindowUnit.days, length: command.days ?? DefaultTokenDays };
  const input = {
    machines: readings.map((reading) => ({ ...tokenMachineOf(reading, now), rows: reading.usage.rows })),
    prices,
    filter,
    window,
    now,
    timeZone,
  };
  const report = tokenReportOf({ ...input, metric, accountNames: names });
  const exitCode = readings.every(({ problem }) => problem !== undefined) ? 1 : 0;
  if (command.isJson) {
    const document = {
      since: report.since,
      until: report.until,
      timeZone,
      machines: readings.map(({ machine, usage, problem }) => ({
        id: machine.id,
        name: machine.name,
        readAt: usage.readAt,
        problem,
      })),
      prices: { source: prices.source, fetchedAt: prices.fetchedAt },
      days: tokenDayRowsOf(input),
    };
    print(JSON.stringify(document, undefined, 2));
    return exitCode;
  }
  const choices = {
    machines: machines.map(({ id, name }) => ({ id, name, isOn: chosen.some((machine) => machine.id === id) })),
    accounts: accountIds.map((id) => ({ id, name: names[id] ?? id, isOn: !filter.accounts.includes(id) })),
    providers: providerIds.map((id) => ({ id, name: Providers[id].label, isOn: !filter.providers.includes(id) })),
  };
  const period = command.isAllTime ? 'all time' : `last ${window.length} ${window.length === 1 ? 'day' : 'days'}`;
  const title = metric === TokenMetric.cost ? 'Cost' : 'Tokens';
  print(
    `${context.paint.bold(title.padEnd(TitleWidth))}${context.paint.dim(`${period} · ${filterSummaryOf(choices)}`)}`
  );
  print('');
  const uncounted = ProviderOrder.filter(
    (id) => installed.includes(id) && !TokenProviders.includes(id) && !filter.providers.includes(id)
  ).map((id) => Providers[id].label);
  printTokenReport(context, report, timeZone, uncounted);
  const skipped = skippedNoteOf(readings.reduce((total, { usage }) => total + usage.skippedRecords, 0));
  if (skipped) print(context.paint.dim(skipped));
  for (const { machine, problem } of readings) {
    if (problem) print(`${machine.name}: ${problem}`);
  }
  return exitCode;
}

function printTokenReport(
  { print, paint }: CommandContext,
  report: TokenReport,
  timeZone: string,
  uncounted: string[]
) {
  const isCost = report.metric === TokenMetric.cost;
  const { lead, facts } = tokenHeadlineOf(report);
  print(`  ${paint.accent(lead)}${facts.map((fact) => `${FactGap}${fact}`).join('')}`);
  if (isCost) print(paint.dim(`  ${NotABillMessage}`));
  print('');
  if (report.total.tokens === 0) {
    print(`  ${NoTokensMessage}`);
    return;
  }
  const chart = tokenChartOf({ report, columns: TokenChartColumns, rows: TokenChartRows, timeZone });
  if (chart) {
    const buckets = chart.lines[0]?.length ?? 1;
    const stretch = Math.max(1, Math.min(MaximumBarStretch, Math.floor(TokenChartColumns / buckets)));
    const barsWidth = buckets * stretch;
    const captions = chartCaptionsOf({ chart, barsWidth, metric: report.metric, width: OutputWidth });
    for (const line of chart.lines) {
      const bars = [...line].map((bar) => bar.repeat(stretch)).join('');
      print(`  ${paint.accent(bars.trimEnd())}`);
    }
    for (const caption of captions) print(paint.dim(`  ${caption}`));
    print('');
  }
  const bars = { report, columns: barColumnsOf(report, MaximumNameWidth), hasBars: true };
  const models = { report, columns: tokenColumnsOf(report.models, report, MaximumNameWidth), hasBars: false };
  printTokenGroups({ print, paint }, { ...bars, title: 'Providers', groups: report.providers, uncounted });
  printTokenGroups({ print, paint }, { ...bars, title: 'Accounts', groups: report.accounts });
  printTokenGroups({ print, paint }, { ...bars, title: 'Machines', groups: report.machines });
  printTokenGroups({ print, paint }, { ...models, title: 'Models', groups: report.models });
  const types = tokenTypesOf(report);
  print(paint.bold('Types'));
  print(`  ${types.types.join(' · ')}`);
  if (types.cached) print(paint.dim(`  ${types.cached}`));
  const unpriced = isCost ? unpricedNoteOf(report) : undefined;
  if (unpriced) print(paint.dim(`  ${unpriced}`));
}

type TokenSection = {
  title: string;
  groups: TokenGroup[];
  report: TokenReport;
  columns: TokenColumns;
  hasBars: boolean;
  uncounted?: string[];
};

function printTokenGroups({ print, paint }: Pick<CommandContext, 'print' | 'paint'>, section: TokenSection) {
  const { title, groups, report, columns, hasBars, uncounted = [] } = section;
  if (groups.length === 0 && uncounted.length === 0) return;
  print(paint.bold(title));
  for (const group of groups) {
    const name = group.name.padEnd(columns.name);
    if (group.tokens === 0 && group.note !== undefined) {
      print(paint.dim(`  ${name}  ${group.note}`));
      continue;
    }
    const { lead, other } = tokenNumbersOf(group, report, columns);
    const { filled, rest } = tokenBarOf(group.share, TokenBarWidth);
    const bar = hasBars ? `${paint.accent('▄'.repeat(filled))}${paint.dim('▂'.repeat(rest))}` : '';
    const note = group.note === undefined ? '' : paint.dim(`  ${group.note}`);
    print(`  ${group.isFaded ? paint.dim(name) : name}  ${bar}${lead}${other}${note}`);
  }
  if (uncounted.length > 0) print(paint.dim(`  ${uncounted.join(', ')}  ${NotCountedLabel}`));
  print('');
}

function shownAccountsOf(wanted: string[], ids: string[], names: Record<string, string>) {
  return wanted.map((account) => {
    const id = ids.find((candidate) => candidate === account || names[candidate] === account);
    assertDomain(id, DomainErrorCode.accountNotFound, `No account named "${account}".`);
    return id;
  });
}

async function machineTokensOf(client: RpcClient, machine: Machine) {
  const tokens = await countedTokensOf(client, machine);
  const isCounted = tokens.problem === undefined;
  if (isCounted && !machine.isLocal) await client.call(keepTokenUsage, { id: machine.id, usage: tokens.usage });
  return tokens;
}

async function countedTokensOf(client: RpcClient, machine: Machine): Promise<MachineTokens> {
  try {
    const usage = await client.call(readTokenUsage, { isFresh: true }, { machineId: machine.id });
    return { machine, usage, isOutdated: false };
  } catch (error) {
    if (!(error instanceof DomainError)) throw error;
    const usage = await client.call(readKeptTokenUsage, { id: machine.id });
    const isOutdated = isOlderFavoError(error);
    return { machine, usage, isOutdated, problem: isOutdated ? 'older favo' : error.message };
  }
}

function tokenMachineOf({ machine, usage, problem, isOutdated }: MachineTokens, now: number) {
  const { id, name } = machine;
  if (problem === undefined) return { id, name };
  const note = `${isOutdated ? 'older favo' : 'could not read'}${lastReadOf(usage.readAt, now)}`;
  return { id, name, note, isFaded: true };
}

async function accountsOf(client: RpcClient, machines: Machine[]) {
  const listed = await Promise.all(
    machines.map((machine) =>
      client.call(listAccounts, {}, { machineId: machine.id }).catch((error) => {
        if (!(error instanceof DomainError)) throw error;
        return [];
      })
    )
  );
  const accounts = listed.flat();
  const seats = accounts.flatMap((account) => account.seats.filter((seat) => seat.isInstalled));
  return {
    names: Object.fromEntries(accounts.map(({ name, displayName }) => [name, displayName])),
    installed: seats.map((seat) => seat.provider),
  };
}
