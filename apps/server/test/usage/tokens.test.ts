import { describe, expect, it } from 'bun:test';
import { createAccount } from '@favo/contracts/rpc/accounts/create-account';
import { renameAccount } from '@favo/contracts/rpc/accounts/rename-account';
import { addMachine } from '@favo/contracts/rpc/machines/add-machine';
import { keepTokenUsage } from '@favo/contracts/rpc/usage/keep-token-usage';
import { readKeptTokenUsage } from '@favo/contracts/rpc/usage/read-kept-token-usage';
import { readTokenUsage } from '@favo/contracts/rpc/usage/read-token-usage';
import { DomainErrorCode } from '@favo/domain/shared/domain-error';
import { createTestServer, Home } from '#test/support/test-server';
import { RpcRouter } from '@/shared/rpc/rpc-router';

const ClaudeLogs = `${Home}/.claude/projects/-home-bee-hive`;
const WorkLogs = `${Home}/.favo/accounts/work/claude/projects/-home-bee-hive`;
const CodexLogs = `${Home}/.codex/sessions/2026/10/30`;

function claudeLine(id: string, output: number, overrides: Record<string, unknown> = {}) {
  return {
    type: 'assistant',
    timestamp: '2026-10-30T14:05:00.000Z',
    requestId: `req_${id}`,
    sessionId: 'session-a',
    message: {
      id: `msg_${id}`,
      model: 'claude-test-1',
      usage: {
        input_tokens: 10,
        cache_read_input_tokens: 1000,
        cache_creation_input_tokens: 100,
        output_tokens: output,
      },
    },
    ...overrides,
  };
}

function codexRollout(output: number) {
  const usage = { input_tokens: 1000, cached_input_tokens: 800, output_tokens: output, total_tokens: 1000 + output };
  return [
    { timestamp: '2026-10-30T16:00:00.000Z', type: 'session_meta', payload: { id: 'session-c' } },
    { timestamp: '2026-10-30T16:00:01.000Z', type: 'turn_context', payload: { model: 'gpt-test-1' } },
    {
      timestamp: '2026-10-30T16:00:09.000Z',
      type: 'event_msg',
      payload: { type: 'token_count', info: { last_token_usage: usage, total_token_usage: usage } },
    },
  ];
}

function serverWithLogs() {
  const server = createTestServer();
  server.tokenLogs.write(`${ClaudeLogs}/one.jsonl`, [claudeLine('one', 40), claudeLine('two', 60)]);
  server.tokenLogs.write(`${CodexLogs}/rollout-2026-10-30T16-00-00-c.jsonl`, codexRollout(70));
  return server;
}

describe('reading tokens', () => {
  it('counts the logs of every Claude Code and Codex seat, by hour', async () => {
    const { client } = serverWithLogs();
    const usage = await client.call(readTokenUsage, { isFresh: true });
    expect(usage.readAt).toBe('2026-10-31T12:00:00.000Z');
    expect(usage.skippedRecords).toBe(0);
    expect(usage.rows).toEqual([
      {
        hour: '2026-10-30T14:00:00.000Z',
        account: 'personal',
        provider: 'claude',
        model: 'claude-test-1',
        input: 20,
        cacheRead: 2000,
        cacheWrite: 200,
        output: 100,
        sessions: 1,
      },
      {
        hour: '2026-10-30T16:00:00.000Z',
        account: 'personal',
        provider: 'codex',
        model: 'gpt-test-1',
        input: 200,
        cacheRead: 800,
        cacheWrite: 0,
        output: 70,
        sessions: 1,
      },
    ]);
  });
  it('names a cell by its folder, which survives a rename', async () => {
    const { client, tokenLogs } = serverWithLogs();
    await client.call(createAccount, { name: 'work' });
    await client.call(renameAccount, { name: 'work', newName: 'side' });
    tokenLogs.write(`${WorkLogs}/one.jsonl`, [claudeLine('three', 5)]);
    const { rows } = await client.call(readTokenUsage, { isFresh: true });
    expect(rows.map(({ account }) => account).toSorted()).toEqual(['personal', 'personal', 'work']);
  });
  it('counts a message copied into the file of a resumed session once', async () => {
    const { client, tokenLogs } = serverWithLogs();
    tokenLogs.write(`${ClaudeLogs}/resumed.jsonl`, [claudeLine('one', 40, { sessionId: 'session-b' })]);
    const { rows } = await client.call(readTokenUsage, { isFresh: true });
    expect(rows[0]).toMatchObject({ output: 100, sessions: 1 });
  });
  it('reads a rollout once when its compressed copy is still beside it', async () => {
    const { client, tokenLogs } = serverWithLogs();
    tokenLogs.write(`${CodexLogs}/rollout-2026-10-30T16-00-00-c.jsonl.zst`, codexRollout(70));
    tokenLogs.write(`${CodexLogs}/rollout-2026-10-29T09-00-00-d.jsonl.zst`, codexRollout(30));
    const { rows } = await client.call(readTokenUsage, { isFresh: true });
    expect(rows.find(({ provider }) => provider === 'codex')?.output).toBe(100);
    expect(tokenLogs.reads.filter((path) => path.endsWith('-c.jsonl.zst'))).toEqual([]);
  });
  it('never reads the text of a message, only the lines that carry numbers', async () => {
    const { client, tokenLogs } = serverWithLogs();
    tokenLogs.write(`${ClaudeLogs}/chat.jsonl`, [{ type: 'user', message: { content: 'a secret' } }]);
    const { rows, skippedRecords } = await client.call(readTokenUsage, { isFresh: true });
    expect(rows).toHaveLength(2);
    expect(skippedRecords).toBe(0);
  });
  it('says how many records it could not read, and keeps the rest', async () => {
    const { client, tokenLogs } = serverWithLogs();
    tokenLogs.write(`${ClaudeLogs}/broken.jsonl`, ['{"message":{"usage":']);
    tokenLogs.unreadable.push(`${CodexLogs}/rollout-2026-10-30T16-00-00-c.jsonl`);
    const usage = await client.call(readTokenUsage, { isFresh: true });
    expect(usage.skippedRecords).toBe(2);
    expect(usage.rows).toHaveLength(1);
  });
});

describe('the record', () => {
  it('is empty before the first read, and is not read just by asking for it', async () => {
    const { client, tokenLogs } = serverWithLogs();
    expect(await client.call(readTokenUsage, { isFresh: false })).toEqual({ rows: [], skippedRecords: 0 });
    expect(tokenLogs.reads).toEqual([]);
  });
  it('is kept under ~/.favo, and answers without reading the logs again', async () => {
    const { client, tokenLogs, fileSystem, paths } = serverWithLogs();
    const read = await client.call(readTokenUsage, { isFresh: true });
    const reads = tokenLogs.reads.length;
    expect(await client.call(readTokenUsage, { isFresh: false })).toEqual(read);
    expect(tokenLogs.reads).toHaveLength(reads);
    expect(JSON.parse((await fileSystem.readText(paths.tokenUsageFile))!)).toMatchObject({ version: 1 });
  });
  it('keeps an hour whose logs are gone', async () => {
    const { client, tokenLogs } = serverWithLogs();
    await client.call(readTokenUsage, { isFresh: true });
    tokenLogs.remove(`${ClaudeLogs}/one.jsonl`);
    const { rows } = await client.call(readTokenUsage, { isFresh: true });
    expect(rows[0]).toMatchObject({ provider: 'claude', output: 100 });
  });
  it('raises an hour when the logs hold more', async () => {
    const { client, tokenLogs } = serverWithLogs();
    await client.call(readTokenUsage, { isFresh: true });
    tokenLogs.write(`${ClaudeLogs}/two.jsonl`, [claudeLine('three', 11)]);
    const { rows } = await client.call(readTokenUsage, { isFresh: true });
    expect(rows[0]).toMatchObject({ output: 111, input: 30 });
  });
  it('lets a newer reader replace the hours still on disk, and keeps the older ones', async () => {
    const { client, fileSystem, paths } = serverWithLogs();
    const { rows } = await client.call(readTokenUsage, { isFresh: true });
    const inflated = { ...rows[0]!, output: 999 };
    const old = { ...rows[0]!, hour: '2026-08-01T10:00:00.000Z', output: 7 };
    const record = {
      version: 0,
      readAt: '2026-10-30T00:00:00.000Z',
      skippedRecords: 0,
      rows: [old, inflated, rows[1]],
    };
    await fileSystem.replaceText(paths.tokenUsageFile, JSON.stringify(record));
    const after = await client.call(readTokenUsage, { isFresh: true });
    expect(after.rows.map(({ output }) => output)).toEqual([7, 100, 70]);
  });
  it('refuses to count over a record it cannot read, so the hours only it remembers are not lost', async () => {
    const { client, fileSystem, paths } = serverWithLogs();
    const { rows } = await client.call(readTokenUsage, { isFresh: true });
    const august = { ...rows[0]!, hour: '2026-08-01T10:00:00.000Z', addedByALaterFavo: true };
    const record = JSON.stringify({
      version: 1,
      readAt: '2026-10-30T00:00:00.000Z',
      skippedRecords: 0,
      rows: [august],
    });
    await fileSystem.replaceText(paths.tokenUsageFile, record);
    for (const isFresh of [false, true]) {
      const call = client.call(readTokenUsage, { isFresh });
      await expect(call).rejects.toMatchObject({ code: DomainErrorCode.invalidConfig });
    }
    expect(await fileSystem.readText(paths.tokenUsageFile)).toBe(record);
  });
  it('skips a line whose number no count could hold, and keeps a record it can read back', async () => {
    const { client, tokenLogs } = serverWithLogs();
    const absurd = claudeLine('absurd', 1e30);
    tokenLogs.write(`${ClaudeLogs}/absurd.jsonl`, [absurd]);
    const usage = await client.call(readTokenUsage, { isFresh: true });
    expect(usage.skippedRecords).toBe(1);
    expect(usage.rows[0]).toMatchObject({ output: 100 });
    expect(await client.call(readTokenUsage, { isFresh: false })).toEqual(usage);
  });
  it('reads once when two front ends ask at the same moment', async () => {
    const { client, tokenLogs } = serverWithLogs();
    const [first, second] = await Promise.all([
      client.call(readTokenUsage, { isFresh: true }),
      client.call(readTokenUsage, { isFresh: true }),
    ]);
    expect(first).toEqual(second);
    expect(tokenLogs.reads).toHaveLength(2);
  });
});

describe('tokens on another machine', () => {
  it('are counted there, from the logs that live there', async () => {
    const mac = createTestServer();
    await mac.client.call(addMachine, { target: 'bee@devbox' });
    const devbox = serverWithLogs();
    mac.remotes.connect('devbox', devbox.router);
    const usage = await mac.client.call(readTokenUsage, { isFresh: true }, { machineId: 'devbox' });
    expect(usage.rows).toHaveLength(2);
    expect(mac.tokenLogs.reads).toEqual([]);
  });
  it('are kept here on request, so a machine that goes offline still shows its last reading', async () => {
    const mac = createTestServer();
    const devbox = serverWithLogs();
    const usage = await devbox.client.call(readTokenUsage, { isFresh: true });
    expect(await mac.client.call(readKeptTokenUsage, { id: 'devbox' })).toEqual({ rows: [], skippedRecords: 0 });
    await mac.client.call(keepTokenUsage, { id: 'devbox', usage });
    await mac.client.call(keepTokenUsage, { id: '../config', usage });
    expect(await mac.client.call(readKeptTokenUsage, { id: 'devbox' })).toEqual(usage);
    expect(await mac.fileSystem.list(mac.paths.keptTokenUsage)).toEqual(['..%2Fconfig.json', 'devbox.json']);
  });
  it('answer unknownMethod from an older favo, for the front end to explain', async () => {
    const mac = createTestServer();
    await mac.client.call(addMachine, { target: 'bee@devbox' });
    mac.remotes.connect('devbox', new RpcRouter());
    const call = mac.client.call(readTokenUsage, { isFresh: false }, { machineId: 'devbox' });
    await expect(call).rejects.toMatchObject({ code: DomainErrorCode.unknownMethod });
  });
});
