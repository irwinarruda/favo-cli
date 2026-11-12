import { type UsageFilterChoice, type UsageFilterGroup, UsageFilterGroups } from '@favo/domain/usage/usage-view';
import type { ScrollBoxRenderable } from '@opentui/core';
import { useKeyboard, useTerminalDimensions } from '@opentui/react';
import { useEffect, useRef } from 'react';
import { Dialog } from '@/shared/components/Dialog';
import { KeyHint } from '@/shared/components/KeyHint';
import { useApp } from '@/shared/stores/app';
import { Hex } from '@/shared/theme/glyphs';

const DialogWidth = 50;
const DialogChrome = 10;
const NameWidth = 26;
const GroupLabels: Record<UsageFilterGroup, string> = {
  machines: 'Machines',
  accounts: 'Accounts',
  providers: 'Providers',
};

type FilterRowProps = { group: UsageFilterGroup; choice: UsageFilterChoice; isCurrent: boolean; onPress(): void };

function FilterRow({ group, choice, isCurrent, onPress }: FilterRowProps) {
  const colors = useApp((state) => state.colors);

  return (
    <box
      id={`filter:${group}:${choice.id}`}
      flexDirection="row"
      flexShrink={0}
      backgroundColor={isCurrent ? colors.selection : undefined}
      onMouseDown={onPress}
    >
      <text wrapMode="none" truncate>
        <span fg={colors.accent}>{isCurrent ? '▸ ' : '  '}</span>
        <span fg={choice.isOn ? colors.accent : colors.faint}>{choice.isOn ? Hex.filled : Hex.hollow}</span>
        <span
          fg={choice.isOn ? colors.text : colors.faint}
        >{` ${choice.name.slice(0, NameWidth).padEnd(NameWidth)}`}</span>
        <span fg={colors.faint}>{`  ${choice.note ?? ''}`}</span>
      </text>
    </box>
  );
}

export function FilterDialog() {
  const { height } = useTerminalDimensions();
  const colors = useApp((state) => state.colors);
  const choices = useApp((state) => state.usageFilterChoices);
  const cursor = useApp((state) => state.usageFilterCursor);
  const moveUsageFilterCursor = useApp((state) => state.moveUsageFilterCursor);
  const toggleUsageFilterAt = useApp((state) => state.toggleUsageFilterAt);
  const keepOnlyUsageFilterAtCursor = useApp((state) => state.keepOnlyUsageFilterAtCursor);
  const clearUsageFilter = useApp((state) => state.clearUsageFilter);
  const closeUsageFilter = useApp((state) => state.closeUsageFilter);
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const groups = UsageFilterGroups.filter((group) => choices[group].length > 0);
  const rows = groups.flatMap((group) => choices[group].map((choice) => ({ group, choice })));
  const current = rows[cursor];
  const currentId = current ? `filter:${current.group}:${current.choice.id}` : undefined;
  const listHeight = Math.min(rows.length + groups.length * 2 - 1, Math.max(height - DialogChrome, 4));

  useKeyboard((key) => {
    if (key.name === 'down' || key.name === 'j') moveUsageFilterCursor(1);
    else if (key.name === 'up' || key.name === 'k') moveUsageFilterCursor(-1);
    else if (key.name === 'space') toggleUsageFilterAt();
    else if (key.name === 'o') keepOnlyUsageFilterAtCursor();
    else if (key.name === 'a') clearUsageFilter();
    else if (key.name === 'escape' || key.name === 'return' || key.name === 'f') closeUsageFilter();
  });

  useEffect(() => {
    if (currentId) scrollRef.current?.scrollChildIntoView(currentId);
  }, [currentId]);

  return (
    <Dialog title="filters" width={DialogWidth}>
      <scrollbox ref={scrollRef} height={listHeight}>
        {groups.map((group, groupIndex) => (
          <box key={group} flexDirection="column" flexShrink={0} marginTop={groupIndex === 0 ? 0 : 1}>
            <text fg={colors.muted}>{GroupLabels[group]}</text>
            {choices[group].map((choice) => {
              const index = rows.findIndex((row) => row.group === group && row.choice.id === choice.id);
              return (
                <FilterRow
                  key={choice.id}
                  group={group}
                  choice={choice}
                  isCurrent={index === cursor}
                  onPress={() => toggleUsageFilterAt(index)}
                />
              );
            })}
          </box>
        ))}
      </scrollbox>
      <box flexDirection="row" flexWrap="wrap" marginTop={1}>
        <KeyHint keys="↑↓" label="move" />
        <KeyHint keys="space" label="toggle" onPress={() => toggleUsageFilterAt()} />
        <KeyHint keys="o" label="only this" onPress={keepOnlyUsageFilterAtCursor} />
        <KeyHint keys="a" label="all" onPress={clearUsageFilter} />
        <KeyHint keys="esc" label="done" onPress={closeUsageFilter} />
      </box>
    </Dialog>
  );
}
