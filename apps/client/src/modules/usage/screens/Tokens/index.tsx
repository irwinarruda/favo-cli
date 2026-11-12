import { TokenKeys } from '@/modules/usage/components/TokenKeys';
import { TokenPage } from '@/modules/usage/components/TokenPage';
import type { UsageKeysProps, UsagePageProps } from '@/modules/usage/components/UsagePageProps';

export function Tokens(props: UsagePageProps) {
  return <TokenPage {...props} />;
}

export function TokensKeys(props: UsageKeysProps) {
  return <TokenKeys {...props} />;
}
