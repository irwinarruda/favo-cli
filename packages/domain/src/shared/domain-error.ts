import type { ValueOf } from './value-of';

export const DomainErrorCode = {
  invalidAccountName: 'invalidAccountName',
  accountExists: 'accountExists',
  accountNotFound: 'accountNotFound',
  accountIsPersonal: 'accountIsPersonal',
  unknownProvider: 'unknownProvider',
  providerNotInstalled: 'providerNotInstalled',
  logoutUnsupported: 'logoutUnsupported',
  desktopAppMissing: 'desktopAppMissing',
  desktopAppFailed: 'desktopAppFailed',
  desktopAppStuck: 'desktopAppStuck',
  adoptSourceMissing: 'adoptSourceMissing',
  adoptTargetExists: 'adoptTargetExists',
  adoptSourceProtected: 'adoptSourceProtected',
  invalidMachineName: 'invalidMachineName',
  invalidMachineTarget: 'invalidMachineTarget',
  machineExists: 'machineExists',
  machineNotFound: 'machineNotFound',
  machineUnreachable: 'machineUnreachable',
  machineNeedsInstall: 'machineNeedsInstall',
  machineOutdated: 'machineOutdated',
  unsupportedPlatform: 'unsupportedPlatform',
  assetMissing: 'assetMissing',
  directoryNotFound: 'directoryNotFound',
  threadNotFound: 'threadNotFound',
  invalidConfig: 'invalidConfig',
  invalidTheme: 'invalidTheme',
  themeNotFound: 'themeNotFound',
  invalidParams: 'invalidParams',
  unsafeArgument: 'unsafeArgument',
  unknownMethod: 'unknownMethod',
  updateNotStarted: 'updateNotStarted',
  logUnreadable: 'logUnreadable',
  pricesUnavailable: 'pricesUnavailable',
  internal: 'internal',
} as const;
export type DomainErrorCode = ValueOf<typeof DomainErrorCode>;

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export function assertDomain(condition: unknown, code: DomainErrorCode, message: string): asserts condition {
  if (!condition) throw new DomainError(code, message);
}
