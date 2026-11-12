import { afterAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname } from 'node:path';
import { DomainErrorCode } from '@favo/domain/shared/domain-error';
import { DiskTokenLogs } from '@/modules/usage/gateways/disk.token-logs';
import { MemoryTokenLogs } from '@/modules/usage/gateways/memory.token-logs';
import type { TokenLogs } from '@/modules/usage/gateways/token-logs';
import { zstdContentSizeOf } from '@/modules/usage/utils/zstd-frame';

const realRoot = mkdtempSync(`${tmpdir()}/favo-logs-`).replaceAll('\\', '/');
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
  return { logs, write };
}

function inMemory() {
  const logs = new MemoryTokenLogs();
  return { logs, write: (path: string, lines: string[]) => logs.write(path, lines) };
}

const doubles: [string, () => { logs: TokenLogs; write(path: string, lines: string[]): void }, string][] = [
  ['disk, whole files', () => onDisk(), `${realRoot}/whole`],
  ['disk, in pieces', () => onDisk(64, 16), `${realRoot}/pieces`],
  ['memory', inMemory, '/logs'],
];

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
    expect(await logs.files(`${root}/list`, ['.jsonl'])).toEqual([
      `${root}/list/a/deep/one.jsonl`,
      `${root}/list/b/two.jsonl`,
    ]);
    expect(await logs.files(`${root}/list`, ['.jsonl', '.jsonl.zst'])).toHaveLength(3);
  });
  it('lists nothing for a folder that is not there', async () => {
    expect(await create().logs.files(`${root}/missing`, ['.jsonl'])).toEqual([]);
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
