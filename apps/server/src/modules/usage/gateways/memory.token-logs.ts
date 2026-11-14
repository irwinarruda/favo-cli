import { DomainError, DomainErrorCode } from '@favo/domain/shared/domain-error';
import type { TokenTable } from '@favo/domain/usage/token-usage';
import { TokenLogs } from '@/modules/usage/gateways/token-logs';

const DeepestLink = 8;

export class MemoryTokenLogs extends TokenLogs {
  readonly reads: string[] = [];
  readonly unreadable: string[] = [];
  hold?: Promise<void>;
  private readonly texts = new Map<string, string>();
  private readonly databases = new Map<string, Map<string, unknown[]>>();
  private readonly created = new Map<string, number>();
  private readonly links = new Map<string, string>();

  write(path: string, lines: unknown[], createdAt?: number) {
    this.texts.set(path, lines.map((line) => (typeof line === 'string' ? line : JSON.stringify(line))).join('\n'));
    if (createdAt !== undefined) this.created.set(path, createdAt);
  }

  writeTable(path: string, table: string, rows: unknown[]) {
    const tables = this.databases.get(path) ?? new Map<string, unknown[]>();
    this.databases.set(path, tables.set(table, rows));
  }

  link(path: string, target: string) {
    this.links.set(path, target);
  }

  remove(path: string) {
    this.texts.delete(path);
    this.databases.delete(path);
  }

  async files(folder: string, suffixes: string[], isDeep = true) {
    const root = this.realPathOf(folder);
    const paths = [...this.reachablePaths()].filter((path) => path.startsWith(`${folder}/`));
    const files = paths
      .filter((path) => isDeep || !path.slice(folder.length + 1).includes('/'))
      .filter((path) => suffixes.some((suffix) => path.endsWith(suffix)))
      .toSorted()
      .map((path) => ({ path, realPath: this.realPathOf(path), createdAt: this.created.get(this.realPathOf(path)) }));
    return { root, files };
  }

  async read(path: string, markers: string[], onLine: (line: string) => void) {
    this.reads.push(path);
    await this.hold;
    const text = this.texts.get(this.realPathOf(path));
    if (text === undefined || this.unreadable.includes(path)) {
      throw new DomainError(DomainErrorCode.logUnreadable, `Could not read ${path}: no such file`);
    }
    for (const line of text.split('\n')) {
      if (markers.some((marker) => line.includes(marker))) onLine(line);
    }
  }

  async rows(path: string, tables: TokenTable[], onRow: (row: unknown) => void) {
    this.reads.push(path);
    await this.hold;
    const database = this.databases.get(this.realPathOf(path));
    if (database === undefined || this.unreadable.includes(path)) {
      throw new DomainError(DomainErrorCode.logUnreadable, `Could not read ${path}: no such file`);
    }
    for (const { name } of tables) {
      for (const row of database.get(name) ?? []) onRow(row);
    }
  }

  private reachablePaths() {
    const paths = new Set([...this.texts.keys(), ...this.databases.keys()]);
    for (let depth = 0; depth < DeepestLink; depth += 1) {
      for (const [link, target] of this.links) {
        for (const path of [...paths]) {
          if (path === target || path.startsWith(`${target}/`)) paths.add(`${link}${path.slice(target.length)}`);
        }
      }
    }
    return paths;
  }

  private realPathOf(path: string) {
    let real = path;
    for (let depth = 0; depth < DeepestLink; depth += 1) {
      const link = [...this.links.keys()].find((each) => real === each || real.startsWith(`${each}/`));
      if (link === undefined) return real;
      real = `${this.links.get(link)}${real.slice(link.length)}`;
    }
    return real;
  }
}
