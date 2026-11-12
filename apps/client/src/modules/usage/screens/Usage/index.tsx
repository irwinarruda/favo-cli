import { UsagePage, UsagePageLabels, UsagePages, UsagePeriods } from '@favo/domain/usage/usage-view';
import type { ScrollBoxRenderable } from '@opentui/core';
import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { type ReactNode, useEffect, useRef } from 'react';
import type { UsageKeysProps, UsagePageProps } from '@/modules/usage/components/UsagePageProps';
import { Cost, CostKeys } from '@/modules/usage/screens/Cost';
import { Limits } from '@/modules/usage/screens/Limits';
import { Tokens, TokensKeys } from '@/modules/usage/screens/Tokens';
import { FilterDialog } from '@/modules/usage/screens/Usage/FilterDialog';
import { KeyHint } from '@/shared/components/KeyHint';
import { useError } from '@/shared/error/useError';
import { useApp } from '@/shared/stores/app';
import { Hex } from '@/shared/theme/glyphs';

const TickMs = 15_000;
const WideKeyBarWidth = 96;
const TabKeys: Record<string, UsagePage> = { l: UsagePage.limits, t: UsagePage.tokens, c: UsagePage.cost };

type PageParts = { Body(props: UsagePageProps): ReactNode; Keys?(props: UsageKeysProps): ReactNode };

const Pages: Record<UsagePage, PageParts> = {
  [UsagePage.limits]: { Body: Limits },
  [UsagePage.tokens]: { Body: Tokens, Keys: TokensKeys },
  [UsagePage.cost]: { Body: Cost, Keys: CostKeys },
};

type UsageProps = { isEnabled: boolean; onHelp(): void; onQuit(): void };

export function Usage({ isEnabled, onHelp, onQuit }: UsageProps) {
  const colors = useApp((state) => state.colors);
  const { width } = useTerminalDimensions();
  const page = useApp((state) => state.usagePage);
  const period = useApp((state) => state.usagePeriod);
  const filterSummary = useApp((state) => state.usageFilterSummary);
  const isFiltered = useApp((state) => state.isUsageFiltered);
  const isFilterOpen = useApp((state) => state.isUsageFilterOpen);
  const readingLabel = useApp((state) => state.tokenReadingLabel);
  const closeUsage = useApp((state) => state.closeUsage);
  const refreshUsage = useApp((state) => state.refreshUsage);
  const tickUsage = useApp((state) => state.tickUsage);
  const showUsagePage = useApp((state) => state.showUsagePage);
  const stepUsagePage = useApp((state) => state.stepUsagePage);
  const showUsagePeriod = useApp((state) => state.showUsagePeriod);
  const stepUsagePeriod = useApp((state) => state.stepUsagePeriod);
  const openUsageFilter = useApp((state) => state.openUsageFilter);
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const error = useError();
  const { Body, Keys } = Pages[page];
  const hasPeriods = page !== UsagePage.limits;
  const areKeysOn = isEnabled && !isFilterOpen;
  const isWide = width >= WideKeyBarWidth;

  useKeyboard((key) => {
    if (!areKeysOn) return;
    const tab = TabKeys[key.name];
    const periodByNumber = UsagePeriods[Number(key.name) - 1];
    if (key.sequence === '?') onHelp();
    else if (key.name === 'escape' || key.name === 'u') closeUsage();
    else if (key.name === 'q') onQuit();
    else if (key.name === 'r') void error.handle(refreshUsage)();
    else if (key.name === 'f') openUsageFilter();
    else if (tab) void error.handle(showUsagePage)(tab);
    else if (key.name === 'tab') void error.handle(stepUsagePage)(key.shift ? -1 : 1);
    else if (key.name === 'left') void error.handle(stepUsagePeriod)(-1);
    else if (key.name === 'right') void error.handle(stepUsagePeriod)(1);
    else if (periodByNumber) void error.handle(showUsagePeriod)(periodByNumber);
    else if (key.name === 'down' || key.name === 'j') scrollRef.current?.scrollBy(1);
    else if (key.name === 'up' || key.name === 'k') scrollRef.current?.scrollBy(-1);
  });

  useEffect(() => {
    const timer = setInterval(tickUsage, TickMs);
    return () => clearInterval(timer);
  }, []);

  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width="100%"
      height="100%"
      flexDirection="column"
      backgroundColor={colors.background}
    >
      <box flexDirection="row" justifyContent="space-between" paddingX={2} paddingTop={1} flexShrink={0}>
        <box flexDirection="row" flexShrink={0}>
          <text>
            <span fg={colors.accent}>{Hex.filled}</span>
            <b fg={colors.text}> Usage</b>
          </text>
          {UsagePages.map((tab, index) => (
            <box key={tab} marginLeft={index === 0 ? 4 : 2} onMouseDown={() => void error.handle(showUsagePage)(tab)}>
              <text>
                {tab === page ? (
                  <b fg={colors.accent}>{UsagePageLabels[tab]}</b>
                ) : (
                  <span fg={colors.muted}>{UsagePageLabels[tab]}</span>
                )}
              </text>
            </box>
          ))}
        </box>
        <box flexDirection="row" flexShrink={0}>
          {UsagePeriods.map((each) => (
            <box key={each} marginLeft={2} onMouseDown={() => void error.handle(showUsagePeriod)(each)}>
              <text>
                {hasPeriods && each === period ? (
                  <b fg={colors.accent}>{each}</b>
                ) : (
                  <span fg={hasPeriods ? colors.muted : colors.faint}>{each}</span>
                )}
              </text>
            </box>
          ))}
        </box>
      </box>
      <box flexDirection="row" justifyContent="space-between" paddingX={2} flexShrink={0}>
        <box flexShrink={1} marginRight={2} onMouseDown={openUsageFilter}>
          <text fg={isFiltered ? colors.accent : colors.muted} wrapMode="none" truncate>
            {filterSummary}
          </text>
        </box>
        {hasPeriods && <text fg={colors.muted}>{readingLabel}</text>}
      </box>
      <Body scrollRef={scrollRef} width={width} />
      <box flexDirection="row" paddingX={2} flexShrink={0} height={1} overflow="hidden">
        <KeyHint keys="r" label="refresh" onPress={error.handle(refreshUsage)} />
        <KeyHint keys="f" label="filters" onPress={openUsageFilter} />
        {isWide && <KeyHint keys="tab" label="tabs" onPress={() => void error.handle(stepUsagePage)(1)} />}
        {hasPeriods && <KeyHint keys="←→" label="period" onPress={() => void error.handle(stepUsagePeriod)(1)} />}
        {Keys !== undefined && <Keys isEnabled={areKeysOn} />}
        {isWide && <KeyHint keys="↑↓" label="scroll" />}
        <KeyHint keys="esc" label="back" onPress={closeUsage} />
        <KeyHint keys="?" label="help" onPress={onHelp} />
        <KeyHint keys="q" label="quit" onPress={onQuit} />
      </box>
      {isFilterOpen && <FilterDialog />}
    </box>
  );
}
