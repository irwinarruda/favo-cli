import { describe, expect, test } from 'bun:test';
import { mockDb } from '@/__tests__/db';
import { getApp } from '@/__tests__/utils/getApp';

async function openApp(prepare?: () => void) {
  const app = await getApp({ isLoaded: false });
  prepare?.();
  await app.state.loadFleet();
  while (app.state.isLimitsReading || app.state.isTokensReading || !app.state.isUsageViewLoaded) await Bun.sleep(1);
  return app;
}

describe('the tab and the period', () => {
  test('start on Limits over 30 days', async () => {
    const app = await openApp();
    await app.state.openUsage();
    expect(app.state).toMatchObject({ isUsageOpen: true, usagePage: 'limits', usagePeriod: '30d' });
  });
  test('open on the ones used last', async () => {
    const app = await openApp(() => {
      mockDb.usageView = { page: 'cost', period: '7d' };
    });
    await app.state.openUsage();
    expect(app.state).toMatchObject({ usagePage: 'cost', usagePeriod: '7d' });
    expect(app.state.tokenReport.metric).toBe('cost');
  });
  test('are remembered when they change', async () => {
    const app = await openApp();
    await app.state.openUsage();
    await app.state.showUsagePage('tokens');
    expect(mockDb.usageView).toEqual({ page: 'tokens', period: '30d' });
    await app.state.showUsagePeriod('90d');
    expect(mockDb.usageView).toEqual({ page: 'tokens', period: '90d' });
  });
  test('never change under you when the saved ones arrive late', async () => {
    const app = await getApp({ isLoaded: false });
    mockDb.usageView = { page: 'cost', period: '7d' };
    const loading = app.state.loadUsageView();
    await app.state.openUsage();
    await loading;
    expect(app.state.usagePage).toBe('limits');
  });
  test('go around the tabs, and stop at the ends of the periods', async () => {
    const app = await openApp();
    await app.state.openUsage();
    await app.state.stepUsagePage(-1);
    expect(app.state.usagePage).toBe('cost');
    await app.state.stepUsagePage(1);
    expect(app.state.usagePage).toBe('limits');
    await app.state.showUsagePage('tokens');
    await app.state.stepUsagePeriod(1);
    await app.state.stepUsagePeriod(1);
    await app.state.stepUsagePeriod(1);
    expect(app.state.usagePeriod).toBe('all');
    await app.state.showUsagePeriod('24h');
    await app.state.stepUsagePeriod(-1);
    expect(app.state.usagePeriod).toBe('24h');
  });
  test('leave the period alone on Limits, where it means nothing', async () => {
    const app = await openApp();
    await app.state.openUsage();
    await app.state.showUsagePeriod('7d');
    await app.state.stepUsagePeriod(1);
    expect(app.state.usagePeriod).toBe('30d');
    expect(mockDb.usageView).toEqual({ page: 'limits', period: '30d' });
  });
  test('read what the tab shows: limits on Limits, tokens on the other two', async () => {
    const app = await openApp();
    mockDb.limitReads = [];
    mockDb.tokenReads = [];
    await app.state.openUsage();
    await app.state.refreshUsage();
    expect(mockDb.limitReads.toSorted()).toEqual(['devbox', 'local']);
    expect(mockDb.tokenReads).toEqual([]);
    await app.state.showUsagePage('cost');
    mockDb.limitReads = [];
    mockDb.tokenReads = [];
    await app.state.refreshUsage();
    expect(mockDb.limitReads).toEqual([]);
    expect(mockDb.tokenReads.toSorted()).toEqual(['devbox:fresh', 'local:fresh']);
  });
});

describe('filters', () => {
  test('list every machine, account and provider, all on', async () => {
    const app = await openApp();
    const { machines, accounts, providers } = app.state.usageFilterChoices;
    expect(machines.map(({ name, isOn, note }) => [name, isOn, note])).toEqual([
      ['macbook', true, undefined],
      ['devbox', true, undefined],
      ['studio', true, 'offline'],
    ]);
    expect(accounts.map(({ name }) => name)).toEqual(['personal', 'work']);
    expect(providers.map(({ name }) => name)).toEqual(['Claude Code', 'Codex', 'Antigravity', 'OpenCode']);
    expect(app.state.usageFilterSummary).toBe('all machines · all accounts · all providers');
    expect(app.state.isUsageFiltered).toBe(false);
  });
  test('show an account by the name you gave it, and one only the record remembers', async () => {
    const app = await openApp(() => {
      mockDb.accounts.local![1] = { ...mockDb.accounts.local![1]!, displayName: 'side' };
      const [row] = mockDb.tokenUsage.local!.rows;
      mockDb.tokenUsage.local!.rows.push({ ...row!, account: 'old-client' });
    });
    await app.state.openUsage();
    await app.state.showUsagePage('tokens');
    expect(app.state.usageFilterChoices.accounts.map(({ id, name }) => [id, name])).toEqual([
      ['personal', 'personal'],
      ['work', 'side'],
      ['old-client', 'old-client'],
    ]);
  });
  test('leave a machine, an account or a provider out of every page', async () => {
    const app = await openApp();
    await app.state.openUsage();
    app.state.toggleUsageFilter('accounts', 'work');
    expect(app.state.usageFilterSummary).toBe('all machines · 1 of 2 accounts · all providers');
    expect(app.state.isUsageFiltered).toBe(true);
    const claude = app.state.limitPools.find(({ label }) => label === 'Claude Code');
    expect(claude?.seats.map(({ name }) => name)).toEqual(['personal']);
    await app.state.showUsagePage('tokens');
    expect(app.state.usageFilter.accounts).toEqual(['work']);
    expect(app.state.tokenReport.accounts.map(({ name }) => name)).toEqual(['personal']);
    app.state.toggleUsageFilter('providers', 'codex');
    expect(app.state.limitPools.map(({ label }) => label)).toEqual(['Claude Code', 'OpenCode']);
    expect(app.state.tokenReport.providers.map(({ name }) => name)).toEqual(['Claude Code']);
    app.state.toggleUsageFilter('machines', 'devbox');
    expect(app.state.limitMachineLines.map(({ name }) => name)).toEqual(['macbook', 'studio']);
    expect(app.state.tokenReport.machines.map(({ name }) => name)).toEqual(['macbook', 'studio']);
  });
  test('keep only the row under the cursor in its group, and turn everything back on', async () => {
    const app = await openApp();
    await app.state.openUsage();
    app.state.openUsageFilter();
    app.state.moveUsageFilterCursor(1);
    app.state.keepOnlyUsageFilterAtCursor();
    expect(app.state.usageFilter).toEqual({ machines: ['local', 'studio'], accounts: [], providers: [] });
    expect(app.state.usageFilterSummary).toBe('1 of 3 machines · all accounts · all providers');
    app.state.clearUsageFilter();
    expect(app.state.isUsageFiltered).toBe(false);
  });
  test('toggle the row under the cursor, which stops at both ends', async () => {
    const app = await openApp();
    await app.state.openUsage();
    app.state.openUsageFilter();
    app.state.moveUsageFilterCursor(-1);
    app.state.toggleUsageFilterAt();
    expect(app.state.usageFilter.machines).toEqual(['local']);
    app.state.moveUsageFilterCursor(99);
    app.state.toggleUsageFilterAt();
    expect(app.state.usageFilter.providers).toEqual(['opencode']);
    app.state.toggleUsageFilterAt(3);
    expect(app.state.usageFilterCursor).toBe(3);
    expect(app.state.usageFilter.accounts).toEqual(['personal']);
  });
  test('say so when nothing is left in a group', async () => {
    const app = await openApp();
    await app.state.openUsage();
    app.state.toggleUsageFilter('accounts', 'work');
    expect(app.state.isUsageSelectionEmpty).toBe(false);
    app.state.toggleUsageFilter('accounts', 'personal');
    expect(app.state.isUsageSelectionEmpty).toBe(true);
  });
  test('start with everything on each time Usage opens', async () => {
    const app = await openApp();
    await app.state.openUsage();
    app.state.toggleUsageFilter('machines', 'devbox');
    app.state.openUsageFilter();
    app.state.closeUsage();
    await app.state.openUsage();
    expect(app.state.isUsageFiltered).toBe(false);
    expect(app.state.isUsageFilterOpen).toBe(false);
  });
});
