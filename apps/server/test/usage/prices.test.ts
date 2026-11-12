import { afterEach, describe, expect, it } from 'bun:test';
import { createAccount } from '@favo/contracts/rpc/accounts/create-account';
import { renameAccount } from '@favo/contracts/rpc/accounts/rename-account';
import { selectTheme } from '@favo/contracts/rpc/themes/select-theme';
import { readTokenPrices } from '@favo/contracts/rpc/usage/read-token-prices';
import { readUsageView } from '@favo/contracts/rpc/usage/read-usage-view';
import { saveUsageView } from '@favo/contracts/rpc/usage/save-usage-view';
import { DomainErrorCode } from '@favo/domain/shared/domain-error';
import { createTestServer } from '#test/support/test-server';
import { LitellmPriceSource } from '@/modules/usage/gateways/litellm.price-source';

const Table = {
  'claude-test-1': { input_cost_per_token: 0.000003, output_cost_per_token: 0.000015 },
  'openai/gpt-test-1': { input_cost_per_token: 0.000002, output_cost_per_token: 0.000008 },
};
const Hour = 3_600_000;

function serverWithTable() {
  const server = createTestServer();
  server.priceSource.table = Table;
  return server;
}

describe('the price table', () => {
  it('is fetched the first time, and answers only for the models asked about', async () => {
    const { client, priceSource } = serverWithTable();
    const prices = await client.call(readTokenPrices, { models: ['claude-test-1', 'mystery-1'], isFresh: false });
    expect(prices.fetchedAt).toBe('2026-10-31T12:00:00.000Z');
    expect(Object.keys(prices.rates)).toEqual(['claude-test-1']);
    expect(priceSource.fetches).toBe(1);
  });
  it('is kept under ~/.favo and fetched at most once a day', async () => {
    const { client, priceSource, clock, fileSystem, paths } = serverWithTable();
    await client.call(readTokenPrices, { models: [], isFresh: false });
    clock.instant = new Date(clock.instant.getTime() + 23 * Hour);
    await client.call(readTokenPrices, { models: [], isFresh: false });
    expect(priceSource.fetches).toBe(1);
    clock.instant = new Date(clock.instant.getTime() + 2 * Hour);
    await client.call(readTokenPrices, { models: [], isFresh: false });
    expect(priceSource.fetches).toBe(2);
    expect(await fileSystem.readText(paths.priceTableFile)).toContain('gpt-test-1');
  });
  it('is fetched again when asked to refresh', async () => {
    const { client, priceSource } = serverWithTable();
    await client.call(readTokenPrices, { models: [], isFresh: false });
    await client.call(readTokenPrices, { models: [], isFresh: true });
    expect(priceSource.fetches).toBe(2);
  });
  it('uses the copy it kept when the fetch fails', async () => {
    const { client, priceSource } = serverWithTable();
    await client.call(readTokenPrices, { models: [], isFresh: false });
    priceSource.table = undefined;
    const prices = await client.call(readTokenPrices, { models: ['gpt-test-1'], isFresh: true });
    expect(prices.fetchedAt).toBe('2026-10-31T12:00:00.000Z');
    expect(prices.rates['gpt-test-1']?.output).toBe(0.000008);
  });
  it('keeps the copy when the answer is not a price table', async () => {
    const { client, priceSource } = serverWithTable();
    await client.call(readTokenPrices, { models: [], isFresh: false });
    priceSource.table = { error: 'rate limited' };
    const prices = await client.call(readTokenPrices, { models: ['claude-test-1'], isFresh: true });
    expect(Object.keys(prices.rates)).toEqual(['claude-test-1']);
  });
  it('does not try again on every page when the fetch just failed, unless asked to refresh', async () => {
    const { client, priceSource, clock } = createTestServer();
    const read = (isFresh: boolean) => client.call(readTokenPrices, { models: [], isFresh });
    await read(false);
    await read(false);
    expect(priceSource.fetches).toBe(1);
    await read(true);
    expect(priceSource.fetches).toBe(2);
    clock.instant = new Date(clock.instant.getTime() + 11 * 60_000);
    await read(false);
    expect(priceSource.fetches).toBe(3);
  });
  it('says there is none yet when this computer was never online', async () => {
    const { client } = createTestServer();
    const prices = await client.call(readTokenPrices, { models: ['claude-test-1'], isFresh: false });
    expect(prices).toEqual({ source: 'litellm', rates: {} });
  });
});

describe('fetching the table', () => {
  let server: ReturnType<typeof Bun.serve> | undefined;

  function serve(respond: () => Response) {
    server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: respond });
    return `http://127.0.0.1:${server.port}/prices.json`;
  }

  afterEach(async () => {
    await server?.stop(true);
    server = undefined;
  });

  it('reads the document the source publishes', async () => {
    const url = serve(() => Response.json(Table));
    expect(await new LitellmPriceSource(url).fetchTable()).toEqual(Table);
  });
  it('turns a refusal, a timeout and a page that is not JSON into one error', async () => {
    const refused = new LitellmPriceSource(serve(() => new Response('no', { status: 503 })));
    await expect(refused.fetchTable()).rejects.toMatchObject({ code: DomainErrorCode.pricesUnavailable });
    await server?.stop(true);
    const notJson = new LitellmPriceSource(serve(() => new Response('<html>')));
    await expect(notJson.fetchTable()).rejects.toMatchObject({ code: DomainErrorCode.pricesUnavailable });
    await server?.stop(true);
    const slow = serve(() => new Promise<Response>(() => {}) as unknown as Response);
    await expect(new LitellmPriceSource(slow, 20).fetchTable()).rejects.toMatchObject({
      code: DomainErrorCode.pricesUnavailable,
    });
  });
});

describe('the usage view', () => {
  it('starts on Limits over 30 days', async () => {
    const { client } = createTestServer();
    expect(await client.call(readUsageView, {})).toEqual({ page: 'limits', period: '30d' });
  });
  it('remembers the tab and the period in config.json, beside what is already there', async () => {
    const { client, fileSystem, paths } = createTestServer();
    await fileSystem.writePrivateText(paths.configFile, JSON.stringify({ theme: 'wax' }));
    await client.call(saveUsageView, { page: 'cost', period: '7d' });
    expect(await client.call(readUsageView, {})).toEqual({ page: 'cost', period: '7d' });
    expect(JSON.parse((await fileSystem.readText(paths.configFile))!)).toEqual({
      theme: 'wax',
      usageView: { page: 'cost', period: '7d' },
    });
  });
  it('loses nothing when the tab, the theme and a name are saved at the same moment', async () => {
    const { client, fileSystem, paths } = createTestServer();
    await client.call(createAccount, { name: 'work' });
    await Promise.all([
      client.call(saveUsageView, { page: 'tokens', period: '7d' }),
      client.call(selectTheme, { id: 'wax' }),
      client.call(renameAccount, { name: 'work', newName: 'side' }),
      client.call(saveUsageView, { page: 'cost', period: '90d' }),
    ]);
    expect(JSON.parse((await fileSystem.readText(paths.configFile))!)).toEqual({
      usageView: { page: 'cost', period: '90d' },
      theme: 'wax',
      accountNames: { work: 'side' },
    });
  });
  it('falls back when what config.json holds is from another favo', async () => {
    const { client, fileSystem, paths } = createTestServer();
    await fileSystem.writePrivateText(paths.configFile, JSON.stringify({ usageView: { page: 'graphs' } }));
    expect(await client.call(readUsageView, {})).toEqual({ page: 'limits', period: '30d' });
  });
  it('refuses a tab it does not have', async () => {
    const { client } = createTestServer();
    const call = client.call(saveUsageView, { page: 'graphs' as 'cost', period: '7d' });
    await expect(call).rejects.toMatchObject({ code: DomainErrorCode.invalidParams });
  });
});
