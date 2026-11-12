import { useKeyboard } from '@opentui/react';
import { Dialog } from '@/shared/components/Dialog';
import { useApp } from '@/shared/stores/app';

export const CombHelpKeys = [
  ['↑ ↓ / j k', 'move between seats'],
  ['← → / h l', 'move between accounts'],
  ['tab', 'next machine'],
  ['enter', 'launch, or sign in'],
  ['b', 'go back to a thread'],
  ['s / o', 'sign in / sign out'],
  ['c', 'copy the config path'],
  ['p', 'open the desktop app'],
  ['u', 'limits, tokens and cost'],
  ['v', 'every provider CLI version'],
  ['a / n / x', 'add / rename / delete a cell'],
  ['m / X', 'add / forget a machine'],
  ['i', 'install or update favo there'],
  ['U', 'update favo everywhere'],
  ['P', 'update every provider CLI'],
  ['r / R', 'refresh / mend shared links'],
  ['d', 'choose the launch folder'],
  ['t', 'change the theme'],
  ['q', 'quit'],
  ['↗ → ↘', 'ahead of, on or under pace'],
  ['▄ ▂ ▁ █', 'left, next reset, rest, pace'],
];

type HelpDialogProps = { keys?: string[][]; onClose(): void };

export function HelpDialog({ keys = CombHelpKeys, onClose }: HelpDialogProps) {
  const colors = useApp((state) => state.colors);
  useKeyboard((key) => {
    if (key.name === 'escape' || key.sequence === '?' || key.name === 'return') onClose();
  });

  return (
    <Dialog title="keys" width={46}>
      {keys.map(([hint, label]) => (
        <text key={hint}>
          <span fg={colors.accent}>{hint!.padEnd(12)}</span>
          <span fg={colors.text}>{label}</span>
        </text>
      ))}
    </Dialog>
  );
}
