export abstract class TokenLogs {
  abstract files(folder: string, suffixes: string[]): Promise<string[]>;
  abstract read(path: string, markers: string[], onLine: (line: string) => void): Promise<void>;
}
