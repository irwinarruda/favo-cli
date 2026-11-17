import { remainingPercentOf } from '@favo/domain/usage/seat-limits';
import { useKeyboard } from '@opentui/react';
import { useState } from 'react';
import { Dialog } from '@/shared/components/Dialog';
import { KeyHint } from '@/shared/components/KeyHint';
import { useApp } from '@/shared/stores/app';

export function HandoffDialog() {
  const colors = useApp((state) => state.colors);
  const pendingHandoff = useApp((state) => state.pendingHandoff);
  const accounts = useApp((state) => state.accounts);
  const machineLimits = useApp((state) => state.machineLimits);
  const continueHandoff = useApp((state) => state.continueHandoff);
  const closeHandoff = useApp((state) => state.closeHandoff);
  const [highlighted, setHighlighted] = useState(0);
  const sourceAccount = pendingHandoff
    ? accounts.find(
        (account) =>
          account.machineId === pendingHandoff.source.machineId && account.name === pendingHandoff.source.account
      )
    : undefined;
  const candidates = pendingHandoff
    ? (sourceAccount?.visibleSeats ?? []).filter((seat) => seat.key !== pendingHandoff.source.key && seat.isSignedIn)
    : [];
  const candidate = candidates[highlighted];

  useKeyboard((key) => {
    if (!pendingHandoff) return;
    if (key.name === 'escape' || key.name === 'q') closeHandoff();
    if (key.name === 'up') setHighlighted((index) => Math.max(0, index - 1));
    if (key.name === 'down') setHighlighted((index) => Math.min(candidates.length - 1, index + 1));
    if (key.name === 'return' && candidate) void continueHandoff(candidate);
  });

  if (!pendingHandoff) return null;
  const limits = machineLimits[pendingHandoff.source.machineId]?.seats ?? [];
  return (
    <Dialog title="provider usage limit" width={72}>
      <text fg={colors.text}>
        {pendingHandoff.source.label} reached its limit. Continue with a signed-in provider in this same account?
      </text>
      <text fg={colors.faint}>
        Choosing one lets it read the local session transcript.{' '}
        {pendingHandoff.transcript
          ? 'Transcript available.'
          : 'No session transcript was saved; only workspace state will be available.'}
      </text>
      {candidates.length === 0 ? (
        <text fg={colors.faint}>No other signed-in provider is available in this account.</text>
      ) : (
        candidates.map((seat, index) => {
          const usage = limits.find(
            (limit) => limit.account === seat.account && limit.provider === seat.provider
          )?.usage;
          const remaining = usage?.windows[0]
            ? `${remainingPercentOf(usage.windows[0])}% remaining`
            : 'limit unavailable';
          return (
            <text key={seat.key} fg={index === highlighted ? colors.accent : colors.text}>
              {index === highlighted ? '› ' : '  '}
              {seat.label} · {remaining}
            </text>
          );
        })
      )}
      <box flexDirection="row" marginTop={1}>
        {candidate && <KeyHint keys="enter" label="continue" onPress={() => void continueHandoff(candidate)} />}
        <KeyHint keys="esc" label="stop" onPress={closeHandoff} />
      </box>
    </Dialog>
  );
}
