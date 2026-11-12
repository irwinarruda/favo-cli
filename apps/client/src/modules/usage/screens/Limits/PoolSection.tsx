import { LimitBarPart, limitHeadlineOf, limitRowOf } from '@favo/domain/usage/limit-bar';
import type { LimitPool, LimitPoolColumn, LimitPoolMember, LimitPoolWindow } from '@favo/domain/usage/limit-pool';
import { useApp } from '@/shared/stores/app';

const LabelWidth = 16;
const CardChrome = 7;
const HeadlineWidth = 21;
const SegmentGap = 3;
const SegmentFactsWidth = 15;
const MaximumNameWidth = 20;
const MinimumBarWidth = 8;
const MaximumBarWidth = 30;
const StackedRowChrome = 20;

function SeatBar({ member, width }: { member: LimitPoolMember; width: number }) {
  const colors = useApp((state) => state.colors);
  const now = useApp((state) => state.usageNow);
  const { bar } = limitRowOf(member, width, now);
  const partColors = {
    [LimitBarPart.left]: colors.accent,
    [LimitBarPart.refill]: colors.muted,
    [LimitBarPart.track]: colors.faint,
    [LimitBarPart.tick]: colors.text,
  };

  return (
    <>
      {bar.map(({ offset, part, text }) => (
        <span key={offset} fg={member.isStale ? colors.faint : partColors[part]}>
          {text}
        </span>
      ))}
    </>
  );
}

type SegmentProps = { column: LimitPoolColumn; showPercent: boolean; width: number };

function Segment({ column, showPercent, width }: SegmentProps) {
  const colors = useApp((state) => state.colors);
  const now = useApp((state) => state.usageNow);
  const { seat, member } = column;

  if (!member) {
    return (
      <box flexDirection="column" width={width} flexShrink={0}>
        <text fg={colors.faint} wrapMode="none" truncate>
          {seat.name}
        </text>
        <text fg={colors.faint}>not reported</text>
      </box>
    );
  }

  const { isStale } = member;
  const { percent, facts } = limitRowOf(member, width, now);
  const shownPercent = showPercent ? `  ${percent.trim()}` : '';
  const name = seat.name.slice(0, Math.max(width - shownPercent.length - facts.length - 1, 1));
  const spacer = ' '.repeat(Math.max(width - name.length - shownPercent.length - facts.length, 1));

  return (
    <box flexDirection="column" width={width} flexShrink={0}>
      <text wrapMode="none" truncate>
        <b fg={isStale ? colors.faint : colors.text}>{name}</b>
        <span fg={isStale ? colors.faint : colors.text}>{shownPercent}</span>
        <span fg={isStale ? colors.faint : colors.muted}>{`${spacer}${facts}`}</span>
      </text>
      <text wrapMode="none" truncate>
        <SeatBar member={member} width={width} />
      </text>
    </box>
  );
}

type WindowProps = { pool: LimitPool; window: LimitPoolWindow; isFirst: boolean };

function SideBySideWindow({ pool, window, isFirst, segmentWidth }: WindowProps & { segmentWidth: number }) {
  const colors = useApp((state) => state.colors);
  const { label, remaining, facts } = limitHeadlineOf(window);

  return (
    <box flexDirection="row" flexShrink={0} columnGap={SegmentGap} marginTop={isFirst ? 0 : 1}>
      <box flexDirection="column" width={HeadlineWidth} flexShrink={0}>
        <text fg={window.isStale ? colors.faint : colors.text} wrapMode="none" truncate>
          {label}
        </text>
        <text wrapMode="none" truncate>
          <b fg={window.isStale ? colors.faint : colors.accent}>{remaining}</b>
          <span fg={colors.muted}>{facts}</span>
        </text>
      </box>
      {window.columns.map((column) => (
        <Segment key={column.seat.key} column={column} showPercent={pool.seats.length > 1} width={segmentWidth} />
      ))}
    </box>
  );
}

type RowProps = { column: LimitPoolColumn; showPercent: boolean; nameWidth: number; barWidth: number };

function SeatRow({ column, showPercent, nameWidth, barWidth }: RowProps) {
  const colors = useApp((state) => state.colors);
  const now = useApp((state) => state.usageNow);
  const { seat, member } = column;
  const name = seat.name.padEnd(nameWidth);

  if (!member) {
    return (
      <text fg={colors.faint} wrapMode="none" truncate>
        {`${name}  not reported`}
      </text>
    );
  }

  const { isStale } = member;
  const { percent, facts } = limitRowOf(member, barWidth, now);

  return (
    <text wrapMode="none" truncate>
      <span fg={isStale ? colors.faint : colors.text}>{`${name}  `}</span>
      <SeatBar member={member} width={barWidth} />
      {showPercent && <span fg={isStale ? colors.faint : colors.text}>{` ${percent}`}</span>}
      <span fg={isStale ? colors.faint : colors.muted}>{`  ${facts}`}</span>
    </text>
  );
}

function StackedWindow({ pool, window, isFirst, innerWidth }: WindowProps & { innerWidth: number }) {
  const colors = useApp((state) => state.colors);
  const { label, remaining, facts } = limitHeadlineOf(window);
  const names = pool.seats.map((seat) => seat.name.length);
  const nameWidth = Math.min(Math.max(0, ...names), MaximumNameWidth);
  const roomForBar = innerWidth - nameWidth - StackedRowChrome;
  const barWidth = Math.max(MinimumBarWidth, Math.min(MaximumBarWidth, roomForBar));

  return (
    <box flexDirection="column" flexShrink={0} marginTop={isFirst ? 0 : 1}>
      <text wrapMode="none" truncate>
        <span fg={window.isStale ? colors.faint : colors.text}>{label}</span>
        <b fg={window.isStale ? colors.faint : colors.accent}>{remaining}</b>
        <span fg={colors.muted}>{facts}</span>
      </text>
      {window.columns.map((column) => (
        <SeatRow
          key={column.seat.key}
          column={column}
          showPercent={pool.seats.length > 1}
          nameWidth={nameWidth}
          barWidth={barWidth}
        />
      ))}
    </box>
  );
}

export function PoolSection({ pool, width }: { pool: LimitPool; width: number }) {
  const colors = useApp((state) => state.colors);
  const innerWidth = width - CardChrome;
  const seats = pool.seats.length;
  const longestName = Math.max(0, ...pool.seats.map((seat) => seat.name.length));
  const segmentWidth = Math.floor((innerWidth - HeadlineWidth - SegmentGap * seats) / seats);
  const isSideBySide = segmentWidth >= longestName + SegmentFactsWidth;

  if (pool.summary) {
    return (
      <box flexShrink={0} marginBottom={1} paddingLeft={2}>
        <text wrapMode="none" truncate>
          <b fg={colors.text}>{pool.label.padEnd(LabelWidth)}</b>
          <span fg={colors.faint}>{pool.summary}</span>
        </text>
      </box>
    );
  }

  return (
    <box
      flexDirection="column"
      flexShrink={0}
      marginBottom={1}
      paddingX={1}
      border
      borderStyle="rounded"
      borderColor={colors.border}
      title={` ${pool.label} `}
      titleColor={colors.text}
    >
      {pool.windows.map((window, index) =>
        isSideBySide ? (
          <SideBySideWindow
            key={`${window.kind}:${window.id}`}
            pool={pool}
            window={window}
            isFirst={index === 0}
            segmentWidth={segmentWidth}
          />
        ) : (
          <StackedWindow
            key={`${window.kind}:${window.id}`}
            pool={pool}
            window={window}
            isFirst={index === 0}
            innerWidth={innerWidth}
          />
        )
      )}
      {pool.notices.map(({ name, message }) => (
        <text key={name} fg={colors.faint} marginTop={1} wrapMode="none" truncate>
          {name}: {message}
        </text>
      ))}
    </box>
  );
}
