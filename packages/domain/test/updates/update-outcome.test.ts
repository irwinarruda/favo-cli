import { describe, expect, it } from 'bun:test';
import { isLeftWhileRunning, RunningReason, settledRecordOf, UpdateState } from '#domain/updates/update-outcome';

const At = '2026-11-04T12:00:00.000Z';

describe('what the last update of a provider says', () => {
  it('keeps an update that is still going, without the process that runs it', () => {
    const record = { state: UpdateState.updating, from: '2.1.300', at: At };
    expect(settledRecordOf({ ...record, pid: 4242 }, true)).toEqual(record);
  });
  it('calls an update whose process is gone stopped, not updating forever', () => {
    const record = { state: UpdateState.updating, from: '2.1.300', at: At };
    expect(settledRecordOf({ ...record, pid: 4242 }, false)).toEqual({ ...record, state: UpdateState.stopped });
  });
  it('keeps the signers it remembered to itself', () => {
    const record = { state: UpdateState.updating, at: At };
    const signedInstall = {
      folder: '/opt/homebrew/Caskroom/codex/0.171.0',
      signers: { 'bin/codex': 'identifier codex' },
    };
    expect(settledRecordOf({ ...record, signedInstall }, true)).toEqual(record);
  });
  it('leaves a finished update as it is', () => {
    const record = { state: UpdateState.failed, from: '2.1.300', reason: 'exit 1', at: At };
    expect(settledRecordOf(record, false)).toEqual(record);
  });
});

describe('an update left alone because the provider was running', () => {
  it('is told apart from one left alone for another reason', () => {
    expect(isLeftWhileRunning({ state: UpdateState.leftAlone, reason: RunningReason, at: At })).toBe(true);
    expect(isLeftWhileRunning({ state: UpdateState.leftAlone, reason: 'it is pinned in Homebrew', at: At })).toBe(
      false
    );
    expect(isLeftWhileRunning({ state: UpdateState.failed, reason: RunningReason, at: At })).toBe(false);
    expect(isLeftWhileRunning(undefined)).toBe(false);
  });
});
