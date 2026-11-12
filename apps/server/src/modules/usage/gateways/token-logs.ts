import type { TokenLogFolder } from '@favo/domain/usage/token-log-files';

export abstract class TokenLogs {
  abstract files(folder: string, suffixes: string[]): Promise<TokenLogFolder>;
  abstract read(path: string, markers: string[], onLine: (line: string) => void): Promise<void>;
}
