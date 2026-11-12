import { type UpdateRecord, UpdateState } from '@favo/domain/updates/update-outcome';
import { formatDuration } from '@favo/domain/usage/seat-limits';

const Minute = 60_000;

export function updateNoteOf(update: UpdateRecord, now: number) {
  const age = now - Date.parse(update.at);
  return `${whatHappened(update)} · ${age < Minute ? 'just now' : `${formatDuration(age)} ago`}`;
}

function whatHappened({ state, reason }: UpdateRecord) {
  if (state === UpdateState.updating) return 'updating';
  if (state === UpdateState.failed) return reason ? `the last update failed, ${reason}` : 'the last update failed';
  if (state === UpdateState.stopped) return 'the last update stopped before it finished';
  return reason ? `left alone: ${reason}` : 'left alone';
}
