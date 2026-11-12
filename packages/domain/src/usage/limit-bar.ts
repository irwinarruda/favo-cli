import type { ValueOf } from '#domain/shared/value-of';
import type { LimitPoolMember, LimitPoolWindow } from '#domain/usage/limit-pool';
import { LimitPaceArrows, paceTickOf, readingAgeOf, remainingPercentOf, resetLabelOf } from '#domain/usage/seat-limits';

const MinimumTickWidth = 6;
const PercentWidth = 4;
const LabelWidth = 7;
const LabelGap = '    ';

export const LimitBarPart = {
  left: 'left',
  refill: 'refill',
  track: 'track',
  tick: 'tick',
} as const;
export type LimitBarPart = ValueOf<typeof LimitBarPart>;

const Glyphs: Record<LimitBarPart, string> = { left: '▄', refill: '▂', track: '▁', tick: '█' };

export function limitBarOf(input: {
  remainingPercent: number;
  refillPercent: number;
  tickPercent?: number;
  width: number;
}) {
  const { remainingPercent, refillPercent, tickPercent, width } = input;
  const left = Math.min(cellsOf(remainingPercent, width), remainingPercent < 100 ? width - 1 : width);
  const refill = Math.min(cellsOf(Math.min(100 - remainingPercent, refillPercent), width), width - left);
  const cells = Array.from<unknown, LimitBarPart>({ length: width }, (_, index) => {
    if (index < left) return LimitBarPart.left;
    return index >= width - refill ? LimitBarPart.refill : LimitBarPart.track;
  });
  if (tickPercent !== undefined && width >= MinimumTickWidth) {
    cells[Math.min(Math.round((tickPercent / 100) * width), width - 1)] = LimitBarPart.tick;
  }
  return runsOf(cells);
}

export function limitRowOf(member: LimitPoolMember, width: number, now: number) {
  const { seat, window, refillPercent } = member;
  const remainingPercent = remainingPercentOf(window);
  const bar = limitBarOf({ remainingPercent, refillPercent, tickPercent: paceTickOf(window, now), width });
  const age = seat.usage.unavailable ? readingAgeOf(seat.usage.checkedAt, now) : undefined;
  const facts = [resetLabelOf(window, now), age].filter(Boolean).join(' · ');
  return { bar, percent: `${remainingPercent}%`.padStart(PercentWidth), facts };
}

export function limitHeadlineOf({ label, remainingPercent, pace, restoresPercent }: LimitPoolWindow) {
  const arrow = pace ? `  ${LimitPaceArrows[pace]}` : '';
  const refill = restoresPercent ? `   ↻ +${restoresPercent}%` : '';
  return {
    label: `${label.padEnd(LabelWidth)}${LabelGap}`,
    remaining: `${remainingPercent}% left`,
    facts: `${arrow}${refill}`,
  };
}

function cellsOf(percent: number, width: number) {
  return percent <= 0 ? 0 : Math.max(1, Math.round((percent / 100) * width));
}

function runsOf(cells: LimitBarPart[]) {
  const runs: { offset: number; part: LimitBarPart; text: string }[] = [];
  for (const [offset, part] of cells.entries()) {
    const last = runs.at(-1);
    if (last?.part === part) last.text += Glyphs[part];
    else runs.push({ offset, part, text: Glyphs[part] });
  }
  return runs;
}
