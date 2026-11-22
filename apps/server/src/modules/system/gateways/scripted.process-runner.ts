import {
  type PipedProcess,
  type ProcessRequest,
  type ProcessResult,
  ProcessRunner,
} from '@/modules/system/gateways/process-runner';

type Reply = Partial<ProcessResult>;
type Responder = (line: string) => string | string[] | undefined | Promise<string | string[] | undefined>;

export class ScriptedProcessRunner extends ProcessRunner {
  readonly calls: ProcessRequest[] = [];
  readonly killed: ProcessRequest[] = [];
  readonly writes: { commandLine: string; line: string }[] = [];
  killOpenCount = 0;
  readonly gone = new Set<number>();
  private readonly replies = new Map<string, Reply>();
  private readonly conversations = new Map<string, string[]>();
  private readonly conversationsInTurn = new Map<string, string[][]>();
  private readonly responders = new Map<string, Responder>();
  private readonly installed = new Map<string, string>();
  private readonly elsewhere = new Map<string, string>();
  private readonly undetachable = new Set<string>();
  private nextPid = 7_000;

  install(command: string, path = `/usr/bin/${command}`) {
    this.installed.set(command, path);
  }

  uninstall(command: string) {
    this.installed.delete(command);
  }

  installIn(folder: string, command: string) {
    this.elsewhere.set(`${folder}/${command}`, `${folder}/${command}`);
  }

  reply(commandLine: string, reply: Reply) {
    this.replies.set(commandLine, reply);
  }

  converse(commandLine: string, lines: string[]) {
    this.conversations.set(commandLine, lines);
  }

  converseInTurn(commandLine: string, conversations: string[][]) {
    this.conversationsInTurn.set(commandLine, conversations);
  }

  respond(commandLine: string, responder: Responder) {
    this.responders.set(commandLine, responder);
  }

  writtenFor(commandLine: string) {
    return this.writes.filter((entry) => entry.commandLine === commandLine).map((entry) => entry.line);
  }

  async run(request: ProcessRequest) {
    this.calls.push(request);
    const reply = this.replies.get(lineOf(request));
    return { code: reply?.code ?? 0, stdout: reply?.stdout ?? '', stderr: reply?.stderr ?? '' };
  }

  open(request: ProcessRequest): PipedProcess {
    this.calls.push(request);
    const commandLine = lineOf(request);
    const responder = this.responders.get(commandLine);
    const lines = this.conversationsInTurn.get(commandLine)?.shift() ?? this.conversations.get(commandLine);
    const listeners: ((line: string) => void)[] = [];
    const { killed, writes } = this;
    return {
      write(line) {
        writes.push({ commandLine, line });
        if (responder) {
          void Promise.resolve(responder(line)).then((answered) => {
            const emitted = answered === undefined ? [] : Array.isArray(answered) ? answered : [answered];
            for (const entry of emitted) for (const listener of listeners) listener(entry);
          });
          return;
        }
        for (const entry of lines ?? []) for (const listener of listeners) listener(entry);
      },
      onLine(listener) {
        listeners.push(listener);
      },
      exited: responder || lines ? new Promise(() => {}) : Promise.resolve({ code: 127, stderr: 'not found' }),
      kill() {
        killed.push(request);
      },
    };
  }

  detach(request: ProcessRequest) {
    this.calls.push(request);
    return this.undetachable.has(request.command) ? undefined : this.nextPid++;
  }

  killOpen() {
    this.killOpenCount++;
  }

  failToDetach(command: string) {
    this.undetachable.add(command);
  }

  which(command: string, path: string) {
    return this.elsewhere.get(`${path}/${command}`) ?? this.installed.get(command);
  }

  isAlive(pid: number) {
    return !this.gone.has(pid);
  }
}

function lineOf(request: ProcessRequest) {
  return [request.command, ...request.args].join(' ');
}
