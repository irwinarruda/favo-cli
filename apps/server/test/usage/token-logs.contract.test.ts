import { Database } from 'bun:sqlite';
import { afterAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname } from 'node:path';
import { DomainErrorCode } from '@favo/domain/shared/domain-error';
import { OpencodeTokenTables } from '@favo/domain/usage/opencode-token-log';
import { DiskTokenLogs } from '@/modules/usage/gateways/disk.token-logs';
import { MemoryTokenLogs } from '@/modules/usage/gateways/memory.token-logs';
import type { TokenLogs } from '@/modules/usage/gateways/token-logs';
import { zstdContentSizeOf } from '@/modules/usage/utils/zstd-frame';

const realRoot = realpathSync(mkdtempSync(`${tmpdir()}/favo-logs-`)).replaceAll('\\', '/');
afterAll(() => rmSync(realRoot, { recursive: true, force: true }));

const Lines = ['{"type":"user","text":"hello"}', '{"type":"assistant","usage":1}', '{"usage":2,"note":"çã"}'];
const LongLine = `{"usage":3,"pad":"${'x'.repeat(5000)}"}`;
const Rows = [
  { id: 'a', n: 1 },
  { id: 'b', n: 2 },
];
const Tables = ['first', 'second'].map((name) => ({ name, query: `select id, n from ${name}` }));

type Row = { id: string; n: number };

function onDisk(wholeFileLimitBytes?: number, streamChunkBytes?: number, longestTurnMs?: number) {
  const logs = new DiskTokenLogs(wholeFileLimitBytes, streamChunkBytes, longestTurnMs);
  function write(path: string, lines: string[]) {
    mkdirSync(dirname(path), { recursive: true });
    const text = lines.join('\n');
    writeFileSync(path, path.endsWith('.zst') ? Bun.zstdCompressSync(Buffer.from(text)) : text);
  }
  function link(path: string, target: string) {
    mkdirSync(dirname(path), { recursive: true });
    symlinkSync(target, path);
  }
  function writeTable(path: string, table: string, rows: Row[]) {
    mkdirSync(dirname(path), { recursive: true });
    const database = new Database(path);
    database.run(`create table ${table} (id text primary key, n integer)`);
    const insert = database.query(`insert into ${table} values (?, ?)`);
    database.transaction(() => {
      for (const { id, n } of rows) insert.run(id, n);
    })();
    database.close();
  }
  return { logs, write, link, writeTable };
}

function inMemory() {
  const logs = new MemoryTokenLogs();
  return {
    logs,
    write: (path: string, lines: string[]) => logs.write(path, lines),
    link: (path: string, target: string) => logs.link(path, target),
    writeTable: (path: string, table: string, rows: Row[]) => logs.writeTable(path, table, rows),
  };
}

type Double = {
  logs: TokenLogs;
  write(path: string, lines: string[]): void;
  link(path: string, target: string): void;
  writeTable(path: string, table: string, rows: Row[]): void;
};

const doubles: [string, () => Double, string][] = [
  ['disk, whole files', () => onDisk(), `${realRoot}/whole`],
  ['disk, in pieces', () => onDisk(64, 16), `${realRoot}/pieces`],
  ['memory', inMemory, '/logs'],
];

async function pathsOf(logs: TokenLogs, folder: string, suffixes: string[], isDeep?: boolean) {
  const { files } = await logs.files(folder, suffixes, isDeep);
  return files.map(({ path }) => path);
}

async function rowsOf(logs: TokenLogs, path: string, tables = Tables) {
  const rows: unknown[] = [];
  await logs.rows(path, tables, (row) => rows.push(row));
  return rows;
}

async function linesOf(logs: TokenLogs, path: string, markers = ['"usage"']) {
  const lines: string[] = [];
  await logs.read(path, markers, (line) => lines.push(line));
  return lines;
}

describe.each(doubles)('token logs on %s', (_name, create, root) => {
  it('lists the logs of a folder at any depth, sorted, and only those asked for', async () => {
    const { logs, write } = create();
    write(`${root}/list/b/two.jsonl`, Lines);
    write(`${root}/list/a/deep/one.jsonl`, Lines);
    write(`${root}/list/a/three.jsonl.zst`, Lines);
    write(`${root}/list/a/notes.txt`, Lines);
    expect(await pathsOf(logs, `${root}/list`, ['.jsonl'])).toEqual([
      `${root}/list/a/deep/one.jsonl`,
      `${root}/list/b/two.jsonl`,
    ]);
    expect(await pathsOf(logs, `${root}/list`, ['.jsonl', '.jsonl.zst'])).toHaveLength(3);
  });
  it('lists only what sits right in the folder when told not to go deeper', async () => {
    const { logs, write } = create();
    write(`${root}/flat/own.db`, Lines);
    write(`${root}/flat/notes.txt`, Lines);
    write(`${root}/flat/deep/other.db`, Lines);
    expect(await pathsOf(logs, `${root}/flat`, ['.db'], false)).toEqual([`${root}/flat/own.db`]);
  });
  it('lists nothing for a folder that is not there', async () => {
    expect(await pathsOf(create().logs, `${root}/missing`, ['.jsonl'])).toEqual([]);
  });
  it.skipIf(process.platform === 'win32')('says where a linked log and a linked folder really live', async () => {
    const { logs, write, link } = create();
    write(`${root}/other/deep/one.jsonl`, Lines);
    write(`${root}/other/two.jsonl`, Lines);
    write(`${root}/linked/own.jsonl`, Lines);
    link(`${root}/linked/file.jsonl`, `${root}/other/two.jsonl`);
    link(`${root}/linked/folder`, `${root}/other/deep`);
    const { root: listed, files } = await logs.files(`${root}/linked`, ['.jsonl']);
    expect(listed).toBe(`${root}/linked`);
    expect(files.map(({ path, realPath }) => [path, realPath])).toEqual([
      [`${root}/linked/file.jsonl`, `${root}/other/two.jsonl`],
      [`${root}/linked/folder/one.jsonl`, `${root}/other/deep/one.jsonl`],
      [`${root}/linked/own.jsonl`, `${root}/linked/own.jsonl`],
    ]);
    expect(await linesOf(logs, `${root}/linked/folder/one.jsonl`)).toHaveLength(2);
  });
  it.skipIf(process.platform === 'win32')('lists a folder that is itself a link, under its real place', async () => {
    const { logs, write, link } = create();
    write(`${root}/disk/projects/one.jsonl`, Lines);
    link(`${root}/seat/projects`, `${root}/disk/projects`);
    const { root: listed, files } = await logs.files(`${root}/seat/projects`, ['.jsonl']);
    expect(listed).toBe(`${root}/disk/projects`);
    expect(files.map(({ path, realPath }) => [path, realPath])).toEqual([
      [`${root}/seat/projects/one.jsonl`, `${root}/disk/projects/one.jsonl`],
    ]);
  });
  it.skipIf(process.platform === 'win32')('skips a link that leads nowhere, and lists the rest', async () => {
    const { logs, write, link } = create();
    write(`${root}/broken/own.jsonl`, Lines);
    link(`${root}/broken/gone.jsonl`, `${root}/nowhere/gone.jsonl`);
    const { files } = await logs.files(`${root}/broken`, ['.jsonl']);
    expect(files.map(({ path }) => path)).toEqual([`${root}/broken/own.jsonl`]);
  });
  it('hands over only the lines that carry a marker, whole', async () => {
    const { logs, write } = create();
    write(`${root}/read/one.jsonl`, [...Lines, LongLine]);
    expect(await linesOf(logs, `${root}/read/one.jsonl`)).toEqual([Lines[1]!, Lines[2]!, LongLine]);
    expect(await linesOf(logs, `${root}/read/one.jsonl`, ['"hello"', '"note"'])).toEqual([Lines[0]!, Lines[2]!]);
  });
  it('reads a log with no line break at its end, and an empty one', async () => {
    const { logs, write } = create();
    write(`${root}/read/tail.jsonl`, [Lines[1]!]);
    write(`${root}/read/empty.jsonl`, []);
    expect(await linesOf(logs, `${root}/read/tail.jsonl`)).toEqual([Lines[1]!]);
    expect(await linesOf(logs, `${root}/read/empty.jsonl`)).toEqual([]);
  });
  it('says so when a log cannot be read', async () => {
    const { logs } = create();
    const call = linesOf(logs, `${root}/read/gone.jsonl`);
    await expect(call).rejects.toMatchObject({ code: DomainErrorCode.logUnreadable });
  });
  it('hands over the rows of each table asked for, in that order', async () => {
    const { logs, writeTable } = create();
    writeTable(`${root}/rows/two.db`, 'second', [Rows[1]!]);
    writeTable(`${root}/rows/two.db`, 'first', [Rows[0]!]);
    expect(await rowsOf(logs, `${root}/rows/two.db`)).toEqual(Rows);
    expect(await rowsOf(logs, `${root}/rows/two.db`, [Tables[1]!])).toEqual([Rows[1]!]);
  });
  it('passes over a table the database does not have', async () => {
    const { logs, writeTable } = create();
    writeTable(`${root}/rows/one.db`, 'second', Rows);
    expect(await rowsOf(logs, `${root}/rows/one.db`)).toEqual(Rows);
  });
  it('lists a database like any other log', async () => {
    const { logs, writeTable } = create();
    writeTable(`${root}/listed/own.db`, 'first', Rows);
    expect(await pathsOf(logs, `${root}/listed`, ['.db'])).toEqual([`${root}/listed/own.db`]);
  });
  it('says so when a database cannot be read', async () => {
    const { logs } = create();
    const call = rowsOf(logs, `${root}/rows/gone.db`);
    await expect(call).rejects.toMatchObject({ code: DomainErrorCode.logUnreadable });
  });
});

describe('token logs on disk', () => {
  it.skipIf(process.platform === 'win32')('walks a folder once when a link leads back into it', async () => {
    const { logs, write, link } = onDisk();
    write(`${realRoot}/loop/a/one.jsonl`, Lines);
    link(`${realRoot}/loop/a/back`, `${realRoot}/loop`);
    const { files } = await logs.files(`${realRoot}/loop`, ['.jsonl']);
    expect(files.map(({ path }) => path)).toEqual([`${realRoot}/loop/a/one.jsonl`]);
    expect(files[0]?.createdAt).toBeGreaterThan(0);
  });
  it('says so when a file is not a database, or a table is not what was asked for', async () => {
    const { logs, write, writeTable } = onDisk();
    write(`${realRoot}/bad/text.db`, Lines);
    writeTable(`${realRoot}/bad/other.db`, 'first', Rows);
    const unreadable = { code: DomainErrorCode.logUnreadable };
    await expect(rowsOf(logs, `${realRoot}/bad/text.db`)).rejects.toMatchObject(unreadable);
    const wrong = [{ name: 'first', query: 'select missing from first' }];
    await expect(rowsOf(logs, `${realRoot}/bad/other.db`, wrong)).rejects.toMatchObject(unreadable);
  });
  it('gives the turn back while it reads a table, and leaves the database as it was', async () => {
    const { logs, writeTable } = onDisk(undefined, undefined, 0);
    const path = `${realRoot}/turns/many.db`;
    const rows = Array.from({ length: 20 }, (_, index) => ({ id: `row-${index}`, n: index }));
    writeTable(path, 'first', rows);
    const before = statSync(path).mtimeMs;
    let hadATurn = false;
    setImmediate(() => {
      hadATurn = true;
    });
    expect(await rowsOf(logs, path)).toEqual(rows);
    expect(hadATurn).toBe(true);
    expect(statSync(path).mtimeMs).toBe(before);
  });
  it('reads the numbers of OpenCode from both of its tables, and none of its text', async () => {
    const path = `${realRoot}/opencode/opencode.db`;
    mkdirSync(dirname(path), { recursive: true });
    const database = new Database(path);
    database.run('pragma journal_mode = wal');
    database.run(
      'create table message (id text primary key, session_id text not null, time_created integer not null, time_updated integer not null, data text not null)'
    );
    database.run(
      'create table session_message (id text primary key, session_id text not null, type text not null, seq integer not null, time_created integer not null, time_updated integer not null, data text not null)'
    );
    const tokens = { input: 10, output: 40, reasoning: 5, cache: { read: 2000, write: 300 } };
    const old = { role: 'assistant', modelID: 'glm-test-1', providerID: 'zai', path: { cwd: '/secret' }, tokens };
    const fresh = { model: { id: 'glm-test-2', providerID: 'zai' }, content: [{ type: 'text', text: 'a secret' }] };
    const insertOld = 'insert into message values (?, ?, ?, ?, ?)';
    database.run(insertOld, ['msg_1', 'ses_a', 1000, 1000, JSON.stringify(old)]);
    database.run(insertOld, ['msg_2', 'ses_a', 2000, 2000, JSON.stringify({ role: 'user', text: 'a secret' })]);
    database.run(insertOld, ['msg_3', 'ses_a', 3000, 3000, '{"role":"assistant","tokens":']);
    const insertNew = 'insert into session_message values (?, ?, ?, ?, ?, ?, ?)';
    database.run(insertNew, ['msg_4', 'ses_b', 'assistant', 1, 4000, 4000, JSON.stringify({ ...fresh, tokens })]);
    database.run(insertNew, ['msg_5', 'ses_b', 'user', 2, 5000, 5000, JSON.stringify({ text: 'a secret' })]);
    database.run(insertNew, ['msg_6', 'ses_b', 'assistant', 3, 6000, 6000, 'not json']);
    database.close();
    const numbers = { input: 10, output: 40, reasoning: 5, cacheRead: 2000, cacheWrite: 300 };
    const rows = await rowsOf(new DiskTokenLogs(), path, OpencodeTokenTables);
    expect(rows).toEqual([
      { id: 'msg_1', session: 'ses_a', at: 1000, model: 'glm-test-1', ...numbers },
      { id: 'msg_4', session: 'ses_b', at: 4000, model: 'glm-test-2', ...numbers },
    ]);
  });
  it.each([undefined, 64])('reads a rollout Codex compressed with zstd (whole file limit %p)', async (limit) => {
    const { logs, write } = onDisk(limit);
    const path = `${realRoot}/zst-${limit}/rollout.jsonl.zst`;
    write(path, [...Lines, LongLine]);
    expect(await linesOf(logs, path)).toEqual([Lines[1]!, Lines[2]!, LongLine]);
  });
  it('reads a long compressed rollout in pieces, whatever its size on disk', async () => {
    const { logs, write } = onDisk(4096);
    const path = `${realRoot}/zst-long/rollout.jsonl.zst`;
    const lines = Array.from({ length: 400 }, (_, index) => `{"usage":${index},"pad":"${'x'.repeat(index)}"}`);
    write(path, lines);
    expect(statSync(path).size).toBeLessThan(4096);
    expect(await linesOf(logs, path)).toEqual(lines);
  });
  it.each([undefined, 4])('says so when a compressed rollout is corrupt (whole file limit %p)', async (limit) => {
    const path = `${realRoot}/corrupt-${limit}/rollout.jsonl.zst`;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      Buffer.concat([Bun.zstdCompressSync(Buffer.from(LongLine)).subarray(0, 12), Buffer.from('nope')])
    );
    const call = linesOf(new DiskTokenLogs(limit), path);
    await expect(call).rejects.toMatchObject({ code: DomainErrorCode.logUnreadable });
  });
  it('knows how large a rollout is once unpacked, from its first bytes', () => {
    for (const size of [0, 200, 300, 70_000, 5_000_000]) {
      const packed = Bun.zstdCompressSync(Buffer.alloc(size, 'x'));
      expect(zstdContentSizeOf(Buffer.from(packed).subarray(0, 18))).toBe(size);
    }
    expect(zstdContentSizeOf(Buffer.from('not zstd at all'))).toBeUndefined();
    expect(zstdContentSizeOf(Buffer.alloc(3))).toBeUndefined();
  });
});
