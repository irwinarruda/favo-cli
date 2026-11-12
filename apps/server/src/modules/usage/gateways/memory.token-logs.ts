import { DomainError, DomainErrorCode } from '@favo/domain/shared/domain-error';
import { TokenLogs } from '@/modules/usage/gateways/token-logs';

export class MemoryTokenLogs extends TokenLogs {
  readonly reads: string[] = [];
  readonly unreadable: string[] = [];
  hold?: Promise<void>;
  private readonly texts = new Map<string, string>();

  write(path: string, lines: unknown[]) {
    this.texts.set(path, lines.map((line) => (typeof line === 'string' ? line : JSON.stringify(line))).join('\n'));
  }

  remove(path: string) {
    this.texts.delete(path);
  }

  async files(folder: string, suffixes: string[]) {
    return [...this.texts.keys()]
      .filter((path) => path.startsWith(`${folder}/`) && suffixes.some((suffix) => path.endsWith(suffix)))
      .toSorted();
  }

  async read(path: string, markers: string[], onLine: (line: string) => void) {
    this.reads.push(path);
    await this.hold;
    const text = this.texts.get(path);
    if (text === undefined || this.unreadable.includes(path)) {
      throw new DomainError(DomainErrorCode.logUnreadable, `Could not read ${path}: no such file`);
    }
    for (const line of text.split('\n')) {
      if (markers.some((marker) => line.includes(marker))) onLine(line);
    }
  }
}
