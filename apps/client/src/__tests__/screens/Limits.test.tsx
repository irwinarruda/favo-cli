import { afterEach, describe, expect, test } from 'bun:test';
import { DomainError, DomainErrorCode } from '@favo/domain/shared/domain-error';
import { mockDb } from '@/__tests__/db';
import { renderApp } from '@/__tests__/utils/renderApp';

let dispose: (() => Promise<void>) | undefined;

async function open(screen?: Parameters<typeof renderApp>[0]) {
  const view = await renderApp(screen);
  dispose = view.dispose;
  return view;
}

async function openUsage(screen?: Parameters<typeof renderApp>[0]) {
  const view = await open(screen);
  await view.press('u');
  await view.waitForFrame((frame) => frame.includes('Claude Code') && frame.includes('read just now'));
  return view;
}

afterEach(async () => {
  await dispose?.();
  dispose = undefined;
});

describe('the usage screen', () => {
  test('opens with u and goes back with escape', async () => {
    const { app, captureCharFrame, pressEscape } = await openUsage();
    expect(app.state.isUsageOpen).toBe(true);
    expect(captureCharFrame()).toContain('all machines · all accounts · all providers');
    await pressEscape();
    expect(app.state.isUsageOpen).toBe(false);
    expect(captureCharFrame()).toContain('macbook · this machine');
  });
  test('has its numbers ready the moment it opens', async () => {
    const view = await open();
    await view.waitFor(() => mockDb.limitReads.length === 2 && !view.app.state.isLimitsReading);
    await view.press('u');
    expect(view.captureCharFrame()).toContain('81% left');
    expect(mockDb.limitReads).toHaveLength(2);
  });
  test('opens from the key bar', async () => {
    const { app, clickOn, waitFor } = await open();
    await clickOn('usage');
    await waitFor(() => app.state.isUsageOpen);
  });
  test('shows the pooled headline, the pace and the next reset', async () => {
    const { captureCharFrame } = await openUsage();
    expect(captureCharFrame()).toMatch(/81% left\s+↘\s+↻ \+16%/);
    expect(captureCharFrame()).toContain('55% left');
  });
  test('gives each seat its own column on a wide screen', async () => {
    const { captureCharFrame } = await openUsage();
    const frame = captureCharFrame();
    expect(frame).toMatch(/personal {2}68%\s+↻ 44m\s+work {2}93%\s+↻ 54m/);
    expect(frame).toMatch(/personal {2}75%\s+↻ 2d 12h\s+work {2}35%\s+↻ 1d 11h/);
  });
  test('keeps a seat in the same column in every window', async () => {
    const { captureCharFrame } = await openUsage();
    const lines = captureCharFrame().split('\n');
    const columnsOf = (name: string) => lines.filter((line) => line.includes(`${name}  `)).map((l) => l.indexOf(name));
    expect(new Set(columnsOf('personal')).size).toBe(1);
    expect(new Set(columnsOf('work')).size).toBe(1);
    expect(columnsOf('personal').length).toBeGreaterThanOrEqual(3);
  });
  test('draws the bar under its seat, as wide as the column', async () => {
    const { captureCharFrame } = await openUsage();
    const lines = captureCharFrame().split('\n');
    const label = lines.findIndex((line) => line.includes('personal  68%'));
    const start = lines[label]!.indexOf('personal');
    expect(lines[label + 1]!.slice(start)).toMatch(/^[▄█]+▂+ {3}[▄█]+▂+/);
  });
  test('does not repeat the percentage for a single seat', async () => {
    const { captureCharFrame } = await openUsage();
    const codex = captureCharFrame().split('Codex')[1]!;
    expect(codex).toContain('90% left');
    expect(codex).not.toMatch(/personal\s+90%/);
  });
  test('sums up a provider with no limits in one line', async () => {
    const { captureCharFrame } = await openUsage({ width: 130, height: 50 });
    expect(captureCharFrame()).toMatch(/OpenCode\s+no limits available/);
  });
  test('says when each machine was read, and what happened to the rest', async () => {
    const { captureCharFrame } = await openUsage();
    const frame = captureCharFrame();
    expect(frame).toContain('macbook read just now');
    expect(frame).toContain('devbox read just now');
    expect(frame).toContain('studio offline');
  });
  test('keeps two seats side by side at 80 columns', async () => {
    const { captureCharFrame } = await openUsage({ width: 80, height: 40 });
    const frame = captureCharFrame();
    expect(frame).toMatch(/personal {2}68%\s+↻ 44m\s+work {2}93%\s+↻ 54m/);
    expect(frame).toContain('esc back');
  });
  test('falls back to one row per seat when the columns would not fit', async () => {
    const { captureCharFrame } = await openUsage({ width: 70, height: 50 });
    const frame = captureCharFrame();
    expect(frame).toMatch(/Session\s+81% left/);
    expect(frame).toMatch(/personal\s+[▄█▂]+\s+68%\s+↻ 44m/);
    expect(frame).toMatch(/work\s+[▄█▂]+\s+93%\s+↻ 54m/);
  });
  test('falls back sooner with more seats', async () => {
    const view = await open({ width: 80, height: 50 });
    const [personal] = mockDb.seatLimits.local!;
    const seat = (name: string) => ({ ...personal!, account: name, displayName: name, identity: `${name}@bee.dev` });
    mockDb.seatLimits.local = [personal!, seat('client'), seat('side'), seat('hive')];
    await view.press('u', 'r');
    await view.waitForFrame((frame) => /side\s+[▄█▂]+\s+68%/.test(frame));
  });
  test('scrolls what does not fit', async () => {
    const { captureCharFrame, press, waitForFrame } = await openUsage({ width: 80, height: 16 });
    expect(captureCharFrame()).not.toContain('Codex');
    await press('j', 'j', 'j', 'j', 'j', 'j', 'j', 'j', 'j', 'j', 'j', 'j', 'j', 'j', 'j', 'j');
    await waitForFrame((frame) => frame.includes('Codex'));
  });
  test('refreshes with r and with a click, past the wait', async () => {
    const { clickOn, press, waitFor } = await openUsage();
    mockDb.limitReads = [];
    await press('r');
    await waitFor(() => mockDb.limitReads.length === 2);
    await clickOn('refresh');
    await waitFor(() => mockDb.limitReads.length === 4);
  });
  test('leaves the comb keys alone while it is open', async () => {
    const { app, press } = await openUsage();
    await press('a');
    expect(app.state.isAddAccountOpen).toBe(false);
  });
  test('explains the arrows in help, over the screen', async () => {
    const { app, captureCharFrame, press, pressEscape } = await openUsage();
    await press('?');
    expect(captureCharFrame()).toContain('ahead of, on or under pace');
    await pressEscape();
    expect(app.state.isUsageOpen).toBe(true);
    expect(captureCharFrame()).not.toContain('ahead of, on or under pace');
  });
  test('quits with q', async () => {
    const view = await openUsage();
    await view.press('q');
    expect(view.quitCount).toBe(1);
  });
  test('keeps the rest of the screen when a machine runs an older favo', async () => {
    const view = await open();
    mockDb.limitFailures.devbox = new DomainError(DomainErrorCode.unknownMethod, 'nope');
    await view.press('u', 'r');
    await view.waitForFrame((frame) => frame.includes('devbox older favo') && frame.includes('Claude Code'));
  });
  test('says so when there is nothing to show', async () => {
    const view = await open();
    await view.waitFor(() => mockDb.limitReads.length === 2 && !view.app.state.isLimitsReading);
    mockDb.seatLimits = {};
    await view.press('u', 'r');
    await view.waitForFrame((frame) => frame.includes('No signed in seat reports limits.'));
  });
});
