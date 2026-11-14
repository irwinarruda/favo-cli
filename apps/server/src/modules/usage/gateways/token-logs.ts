import type { TokenLogFolder } from '@favo/domain/usage/token-log-files';
import type { TokenTable } from '@favo/domain/usage/token-usage';

export abstract class TokenLogs {
  abstract files(folder: string, suffixes: string[], isDeep?: boolean): Promise<TokenLogFolder>;
  abstract read(path: string, markers: string[], onLine: (line: string) => void): Promise<void>;
  abstract rows(path: string, tables: TokenTable[], onRow: (row: unknown) => void): Promise<void>;
}
