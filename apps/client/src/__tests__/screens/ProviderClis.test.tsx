import { afterEach, describe, expect, test } from 'bun:test';
import { mockDb } from '@/__tests__/db';
import { renderApp } from '@/__tests__/utils/renderApp';

let dispose: (() => Promise<void>) | undefined;

async function open(screen?: Parameters<typeof renderApp>[0]) {
  const view = await renderApp(screen);
  dispose = view.dispose;
  return view;
}

async function openClis(screen?: Parameters<typeof renderApp>[0]) {
  const view = await open(screen);
  await view.press('v');
  await view.waitForFrame((frame) => frame.includes('Provider CLIs') && frame.includes('2.1.290'));
  return view;
}

afterEach(async () => {
  await dispose?.();
  dispose = undefined;
});

describe('the provider CLIs screen', () => {
  test('opens with v and goes back with escape or v', async () => {
    const { app, captureCharFrame, press, pressEscape } = await openClis();
    expect(captureCharFrame()).toContain('what each machine has installed');
    await pressEscape();
    expect(app.state.isProviderClisOpen).toBe(false);
    expect(captureCharFrame()).toContain('macbook · this machine');
    await press('v');
    expect(app.state.isProviderClisOpen).toBe(true);
    await press('v');
    expect(app.state.isProviderClisOpen).toBe(false);
  });
  test('opens from the key bar', async () => {
    const { app, clickOn, waitFor } = await open();
    await clickOn('versions');
    await waitFor(() => app.state.isProviderClisOpen);
  });
  test('shows each version and how it got there, machine by machine', async () => {
    const { captureCharFrame } = await openClis();
    const frame = captureCharFrame();
    expect(frame).toMatch(/macbook\s+2\.1\.316\s+Homebrew cask claude-code/);
    expect(frame).toMatch(/devbox\s+2\.1\.290 older\s+npm in \/home\/bee/);
  });
  test('colors a version that is older than elsewhere like a failure', async () => {
    const { captureSpans } = await openClis();
    const spans = captureSpans().lines.flatMap((line) => line.spans);
    const colorOf = (text: string) => spans.find((span) => span.text.includes(text))?.fg.toString();
    expect(colorOf('2.1.290 older')).toBe(colorOf('the last update failed'));
    expect(colorOf('2.1.316')).not.toBe(colorOf('2.1.290 older'));
  });
  test('says what the last update did to each provider', async () => {
    const { captureCharFrame } = await openClis();
    const frame = captureCharFrame();
    expect(frame).toContain('the last update failed, exit 1 · 1d 2h ago');
    expect(frame).toContain('left alone: it is pinned in Homebrew');
  });
  test('names what happened to the machines it could not read', async () => {
    const { captureCharFrame } = await openClis();
    const frame = captureCharFrame();
    expect(frame).toContain('macbook 3 CLIs');
    expect(frame).toContain('studio offline');
  });
  test('refreshes with r', async () => {
    const { press, waitFor } = await openClis();
    mockDb.providerVersionReads = [];
    await press('r');
    await waitFor(() => mockDb.providerVersionReads.length === 2);
  });
  test('fits 80 columns', async () => {
    const { captureCharFrame } = await openClis({ width: 80, height: 40 });
    const frame = captureCharFrame();
    expect(frame).toMatch(/devbox\s+2\.1\.290 older/);
    expect(frame).toContain('esc back');
  });
  test('updates every machine with P, showing each CLI as it goes', async () => {
    const { app, press, captureCharFrame, waitForFrame } = await openClis();
    expect(captureCharFrame()).toContain('P update all');
    await press('P');
    expect(captureCharFrame()).toContain('Update the provider CLIs on every machine?');
    await press('y');
    const frame = await waitForFrame((current) => current.includes('updating · just now'));
    expect(frame).toContain('updating in the background');
    expect(frame).toContain('devbox updating…');
    for (const [machineId, versions] of Object.entries(mockDb.providerVersions)) {
      mockDb.providerVersions[machineId] = versions.map((view) => ({ ...view, lastUpdate: undefined }));
    }
    while (app.state.isUpdatingProviderClis) await Bun.sleep(20);
  });
  test('shows what changed once each machine is done', async () => {
    const { press, waitForFrame } = await openClis();
    mockDb.providerUpdateOutcomes.local = {};
    mockDb.providerUpdateOutcomes.devbox = { claude: { version: '2.1.316' } };
    await press('P');
    await press('y');
    const frame = await waitForFrame((current) => current.includes('updated from 2.1.290'));
    expect(frame).toContain('no change');
    expect(frame).toContain('Updated Claude Code on devbox.');
    expect(frame).not.toContain('2.1.290 older');
  });
  test('asks to update every machine from the key bar too', async () => {
    const { clickOn, waitForFrame } = await openClis();
    await clickOn('update all');
    await waitForFrame((frame) => frame.includes('Update the provider CLIs on every machine?'));
  });
  test('goes back to the list when the question is turned down', async () => {
    const { app, press, pressEscape, captureCharFrame } = await openClis();
    await press('P');
    await pressEscape();
    expect(app.state.isProviderClisOpen).toBe(true);
    expect(captureCharFrame()).not.toContain('Update the provider CLIs on every machine?');
    expect(mockDb.providerUpdateStarts).toEqual([]);
  });
  test('lists the key in the help', async () => {
    const { press, captureCharFrame } = await open();
    await press('?');
    expect(captureCharFrame()).toContain('every provider CLI version');
  });
});
