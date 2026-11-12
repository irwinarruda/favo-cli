import { afterAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname } from 'node:path';
import { DomainErrorCode } from '@favo/domain/shared/domain-error';
import { DiskTokenLogs } from '@/modules/usage/gateways/disk.token-logs';
import { MemoryTokenLogs } from '@/modules/usage/gateways/memory.token-logs';
import type { TokenLogs } from '@/modules/usage/gateways/token-logs';
import { zstdContentSizeOf } from '@/modules/usage/utils/zstd-frame';

const realRoot = realpathSync(mkdtempSync(`${tmpdir()}/favo-logs-`)).replaceAll('\\', '/');
afterAll(() => rmSync(realRoot, { recursive: true, force: true }));

const Lines = ['{"type":"user","text":"hello"}', '{"type":"assistant","usage":1}', '{"usage":2,"note":"çã"}'];
const LongLine = `{"usage":3,"pad":"${'x'.repeat(5000)}"}`;

function onDisk(wholeFileLimitBytes?: number, streamChunkBytes?: number) {
  const logs = new DiskTokenLogs(wholeFileLimitBytes, streamChunkBytes);
  function write(path: string, lines: string[]) {
    mkdirSync(dirname(path), { recursive: true });
    const text = lines.join('\n');
    writeFileSync(path, path.endsWith('.zst') ? Bun.zstdCompressSync(Buffer.from(text)) : text);
  }
  function link(path: string, target: string) {
    mkdirSync(dirname(path), { recursive: true });
    symlinkSync(target, path);
  }
  return { logs, write, link };
}

function inMemory() {
  const logs = new MemoryTokenLogs();
  return {
    logs,
    write: (path: string, lines: string[]) => logs.write(path, lines),
    link: (path: string, target: string) => logs.link(path, target),
  };
}

type Double = { logs: TokenLogs; write(path: string, lines: string[]): void; link(path: string, target: string): void };

const doubles: [string, () => Double, string][] = [
  ['disk, whole files', () => onDisk(), `${realRoot}/whole`],
  ['disk, in pieces', () => onDisk(64, 16), `${realRoot}/pieces`],
  ['memory', inMemory, '/logs'],
];

async function pathsOf(logs: TokenLogs, folder: string, suffixes: string[]) {
  const { files } = await logs.files(folder, suffixes);
  return files.map(({ path }) => path);
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
    const { root: listed, files, brokenLinks } = await logs.files(`${root}/linked`, ['.jsonl']);
    expect(listed).toBe(`${root}/linked`);
    expect(brokenLinks).toBe(0);
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
  it.skipIf(process.platform === 'win32')('counts a link that leads nowhere, and lists the rest', async () => {
    const { logs, write, link } = create();
    write(`${root}/broken/own.jsonl`, Lines);
    link(`${root}/broken/gone.jsonl`, `${root}/nowhere/gone.jsonl`);
    const { files, brokenLinks } = await logs.files(`${root}/broken`, ['.jsonl']);
    expect(brokenLinks).toBe(1);
    expect(files).toHaveLength(1);
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
