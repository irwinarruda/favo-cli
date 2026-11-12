import { NothingSelectedMessage } from '@favo/domain/usage/token-view';
import type { UsagePageProps } from '@/modules/usage/components/UsagePageProps';
import { PoolSection } from '@/modules/usage/screens/Limits/PoolSection';
import { Spinner } from '@/shared/components/Spinner';
import { useApp } from '@/shared/stores/app';

export function Limits({ scrollRef, width }: UsagePageProps) {
  const colors = useApp((state) => state.colors);
  const pools = useApp((state) => state.limitPools);
  const lines = useApp((state) => state.limitMachineLines);
  const isReading = useApp((state) => state.isLimitsReading);
  const isSelectionEmpty = useApp((state) => state.isUsageSelectionEmpty);
  const isEmpty = pools.length === 0 && !isSelectionEmpty;

  return (
    <>
      <box flexDirection="row" flexWrap="wrap" columnGap={2} paddingX={2} paddingBottom={1} flexShrink={0}>
        {lines.map(({ id, name, label, isOld }) => (
          <text key={id}>
            <span fg={isOld ? colors.faint : colors.text}>{name}</span>
            <span fg={isOld ? colors.faint : colors.muted}> {label}</span>
          </text>
        ))}
      </box>
      <scrollbox ref={scrollRef} flexGrow={1} flexShrink={1} paddingX={1} minHeight={0}>
        {pools.map((pool) => (
          <PoolSection key={pool.provider} pool={pool} width={width} />
        ))}
        {isSelectionEmpty && <text fg={colors.muted}>{NothingSelectedMessage}</text>}
        {isEmpty && isReading && <Spinner label="reading every seat…" />}
        {isEmpty && !isReading && <text fg={colors.muted}>No signed in seat reports limits.</text>}
      </scrollbox>
    </>
  );
}
