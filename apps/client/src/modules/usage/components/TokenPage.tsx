import { NotABillMessage } from '@favo/domain/usage/token-prices';
import { TokenChartRows, TokenMetric, tokenChartOf } from '@favo/domain/usage/token-report';
import {
  barColumnsOf,
  chartCaptionsOf,
  NoTokensMessage,
  NothingSelectedMessage,
  skippedNoteOf,
  tokenHeadlineOf,
  tokenTypeLinesOf,
  tokenTypesOf,
  unpricedNoteOf,
} from '@favo/domain/usage/token-view';
import { TokenBars } from '@/modules/usage/components/TokenBars';
import { TokenTable } from '@/modules/usage/components/TokenTable';
import type { UsagePageProps } from '@/modules/usage/components/UsagePageProps';
import { Spinner } from '@/shared/components/Spinner';
import { useApp } from '@/shared/stores/app';

const PageChrome = 12;
const MaximumBarStretch = 3;
const MaximumNameWidth = 18;
const FactGap = '      ';

export function TokenPage({ scrollRef, width }: UsagePageProps) {
  const colors = useApp((state) => state.colors);
  const report = useApp((state) => state.tokenReport);
  const timeZone = useApp((state) => state.usageTimeZone);
  const uncounted = useApp((state) => state.uncountedProviders);
  const skippedRecords = useApp((state) => state.skippedTokenRecords);
  const isReading = useApp((state) => state.isTokensReading);
  const hasReadings = useApp((state) => state.hasTokenReadings);
  const isSelectionEmpty = useApp((state) => state.isUsageSelectionEmpty);
  const isCost = report.metric === TokenMetric.cost;
  const room = Math.max(width - PageChrome, 1);
  const chart = tokenChartOf({ report, columns: room, rows: TokenChartRows, timeZone });
  const buckets = chart?.lines[0]?.length ?? 1;
  const stretch = Math.max(1, Math.min(MaximumBarStretch, Math.floor(room / buckets)));
  const chartLines = (chart?.lines ?? []).map((line, row) => ({
    row,
    text: [...line].map((bar) => bar.repeat(stretch)).join(''),
  }));
  const captions = chart
    ? chartCaptionsOf({ chart, barsWidth: buckets * stretch, metric: report.metric, width: room })
    : [];
  const { lead, facts } = tokenHeadlineOf(report);
  const typeLines = tokenTypeLinesOf(tokenTypesOf(report), room);
  const skippedNote = skippedNoteOf(skippedRecords);
  const unpricedNote = isCost ? unpricedNoteOf(report) : undefined;
  const isCounting = isReading && !hasReadings;
  const columns = barColumnsOf(report, MaximumNameWidth);
  const unanswered = report.machines.filter((machine) => machine.note !== undefined);
  const isEmpty = report.total.tokens === 0;

  if (isSelectionEmpty || isCounting || isEmpty) {
    return (
      <scrollbox ref={scrollRef} flexGrow={1} flexShrink={1} paddingX={2} paddingTop={1} minHeight={0}>
        {isSelectionEmpty && <text fg={colors.muted}>{NothingSelectedMessage}</text>}
        {!isSelectionEmpty && isCounting && <Spinner label="counting tokens on every machine…" />}
        {!isSelectionEmpty && !isCounting && <text fg={colors.muted}>{NoTokensMessage}</text>}
        {skippedNote !== undefined && <text fg={colors.faint}>{skippedNote}</text>}
        {!isSelectionEmpty && unanswered.length > 0 && (
          <box flexShrink={0} marginTop={1}>
            <TokenBars title="Machines" groups={unanswered} columns={columns} width={width} />
          </box>
        )}
      </scrollbox>
    );
  }

  return (
    <scrollbox ref={scrollRef} flexGrow={1} flexShrink={1} paddingX={2} paddingTop={1} minHeight={0}>
      <box flexDirection="column" flexShrink={0} paddingLeft={2} marginBottom={1}>
        <text wrapMode="none" truncate>
          <b fg={colors.accent}>{lead}</b>
          <span fg={colors.text}>{facts.map((fact) => `${FactGap}${fact}`).join('')}</span>
        </text>
        {isCost && <text fg={colors.muted}>{NotABillMessage}</text>}
      </box>
      {chart !== undefined && (
        <box flexDirection="column" flexShrink={0} paddingLeft={4} marginBottom={1}>
          {chartLines.map(({ row, text }) => (
            <text key={row} fg={colors.accent} wrapMode="none" truncate>
              {text}
            </text>
          ))}
          {captions.map((caption) => (
            <text key={caption} fg={colors.muted} wrapMode="none" truncate>
              {caption}
            </text>
          ))}
        </box>
      )}
      <TokenBars title="Providers" groups={report.providers} uncounted={uncounted} columns={columns} width={width} />
      <TokenBars title="Accounts" groups={report.accounts} columns={columns} width={width} />
      <TokenBars title="Machines" groups={report.machines} columns={columns} width={width} />
      <box flexDirection="column" flexShrink={0} paddingLeft={2} marginBottom={1}>
        <text fg={colors.text}>Types</text>
        {typeLines.map((line) => (
          <text key={line} fg={colors.muted} wrapMode="none" truncate>{`  ${line}`}</text>
        ))}
      </box>
      <TokenTable width={width} />
      {unpricedNote !== undefined && (
        <text fg={colors.muted} paddingLeft={2} marginTop={1}>
          {unpricedNote}
        </text>
      )}
      {skippedNote !== undefined && (
        <text fg={colors.faint} paddingLeft={2} marginTop={1}>
          {skippedNote}
        </text>
      )}
    </scrollbox>
  );
}
