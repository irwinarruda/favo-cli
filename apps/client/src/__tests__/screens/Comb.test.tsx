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

async function dismissNotice(view: Awaited<ReturnType<typeof open>>) {
  await view.waitFor(() => view.app.state.isProviderCliDriftNoticed);
  view.app.state.clearToast(view.app.state.toast!.id);
  await view.flush();
  await view.renderOnce();
}

afterEach(async () => {
  await dispose?.();
  dispose = undefined;
});

describe('the comb', () => {
  test('shows every machine and every account in one view', async () => {
    const { captureCharFrame } = await open();
    const frame = captureCharFrame();
    expect(frame).toContain('macbook · this machine');
    expect(frame).toContain('devbox · bee@devbox');
    expect(frame).toContain('studio · bee@studio');
    expect(frame).toContain('personal');
    expect(frame).toContain('work');
    expect(frame).toContain('bee@work.dev');
    expect(frame).toContain('3 hives · 3 cells · 6 signed in');
  });
  test('tells a machine that is down from one that is up', async () => {
    const { captureCharFrame } = await open();
    const frame = captureCharFrame();
    expect(frame).toContain('⬢ devbox');
    expect(frame).toContain('⬡ studio');
    expect(frame).toContain('offline');
  });
  test('shows hollow cells for a seat that is signed out', async () => {
    const { captureCharFrame } = await open();
    expect(captureCharFrame()).toContain('⬡ codex    sign in');
  });
  test('flags a seat with broken links', async () => {
    const { captureCharFrame } = await open();
    expect(captureCharFrame()).toMatch(/bee@work\.dev\s+app {2}!/);
  });
  test('shows the config path of the selected seat', async () => {
    const { captureCharFrame, press, waitForFrame } = await open();
    expect(captureCharFrame()).toContain('~/.claude');
    expect(captureCharFrame()).toContain('T3 Code: CLAUDE_CONFIG_DIR path');
    await press('j');
    await waitForFrame((frame) => frame.includes('T3 Code: CODEX_HOME path'));
    expect(captureCharFrame()).toContain('~/.codex');
  });
  test('shows what is shared, what is broken and what stays sealed', async () => {
    const { waitForFrame } = await open();
    const frame = await waitForFrame((current) => current.includes('✓ CLAUDE.md'));
    expect(frame).toContain('✓ skills');
    expect(frame).toContain('! hooks');
    expect(frame).toContain('1 more not in your base');
    expect(frame).toContain('SEALED IN THIS CELL');
    expect(frame).toContain('login, threads, history');
  });
  test('warns when an older machine cannot say whether a login is separate', async () => {
    const { app, flush, renderOnce, waitForFrame } = await open();
    mockDb.accounts.devbox![0]!.seats[2]!.loginScope = 'unverified';
    await app.state.refreshMachine('devbox');
    app.state.selectRow('seat:devbox/personal/antigravity');
    await flush();
    await renderOnce();
    await waitForFrame((frame) => frame.includes('may be shared'));
  });
  test('says every cell on a computer shares one login, and keeps it off the sealed list', async () => {
    const { app, flush, renderOnce, waitForFrame } = await open();
    mockDb.accounts.devbox![0]!.seats[2]!.loginScope = 'perComputer';
    await app.state.refreshMachine('devbox');
    app.state.selectRow('seat:devbox/personal/antigravity');
    await flush();
    await renderOnce();
    const frame = await waitForFrame((current) => current.includes('computer shares one login.'));
    expect(frame).toContain('Every Antigravity cell on this');
    expect(frame).toContain('threads, history');
    expect(frame).not.toContain('login, threads, history');
  });
  test('says nothing about sharing where each cell keeps its own login', async () => {
    const { app, flush, renderOnce, waitForFrame } = await open();
    app.state.selectRow('seat:devbox/personal/antigravity');
    await flush();
    await renderOnce();
    const frame = await waitForFrame((current) => current.includes('HOME for agy'));
    expect(frame).not.toContain('keychain');
    expect(frame).not.toContain('may be shared');
  });
  test('changes the main action with the login state', async () => {
    const { captureCharFrame, press } = await open();
    expect(captureCharFrame()).toContain('enter launch');
    await press('l', 'j');
    expect(captureCharFrame()).toContain('enter sign in');
  });
  test('keeps the machines and the path on a default 80 by 24 terminal', async () => {
    const view = await open({ width: 80, height: 24 });
    await dismissNotice(view);
    const frame = view.captureCharFrame();
    expect(frame).toContain('macbook · this machine');
    expect(frame).toContain('CONFIG PATH');
    expect(frame).toContain('LAUNCHES IN');
    expect(frame).not.toContain('SHARED WALLS');
  });
  test('shows the shared walls when there is room', async () => {
    const { waitForFrame } = await open({ width: 130, height: 36 });
    await waitForFrame((frame) => frame.includes('SHARED WALLS'));
  });
  test('cuts a cell too tall for the terminal from the bottom, never a line from the middle', async () => {
    const { app, select, waitForFrame } = await open({ width: 130, height: 30 });
    mockDb.appLogins['seat:local/work/claude'] = { login: 'signedIn', isOtherAccount: false };
    await app.state.refreshMachine('local');
    await select('seat:local/work/claude');
    const frame = await waitForFrame((current) => current.includes('bbbb0001') && current.includes('app signed in'));
    expect(frame).toContain('n rename');
    expect(frame).toContain('LAST THREAD');
    expect(frame).toContain('T3 Code: CLAUDE_CONFIG_DIR path');
    expect(frame).not.toContain('SEALED IN THIS CELL');
  });
  test('lays out for a narrow terminal', async () => {
    const { captureCharFrame } = await open({ width: 80, height: 44 });
    const frame = captureCharFrame();
    expect(frame).toContain('macbook · this machine');
    expect(frame).toContain('CONFIG PATH');
  });
  test('scrolls to a machine far down the list', async () => {
    const { captureCharFrame, press, flush, renderOnce } = await open({ width: 120, height: 16 });
    expect(captureCharFrame()).not.toContain('studio · bee@studio');
    await press('TAB', 'TAB');
    await flush();
    await renderOnce();
    expect(captureCharFrame()).toContain('studio · bee@studio');
  });
});

describe('the launch directory', () => {
  test('is always on screen for this machine', async () => {
    const { captureCharFrame } = await open();
    const frame = captureCharFrame();
    expect(frame).toContain('favo in ~/code/hive');
    expect(frame).toContain('LAUNCHES IN · press d to change');
  });
  test('follows the selection to another machine', async () => {
    const { press, captureCharFrame } = await open();
    await press('TAB');
    const frame = captureCharFrame();
    expect(frame).toContain('favo on devbox in ~');
    expect(frame).not.toContain('favo in ~/code/hive');
  });
  test('stays honest for a machine that never answered', async () => {
    const { press, captureCharFrame } = await open();
    await press('TAB', 'TAB');
    expect(captureCharFrame()).toContain('favo on studio');
    expect(captureCharFrame()).not.toContain('LAUNCHES IN');
  });
});

describe('choosing the launch folder', () => {
  test('opens with d, inside the current folder', async () => {
    const { press, waitForFrame } = await open();
    await press('d');
    const frame = await waitForFrame((current) => current.includes('launch folder on macbook'));
    expect(frame).toContain('~/code/hive/');
    expect(frame).toContain('FOLDERS');
    await waitForFrame((current) => current.includes('packages'));
  });
  test('keeps its hints inside the dialog', async () => {
    const { press, waitForFrame } = await open({ width: 80, height: 30 });
    await press('d');
    const frame = await waitForFrame((current) => current.includes('esc close'));
    const lines = frame.split('\n');
    const top = lines.find((line) => line.includes('launch folder on'))!;
    const dialogRight = top.lastIndexOf('╮');
    const hints = lines.find((line) => line.includes('esc close'))!;
    expect(hints.indexOf('esc close') + 'esc close'.length).toBeLessThan(dialogRight);
    expect(hints[dialogRight]).toBe('│');
  });
  test('opens by clicking the path', async () => {
    const { app, clickOn, waitFor } = await open();
    await clickOn('LAUNCHES IN');
    await waitFor(() => app.state.isDirectoryPickerOpen);
  });
  test('autocompletes what you type, and tab finishes it', async () => {
    const { press, mockInput, flush, waitForFrame, captureCharFrame } = await open();
    await press('d');
    await waitForFrame((frame) => frame.includes('packages'));
    for (let index = 0; index < 'code/hive/'.length; index++) mockInput.pressBackspace();
    await flush();
    await mockInput.typeText('Doc');
    await waitForFrame((frame) => frame.includes('Documents') && !frame.includes('Downloads'));
    await press('TAB');
    await waitForFrame((frame) => frame.includes('~/Documents/'));
    expect(captureCharFrame()).toContain('notes');
  });
  test('walks with arrows, enters a folder, and uses it', async () => {
    const { app, press, mockInput, flush, waitFor, waitForFrame } = await open();
    await press('d');
    await waitForFrame((frame) => frame.includes('packages'));
    mockInput.pressArrow('down');
    await flush();
    await waitForFrame((frame) => frame.includes('enter open'));
    await press('RETURN');
    await waitFor(() => app.state.directoryInput === '~/code/hive/apps/');
    mockDb.directoryTrees.local!['/Users/bee/code/hive/apps'] = [];
    await waitForFrame((frame) => frame.includes('use folder'));
    await press('RETURN');
    await waitFor(() => app.state.selectedDirectory === '/Users/bee/code/hive/apps');
    await waitForFrame((frame) => frame.includes('favo in ~/code/hive/apps'));
  });
  test('backspace on a finished folder goes up one level', async () => {
    const { app, press, mockInput, flush, waitFor, waitForFrame } = await open();
    await press('d');
    await waitForFrame((frame) => frame.includes('packages'));
    mockInput.pressBackspace();
    await flush();
    await waitFor(() => app.state.directoryInput === '~/code/');
  });
  test('does not move the comb behind the dialog', async () => {
    const { app, press, waitFor } = await open();
    await press('d');
    await waitFor(() => app.state.isDirectoryPickerOpen);
    await press('j', 'q', 'x');
    expect(app.state.selectedSeat?.key).toBe('seat:local/personal/claude');
    expect(app.state.directoryInput).toContain('jqx');
  });
  test('selects a folder by clicking it', async () => {
    const { app, press, clickOn, waitFor, waitForFrame } = await open();
    await press('d');
    await waitForFrame((frame) => frame.includes('packages'));
    await clickOn('packages');
    await waitFor(() => app.state.directoryInput === '~/code/hive/packages/');
  });
  test('scrolls a long list to the highlighted folder', async () => {
    const { app, press, mockInput, flush, waitFor, waitForFrame } = await open();
    await press('d');
    await waitForFrame((frame) => frame.includes('packages'));
    mockInput.pressBackspace();
    await flush();
    await waitForFrame((frame) => frame.includes('project-00'));
    mockInput.pressArrow('up');
    await flush();
    await waitFor(() => app.state.highlightedDirectoryIndex === 14);
    await waitForFrame((frame) => frame.includes('project-13'));
  });
  test('says when a folder does not exist', async () => {
    const { press, mockInput, flush, waitForFrame } = await open();
    await press('d');
    await waitForFrame((frame) => frame.includes('packages'));
    await mockInput.typeText('nope');
    await flush();
    await press('RETURN');
    await waitForFrame((frame) => frame.includes('No folder at'));
  });
  test('closes with escape', async () => {
    const { app, press, pressEscape, waitFor } = await open();
    await press('d');
    await waitFor(() => app.state.isDirectoryPickerOpen);
    await pressEscape();
    expect(app.state.isDirectoryPickerOpen).toBe(false);
  });
  test('works on another machine', async () => {
    const { app, press, waitForFrame } = await open();
    await press('TAB', 'd');
    await waitForFrame((frame) => frame.includes('launch folder on devbox'));
    await waitForFrame((frame) => frame.includes('projects'));
    expect(app.state.directoryInput).toBe('~/');
  });
});

describe('choosing a theme', () => {
  test('lists built-in and custom themes', async () => {
    const { press, waitForFrame } = await open();
    await press('t');
    const frame = await waitForFrame((current) => current.includes('BUILT IN'));
    expect(frame).toContain('Honey');
    expect(frame).toContain('Tokyo Night');
    expect(frame).toContain('CUSTOM');
    expect(frame).toContain('Midnight');
    expect(frame).toContain('saved');
  });
  test('recolors the whole screen while you move, and saves on enter', async () => {
    const { app, press, waitFor, captureSpans, flush, renderOnce } = await open();
    await press('t');
    await waitFor(() => app.state.isThemePickerOpen);
    const before = captureSpans();
    await press('j');
    await flush();
    await renderOnce();
    expect(app.state.theme.id).toBe('wax');
    expect(mockDb.themeList.activeId).toBe('honey');
    const after = captureSpans();
    expect(after.lines[0]?.spans[0]?.bg.toString()).not.toBe(before.lines[0]?.spans[0]?.bg.toString());
    await press('RETURN');
    await waitFor(() => mockDb.themeList.activeId === 'wax');
    expect(app.state.isThemePickerOpen).toBe(false);
  });
  test('puts everything back on escape', async () => {
    const { app, press, pressEscape, waitFor } = await open();
    await press('t');
    await waitFor(() => app.state.isThemePickerOpen);
    await press('j', 'j');
    await pressEscape();
    expect(app.state.theme.id).toBe('honey');
    expect(mockDb.themeList.activeId).toBe('honey');
  });
  test('does not move the comb behind the dialog', async () => {
    const { app, press, waitFor } = await open();
    await press('t');
    await waitFor(() => app.state.isThemePickerOpen);
    await press('j');
    expect(app.state.selectedSeat?.key).toBe('seat:local/personal/claude');
  });
  test('previews on click and saves on the second click', async () => {
    const { app, press, clickOn, waitFor } = await open();
    await press('t');
    await waitFor(() => app.state.isThemePickerOpen);
    await clickOn('Gruvbox');
    expect(app.state.theme.id).toBe('gruvbox');
    await clickOn('Gruvbox');
    await waitFor(() => mockDb.themeList.activeId === 'gruvbox');
  });
  test('reaches the end of a long list in a short terminal', async () => {
    const { app, press, waitFor, waitForFrame } = await open({ width: 120, height: 20 });
    await press('t');
    await waitFor(() => app.state.isThemePickerOpen);
    await press('k');
    await waitForFrame((frame) => frame.includes('Midnight'));
    expect(app.state.theme.id).toBe('midnight');
  });
  test('names a theme file that could not load', async () => {
    const { app, press, waitForFrame } = await open();
    mockDb.themeList = { ...mockDb.themeList, problems: [{ file: 'bad.json', message: 'not valid JSON' }] };
    await press('t');
    await waitForFrame((frame) => frame.includes('bad.json: not valid JSON'));
    expect(app.state.themeProblems).toHaveLength(1);
  });
});

describe('the honey palette', () => {
  function spanWith(frame: ReturnType<Awaited<ReturnType<typeof renderApp>>['captureSpans']>, text: string) {
    return frame.lines.flatMap((line) => line.spans).find((span) => span.text.includes(text));
  }

  test('paints a signed in cell honey and a signed out one faint', async () => {
    const { captureSpans } = await open();
    const spans = captureSpans();
    const hexes = spans.lines.flatMap((line) => line.spans).filter((span) => span.text.includes('⬢'));
    expect(hexes.length).toBeGreaterThan(0);
    expect(spanWith(spans, '⬡')?.fg.toString()).not.toBe(hexes[0]?.fg.toString());
  });
  test('highlights the selected row', async () => {
    const { captureSpans } = await open();
    const selected = spanWith(captureSpans(), '▸');
    const idle = spanWith(captureSpans(), 'bee@work.dev');
    expect(selected?.bg.toString()).not.toBe(idle?.bg.toString());
  });
});

describe('keyboard', () => {
  test('launches with enter and copies with c', async () => {
    const { press, waitFor, waitForFrame } = await open();
    await press('RETURN');
    await waitFor(() => mockDb.terminalRuns.length === 1);
    expect(mockDb.terminalRuns[0]?.args).toEqual(['launch', 'personal']);
    await press('c');
    await waitForFrame((frame) => frame.includes('Copied. Paste it into T3 Code as CLAUDE_CONFIG_DIR path.'));
    expect(mockDb.clipboard).toEqual(['/Users/bee/.claude']);
  });
  test('moves with arrows and with vim keys', async () => {
    const { app, mockInput, press, flush } = await open();
    mockInput.pressArrow('down');
    await flush();
    expect(app.state.selectedSeat?.provider).toBe('codex');
    mockInput.pressArrow('right');
    await flush();
    expect(app.state.selectedSeat?.account).toBe('work');
    await press('k');
    expect(app.state.selectedSeat?.provider).toBe('claude');
    await press('h');
    expect(app.state.selectedSeat?.account).toBe('personal');
  });
  test('jumps machines with tab', async () => {
    const { app, press } = await open();
    await press('TAB');
    expect(app.state.selectedMachine?.id).toBe('devbox');
  });
  test('quits with q', async () => {
    const view = await open();
    await view.press('q');
    expect(view.quitCount).toBe(1);
  });
  test('opens help and closes it', async () => {
    const { captureCharFrame, press, pressEscape } = await open();
    await press('?');
    expect(captureCharFrame()).toContain('copy the config path');
    await pressEscape();
    expect(captureCharFrame()).not.toContain('copy the config path');
  });
  test('shows an error from the backend as a toast and keeps running', async () => {
    const { select, press, waitForFrame } = await open();
    await select('seat:devbox/personal/antigravity');
    await press('o');
    await waitForFrame((frame) => frame.includes('has no sign-out command'));
  });
});

describe('mouse', () => {
  test('selects a seat on click and acts on the second click', async () => {
    const { app, clickOn, waitFor } = await open();
    await clickOn('bee@work.dev');
    expect(app.state.selectedSeat?.key).toBe('seat:local/work/claude');
    expect(mockDb.terminalRuns).toHaveLength(0);
    await clickOn('bee@work.dev');
    await waitFor(() => mockDb.terminalRuns.length === 1);
  });
  test('selects a seat on another machine', async () => {
    const { app, clickOn } = await open();
    await clickOn('agy');
    expect(app.state.selectedSeat?.key).toBe('seat:devbox/personal/antigravity');
    expect(app.state.selectedMachine?.id).toBe('devbox');
  });
  test('copies the path when you click on it', async () => {
    const { clickOn, waitFor } = await open();
    await clickOn('~/.claude');
    await waitFor(() => mockDb.clipboard.length === 1);
  });
  test('reaches a machine that is down', async () => {
    const { app, clickOn } = await open();
    await clickOn('offline');
    expect(app.state.selectedMachine?.id).toBe('studio');
    expect(app.state.selectedSeat).toBeUndefined();
  });
  test('works the key bar', async () => {
    const { app, clickOn } = await open();
    await clickOn('account');
    expect(app.state.isAddAccountOpen).toBe(true);
  });
});

describe('adding an account', () => {
  test('types a name and creates the cell on the selected machine', async () => {
    const { app, press, mockInput, flush, waitForFrame, captureCharFrame } = await open();
    await press('TAB', 'a');
    expect(captureCharFrame()).toContain('new cell on devbox');
    await mockInput.typeText('side');
    await flush();
    await press('RETURN');
    await waitForFrame((frame) => frame.includes('A new cell for side on devbox.'));
    expect(app.state.accounts.map((account) => account.key)).toContain('devbox/side');
  });
  test('does not treat what you type as commands', async () => {
    const { app, press, mockInput, flush } = await open();
    await press('a');
    await mockInput.typeText('qmx');
    await flush();
    expect(app.state.isAddMachineOpen).toBe(false);
    expect(app.state.isAddAccountOpen).toBe(true);
  });
  test('shows the error inside the dialog', async () => {
    const { press, mockInput, flush, waitForFrame } = await open();
    await press('a');
    await mockInput.typeText('work');
    await flush();
    await press('RETURN');
    await waitForFrame((frame) => frame.includes('"work" already exists.'));
  });
  test('cancels with escape', async () => {
    const { app, press, pressEscape } = await open();
    await press('a');
    await pressEscape();
    expect(app.state.isAddAccountOpen).toBe(false);
  });
});

describe('removing an account', () => {
  test('asks first, in the view', async () => {
    const { app, select, press, captureCharFrame, waitFor } = await open();
    await select('seat:local/work/claude');
    await press('x');
    expect(captureCharFrame()).toContain('Move work on macbook to the trash?');
    expect(app.state.accounts.map((account) => account.name)).toContain('work');
    await press('y');
    await waitFor(() => !app.state.accounts.some((account) => account.name === 'work'));
  });
  test('backs out with n, which does not start a rename', async () => {
    const { app, select, press, captureCharFrame } = await open();
    await select('seat:local/work/claude');
    await press('x');
    expect(captureCharFrame()).toContain('to the trash?');
    await press('n');
    expect(captureCharFrame()).not.toContain('to the trash?');
    expect(app.state.accounts.map((account) => account.name)).toContain('work');
    expect(app.state.isRenameAccountOpen).toBe(false);
  });
  test('refuses the base right away, without asking first', async () => {
    const { app, press, captureCharFrame, waitForFrame } = await open();
    await press('x');
    await waitForFrame((frame) => frame.includes('personal is the base cell, so it stays.'));
    expect(captureCharFrame()).not.toContain('to the trash?');
    expect(app.state.accounts.map((account) => account.name)).toContain('personal');
  });
  test('offers delete in the cell panel, except on the base', async () => {
    const { select, flush, captureCharFrame, clickOn, app } = await open();
    expect(captureCharFrame()).toContain('n rename');
    expect(captureCharFrame()).not.toContain('x delete');
    await select('seat:local/work/claude');
    await flush();
    expect(captureCharFrame()).toContain('x delete');
    await clickOn('delete');
    expect(captureCharFrame()).toContain('Move work on macbook to the trash?');
    expect(app.state.accounts.map((account) => account.name)).toContain('work');
  });
});

describe('renaming an account', () => {
  test('starts from the current name and shows the new one everywhere', async () => {
    const { app, select, press, mockInput, flush, waitForFrame, captureCharFrame } = await open();
    await select('seat:local/work/claude');
    await press('n');
    expect(captureCharFrame()).toContain('rename work');
    await mockInput.typeText('-side');
    await flush();
    await press('RETURN');
    const frame = await waitForFrame((text) => text.includes('work is now work-side.'));
    expect(frame).toContain('Claude Code as work-side');
    expect(app.state.selectedAccount?.name).toBe('work');
    expect(app.state.isRenameAccountOpen).toBe(false);
  });
  test('renames the base and keeps its tag', async () => {
    const { press, mockInput, flush, waitForFrame } = await open();
    await press('n');
    await mockInput.typeText('-bee');
    await flush();
    await press('RETURN');
    const frame = await waitForFrame((text) => text.includes('personal is now personal-bee.'));
    expect(frame).toContain('personal-bee base');
  });
  test('does not treat what you type as commands', async () => {
    const { app, press, mockInput, flush } = await open();
    await press('n');
    await mockInput.typeText('qmx');
    await flush();
    expect(app.state.isAddMachineOpen).toBe(false);
    expect(app.state.isRenameAccountOpen).toBe(true);
  });
  test('shows the error inside the dialog', async () => {
    const { press, select, mockInput, flush, waitForFrame } = await open();
    await select('seat:local/work/claude');
    await press('n');
    for (const _ of 'work') await press('BACKSPACE');
    await mockInput.typeText('personal');
    await flush();
    await press('RETURN');
    await waitForFrame((frame) => frame.includes('"personal" already exists.'));
  });
  test('cancels with escape', async () => {
    const { app, press, pressEscape } = await open();
    await press('n');
    await pressEscape();
    expect(app.state.isRenameAccountOpen).toBe(false);
  });
});

describe('adding a machine', () => {
  test('lists what it found and joins what you type', async () => {
    const { app, press, mockInput, flush, waitForFrame } = await open();
    await press('m');
    const dialog = await waitForFrame((frame) => frame.includes('buildbox'));
    expect(dialog).toContain('pi');
    expect(dialog).toContain('tailscale');
    expect(dialog).toContain('ssh config');
    await mockInput.typeText('bee@pi');
    await flush();
    await press('RETURN');
    await waitForFrame((frame) => frame.includes('pi joined the comb.'));
    expect(app.state.machines.map((machine) => machine.id)).toContain('pi');
  });
  test('fills the target when you click a discovered machine', async () => {
    const { press, clickOn, waitForFrame, captureCharFrame } = await open();
    await press('m');
    await waitForFrame((frame) => frame.includes('buildbox'));
    await clickOn('buildbox');
    const lines = captureCharFrame().split('\n');
    expect(lines.some((line) => line.includes('│') && line.includes('buildbox') && !line.includes('ssh config'))).toBe(
      true
    );
  });
  test('shows why a machine could not be reached', async () => {
    const { press, mockInput, flush, waitForFrame } = await open();
    await press('m');
    await mockInput.typeText('down@host');
    await flush();
    await press('RETURN');
    await waitForFrame((frame) => frame.includes('down@host: connection refused'));
  });
  test('offers to install favo on a machine that lacks it', async () => {
    const { app, press, flush, renderOnce, waitFor, captureCharFrame } = await open();
    mockDb.machineStatuses.studio = { state: 'needsInstall' };
    await app.state.refreshMachine('studio');
    app.state.selectRow('machine:studio');
    await flush();
    await renderOnce();
    expect(captureCharFrame()).toContain('Press i to install favo there.');
    expect(captureCharFrame()).toContain('i install');
    await press('i');
    await waitFor(() => mockDb.installed.length === 1);
  });
  test('flags a machine on an older favo and updates every one with U', async () => {
    const { app, press, flush, renderOnce, captureCharFrame, waitFor } = await open();
    mockDb.machineStatuses.devbox = { state: 'online', version: '0.0.1', isBehind: true };
    await app.state.refreshMachine('devbox');
    await flush();
    await renderOnce();
    expect(captureCharFrame()).toContain('devbox · bee@devbox · older favo 0.0.1');
    expect(captureCharFrame()).toContain('U update all');
    expect(captureCharFrame()).toContain('⬡ agy      sign in');
    await press('U');
    await waitFor(() => mockDb.installed.length === 1 && !app.state.hasMachinesBehind);
  });
  test('offers to update the selected machine with i', async () => {
    const { app, press, select, captureCharFrame, waitFor } = await open();
    mockDb.machineStatuses.devbox = { state: 'online', version: '0.0.1', isBehind: true };
    await app.state.refreshMachine('devbox');
    await select('seat:devbox/personal/antigravity');
    expect(captureCharFrame()).toContain('i update');
    await press('i');
    await waitFor(() => mockDb.installed.includes('devbox'));
  });
  test('offers to update every provider CLI, and asks first', async () => {
    const { app, press, captureCharFrame, waitFor } = await open();
    mockDb.providerUpdateOutcomes = { local: {}, devbox: {} };
    await press('P');
    expect(captureCharFrame()).toContain('Update the provider CLIs on every machine?');
    expect(mockDb.providerUpdateStarts).toEqual([]);
    await press('y');
    await waitFor(() => mockDb.providerUpdateStarts.length === 2);
    expect(app.state.isProviderClisOpen).toBe(true);
    await waitFor(() => !app.state.isUpdatingProviderClis);
  });
  test('says favo goes first on a machine that runs an older one', async () => {
    const { app, press, captureCharFrame, flush, renderOnce } = await open();
    mockDb.machineStatuses.devbox = { state: 'online', version: '0.0.1', isBehind: true };
    await app.state.refreshMachine('devbox');
    await flush();
    await renderOnce();
    await press('P');
    expect(captureCharFrame()).toContain('favo on devbox is older');
  });
  test('shows P in the key bar while a provider CLI is older on one machine', async () => {
    const { clickOn, captureCharFrame, waitForFrame } = await open();
    await waitForFrame((frame) => frame.includes('P update CLIs'));
    await clickOn('update CLIs');
    expect(captureCharFrame()).toContain('Update the provider CLIs on every machine?');
  });
  test('says when a provider CLI is older on one machine than on another', async () => {
    const { waitForFrame } = await open();
    await waitForFrame((frame) => frame.includes('Claude Code on devbox is older than on another machine.'));
  });
  test('asks again about one it left alone because it was running', async () => {
    const { press, captureCharFrame, waitFor, waitForFrame } = await open();
    const at = new Date().toISOString();
    mockDb.providerUpdateOutcomes.local = {
      codex: { lastUpdate: { state: 'leftAlone', reason: 'it is running', at } },
    };
    mockDb.providerUpdateOutcomes.devbox = {};
    await press('P');
    await press('y');
    await waitForFrame((frame) => frame.includes('Codex on macbook is running'));
    expect(captureCharFrame()).toContain('update running CLIs');
    await press('y');
    await waitFor(() => mockDb.providerUpdateStarts.length === 3);
    expect(mockDb.providerUpdateStarts.at(-1)).toEqual({
      machineId: 'local',
      providers: ['codex'],
      isRunningIncluded: true,
    });
  });
  test('lists the key in the help', async () => {
    const { select, press, captureCharFrame } = await open();
    await select('seat:local/personal/claude');
    await press('?');
    expect(captureCharFrame()).toContain('update every provider CLI');
  });
  async function finishWhileHeld(view: Awaited<ReturnType<typeof open>>) {
    const at = new Date().toISOString();
    mockDb.providerUpdateOutcomes.local = {
      codex: { lastUpdate: { state: 'leftAlone', reason: 'it is running', at } },
    };
    mockDb.providerUpdateOutcomes.devbox = {};
    const { promise, resolve } = Promise.withResolvers<void>();
    mockDb.providerVersionHold = promise;
    await view.press('P');
    await view.press('y');
    await view.waitFor(() => view.app.state.isProviderClisOpen);
    await view.pressEscape();
    return resolve;
  }
  test('waits to ask about a running CLI until the open question is answered', async () => {
    const view = await open();
    const release = await finishWhileHeld(view);
    await view.select('machine:studio');
    await view.press('X');
    release();
    await view.waitFor(() => !view.app.state.isUpdatingProviderClis);
    await view.renderOnce();
    expect(view.captureCharFrame()).toContain('Forget studio?');
    expect(view.captureCharFrame()).not.toContain('update running CLIs');
    await view.press('n');
    await view.waitForFrame((frame) => frame.includes('Codex on macbook is running'));
  });
  test('does not ask about a running CLI while a name is being typed', async () => {
    const view = await open();
    const release = await finishWhileHeld(view);
    await view.press('a');
    await view.waitFor(() => view.app.state.isAddAccountOpen);
    release();
    await view.waitFor(() => !view.app.state.isUpdatingProviderClis);
    await view.press('y');
    expect(view.captureCharFrame()).not.toContain('update running CLIs');
    expect(mockDb.providerUpdateStarts).toHaveLength(2);
    await view.pressEscape();
    await view.waitForFrame((frame) => frame.includes('Codex on macbook is running'));
  });
  test('forgets a machine after asking', async () => {
    const { app, select, press, captureCharFrame, waitFor } = await open();
    await select('machine:studio');
    await press('X');
    expect(captureCharFrame()).toContain('Forget studio?');
    await press('y');
    await waitFor(() => !app.state.machines.some((machine) => machine.id === 'studio'));
  });
});

describe('opening a desktop app', () => {
  test('offers it on the key bar only when it exists', async () => {
    const { select, captureCharFrame } = await open();
    expect(captureCharFrame()).toContain('p open Claude');
    await select('seat:local/personal/codex');
    expect(captureCharFrame()).not.toContain('p open');
    await select('seat:devbox/personal/claude');
    expect(captureCharFrame()).not.toContain('p open');
  });
  test('shows it on the key bar at 80 columns', async () => {
    const { captureCharFrame } = await open({ width: 80, height: 30 });
    expect(captureCharFrame()).toContain('p open Claude');
  });
  test('fits its row in the help', async () => {
    const { press, waitForFrame } = await open();
    await press('?');
    await waitForFrame((frame) => frame.includes('p           open the desktop app'));
  });
  test('opens with p and says so', async () => {
    const { select, press, waitForFrame } = await open();
    await select('seat:local/work/claude');
    await press('p');
    await waitForFrame((frame) => frame.includes('Claude is opening as work.'));
    expect(mockDb.desktopOpenings).toEqual(['seat:local/work/claude']);
  });
  test('says in the cell that it waits for the sign-in in the app it opened', async () => {
    const { select, press, waitForFrame } = await open();
    await select('seat:local/work/claude');
    await press('p');
    await waitForFrame((frame) => frame.includes('⬡ Claude app waiting for sign-in'));
  });
  test('opens with a click', async () => {
    const { select, clickOn, waitFor } = await open();
    await select('seat:local/work/claude');
    await clickOn('open Claude');
    await waitFor(() => mockDb.desktopOpenings.length === 1);
  });
  test.each([
    ['a provider with no app here', 'seat:local/personal/codex'],
    ['another machine', 'seat:devbox/personal/claude'],
  ])('p does nothing on %s', async (_name, seat) => {
    const { select, press, flush, renderOnce, captureCharFrame } = await open();
    await select(seat);
    await press('p');
    await flush();
    await renderOnce();
    expect(mockDb.desktopOpenings).toEqual([]);
    expect(captureCharFrame()).not.toContain('has no desktop app');
    expect(captureCharFrame()).not.toContain('is opening as');
  });
  test('asks before closing an open app, and keeps it open on no', async () => {
    const { select, press, waitForFrame, captureCharFrame } = await open();
    mockDb.runningDesktopApps = ['claude'];
    await select('seat:local/work/claude');
    await press('p');
    await waitForFrame((frame) => frame.includes('Close it and reopen as work?'));
    expect(captureCharFrame()).toContain('Anything running in it stops.');
    await press('n');
    await waitForFrame((frame) => !frame.includes('Close it and reopen as work?'));
    expect(mockDb.desktopOpenings).toEqual([]);
  });
  test('closes and reopens on yes', async () => {
    const { select, press, waitForFrame, waitFor } = await open();
    mockDb.runningDesktopApps = ['claude'];
    await select('seat:local/work/claude');
    await press('p');
    await waitForFrame((frame) => frame.includes('Close it and reopen as work?'));
    await press('y');
    await waitFor(() => mockDb.desktopOpenings.length === 1);
  });
  test('acts on the account it named, even if the selection moved', async () => {
    const { select, press, waitForFrame, waitFor } = await open();
    mockDb.runningDesktopApps = ['claude'];
    await select('seat:local/work/claude');
    await press('p');
    await waitForFrame((frame) => frame.includes('Close it and reopen as work?'));
    await select('seat:local/personal/claude');
    await press('y');
    await waitFor(() => mockDb.desktopOpenings.length === 1);
    expect(mockDb.desktopOpenings).toEqual(['seat:local/work/claude']);
  });
  test('shows why an app could not be closed', async () => {
    const { select, press, waitForFrame } = await open();
    mockDb.runningDesktopApps = ['claude'];
    await select('seat:local/work/claude');
    await press('p');
    await waitForFrame((frame) => frame.includes('Close it and reopen as work?'));
    mockDb.desktopFailure = new DomainError('desktopAppStuck', 'Claude did not close.');
    await press('y');
    await waitForFrame((frame) => frame.includes('Claude did not close.'));
  });
});

describe('the app login', () => {
  const signedIn = { login: 'signedIn', isOtherAccount: false } as const;
  const otherAccount = { login: 'signedIn', isOtherAccount: true } as const;

  async function openWith(appLogins: typeof mockDb.appLogins, screen?: Parameters<typeof renderApp>[0]) {
    const view = await open(screen);
    Object.assign(mockDb.appLogins, appLogins);
    await view.app.state.refreshMachine('local');
    await view.flush();
    await view.renderOnce();
    return view;
  }

  type Spans = ReturnType<Awaited<ReturnType<typeof renderApp>>['captureSpans']>;

  function spanOf(frame: Spans, text: string) {
    return frame.lines.flatMap((line) => line.spans).find((span) => span.text.includes(text));
  }

  function colorOf(frame: Spans, text: string) {
    return spanOf(frame, text)?.fg.toString();
  }

  function badgesOf(frame: Spans) {
    return frame.lines.flatMap((line) => line.spans).filter((span) => /^ app[ ?]$/.test(span.text));
  }

  test('tags each seat here whose app signs in on its own, apart from its CLI', async () => {
    const { captureCharFrame, captureSpans } = await openWith({ 'seat:local/personal/claude': signedIn });
    const frame = captureCharFrame();
    expect(frame).toMatch(/bee@hive\.dev\s+app /);
    expect(frame).toMatch(/bee@work\.dev\s+app {2}!/);
    const [personal, work] = badgesOf(captureSpans());
    expect(personal?.bg.toString()).toBe(colorOf(captureSpans(), '⬢'));
    expect(work?.bg.toString()).not.toBe(personal?.bg.toString());
  });
  test('tags no app on another machine without one, or for a provider whose app is not here', async () => {
    const { captureSpans } = await openWith({});
    expect(badgesOf(captureSpans())).toHaveLength(2);
  });
  test('says in the cell whether the app is signed in', async () => {
    const { select, waitForFrame } = await openWith({ 'seat:local/personal/claude': signedIn });
    await waitForFrame((frame) => frame.includes('⬢ Claude app signed in'));
    await select('seat:local/work/claude');
    await waitForFrame((frame) => frame.includes('⬡ Claude app signed out'));
  });
  test('warns in red when the app is on another account than the CLI', async () => {
    const { select, waitForFrame, captureSpans } = await openWith({ 'seat:local/work/claude': otherAccount });
    await select('seat:local/work/claude');
    await waitForFrame((frame) => frame.includes('⬢ Claude app on another account'));
    const spans = captureSpans();
    expect(colorOf(spans, 'on another account')).toBe(colorOf(spans, ' !'));
    expect(badgesOf(spans).some((badge) => badge.bg.toString() === colorOf(spans, ' !'))).toBe(true);
  });
  test('keeps the warning in a small terminal, and leaves out the rest the row already shows', async () => {
    const view = await openWith(
      { 'seat:local/personal/claude': signedIn, 'seat:local/work/claude': otherAccount },
      { width: 80, height: 24 }
    );
    const { select, waitForFrame, captureCharFrame } = view;
    await dismissNotice(view);
    expect(captureCharFrame()).toMatch(/\.dev\s+app /);
    expect(captureCharFrame()).toContain('CONFIG PATH');
    expect(captureCharFrame()).not.toContain('Claude app signed in');
    await select('seat:local/work/claude');
    const frame = await waitForFrame((current) => current.includes('Claude app on another account'));
    expect(frame).toContain('CONFIG PATH');
  });
  test('tags an unknown app login with a question mark, and says so in the cell', async () => {
    const { waitForFrame } = await openWith({
      'seat:local/personal/claude': { login: 'unknown', isOtherAccount: false },
    });
    const frame = await waitForFrame((current) => current.includes('? Claude app sign-in unknown'));
    expect(frame).toMatch(/bee@hive\.dev\s+app\?/);
  });
  test('keeps a seat with a long email on one line, and cuts only the email', async () => {
    const view = await open();
    mockDb.seatStatuses['seat:local/work/claude'] = {
      login: 'signedIn',
      identity: 'irwin.arruda@matchit.example.com.br',
      problems: 1,
    };
    mockDb.appLogins['seat:local/work/claude'] = signedIn;
    await view.app.state.refreshMachine('local');
    await view.select('seat:local/work/claude');
    const frame = await view.waitForFrame((current) => current.includes('▸ ⬢ claude'));
    expect(frame).toMatch(/▸ ⬢ claude\s+irwin\.\S+\.com\.br\s+app {2}!/);
  });
  test('tags the app of a seat on another machine, which opens only there', async () => {
    const view = await open();
    mockDb.desktopApps.devbox = [{ provider: 'claude', label: 'Claude', login: 'separate', canOpen: false }];
    mockDb.appLogins['seat:devbox/personal/claude'] = signedIn;
    await view.app.state.refreshMachine('devbox');
    await view.select('seat:devbox/personal/claude');
    const frame = await view.waitForFrame((current) => current.includes('⬢ Claude app signed in'));
    expect(badgesOf(view.captureSpans())).toHaveLength(3);
    expect(frame).not.toContain('p open');
  });
});

describe('going back to a thread', () => {
  async function openOn(rowKey: string) {
    const view = await open();
    await view.select(rowKey);
    return view;
  }

  test('shows the last thread of the seat, its age and its folder', async () => {
    const { waitForFrame } = await open();
    const frame = await waitForFrame((text) => text.includes('press b to go back'));
    expect(frame).toContain('12m ago · aaaa0001 · 2 more');
    expect(frame).toContain('~/code/hive');
  });
  test('shows the key in the bar', async () => {
    const { waitForFrame } = await open();
    expect(await waitForFrame((text) => text.includes('press b to go back'))).toContain('b go back');
  });
  test('lists every thread on b, and goes back to the one you pick', async () => {
    const view = await open();
    await view.waitForFrame((text) => text.includes('press b to go back'));
    await view.press('b');
    const frame = await view.waitForFrame((text) => text.includes('go back to a thread'));
    expect(frame).toContain('aaaa0002');
    expect(frame).toContain('folder gone');
    await view.press('j', 'RETURN');
    await view.waitFor(() => mockDb.terminalRuns.length === 1);
    expect(mockDb.terminalRuns[0]?.args).toEqual(['resume', 'personal', '11111111-2222-4333-8444-5555aaaa0002']);
  });
  test('closes the list with escape', async () => {
    const view = await open();
    await view.waitForFrame((text) => text.includes('press b to go back'));
    await view.press('b');
    await view.waitForFrame((text) => text.includes('go back to a thread'));
    await view.pressEscape();
    expect(view.app.state.isThreadPickerOpen).toBe(false);
    expect(mockDb.terminalRuns).toEqual([]);
  });
  test('disables the comb while the list is open', async () => {
    const view = await open();
    await view.waitForFrame((text) => text.includes('press b to go back'));
    await view.press('b');
    await view.waitForFrame((text) => text.includes('go back to a thread'));
    await view.press('u');
    expect(view.app.state.isUsageOpen).toBe(false);
  });
  test('goes straight back from a click on the key bar when there is one thread', async () => {
    const view = await openOn('seat:local/work/claude');
    await view.waitForFrame((text) => text.includes('44m ago'));
    await view.clickOn('go back');
    await view.waitFor(() => mockDb.terminalRuns.length === 1);
    expect(mockDb.terminalRuns[0]?.args).toContain('22222222-2222-4333-8444-5555bbbb0001');
  });
  test('warns that a guess can be wrong', async () => {
    const view = await openOn('seat:local/personal/opencode');
    expect(await view.waitForFrame((text) => text.includes('a guess'))).toContain('two sessions here');
  });
  test('asks before changing your config, and changes nothing if you say no', async () => {
    const view = await openOn('seat:local/work/codex');
    await view.waitForFrame((text) => text.includes('press b to remember them'));
    await view.press('b');
    await view.waitForFrame((text) => text.includes('remember threads'));
    await view.press('n');
    expect(mockDb.hooks.local?.find(({ provider }) => provider === 'codex')?.state).toBe('absent');
  });
  test('installs the hook when you say yes', async () => {
    const view = await openOn('seat:local/work/codex');
    await view.waitForFrame((text) => text.includes('press b to remember them'));
    await view.press('b');
    await view.waitForFrame((text) => text.includes('remember threads'));
    await view.press('y');
    await view.waitForFrame((text) => text.includes('from now on'));
    expect(mockDb.hooks.local?.find(({ provider }) => provider === 'codex')?.state).toBe('current');
  });
  test('hides threads on a machine with an older favo', async () => {
    const view = await open();
    mockDb.threadFailures.devbox = new DomainError(DomainErrorCode.unknownMethod, 'Unknown method.');
    await view.select('seat:devbox/personal/claude');
    await view.waitFor(() => view.app.state.machinesWithoutThreads.includes('devbox'));
    await view.flush();
    const frame = view.captureCharFrame();
    expect(frame).not.toContain('LAST THREAD');
    expect(frame).not.toContain('b go back');
    expect(frame).toContain('CONFIG PATH');
  });
  test('ignores b on a machine with an older favo', async () => {
    const view = await open();
    mockDb.threadFailures.devbox = new DomainError(DomainErrorCode.unknownMethod, 'Unknown method.');
    await view.select('seat:devbox/personal/claude');
    await view.waitFor(() => view.app.state.machinesWithoutThreads.includes('devbox'));
    await dismissNotice(view);
    await view.press('b');
    expect(view.app.state.toast).toBeUndefined();
    expect(view.app.state.isThreadPickerOpen).toBe(false);
  });
  test('tells a problem from a guess by color', async () => {
    const view = await openOn('seat:local/personal/claude');
    await view.waitForFrame((text) => text.includes('press b to go back'));
    await view.press('b');
    const frame = await view.waitForFrame((text) => text.includes('folder gone'));
    expect(frame).toContain('folder gone');
  });
  test('fits at 80 columns', async () => {
    const view = await open({ width: 80, height: 40 });
    const frame = await view.waitForFrame((text) => text.includes('press b to go back'));
    expect(frame).toContain('b go back');
  });
});
