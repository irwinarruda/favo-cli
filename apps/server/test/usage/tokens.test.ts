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
const WorkCodexLogs = `${Home}/.favo/accounts/work/codex/sessions/2026/10/30`;
const Rollout = 'rollout-2026-10-30T16-00-00-c.jsonl';
const OpencodeDatabase = `${Home}/.local/share/opencode/opencode.db`;
const WorkOpencodeDatabase = `${Home}/.favo/accounts/work/opencode/opencode/opencode.db`;

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

function opencodeRow(id: string, output: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `msg_${id}`,
    session: 'session-o',
    at: Date.parse('2026-10-30T18:05:00.000Z'),
    model: 'glm-test-1',
    input: 10,
    output,
    reasoning: 5,
    cacheRead: 1000,
    cacheWrite: 0,
    ...overrides,
  };
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

describe('reading the tokens of OpenCode', () => {
  it('counts its database, a message once whichever of its two tables holds it', async () => {
    const { client, tokenLogs } = createTestServer();
    tokenLogs.writeTable(OpencodeDatabase, 'message', [opencodeRow('one', 40), opencodeRow('two', 60)]);
    tokenLogs.writeTable(OpencodeDatabase, 'session_message', [opencodeRow('two', 60), opencodeRow('three', 20)]);
    const usage = await client.call(readTokenUsage, { isFresh: true });
    expect(usage.skippedRecords).toBe(0);
    expect(usage.rows).toEqual([
      {
        hour: '2026-10-30T18:00:00.000Z',
        account: 'personal',
        provider: 'opencode',
        model: 'glm-test-1',
        input: 30,
        cacheRead: 3000,
        cacheWrite: 0,
        output: 135,
        sessions: 1,
      },
    ]);
  });
  it('finds the database of a cell one folder down, and only there', async () => {
    const { client, tokenLogs } = createTestServer();
    await client.call(createAccount, { name: 'work' });
    tokenLogs.writeTable(WorkOpencodeDatabase, 'message', [opencodeRow('one', 40)]);
    tokenLogs.writeTable(`${Home}/.local/share/opencode/storage/backup/opencode.db`, 'message', [
      opencodeRow('old', 9),
    ]);
    const { rows } = await client.call(readTokenUsage, { isFresh: true });
    expect(rows).toMatchObject([{ account: 'work', provider: 'opencode', output: 45 }]);
    expect(tokenLogs.reads).toEqual([WorkOpencodeDatabase]);
  });
  it('keeps what it counted when a session is deleted from the database', async () => {
    const { client, tokenLogs } = createTestServer();
    tokenLogs.writeTable(OpencodeDatabase, 'message', [opencodeRow('one', 40), opencodeRow('two', 60)]);
    await client.call(readTokenUsage, { isFresh: true });
    tokenLogs.writeTable(OpencodeDatabase, 'message', [opencodeRow('two', 60)]);
    const { rows } = await client.call(readTokenUsage, { isFresh: true });
    expect(rows).toMatchObject([{ output: 110 }]);
  });
  it('says so when the database could not be read, and keeps the other providers', async () => {
    const { client, tokenLogs } = serverWithLogs();
    tokenLogs.writeTable(OpencodeDatabase, 'message', [opencodeRow('one', 40)]);
    tokenLogs.unreadable.push(OpencodeDatabase);
    const usage = await client.call(readTokenUsage, { isFresh: true });
    expect(usage.skippedRecords).toBe(1);
    expect(usage.rows.map(({ provider }) => provider)).toEqual(['claude', 'codex']);
  });
});

describe('a log two accounts can reach', () => {
  async function serverWithWork() {
    const server = serverWithLogs();
    await server.client.call(createAccount, { name: 'work' });
    return server;
  }

  async function rowsOfOneSeat() {
    const { rows } = await serverWithLogs().client.call(readTokenUsage, { isFresh: true });
    return rows;
  }

  it('counts a linked session once, for the account that holds the real file', async () => {
    const { client, tokenLogs } = await serverWithWork();
    tokenLogs.link(`${WorkLogs}/one.jsonl`, `${ClaudeLogs}/one.jsonl`);
    const usage = await client.call(readTokenUsage, { isFresh: true });
    expect(usage).toMatchObject({ rows: await rowsOfOneSeat(), skippedRecords: 0 });
    expect(tokenLogs.reads).toHaveLength(2);
  });
  it('skips a linked folder of another account with everything under it', async () => {
    const { client, tokenLogs } = await serverWithWork();
    tokenLogs.link(`${Home}/.favo/accounts/work/claude/projects/linked`, `${Home}/.claude/projects`);
    tokenLogs.link(WorkCodexLogs, CodexLogs);
    const { rows } = await client.call(readTokenUsage, { isFresh: true });
    expect(rows).toEqual(await rowsOfOneSeat());
  });
  it('reads a log outside every account once when two accounts link it', async () => {
    const { client, tokenLogs } = await serverWithWork();
    tokenLogs.write('/mnt/backup/old.jsonl', [claudeLine('old', 9)]);
    tokenLogs.link(`${ClaudeLogs}/old.jsonl`, '/mnt/backup/old.jsonl');
    tokenLogs.link(`${WorkLogs}/old.jsonl`, '/mnt/backup/old.jsonl');
    const { rows } = await client.call(readTokenUsage, { isFresh: true });
    expect(rows.filter(({ provider }) => provider === 'claude')).toMatchObject([{ account: 'personal', output: 109 }]);
    expect(tokenLogs.reads.filter((path) => path.endsWith('old.jsonl'))).toHaveLength(1);
  });
  it('reads an account whose whole log folder is a link', async () => {
    const { client, tokenLogs } = await serverWithWork();
    tokenLogs.link(`${Home}/.favo/accounts/work/claude/projects`, '/mnt/disk/projects');
    tokenLogs.write('/mnt/disk/projects/-home-bee-hive/own.jsonl', [claudeLine('own', 5, { sessionId: 'session-w' })]);
    const { rows } = await client.call(readTokenUsage, { isFresh: true });
    expect(rows.find(({ account }) => account === 'work')).toMatchObject({ output: 5, sessions: 1 });
  });
  it('skips a link that leads nowhere, without calling it a record it could not read', async () => {
    const { client, tokenLogs } = await serverWithWork();
    tokenLogs.link(`${WorkLogs}/gone.jsonl`, '/mnt/backup/gone.jsonl');
    const usage = await client.call(readTokenUsage, { isFresh: true });
    expect(usage).toMatchObject({ rows: await rowsOfOneSeat(), skippedRecords: 0 });
  });
  it('counts a request copied into another account once, tokens and sessions', async () => {
    const { client, tokenLogs } = await serverWithWork();
    tokenLogs.write(`${WorkLogs}/one.jsonl`, [claudeLine('one', 40), claudeLine('two', 60)]);
    const { rows } = await client.call(readTokenUsage, { isFresh: true });
    expect(rows).toEqual(await rowsOfOneSeat());
  });
  it('gives a copied request to the account whose file is older', async () => {
    const { client, tokenLogs } = await serverWithWork();
    tokenLogs.write(`${ClaudeLogs}/one.jsonl`, [claudeLine('one', 40), claudeLine('two', 60)], 300);
    tokenLogs.write(`${WorkLogs}/one.jsonl`, [claudeLine('one', 40), claudeLine('two', 60)], 200);
    const { rows } = await client.call(readTokenUsage, { isFresh: true });
    expect(rows.filter(({ provider }) => provider === 'claude')).toMatchObject([{ account: 'work', output: 100 }]);
  });
  it('keeps the largest numbers when one copy is partial', async () => {
    const { client, tokenLogs } = await serverWithWork();
    tokenLogs.write(`${WorkLogs}/one.jsonl`, [claudeLine('two', 75)]);
    const { rows } = await client.call(readTokenUsage, { isFresh: true });
    expect(rows.filter(({ provider }) => provider === 'claude')).toMatchObject([{ account: 'personal', output: 115 }]);
  });
  it('counts a request that carries no id in each account, since nothing can compare it', async () => {
    const { client, tokenLogs } = await serverWithWork();
    const nameless = claudeLine('one', 8, {
      requestId: undefined,
      message: { ...claudeLine('one', 8).message, id: undefined },
    });
    tokenLogs.write(`${ClaudeLogs}/nameless.jsonl`, [nameless]);
    tokenLogs.write(`${WorkLogs}/nameless.jsonl`, [nameless]);
    const { rows } = await client.call(readTokenUsage, { isFresh: true });
    expect(rows.filter(({ provider }) => provider === 'claude')).toMatchObject([
      { account: 'personal', output: 108 },
      { account: 'work', output: 8 },
    ]);
  });
  it('counts a Codex rollout that sits in two accounts once', async () => {
    const { client, tokenLogs } = await serverWithWork();
    tokenLogs.write(`${WorkCodexLogs}/${Rollout}.zst`, codexRollout(70));
    const { rows } = await client.call(readTokenUsage, { isFresh: true });
    expect(rows).toEqual(await rowsOfOneSeat());
  });
  it('forgets what an older favo counted twice, and only for the account that was wrong', async () => {
    const { client, tokenLogs, fileSystem, paths } = await serverWithWork();
    tokenLogs.link(`${WorkLogs}/one.jsonl`, `${ClaudeLogs}/one.jsonl`);
    const own = { timestamp: '2026-10-30T18:05:00.000Z', sessionId: 'session-w' };
    tokenLogs.write(`${WorkLogs}/own.jsonl`, [claudeLine('own', 5, own)]);
    const [claude, codex] = await rowsOfOneSeat();
    const august = '2026-08-05T10:00:00.000Z';
    const record = {
      version: 1,
      readAt: '2026-10-30T00:00:00.000Z',
      skippedRecords: 0,
      rows: [
        { ...claude!, hour: august, output: 7 },
        claude,
        codex,
        { ...claude!, account: 'work', hour: august, output: 7 },
        { ...claude!, account: 'work' },
        { ...claude!, account: 'work', hour: '2026-10-30T18:00:00.000Z', output: 5 },
      ],
    };
    await fileSystem.replaceText(paths.tokenUsageFile, JSON.stringify(record));
    const { rows } = await client.call(readTokenUsage, { isFresh: true });
    expect(rows.map(({ account, hour, output }) => [account, hour.slice(5, 13), output])).toEqual([
      ['personal', '08-05T10', 7],
      ['personal', '10-30T14', 100],
      ['personal', '10-30T16', 70],
      ['work', '10-30T18', 5],
    ]);
  });
  it('keeps every stored hour of a machine with no shared log when the reader changes', async () => {
    const { client, tokenLogs, fileSystem, paths } = await serverWithWork();
    tokenLogs.write(`${WorkLogs}/own.jsonl`, [claudeLine('own', 5, { sessionId: 'session-w' })]);
    const { rows } = await client.call(readTokenUsage, { isFresh: true });
    const gone = { ...rows.find(({ account }) => account === 'work')!, hour: '2026-08-05T10:00:00.000Z' };
    const record = { version: 1, readAt: '2026-10-30T00:00:00.000Z', skippedRecords: 0, rows: [...rows, gone] };
    await fileSystem.replaceText(paths.tokenUsageFile, JSON.stringify(record));
    const after = await client.call(readTokenUsage, { isFresh: true });
    expect(after.rows).toHaveLength(rows.length + 1);
    expect(after.rows).toEqual(expect.arrayContaining([...rows, gone]));
  });
});

describe('what the record remembers about the logs', () => {
  async function serverWithWork() {
    const server = serverWithLogs();
    await server.client.call(createAccount, { name: 'work' });
    return server;
  }

  async function recordOf({ fileSystem, paths }: ReturnType<typeof createTestServer>) {
    return JSON.parse((await fileSystem.readText(paths.tokenUsageFile))!);
  }

  it('writes down which hours each log fed', async () => {
    const server = serverWithLogs();
    await server.client.call(readTokenUsage, { isFresh: true });
    expect(await recordOf(server)).toMatchObject({
      goneHours: [],
      owners: { claude: {}, codex: {} },
      logs: {
        [`${ClaudeLogs}/one.jsonl`]: { provider: 'claude', hours: { personal: ['2026-10-30T14:00:00.000Z'] } },
        [`${CodexLogs}/${Rollout}`]: { provider: 'codex', hours: { personal: ['2026-10-30T16:00:00.000Z'] } },
      },
    });
  });
  it('moves the hours of a log that is gone out of the logs it holds', async () => {
    const server = serverWithLogs();
    await server.client.call(readTokenUsage, { isFresh: true });
    server.tokenLogs.remove(`${ClaudeLogs}/one.jsonl`);
    await server.client.call(readTokenUsage, { isFresh: true });
    const record = await recordOf(server);
    expect(Object.keys(record.logs)).toEqual([`${CodexLogs}/${Rollout}`]);
    expect(record.goneHours).toEqual([{ account: 'personal', provider: 'claude', hour: '2026-10-30T14:00:00.000Z' }]);
  });
  it('lets a later reader lower an hour whose logs are all on disk, and not one a deleted log fed', async () => {
    const server = serverWithLogs();
    const { client, tokenLogs, fileSystem, paths } = server;
    const later = { timestamp: '2026-10-30T18:05:00.000Z', sessionId: 'session-b' };
    tokenLogs.write(`${ClaudeLogs}/later.jsonl`, [claudeLine('later', 5, later)]);
    await client.call(readTokenUsage, { isFresh: true });
    const record = await recordOf(server);
    const rows = record.rows.map((row: { output: number }) => ({ ...row, output: row.output + 900 }));
    await fileSystem.replaceText(paths.tokenUsageFile, JSON.stringify({ ...record, version: 99, rows }));
    tokenLogs.remove(`${ClaudeLogs}/later.jsonl`);
    const after = await client.call(readTokenUsage, { isFresh: true });
    expect(after.rows.map(({ hour, output }) => [hour.slice(11, 13), output])).toEqual([
      ['14', 100],
      ['16', 70],
      ['18', 905],
    ]);
  });
  it('keeps a copied request with its first account after that account loses its log', async () => {
    const server = await serverWithWork();
    const { client, tokenLogs } = server;
    tokenLogs.write(`${WorkLogs}/one.jsonl`, [claudeLine('one', 40), claudeLine('two', 60)]);
    const first = await client.call(readTokenUsage, { isFresh: true });
    expect((await recordOf(server)).owners.claude).toEqual({
      'msg_one:req_one': 'personal',
      'msg_two:req_two': 'personal',
    });
    tokenLogs.remove(`${ClaudeLogs}/one.jsonl`);
    const second = await client.call(readTokenUsage, { isFresh: true });
    expect(second.rows).toEqual(first.rows);
    expect(await client.call(readTokenUsage, { isFresh: true })).toMatchObject({ rows: first.rows });
  });
  it('keeps a copied Codex rollout with its first account after that account loses its log', async () => {
    const server = await serverWithWork();
    const { client, tokenLogs } = server;
    tokenLogs.write(`${WorkCodexLogs}/${Rollout}.zst`, codexRollout(70));
    const first = await client.call(readTokenUsage, { isFresh: true });
    expect((await recordOf(server)).owners.codex).toEqual({ [Rollout]: 'personal' });
    tokenLogs.remove(`${CodexLogs}/${Rollout}`);
    const second = await client.call(readTokenUsage, { isFresh: true });
    expect(second.rows).toEqual(first.rows);
  });
  it('forgets who owns a request once no log holds it', async () => {
    const server = await serverWithWork();
    const { client, tokenLogs } = server;
    tokenLogs.write(`${WorkLogs}/one.jsonl`, [claudeLine('one', 40)]);
    await client.call(readTokenUsage, { isFresh: true });
    tokenLogs.remove(`${ClaudeLogs}/one.jsonl`);
    tokenLogs.remove(`${WorkLogs}/one.jsonl`);
    const { rows } = await client.call(readTokenUsage, { isFresh: true });
    expect((await recordOf(server)).owners.claude).toEqual({});
    expect(rows[0]).toMatchObject({ account: 'personal', output: 100 });
  });
  it('reads the record of the version before, and starts remembering from there', async () => {
    const server = serverWithLogs();
    const { client, fileSystem, paths } = server;
    const { rows } = await client.call(readTokenUsage, { isFresh: true });
    const august = { ...rows[0]!, hour: '2026-08-05T10:00:00.000Z', output: 7 };
    const before = { version: 2, readAt: '2026-10-30T00:00:00.000Z', skippedRecords: 0, rows: [august, ...rows] };
    await fileSystem.replaceText(paths.tokenUsageFile, JSON.stringify(before));
    const after = await client.call(readTokenUsage, { isFresh: true });
    expect(after.rows).toEqual([august, ...rows]);
    const record = await recordOf(server);
    expect(record).toMatchObject({ version: 3, goneHours: [{ account: 'personal', hour: august.hour }] });
    expect(Object.keys(record.logs)).toHaveLength(2);
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
    expect(JSON.parse((await fileSystem.readText(paths.tokenUsageFile))!)).toMatchObject({ version: 3 });
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
