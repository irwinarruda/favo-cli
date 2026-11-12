import { createReadStream } from 'node:fs';
import { open, readdir, readFile, stat } from 'node:fs/promises';
import { createZstdDecompress } from 'node:zlib';
import { DomainError, DomainErrorCode } from '@favo/domain/shared/domain-error';
import { TokenLogs } from '@/modules/usage/gateways/token-logs';
import { ZstdFrameHeaderBytes, zstdContentSizeOf } from '@/modules/usage/utils/zstd-frame';

const CompressedSuffix = '.zst';
const LineBreak = 10;
const WholeFileLimitBytes = 32 * 1024 * 1024;
const StreamChunkBytes = 1024 * 1024;

export class DiskTokenLogs extends TokenLogs {
  constructor(
    private readonly wholeFileLimitBytes = WholeFileLimitBytes,
    private readonly streamChunkBytes = StreamChunkBytes
  ) {
    super();
  }

  async files(folder: string, suffixes: string[]) {
    const names = await readdir(folder, { recursive: true }).catch(() => []);
    return names
      .map((name) => name.replaceAll('\\', '/'))
      .filter((name) => suffixes.some((suffix) => name.endsWith(suffix)))
      .map((name) => `${folder}/${name}`)
      .toSorted();
  }

  async read(path: string, markers: string[], onLine: (line: string) => void) {
    try {
      const needles = markers.map((marker) => Buffer.from(marker));
      const carried: Buffer[] = [];
      const { chunks, unpackedSize } = await this.chunksOf(path);
      let seen = 0;
      for await (const chunk of chunks) {
        seen += chunk.length;
        let from = 0;
        for (let end = chunk.indexOf(LineBreak); end >= 0; end = chunk.indexOf(LineBreak, from)) {
          const piece = chunk.subarray(from, end);
          emit(carried.length > 0 ? Buffer.concat([...carried.splice(0), piece]) : piece, needles, onLine);
          from = end + 1;
        }
        if (from < chunk.length) carried.push(chunk.subarray(from));
      }
      if (seen < (unpackedSize ?? 0)) throw new Error('it ends before its last line');
      if (carried.length > 0) emit(Buffer.concat(carried), needles, onLine);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new DomainError(DomainErrorCode.logUnreadable, `Could not read ${path}: ${reason}`);
    }
  }

  private async chunksOf(path: string): Promise<{ chunks: AsyncIterable<Buffer> | Buffer[]; unpackedSize?: number }> {
    const { size } = await stat(path);
    if (!path.endsWith(CompressedSuffix)) {
      if (size <= this.wholeFileLimitBytes) return { chunks: [await readFile(path)] };
      return { chunks: createReadStream(path, { highWaterMark: this.streamChunkBytes }) };
    }
    const unpackedSize = await this.unpackedSizeOf(path);
    if (unpackedSize !== undefined && Math.max(size, unpackedSize) <= this.wholeFileLimitBytes) {
      const unpacked = await Bun.zstdDecompress(await readFile(path));
      return { chunks: [Buffer.from(unpacked.buffer, unpacked.byteOffset, unpacked.byteLength)] };
    }
    const packed = createReadStream(path, { highWaterMark: this.streamChunkBytes });
    const unpacked = createZstdDecompress();
    packed.on('error', (error) => unpacked.destroy(error));
    unpacked.on('close', () => packed.destroy());
    return { chunks: packed.pipe(unpacked), unpackedSize };
  }

  private async unpackedSizeOf(path: string) {
    const file = await open(path, 'r');
    try {
      const { buffer, bytesRead } = await file.read(Buffer.alloc(ZstdFrameHeaderBytes), 0, ZstdFrameHeaderBytes, 0);
      return zstdContentSizeOf(buffer.subarray(0, bytesRead));
    } finally {
      await file.close();
    }
  }
}

function emit(line: Buffer, needles: Buffer[], onLine: (line: string) => void) {
  if (needles.some((needle) => line.includes(needle))) onLine(line.toString('utf8'));
}
