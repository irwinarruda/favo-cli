import { formatDollars, formatPercent } from '@favo/domain/usage/token-format';
import { cachedPercentOf, perMillionOf, type TokenGroup, TokenMetric } from '@favo/domain/usage/token-report';
import { tokenRowOf } from '@favo/domain/usage/token-view';
import { TokenBreakdown } from '@/modules/usage/app/services/TokensService';
import { useApp } from '@/shared/stores/app';

const MaximumNameWidth = 30;
const MinimumNameWidth = 12;
const TableChrome = 10;
const RequiredColumns = 2;
const ColumnGap = 3;
const Columns = ['amount', 'share', 'other', 'cached', 'perMillion'] as const;

type Column = (typeof Columns)[number];

const Titles: Record<TokenBreakdown, string> = { models: 'Models', days: 'Days' };

export function TokenTable({ width }: { width: number }) {
  const colors = useApp((state) => state.colors);
  const report = useApp((state) => state.tokenReport);
  const breakdown = useApp((state) => state.tokenBreakdown);
  const toggleTokenBreakdown = useApp((state) => state.toggleTokenBreakdown);
  const isCost = report.metric === TokenMetric.cost;
  const groups = breakdown === TokenBreakdown.days ? report.days : report.models;
  const headings: Record<Column, string> = {
    amount: isCost ? 'cost' : 'tokens',
    share: 'share',
    other: isCost ? 'tokens' : 'cost',
    cached: 'cached',
    perMillion: 'per 1M',
  };
  const rows = groups.map((group) => ({ group, cells: cellsOf(group) }));
  const known = Columns.filter((column) => report.hasPrices || (column !== 'other' && column !== 'perMillion'));
  const longest = Math.max(MinimumNameWidth, ...groups.map((group) => group.name.length));
  const wantedNameWidth = Math.min(longest, MaximumNameWidth);
  const room = width - TableChrome - wantedNameWidth;
  const columns = known.filter((_, index) => {
    const used = known.slice(0, index + 1).reduce((total, column) => total + widthOf(column), 0);
    return index < RequiredColumns || used <= room;
  });
  const columnsWidth = columns.reduce((total, column) => total + widthOf(column), 0);
  const nameWidth = Math.max(MinimumNameWidth, Math.min(wantedNameWidth, width - TableChrome - columnsWidth));

  function cellsOf(group: TokenGroup): Record<Column, string> {
    const perMillion = perMillionOf(group);
    return {
      ...tokenRowOf(group, report),
      cached: formatPercent(cachedPercentOf(group)),
      perMillion: perMillion === undefined ? '' : formatDollars(perMillion),
    };
  }

  function widthOf(column: Column) {
    return Math.max(headings[column].length, ...rows.map(({ cells }) => cells[column].length)) + ColumnGap;
  }

  return (
    <box flexDirection="column" flexShrink={0} paddingLeft={2}>
      <box flexDirection="row" flexShrink={0} onMouseDown={toggleTokenBreakdown}>
        <text wrapMode="none" truncate>
          <span fg={colors.text}>{Titles[breakdown].padEnd(nameWidth + 2)}</span>
          <span fg={colors.muted}>{columns.map((column) => headings[column].padStart(widthOf(column)))}</span>
        </text>
      </box>
      {rows.map(({ group, cells }) => (
        <text key={group.id} wrapMode="none" truncate>
          <span fg={colors.text}>{`  ${group.name.slice(0, nameWidth).padEnd(nameWidth)}`}</span>
          <span fg={colors.text}>{cells.amount.padStart(widthOf('amount'))}</span>
          <span fg={colors.muted}>{columns.slice(1).map((column) => cells[column].padStart(widthOf(column)))}</span>
        </text>
      ))}
    </box>
  );
}
