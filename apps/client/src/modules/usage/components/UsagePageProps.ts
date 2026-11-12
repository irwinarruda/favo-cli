import type { ScrollBoxRenderable } from '@opentui/core';
import type { RefObject } from 'react';

export type UsagePageProps = { scrollRef: RefObject<ScrollBoxRenderable | null>; width: number };
export type UsageKeysProps = { isEnabled: boolean };
