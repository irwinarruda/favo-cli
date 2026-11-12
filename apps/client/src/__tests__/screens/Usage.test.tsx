import { afterEach, describe, expect, setSystemTime, test } from 'bun:test';
import { DomainError, DomainErrorCode } from '@favo/domain/shared/domain-error';
import { mockDb, TokenSeats, tokenRowOf } from '@/__tests__/db';
import { renderApp } from '@/__tests__/utils/renderApp';

const Tall = { width: 129, height: 46 };
const Narrow = { width: 80, height: 46 };
const Noon = new Date('2026-11-12T15:30:00.000Z');

let dispose: (() => Promise<void>) | undefined;

async function open(screen: Parameters<typeof renderApp>[0] = Tall, prepare?: () => void) {
  setSystemTime(Noon);
  mockDb.reset();
  const view = await renderApp(screen);
  dispose = view.dispose;
  prepare?.();
  await view.waitFor(() => !view.app.state.isLimitsReading && !view.app.state.isTokensReading);
  return view;
}

async function openTokens(screen?: Parameters<typeof renderApp>[0], prepare?: () => void) {
  const view = await open(screen, prepare);
  await view.press('u', 't');
  await view.waitForFrame((frame) => frame.includes('read just now') && !frame.includes('reading…'));
  return view;
}

function linesWith(frame: string, text: string) {
  return frame.split('\n').filter((line) => line.includes(text));
}

afterEach(async () => {
  await dispose?.();
  dispose = undefined;
  setSystemTime();
});

describe('the tabs', () => {
  test('open with l, t and c, and remember the last one', async () => {
    const { app, press, pressEscape, waitForFrame } = await open();
    await press('u', 't');
    await waitForFrame((frame) => frame.includes('1.1B tokens'));
    await press('c');
    await waitForFrame((frame) => frame.includes('$1,066.25 at API prices      1.1B tokens'));
    await press('l');
    await waitForFrame((frame) => frame.includes('81% left'));
    await press('c');
    await pressEscape();
    expect(app.state.isUsageOpen).toBe(false);
    await press('u');
    await waitForFrame((frame) => frame.includes('not your subscription bill'));
    expect(mockDb.usageView.page).toBe('cost');
  });
  test('go around with tab and shift+tab', async () => {
    const { app, press } = await open();
    await press('u', 'TAB');
    expect(app.state.usagePage).toBe('tokens');
    await press('TAB', 'TAB');
    expect(app.state.usagePage).toBe('limits');
  });
  test('open with a click', async () => {
    const { app, press, clickOn, waitFor } = await open();
    await press('u');
    await clickOn('Cost');
    await waitFor(() => app.state.usagePage === 'cost');
    await clickOn('Limits');
    await waitFor(() => app.state.usagePage === 'limits');
  });
  test('each keep the frame: the title, the filters, the keys', async () => {
    const { press, captureCharFrame, waitForFrame } = await open();
    await press('u');
    for (const key of ['l', 't', 'c']) {
      await press(key);
      await waitForFrame((frame) => !frame.includes('reading…'));
      const frame = captureCharFrame();
      expect(frame).toMatch(/⬢ Usage {4}Limits {2}Tokens {2}Cost\s+24h {2}7d {2}30d {2}90d {2}all/);
      expect(frame).toContain('all machines · all accounts · all providers');
      expect(frame).toMatch(/r refresh {2}f filters {2}tab tabs/);
      expect(frame).toMatch(/esc back {2}\? help {2}q quit/);
    }
  });
  test('add their own keys to the bar: none on Limits, the period and the table on the others', async () => {
    const { press, captureCharFrame } = await open();
    await press('u');
    expect(captureCharFrame()).not.toContain('←→ period');
    expect(captureCharFrame()).not.toContain('b by day');
    await press('t');
    expect(captureCharFrame()).toMatch(/←→ period {2}b by day/);
  });
  test('leave the comb keys alone, and quit with q', async () => {
    const view = await openTokens();
    await view.press('a');
    expect(view.app.state.isAddAccountOpen).toBe(false);
    await view.press('q');
    expect(view.quitCount).toBe(1);
  });
  test('explain their keys in help, over the screen', async () => {
    const { app, captureCharFrame, press, pressEscape } = await openTokens();
    await press('?');
    expect(captureCharFrame()).toContain('limits, tokens, cost');
    expect(captureCharFrame()).toContain('at API prices, not a bill');
    await press('c');
    expect(app.state.usagePage).toBe('tokens');
    await pressEscape();
    expect(app.state.isUsageOpen).toBe(true);
  });
});

describe('the periods', () => {
  test('change with 1 to 5 and with the arrows', async () => {
    const { app, press, pressArrow, captureCharFrame } = await openTokens();
    await press('1');
    expect(app.state.usagePeriod).toBe('24h');
    expect(captureCharFrame()).toContain('625M tokens');
    expect(captureCharFrame()).toContain('busiest hour');
    await pressArrow('right', 'right', 'right');
    expect(app.state.usagePeriod).toBe('90d');
    expect(captureCharFrame()).toContain('1.5B tokens');
    await press('5');
    expect(app.state.usagePeriod).toBe('all');
    await pressArrow('left');
    expect(app.state.usagePeriod).toBe('90d');
  });
  test('change with a click, and are remembered', async () => {
    const { app, clickOn, waitFor } = await openTokens();
    await clickOn('7d');
    await waitFor(() => app.state.usagePeriod === '7d');
    expect(mockDb.usageView).toEqual({ page: 'tokens', period: '7d' });
  });
  test('do nothing on Limits', async () => {
    const { app, press, pressArrow } = await open();
    await press('u', '1');
    await pressArrow('right');
    expect(app.state.usagePeriod).toBe('30d');
  });
});

describe('the Tokens page', () => {
  test('leads with the total, the sessions and what the API would charge', async () => {
    const { captureCharFrame } = await openTokens();
    expect(captureCharFrame()).toContain('1.1B tokens      10 sessions      $1,066.25 at API prices');
  });
  test('draws the shape of the period in three rows of blocks, with its ends and its busiest day', async () => {
    const { captureCharFrame } = await openTokens();
    const lines = captureCharFrame().split('\n');
    const base = lines.findIndex((line) => line.includes('▁▁▁▁▁▁'));
    expect(lines[base]?.trim()).toMatch(/^▁+[▁▂▃▄▅▆▇█]+█{6}$/);
    expect(lines[base]?.trim()).toHaveLength(90);
    expect(lines[base - 1]?.trim()).toMatch(/^[▁▂▃▄▅▆▇█]{3}█{3}$/);
    expect(lines[base - 2]?.trim()).toBe('███');
    expect(lines[base - 2]?.indexOf('███')).toBe(lines[base]!.lastIndexOf('███'));
    expect(lines[base + 1]).toMatch(/[A-Z][a-z]{2} \d+ +busiest day [A-Z][a-z]{2} \d+, 625M +[A-Z][a-z]{2} \d+/);
  });
  test('shares the total between providers, accounts and machines', async () => {
    const { captureCharFrame } = await openTokens();
    const frame = captureCharFrame();
    expect(frame).toMatch(/Claude Code +█+░+\s+943M\s+86%\s+\$1,006/);
    expect(frame).toMatch(/Codex +█+░+\s+157M\s+14%\s+\$60\.00/);
    expect(frame).toMatch(/personal +█+░+\s+890M\s+81%\s+\$706/);
    expect(frame).toMatch(/work +█+░+\s+210M\s+19%\s+\$360/);
    expect(frame).toMatch(/macbook +█+░+\s+992M\s+90%\s+\$930/);
    expect(frame).toMatch(/devbox +█+░+\s+108M\s+10%\s+\$136/);
  });
  test('keeps the line of a machine that is down, and names what it does not count yet', async () => {
    const { captureCharFrame } = await openTokens();
    expect(captureCharFrame()).toMatch(/studio +offline/);
    expect(captureCharFrame()).toContain('Antigravity, OpenCode  not counted yet');
  });
  test('says what the tokens were, and how much came from cache', async () => {
    const { captureCharFrame } = await openTokens();
    expect(captureCharFrame()).toContain('cache read 1.1B · cache write 33M · input 9M · output 8M');
    expect(captureCharFrame()).toContain('96% of the input came from cache');
  });
  test('lists the models, with what each cost per million', async () => {
    const { captureCharFrame } = await openTokens();
    const frame = captureCharFrame();
    expect(frame).toMatch(/Models\s+tokens\s+share\s+cost\s+cached\s+per 1M/);
    expect(frame).toMatch(/claude-opus-5-5\s+733M\s+67%\s+\$646\.25\s+96%\s+\$0\.88/);
    expect(frame).toMatch(/gpt-6-astra\s+157M\s+14%\s+\$60\.00\s+97%\s+\$0\.38/);
  });
  test('turns the models into days with b, and with a click on the heading', async () => {
    const { press, clickOn, captureCharFrame, waitForFrame } = await openTokens();
    await press('b');
    expect(captureCharFrame()).toMatch(/Days\s+tokens\s+share\s+cost/);
    expect(captureCharFrame()).toContain('b by model');
    await clickOn('Days');
    await waitForFrame((frame) => frame.includes('claude-opus-5-5'));
  });
  test('fits 80 columns without wrapping, dropping what matters least', async () => {
    const { captureCharFrame } = await openTokens(Narrow);
    const frame = captureCharFrame();
    expect(frame).toMatch(/Claude Code +█+░+\s+943M\s+86%\s+\$1,006/);
    expect(frame).toMatch(/claude-opus-5-5\s+733M\s+67%\s+\$646\.25\s+96%\s+\$0\.88/);
    expect(frame).toMatch(/[A-Z][a-z]{2} \d+ +busiest day [A-Z][a-z]{2} \d+, 625M +[A-Z][a-z]{2} \d+/);
    expect(linesWith(frame, '▁▁▁▁▁▁')[0]?.trim()).toHaveLength(60);
    expect(frame).toMatch(/r refresh {2}f filters {2}←→ period {2}b by day {2}esc back {2}\? help {2}q quit/);
    expect(frame).not.toContain('...');
  });
  test('drops columns, never the names, on a very narrow screen', async () => {
    const { captureCharFrame } = await openTokens({ width: 60, height: 46 });
    const frame = captureCharFrame();
    expect(frame).toMatch(/claude-fable-5-2\s+210M\s+19%\s+\$360\.00\s*\n/);
    expect(frame).not.toContain('cached');
    expect(frame).toMatch(/Claude Code +█+░+\s+943M\s+86%\s+\$1,006/);
    expect(frame).toMatch(/cache read 1\.1B · cache write 33M\s*\n\s+input 9M · output 8M/);
  });
  test('scrolls what does not fit', async () => {
    const { captureCharFrame, press, waitForFrame } = await openTokens({ width: 129, height: 16 });
    expect(captureCharFrame()).not.toContain('Models');
    await press(...Array<string>(24).fill('j'));
    await waitForFrame((frame) => frame.includes('claude-opus-5-5'));
  });
  test('refreshes with r and with a click', async () => {
    const { clickOn, press, waitFor } = await openTokens();
    mockDb.tokenReads = [];
    await press('r');
    await waitFor(() => mockDb.tokenReads.length === 2);
    await clickOn('refresh');
    await waitFor(() => mockDb.tokenReads.length === 4);
    expect(mockDb.limitReads).toHaveLength(2);
  });
  test('says how many records could not be read, quietly, under everything else', async () => {
    const { captureCharFrame, captureSpans } = await openTokens(Tall, () => {
      mockDb.tokenUsage.local!.skippedRecords = 2;
    });
    const frame = captureCharFrame();
    const note = '2 records could not be read, so these numbers may be low.';
    expect(frame.indexOf(note)).toBeGreaterThan(frame.indexOf('gpt-6-astra'));
    const spans = captureSpans().lines.flatMap((line) => line.spans);
    const colorOf = (text: string) => spans.find((span) => span.text.includes(text))?.fg.toString();
    expect(colorOf('2 records could not be read')).toBe(colorOf('not counted yet'));
    expect(colorOf('2 records could not be read')).not.toBe(colorOf('1.1B tokens'));
  });
  test('works without prices, with no cost column', async () => {
    const { captureCharFrame } = await openTokens(Tall, () => {
      mockDb.tokenPrices = { source: 'litellm', rates: {} };
    });
    const frame = captureCharFrame();
    expect(frame).toMatch(/1\.1B tokens {6}10 sessions\s*\n/);
    expect(frame).toMatch(/Models\s+tokens\s+share\s+cached\s*\n/);
    expect(frame).not.toContain('$');
  });
  test('keeps the rest of the screen when a machine runs an older favo', async () => {
    const { captureCharFrame } = await openTokens(Tall, () => {
      mockDb.tokenFailures.devbox = new DomainError(DomainErrorCode.unknownMethod, 'nope');
    });
    expect(captureCharFrame()).toMatch(/devbox +█+░+\s+108M\s+10%\s+\$136\.25 {2}older favo/);
    expect(captureCharFrame()).toContain('1.1B tokens');
  });
  test('still names a machine that could not answer when the period holds nothing', async () => {
    const { press, pressEscape, captureCharFrame } = await openTokens(Tall, () => {
      mockDb.tokenFailures.devbox = new DomainError(DomainErrorCode.machineUnreachable, 'devbox: gone');
    });
    await press('1', 'f', ' ');
    await pressEscape();
    const frame = captureCharFrame();
    expect(frame).toContain('No tokens counted in this period.');
    expect(frame).toMatch(/devbox +could not read, last read 1h ago/);
    expect(frame).toMatch(/studio +offline/);
    expect(frame).not.toMatch(/macbook {2}/);
  });
  test('says so when there is nothing in the period', async () => {
    const { captureCharFrame } = await openTokens(Tall, () => {
      mockDb.tokenUsage = {};
    });
    expect(captureCharFrame()).toContain('No tokens counted in this period.');
  });
});

describe('the Cost page', () => {
  async function openCost(screen?: Parameters<typeof renderApp>[0], prepare?: () => void) {
    const view = await openTokens(screen, prepare);
    await view.press('c');
    return view;
  }

  test('leads with dollars, and always says they are not a bill', async () => {
    const { captureCharFrame } = await openCost();
    const frame = captureCharFrame();
    expect(frame).toContain('$1,066.25 at API prices      1.1B tokens      $5,220.00 saved by cache');
    expect(frame).toContain('what the API would charge for these tokens, not your subscription bill');
  });
  test('draws the same sections in dollars, ordered by cost', async () => {
    const { captureCharFrame } = await openCost();
    const frame = captureCharFrame();
    expect(frame).toMatch(/Claude Code +█+░+\s+\$1,006\.25\s+94%\s+943M/);
    expect(frame).toMatch(/busiest day [A-Z][a-z]{2} \d+, \$510\.00/);
    expect(frame).toContain('cache read $580.00 · cache write $256.25 · output $195.00 · input $35.00');
    expect(frame).toMatch(/Models\s+cost\s+share\s+tokens\s+cached\s+per 1M/);
    expect(frame.indexOf('claude-opus-5-5')).toBeLessThan(frame.indexOf('claude-fable-5-2'));
    expect(frame.indexOf('claude-fable-5-2')).toBeLessThan(frame.indexOf('gpt-6-astra'));
  });
  test('puts a model with no list price last, and says what that leaves out', async () => {
    const { captureCharFrame } = await openCost(Tall, () => {
      const seat = { ...TokenSeats.personalCodex, model: 'mystery-1' };
      mockDb.tokenUsage.local!.rows.push(tokenRowOf(2, seat, [0, 0, 0, 7], 0));
    });
    const frame = captureCharFrame();
    expect(frame).toMatch(/mystery-1\s+unpriced\s+7M/);
    expect(frame.indexOf('gpt-6-astra')).toBeLessThan(frame.indexOf('mystery-1'));
    expect(frame).toContain('7M tokens have no list price, and are left out of every dollar.');
  });
  test('says there is no price table yet, and still counts the tokens', async () => {
    const { captureCharFrame } = await openCost(Tall, () => {
      mockDb.tokenPrices = { source: 'litellm', rates: {} };
    });
    const frame = captureCharFrame();
    expect(frame).toContain('No price table yet. favo fetches it the next time this computer is online.');
    expect(frame).toContain('1.1B tokens');
  });
  test('fits 80 columns', async () => {
    const { captureCharFrame } = await openCost(Narrow);
    const frame = captureCharFrame();
    expect(frame).toContain('$1,066.25 at API prices      1.1B tokens      $5,220.00 saved by cache');
    expect(frame).toMatch(/Claude Code +█+░+\s+\$1,006\.25\s+94%\s+943M/);
    expect(frame).not.toContain('...');
  });
});

describe('the filters', () => {
  test('open with f, list three groups, and close with escape', async () => {
    const { app, press, pressEscape, captureCharFrame } = await openTokens();
    await press('f');
    const frame = captureCharFrame();
    expect(frame).toMatch(/Machines[^\n]*\n[^\n]*▸ ⬢ macbook/);
    expect(frame).toMatch(/⬢ studio\s+offline/);
    expect(frame).toMatch(/Accounts[^\n]*\n[^\n]*⬢ personal/);
    expect(frame).toMatch(/Providers[^\n]*\n[^\n]*⬢ Claude Code/);
    expect(frame).toMatch(/↑↓ move {2}space toggle {2}o only this {2}a all/);
    await pressEscape();
    expect(app.state.isUsageFilterOpen).toBe(false);
    expect(app.state.isUsageOpen).toBe(true);
  });
  test('open with a click on the status row', async () => {
    const { app, clickOn, waitFor } = await openTokens();
    await clickOn('all machines');
    await waitFor(() => app.state.isUsageFilterOpen);
  });
  test('leave a row out with space, and recount the screen behind at once', async () => {
    const { press, pressEscape, captureCharFrame } = await openTokens();
    await press('f', 'j', ' ');
    expect(captureCharFrame()).toMatch(/▸ ⬡ devbox/);
    expect(captureCharFrame()).toContain('992M tokens');
    await pressEscape();
    expect(captureCharFrame()).toContain('2 of 3 machines · all accounts · all providers');
    expect(captureCharFrame()).not.toMatch(/devbox +█/);
  });
  test('keep only one row with o, and turn everything back on with a', async () => {
    const { press, captureCharFrame } = await openTokens();
    await press('f', 'j', 'j', 'j', 'j', 'o');
    expect(captureCharFrame()).toMatch(/⬡ personal/);
    expect(captureCharFrame()).toContain('210M tokens');
    await press('a');
    expect(captureCharFrame()).toContain('1.1B tokens');
    expect(captureCharFrame()).not.toContain('⬡');
  });
  test('toggle a row with a click, and close from the hint', async () => {
    const { app, press, clickOn, waitFor } = await openTokens();
    await press('f');
    await clickOn('⬢ Codex');
    await waitFor(() => app.state.usageFilter.providers.includes('codex'));
    await clickOn('esc done');
    await waitFor(() => !app.state.isUsageFilterOpen);
  });
  test('keep the screen keys off while they are open', async () => {
    const { app, press } = await openTokens();
    await press('f', 'c', 'l', '1', 'b');
    expect(app.state).toMatchObject({ usagePage: 'tokens', usagePeriod: '30d', tokenBreakdown: 'models' });
  });
  test('apply to Limits too, and stay on when the tab changes', async () => {
    const { press, pressEscape, captureCharFrame, waitForFrame } = await openTokens();
    await press('f', 'j', 'j', 'j', 'j', ' ');
    await pressEscape();
    await press('l');
    await waitForFrame((frame) => frame.includes('Claude Code') && !frame.includes('work'));
    expect(captureCharFrame()).toContain('all machines · 1 of 2 accounts · all providers');
  });
  test('say so when nothing is selected', async () => {
    const { press, pressEscape, captureCharFrame } = await openTokens();
    await press('f', 'j', 'j', 'j', ' ', 'j', ' ');
    await pressEscape();
    expect(captureCharFrame()).toContain('Nothing is selected.');
    await press('l');
    expect(captureCharFrame()).toContain('Nothing is selected.');
  });
  test('start with everything on the next time Usage opens', async () => {
    const { press, pressEscape, captureCharFrame } = await openTokens();
    await press('f', ' ');
    await pressEscape();
    await pressEscape();
    await press('u');
    expect(captureCharFrame()).toContain('all machines · all accounts · all providers');
  });
});
