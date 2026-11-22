import { z } from 'zod';
import type { ValueOf } from '#domain/shared/value-of';
import { SignedInstall } from '#domain/updates/signed-install';

export const UpdateState = {
  updating: 'updating',
  failed: 'failed',
  stopped: 'stopped',
  leftAlone: 'leftAlone',
} as const;
export type UpdateState = ValueOf<typeof UpdateState>;

export const RunningReason = 'it is running';

export const UpdateOutcome = z.strictObject({
  state: z.enum(UpdateState),
  from: z.string().optional(),
  reason: z.string().optional(),
});
export type UpdateOutcome = z.infer<typeof UpdateOutcome>;

export const UpdateRecord = z.strictObject({
  ...UpdateOutcome.shape,
  at: z.string(),
});
export type UpdateRecord = z.infer<typeof UpdateRecord>;

export const SavedUpdate = z.strictObject({
  ...UpdateRecord.shape,
  pid: z.number().optional(),
  signedInstall: SignedInstall.optional(),
});
export type SavedUpdate = z.infer<typeof SavedUpdate>;

export function settledRecordOf(
  { pid: _pid, signedInstall: _signedInstall, ...record }: SavedUpdate,
  isUpdaterAlive: boolean
): UpdateRecord {
  if (record.state !== UpdateState.updating || isUpdaterAlive) return record;
  return { ...record, state: UpdateState.stopped };
}

export function isLeftWhileRunning(record?: UpdateRecord) {
  return record?.state === UpdateState.leftAlone && record.reason === RunningReason;
}
