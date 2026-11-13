import { z } from 'zod';
import { ProviderId } from '#domain/providers/provider';
import type { TokenHour, TokenLedger, TokenSeat } from '#domain/usage/token-usage';

export type TokenLogFile = { path: string; realPath: string; createdAt?: number };

export type TokenLogFolder = { root?: string; files: TokenLogFile[] };

export type SeatTokenLogs = TokenSeat & Pick<TokenLogFolder, 'root' | 'files'>;

export type SeatTokenLog = TokenLogFile & TokenSeat;

export const TokenLogIndex = z.record(
  z.string(),
  z.strictObject({ provider: z.enum(ProviderId), hours: z.record(z.string(), z.array(z.iso.datetime())) })
);
export type TokenLogIndex = z.infer<typeof TokenLogIndex>;

export function tokenLogIndexOf({ logHours }: TokenLedger, provider: ProviderId): TokenLogIndex {
  const logs = [...logHours].map(([log, accounts]) => {
    const hours = [...accounts].map(([account, touched]) => [account, [...touched].toSorted()]);
    return [log, { provider, hours: Object.fromEntries(hours) }];
  });
  return Object.fromEntries(logs);
}

export function hoursOfGoneLogs(remembered: TokenLogIndex, read: TokenLogIndex) {
  const gone: TokenHour[] = [];
  for (const [log, { provider, hours }] of Object.entries(remembered)) {
    if (Object.hasOwn(read, log)) continue;
    for (const [account, touched] of Object.entries(hours)) {
      gone.push(...touched.map((hour) => ({ account, provider, hour })));
    }
  }
  return gone;
}

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
