import type { ListThreadsParams } from '@favo/contracts/rpc/threads/list-threads';
import type { RecordThreadParams } from '@favo/contracts/rpc/threads/record-thread';
import type { ThreadView } from '@favo/contracts/rpc/views';
import { isPersonalAccount } from '@favo/domain/accounts/account';
import { isSameDirectory, nativePath } from '@favo/domain/directories/directory-input';
import { isolationEnvironment, type ProviderId, Providers } from '@favo/domain/providers/provider';
import { assertDomain, DomainErrorCode } from '@favo/domain/shared/domain-error';
import { EntryKind } from '@favo/domain/sharing/shared-item';
import {
  herdrAgentOf,
  herdrPaneOf,
  herdrResumeCommand,
  herdrSequenceOf,
  hookReportArguments,
} from '@favo/domain/terminal/herdr';
import {
  chooseThread,
  isNestedRun,
  isRawThreadId,
  orderedThreads,
  Thread,
  threadsToDrop,
} from '@favo/domain/threads/thread';
import type { ThreadRepository } from '@/modules/accounts/repositories/thread.repository';
import type { SeatsService } from '@/modules/accounts/services/seats.service';
import { type Herdr, HerdrAnswer } from '@/modules/herdr/gateways/herdr';
import type { ProvidersService } from '@/modules/providers/services/providers.service';
import type { Clock } from '@/modules/system/gateways/clock';
import type { FileSystem } from '@/modules/system/gateways/file-system';
import type { ProcessRunner } from '@/modules/system/gateways/process-runner';
import type { FavoPaths } from '@/shared/config/favo-paths';
import type { HostFacts } from '@/shared/config/host-facts';

const ReportAttempts = 20;
const ReportPauseMs = 500;
const FavoCommand = 'favo';

export class ThreadsService {
  constructor(
    private readonly threads: ThreadRepository,
    private readonly seats: SeatsService,
    private readonly providers: ProvidersService,
    private readonly fileSystem: FileSystem,
    private readonly herdr: Herdr,
    private readonly processes: ProcessRunner,
    private readonly clock: Clock,
    private readonly paths: FavoPaths,
    private readonly host: HostFacts,
    private readonly callerEnv: Record<string, string | undefined>,
    private readonly binary?: string
  ) {}

  async list({ account, provider, directory }: ListThreadsParams) {
    await this.seats.assertAccount(account);
    const folder = await this.fileSystem.realPath(directory ?? this.host.directory);
    const saved = await this.resumable(account, provider);
    const views = await Promise.all(saved.map((thread) => this.viewOf(thread, false)));
    const hasHere = views.some((view) => isSameDirectory(view.directory, folder));
    const guesses = hasHere ? [] : await this.guesses(account, provider, folder);
    const known = new Set(views.map(({ id }) => id));
    return orderedThreads([...views, ...guesses.filter(({ id }) => !known.has(id))], folder);
  }

  async record({ provider, id, directory, transcript, isFresh, ownerProcess }: RecordThreadParams) {
    const { FAVO_ACCOUNT: account, FAVO_LAUNCH: launchId } = this.callerEnv;
    if (!account) return { isRecorded: false };
    await this.seats.assertAccount(account);
    if (!(await this.isRunningInSeat(account, provider))) return { isRecorded: false };
    const threads = await this.threads.list(account, provider);
    const isAlive = (process: string) => this.processes.isAlive(Number(process));
    if (isNestedRun(threads, isFresh, launchId, ownerProcess, isAlive)) return { isRecorded: false };
    const thread = Thread.parse({
      id,
      directory,
      transcript,
      launchId,
      ownerProcess,
      updatedAt: this.clock.now().toISOString(),
    });
    await this.threads.save(account, provider, thread);
    await this.prune(account, provider, [...threads.filter((other) => other.id !== id), thread]);
    if ((await this.reportOnce(provider, id)) === HerdrAnswer.tooEarly) this.reportLater(provider, id);
    return { isRecorded: true };
  }

  async report(provider: ProviderId, id: string) {
    for (let attempt = 0; attempt < ReportAttempts; attempt++) {
      if ((await this.reportOnce(provider, id)) !== HerdrAnswer.tooEarly) return;
      await this.clock.sleep(ReportPauseMs);
    }
  }

  async target(account: string, provider: ProviderId, selector?: string, directory?: string) {
    const threads = await this.list({ account, provider, directory });
    const chosen = chooseThread(threads, selector);
    if (!chosen) return this.unlisted(account, provider, selector, directory);
    assertDomain(
      !chosen.isDirectoryGone,
      DomainErrorCode.directoryNotFound,
      `That thread was in ${chosen.directory}, which is gone.`
    );
    return { id: chosen.id, directory: chosen.directory };
  }

  private async reportOnce(provider: ProviderId, id: string) {
    const { FAVO_ACCOUNT: account } = this.callerEnv;
    const pane = herdrPaneOf(this.callerEnv);
    const agent = account ? herdrAgentOf(account, provider) : undefined;
    if (!account || !pane || !agent || !(await this.providers.isOnPath(FavoCommand))) return undefined;
    const seq = herdrSequenceOf(this.clock.now().getTime());
    const resume = herdrResumeCommand(account, provider, id);
    return this.herdr.report(pane, { agent, threadId: id, resume, seq });
  }

  private reportLater(provider: ProviderId, id: string) {
    this.processes.detach({ command: this.binary ?? FavoCommand, args: hookReportArguments(provider, id) });
  }

  private async unlisted(
    account: string,
    provider: ProviderId,
    selector: string | undefined,
    directory: string | undefined
  ) {
    assertDomain(
      selector !== undefined && isRawThreadId(selector),
      DomainErrorCode.threadNotFound,
      `favo has no thread for ${account} on ${Providers[provider].label} in ${directory ?? this.host.directory} yet.`
    );
    const saved = await this.threads.list(account, provider);
    const empty = saved.find(({ id }) => id === selector);
    if (!empty) return { id: selector, directory };
    assertDomain(
      await this.fileSystem.isDirectory(empty.directory),
      DomainErrorCode.directoryNotFound,
      `That thread was in ${empty.directory}, which is gone.`
    );
    return { id: undefined, directory: empty.directory };
  }

  private async isRunningInSeat(account: string, provider: ProviderId) {
    if (isPersonalAccount(account)) return true;
    const seat = isolationEnvironment(Providers[provider], this.providers.seatHome(account, provider));
    const [name, home] = Object.entries(seat)[0]!;
    const actual = this.callerEnv[name];
    if (actual === undefined) return false;
    return (await this.fileSystem.realPath(actual)) === (await this.fileSystem.realPath(home));
  }

  private async resumable(account: string, provider: ProviderId) {
    const threads = await this.threads.list(account, provider);
    const isResumable = await Promise.all(threads.map((thread) => this.isResumable(thread)));
    return threads.filter((_, index) => isResumable[index]);
  }

  private async isResumable({ transcript }: Thread) {
    if (transcript === undefined) return true;
    return (await this.fileSystem.entry(transcript)).kind !== EntryKind.missing;
  }

  private async prune(account: string, provider: ProviderId, threads: Thread[]) {
    const resumable = new Set<string>();
    for (const thread of threads) if (await this.isResumable(thread)) resumable.add(thread.id);
    const dropped = threadsToDrop(threads, ({ id }) => resumable.has(id), this.clock.now().getTime());
    await Promise.allSettled(dropped.map(({ id }) => this.threads.remove(account, provider, id)));
  }

  private async guesses(account: string, provider: ProviderId, directory: string) {
    const binary = await this.providers.binaryOf(provider);
    if (!binary || !(await this.seats.isProvisioned(account, provider))) return [];
    const session = { binary, env: await this.providers.environmentOf(account, provider) };
    const seatHome = this.providers.seatHome(account, provider);
    const search = { session, seatHome, directory };
    const found = await this.providers.cliOf(provider).recentThreads(search, this.fileSystem);
    return Promise.all(found.map((thread) => this.viewOf(thread, true)));
  }

  private async viewOf(thread: Omit<ThreadView, 'isGuess' | 'isDirectoryGone'>, isGuess: boolean) {
    const { id, directory, transcript, updatedAt } = thread;
    const isDirectoryGone = !(await this.fileSystem.isDirectory(directory));
    return {
      id,
      updatedAt,
      directory: nativePath(directory, this.paths.isWindows),
      transcript,
      isGuess,
      isDirectoryGone,
    };
  }
}
