import { AppLoginState, DesktopLogin } from '@favo/domain/desktop/desktop-app';
import { HookState } from '@favo/domain/hooks/provider-hook';
import { LoginScope, ProviderId } from '@favo/domain/providers/provider';
import type { ValueOf } from '@favo/domain/shared/value-of';
import { SharedItemState } from '@favo/domain/sharing/shared-item';
import { TerminalPlan } from '@favo/domain/terminal/terminal-plan';
import { UpdateRecord } from '@favo/domain/updates/update-outcome';
import { SeatLimits } from '@favo/domain/usage/seat-limits';
import { z } from 'zod';

export const LoginState = {
  signedIn: 'signedIn',
  signedOut: 'signedOut',
  unknown: 'unknown',
  notInstalled: 'notInstalled',
} as const;
export type LoginState = ValueOf<typeof LoginState>;

export const SeatView = z.strictObject({
  account: z.string(),
  provider: z.enum(ProviderId),
  label: z.string(),
  path: z.string(),
  pathHint: z.string(),
  loginScope: z.enum(LoginScope),
  isInstalled: z.boolean(),
  isProvisioned: z.boolean(),
  canLogout: z.boolean(),
});
export type SeatView = z.infer<typeof SeatView>;

export const DesktopAppView = z.strictObject({
  provider: z.enum(ProviderId),
  label: z.string(),
  login: z.enum(DesktopLogin),
  canOpen: z.boolean(),
});
export type DesktopAppView = z.infer<typeof DesktopAppView>;

export const AppLoginStatus = z.strictObject({
  login: z.enum(AppLoginState),
  isOtherAccount: z.boolean(),
});
export type AppLoginStatus = z.infer<typeof AppLoginStatus>;

export const AccountView = z.strictObject({
  name: z.string(),
  displayName: z.string(),
  isPersonal: z.boolean(),
  seats: z.array(SeatView),
});
export type AccountView = z.infer<typeof AccountView>;

export const SeatStatus = z.strictObject({
  login: z.enum(LoginState),
  identity: z.string().optional(),
  plan: z.string().optional(),
  problems: z.number(),
});
export type SeatStatus = z.infer<typeof SeatStatus>;

export const SeatLimitsView = z.strictObject({
  account: z.string(),
  displayName: z.string(),
  provider: z.enum(ProviderId),
  identity: z.string().optional(),
  plan: z.string().optional(),
  usage: SeatLimits,
});
export type SeatLimitsView = z.infer<typeof SeatLimitsView>;

export const SharedItemView = z.strictObject({
  name: z.string(),
  state: z.enum(SharedItemState),
});
export type SharedItemView = z.infer<typeof SharedItemView>;

export const SeatInspection = z.strictObject({
  items: z.array(SharedItemView),
  privateItems: z.array(z.string()),
  unclassified: z.array(z.string()),
  mirrored: z.number(),
});
export type SeatInspection = z.infer<typeof SeatInspection>;

export const SeatRepair = z.strictObject({
  account: z.string(),
  provider: z.enum(ProviderId),
  linked: z.array(z.string()),
  problems: z.array(SharedItemView),
});
export type SeatRepair = z.infer<typeof SeatRepair>;

export const ThreadView = z.strictObject({
  id: z.string(),
  directory: z.string(),
  updatedAt: z.string(),
  isGuess: z.boolean(),
  isDirectoryGone: z.boolean(),
});
export type ThreadView = z.infer<typeof ThreadView>;

export const HookView = z.strictObject({
  provider: z.enum(ProviderId),
  label: z.string(),
  state: z.enum(HookState),
  isProviderInstalled: z.boolean(),
  needsTrust: z.boolean(),
  file: z.string(),
  problems: z.array(z.string()),
});
export type HookView = z.infer<typeof HookView>;

export const ProviderUpdateView = z.strictObject({
  provider: z.enum(ProviderId),
  label: z.string(),
  version: z.string().optional(),
  installedWith: z.string(),
  otherCopies: z.array(z.string()),
  runningAccounts: z.array(z.string()),
  heldBack: z.string().optional(),
  steps: z.array(TerminalPlan),
});
export type ProviderUpdateView = z.infer<typeof ProviderUpdateView>;

export const ProviderVersionView = z.strictObject({
  provider: z.enum(ProviderId),
  label: z.string(),
  version: z.string().optional(),
  installedWith: z.string(),
  lastUpdate: UpdateRecord.optional(),
});
export type ProviderVersionView = z.infer<typeof ProviderVersionView>;
