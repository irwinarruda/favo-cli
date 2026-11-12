import { useKeyboard } from '@opentui/react';
import { TokenBreakdown } from '@/modules/usage/app/services/TokensService';
import type { UsageKeysProps } from '@/modules/usage/components/UsagePageProps';
import { KeyHint } from '@/shared/components/KeyHint';
import { useApp } from '@/shared/stores/app';

export function TokenKeys({ isEnabled }: UsageKeysProps) {
  const breakdown = useApp((state) => state.tokenBreakdown);
  const toggleTokenBreakdown = useApp((state) => state.toggleTokenBreakdown);

  useKeyboard((key) => {
    if (isEnabled && key.name === 'b') toggleTokenBreakdown();
  });

  return (
    <KeyHint
      keys="b"
      label={breakdown === TokenBreakdown.models ? 'by day' : 'by model'}
      onPress={toggleTokenBreakdown}
    />
  );
}
