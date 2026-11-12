import type { TokenGroup } from '@favo/domain/usage/token-report';
import { NotCountedLabel, type TokenColumns, tokenBarOf, tokenNumbersOf } from '@favo/domain/usage/token-view';
import { useApp } from '@/shared/stores/app';

const MinimumBarWidth = 10;
const MaximumBarWidth = 40;
const RowChrome = 12;

type TokenBarsProps = {
  title: string;
  groups: TokenGroup[];
  uncounted?: string[];
  columns: TokenColumns;
  width: number;
};

export function TokenBars({ title, groups, uncounted = [], columns, width }: TokenBarsProps) {
  const colors = useApp((state) => state.colors);
  const report = useApp((state) => state.tokenReport);
  const room = width - RowChrome - columns.name - columns.amount - columns.share - columns.other;
  const barWidth = Math.max(MinimumBarWidth, Math.min(MaximumBarWidth, room));

  if (groups.length === 0 && uncounted.length === 0) return undefined;

  return (
    <box flexDirection="column" flexShrink={0} paddingLeft={2} marginBottom={1}>
      <text fg={colors.text}>{title}</text>
      {groups.map((group) => {
        const { lead, other } = tokenNumbersOf(group, report, columns);
        const { filled, rest } = tokenBarOf(group.share, barWidth);
        const isIdle = group.tokens === 0 && group.note !== undefined;
        return (
          <text key={group.id} wrapMode="none" truncate>
            <span
              fg={group.isFaded ? colors.faint : colors.text}
            >{`  ${group.name.slice(0, columns.name).padEnd(columns.name)}  `}</span>
            {isIdle && <span fg={colors.faint}>{group.note}</span>}
            {!isIdle && <span fg={group.isFaded ? colors.faint : colors.accent}>{'█'.repeat(filled)}</span>}
            {!isIdle && <span fg={colors.faint}>{'░'.repeat(rest)}</span>}
            {!isIdle && <span fg={group.isFaded ? colors.faint : colors.text}>{lead}</span>}
            {!isIdle && <span fg={group.isFaded ? colors.faint : colors.muted}>{other}</span>}
            {!isIdle && group.note !== undefined && <span fg={colors.faint}>{`  ${group.note}`}</span>}
          </text>
        );
      })}
      {uncounted.length > 0 && (
        <text fg={colors.faint} wrapMode="none" truncate>
          {`  ${uncounted.join(', ')}  ${NotCountedLabel}`}
        </text>
      )}
    </box>
  );
}
