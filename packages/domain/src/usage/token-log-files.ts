import type { TokenSeat } from '#domain/usage/token-usage';

export type TokenLogFile = { path: string; realPath: string; createdAt?: number };

export type TokenLogFolder = { root?: string; files: TokenLogFile[]; brokenLinks: number };

export type SeatTokenLogs = TokenSeat & Pick<TokenLogFolder, 'root' | 'files'>;

export type SeatTokenLog = TokenLogFile & TokenSeat;

export function tokenLogsToRead(seats: SeatTokenLogs[]) {
  const roots = seats.flatMap(({ root }) => (root === undefined ? [] : [root]));
  const read = new Set<string>();
  const logs: SeatTokenLog[] = [];
  const repeatedSeats: TokenSeat[] = [];
  for (const { account, provider, root, files } of seats) {
    let hasRepeats = false;
    for (const file of files) {
      const isOwn = isInside(file.realPath, root);
      const isInAnotherSeat = !isOwn && roots.some((other) => isInside(file.realPath, other));
      const isRead = read.has(file.realPath);
      if (!isOwn || isRead) hasRepeats = true;
      if (isInAnotherSeat || isRead) continue;
      read.add(file.realPath);
      logs.push({ ...file, account, provider });
    }
    if (hasRepeats) repeatedSeats.push({ account, provider });
  }
  return { logs, repeatedSeats };
}

function isInside(path: string, folder: string | undefined) {
  return folder !== undefined && path.startsWith(`${folder}/`);
}
