import { describe, expect, it } from 'bun:test';
import { codexRolloutsOf } from '#domain/usage/codex-token-log';
import { hoursOfGoneLogs, type SeatTokenLogs, tokenLogsToRead } from '#domain/usage/token-log-files';

function seatOf(account: string, files: [path: string, realPath?: string][], root = `/${account}/projects`) {
  const logs = files.map(([path, realPath]) => ({
    path: `/${account}/projects/${path}`,
    realPath: realPath ?? `${root}/${path}`,
  }));
  return { account, provider: 'claude', root, files: logs } satisfies SeatTokenLogs;
}

function plan(...seats: SeatTokenLogs[]) {
  const { logs, repeatedSeats } = tokenLogsToRead(seats);
  return {
    read: logs.map(({ account, path }) => `${account}:${path}`),
    repeated: repeatedSeats.map(({ account }) => account),
  };
}

describe('the logs a machine reads', () => {
  it('reads every log of every seat when none is linked', () => {
    const { read, repeated } = plan(seatOf('personal', [['a.jsonl']]), seatOf('work', [['a.jsonl']]));
    expect(read).toEqual(['personal:/personal/projects/a.jsonl', 'work:/work/projects/a.jsonl']);
    expect(repeated).toEqual([]);
  });
  it('leaves a log linked from another seat to the seat that holds it, in either order', () => {
    const personal = seatOf('personal', [['a.jsonl']]);
    const work = seatOf('work', [['a.jsonl', '/personal/projects/a.jsonl'], ['b.jsonl']]);
    for (const seats of [
      [personal, work],
      [work, personal],
    ]) {
      const { read, repeated } = plan(...seats);
      expect(read.toSorted()).toEqual(['personal:/personal/projects/a.jsonl', 'work:/work/projects/b.jsonl']);
      expect(repeated).toEqual(['work']);
    }
  });
  it('reads a log that leaves every seat once, for the first seat that reaches it', () => {
    const { read, repeated } = plan(
      seatOf('personal', [['old.jsonl', '/mnt/old.jsonl']]),
      seatOf('work', [['old.jsonl', '/mnt/old.jsonl']])
    );
    expect(read).toEqual(['personal:/personal/projects/old.jsonl']);
    expect(repeated).toEqual(['personal', 'work']);
  });
  it('treats a seat whose folder is a link as the owner of what is inside it', () => {
    const { read, repeated } = plan(seatOf('work', [['a.jsonl']], '/mnt/disk/projects'));
    expect(read).toEqual(['work:/work/projects/a.jsonl']);
    expect(repeated).toEqual([]);
  });
  it('reads one folder once when two seats link all of it', () => {
    const { read, repeated } = plan(
      seatOf('personal', [['a.jsonl']], '/mnt/all'),
      seatOf('work', [['a.jsonl']], '/mnt/all')
    );
    expect(read).toEqual(['personal:/personal/projects/a.jsonl']);
    expect(repeated).toEqual(['work']);
  });
});

describe('the logs a machine remembers', () => {
  const hours = ['2026-11-10T14:00:00.000Z', '2026-11-10T15:00:00.000Z'];
  const remembered = {
    '/personal/a.jsonl': { provider: 'claude' as const, hours: { personal: hours, work: [hours[0]!] } },
    '/personal/b.jsonl': { provider: 'claude' as const, hours: { personal: [hours[1]!] } },
  };

  it('names no hour while every log it remembers is still read', () => {
    expect(
      hoursOfGoneLogs(remembered, { ...remembered, '/personal/new.jsonl': remembered['/personal/b.jsonl'] })
    ).toEqual([]);
  });
  it('names the hours a log fed once that log is gone, for each account it fed', () => {
    const read = { '/personal/b.jsonl': remembered['/personal/b.jsonl'] };
    expect(hoursOfGoneLogs(remembered, read)).toEqual([
      { account: 'personal', provider: 'claude', hour: hours[0]! },
      { account: 'personal', provider: 'claude', hour: hours[1]! },
      { account: 'work', provider: 'claude', hour: hours[0]! },
    ]);
  });
});

describe('the rollouts a machine reads', () => {
  const log = (account: string, path: string, createdAt?: number) => ({
    account,
    path: `/${account}/${path}`,
    createdAt,
  });

  it('prefers a rollout to its compressed copy, and names a session by its file', () => {
    const { rollouts } = codexRolloutsOf([
      log('work', '10/a.jsonl'),
      log('work', '10/a.jsonl.zst'),
      log('work', '10/b.jsonl.zst'),
    ]);
    expect(rollouts.map(({ path, session }) => [path, session])).toEqual([
      ['/work/10/a.jsonl', 'a.jsonl'],
      ['/work/10/b.jsonl.zst', 'b.jsonl.zst'],
    ]);
  });
  it('reads a rollout two accounts hold once, from the older file, and says who got it', () => {
    const logs = [log('personal', '10/a.jsonl', 300), log('work', '10/a.jsonl.zst', 200), log('side', '10/a.jsonl')];
    const { rollouts, repeatedAccounts, sharedOwners } = codexRolloutsOf([...logs, log('side', '10/own.jsonl')]);
    expect(rollouts.map(({ account }) => account)).toEqual(['work', 'side']);
    expect([...repeatedAccounts].toSorted()).toEqual(['personal', 'side']);
    expect([...sharedOwners]).toEqual([['a.jsonl', 'work']]);
  });
  it('gives a rollout to the account favo wrote down, even when only another copy is left', () => {
    const owners = new Map([['a.jsonl', 'personal']]);
    const { rollouts, sharedOwners } = codexRolloutsOf([log('work', '10/a.jsonl.zst', 200)], owners);
    expect(rollouts.map(({ account, path }) => [account, path])).toEqual([['personal', '/work/10/a.jsonl.zst']]);
    expect([...sharedOwners]).toEqual([['a.jsonl', 'personal']]);
  });
});
