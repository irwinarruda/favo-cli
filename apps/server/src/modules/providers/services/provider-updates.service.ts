import type { ProviderUpdateView, ProviderVersionView } from '@favo/contracts/rpc/views';
import { versionFrom } from '@favo/domain/machines/machine';
import {
  canUpdateItself,
  type ProviderId,
  ProviderOrder,
  type ProviderSpec,
  Providers,
} from '@favo/domain/providers/provider';
import { ownValue } from '@favo/domain/shared/own-value';
import { EntryKind } from '@favo/domain/sharing/shared-item';
import type { TerminalPlan } from '@favo/domain/terminal/terminal-plan';
import {
  InstallMethod,
  type InstallSource,
  installLabelOf,
  installSourceOf,
  PackageManagers,
  shimTargetOf,
  upgradeArgumentsOf,
  upgradeEnvironmentOf,
} from '@favo/domain/updates/install-source';
import {
  CodesignCommand,
  caskFolderOf,
  inheritedFilesOf,
  quarantineArguments,
  releaseArguments,
  type SignedInstall,
  signedByArguments,
  signerArguments,
  signerFrom,
  XattrCommand,
} from '@favo/domain/updates/signed-install';
import { settledRecordOf, type UpdateOutcome, UpdateState } from '@favo/domain/updates/update-outcome';
import type { ProviderRunRepository } from '@/modules/providers/repositories/provider-run.repository';
import type { ProviderUpdateRepository } from '@/modules/providers/repositories/provider-update.repository';
import type { ProvidersService } from '@/modules/providers/services/providers.service';
import type { Clock } from '@/modules/system/gateways/clock';
import type { FileSystem } from '@/modules/system/gateways/file-system';
import type { ProcessRunner } from '@/modules/system/gateways/process-runner';
import type { ShellEnvironment } from '@/modules/system/gateways/shell-environment';
import type { ConfigRepository } from '@/modules/system/repositories/config.repository';
import type { FavoPaths } from '@/shared/config/favo-paths';

const CheckTimeoutMs = 15_000;
const ReplacedLabel = 'being replaced by its update';
const ShimHeadBytes = 4_096;

export class ProviderUpdatesService {
  constructor(
    private readonly providers: ProvidersService,
    private readonly runs: ProviderRunRepository,
    private readonly updates: ProviderUpdateRepository,
    private readonly processes: ProcessRunner,
    private readonly fileSystem: FileSystem,
    private readonly shell: ShellEnvironment,
    private readonly config: ConfigRepository,
    private readonly paths: FavoPaths,
    private readonly clock: Clock,
    private readonly callerEnv: Record<string, string | undefined>,
    private readonly pid: number
  ) {}

  async list(provider?: ProviderId) {
    const views = await Promise.all(this.chosen(provider).map((id) => this.viewOf(id)));
    return views.filter((view) => view !== undefined);
  }

  async versions(provider?: ProviderId) {
    const views = await Promise.all(this.chosen(provider).map((id) => this.versionOf(id)));
    return views.filter((view) => view !== undefined);
  }

  async record(provider: ProviderId, outcome?: UpdateOutcome, updaterPid = this.pid) {
    if (!outcome) await this.updates.clear(provider);
    else {
      const isUpdating = outcome.state === UpdateState.updating;
      const pid = isUpdating ? updaterPid : undefined;
      const isOwnUpdate = isUpdating && updaterPid === this.pid;
      const signedInstall = isOwnUpdate ? await this.signedInstallOf(provider) : undefined;
      await this.updates.save(provider, { ...outcome, at: this.clock.now().toISOString(), pid, signedInstall });
    }
    return {};
  }

  async upgradeStep(source: InstallSource): Promise<TerminalPlan | undefined> {
    const manager = PackageManagers[source.method];
    const path = await this.shell.path();
    const command = this.processes.which(manager, this.ownFolders(source)) ?? this.processes.which(manager, path);
    if (!command) return undefined;
    return { command, args: upgradeArgumentsOf(source), ...(await this.stepEnvironmentOf(source)) };
  }

  async isPinned(source: InstallSource) {
    if (source.method !== InstallMethod.homebrew || source.isCask) return false;
    const step = await this.upgradeStep(source);
    if (!step) return false;
    const pinned = await this.processes.run({
      command: step.command,
      args: ['list', '--pinned'],
      env: step.env,
      timeoutMs: CheckTimeoutMs,
    });
    return pinned.stdout.split(/\s+/).includes(source.packageName);
  }

  private chosen(provider?: ProviderId) {
    return ProviderOrder.filter((id) => provider === undefined || id === provider);
  }

  private async viewOf(provider: ProviderId): Promise<ProviderUpdateView | undefined> {
    const install = await this.installOf(provider);
    if (!install) return undefined;
    const { spec, binary, realPath, source } = install;
    const steps = await this.stepsOf(spec, binary, source);
    return {
      provider,
      label: spec.label,
      version: install.version,
      installedWith: install.installedWith,
      otherCopies: await this.otherCopies(spec.executable, realPath),
      runningAccounts: await this.runningNames(provider),
      heldBack: (await this.heldBack(provider, source)) ?? this.missingManagerOf(spec, source, steps),
      steps,
    };
  }

  private async versionOf(provider: ProviderId): Promise<ProviderVersionView | undefined> {
    const saved = await this.updates.last(provider);
    const isUpdaterAlive = saved?.pid !== undefined && this.processes.isAlive(saved.pid);
    if (saved?.signedInstall && isUpdaterAlive) await this.carryApproval(provider, saved.signedInstall);
    const install = await this.installOf(provider);
    const { label } = Providers[provider];
    const lastUpdate = saved && settledRecordOf(saved, isUpdaterAlive);
    if (!install) {
      return lastUpdate?.state === UpdateState.updating
        ? { provider, label, installedWith: ReplacedLabel, lastUpdate }
        : undefined;
    }
    return { provider, label, version: install.version, installedWith: install.installedWith, lastUpdate };
  }

  private async installOf(provider: ProviderId) {
    const binary = await this.providers.binaryOf(provider);
    if (!binary) return undefined;
    const spec = Providers[provider];
    const realPath = await this.fileSystem.realPath(binary);
    const source = await this.sourceFor(spec, realPath);
    const env = await this.environmentOf(source);
    const check = await this.processes.run({ command: binary, args: ['--version'], env, timeoutMs: CheckTimeoutMs });
    const installedWith = source ? installLabelOf(source) : `own install at ${realPath}`;
    return { spec, binary, realPath, source, version: versionFrom(check.stdout), installedWith };
  }

  private async caskFolder(provider: ProviderId) {
    const binary = await this.providers.binaryOf(provider);
    if (!binary) return undefined;
    const realPath = await this.fileSystem.realPath(binary);
    const source = await this.sourceFor(Providers[provider], realPath);
    return source?.isCask ? caskFolderOf(realPath) : undefined;
  }

  private async signedInstallOf(provider: ProviderId): Promise<SignedInstall | undefined> {
    const folder = await this.caskFolder(provider);
    if (!folder) return undefined;
    const signers: Record<string, string> = {};
    for (const path of await this.filesIn(folder)) {
      const shown = await this.processes.run({
        command: CodesignCommand,
        args: signerArguments(path),
        timeoutMs: CheckTimeoutMs,
      });
      const signer = signerFrom(shown.stdout);
      if (signer) signers[path.slice(folder.length + 1)] = signer;
    }
    return Object.keys(signers).length > 0 ? { folder, signers } : undefined;
  }

  private async carryApproval(provider: ProviderId, before: SignedInstall) {
    for (const { path, signer } of inheritedFilesOf(before, await this.caskFolder(provider))) {
      const held = await this.processes.run({
        command: XattrCommand,
        args: quarantineArguments(path),
        timeoutMs: CheckTimeoutMs,
      });
      if (held.code !== 0) continue;
      const check = await this.processes.run({
        command: CodesignCommand,
        args: signedByArguments(path, signer),
        timeoutMs: CheckTimeoutMs,
      });
      if (check.code !== 0) continue;
      await this.processes.run({ command: XattrCommand, args: releaseArguments(path), timeoutMs: CheckTimeoutMs });
    }
  }

  private async filesIn(folder: string) {
    const found: string[] = [];
    for (const name of await this.fileSystem.list(folder)) {
      const path = `${folder}/${name}`;
      const { kind } = await this.fileSystem.entry(path);
      if (kind === EntryKind.directory) found.push(...(await this.filesIn(path)));
      if (kind === EntryKind.file) found.push(path);
    }
    return found;
  }

  private async sourceFor(spec: ProviderSpec, realPath: string) {
    const head = await this.fileSystem.readHead(realPath, ShimHeadBytes);
    const source = installSourceOf(realPath) ?? installSourceOf(shimTargetOf(realPath, head ?? '') ?? '');
    return source && spec.update.packages.includes(source.packageName) ? source : undefined;
  }

  private async runningNames(provider: ProviderId) {
    const names = await this.config.accountNames();
    return (await this.runs.accountsRunning(provider)).map((account) => ownValue(names, account) ?? account);
  }

  private async heldBack(provider: ProviderId, source?: InstallSource) {
    const { home, configHome } = this.paths;
    const search = { env: { ...this.callerEnv, ...(await this.shell.variables()) }, home, configHome };
    const off = await this.providers.cliOf(provider).updateSwitch(search, this.fileSystem);
    if (off) return `its updates are turned off by ${off}`;
    return source && (await this.isPinned(source)) ? 'it is pinned in Homebrew' : undefined;
  }

  private missingManagerOf(spec: ProviderSpec, source: InstallSource | undefined, steps: TerminalPlan[]) {
    if (steps.length > 0 || !source || canUpdateItself(spec, source)) return undefined;
    return `favo could not find ${PackageManagers[source.method]} to update it`;
  }

  private async stepsOf(spec: ProviderSpec, binary: string, source?: InstallSource) {
    const args = spec.update.arguments ?? [];
    const own = { command: binary, args, ...(await this.stepEnvironmentOf(source)) };
    const manager = source ? await this.upgradeStep(source) : undefined;
    return [...(canUpdateItself(spec, source) ? [own] : []), ...(manager ? [manager] : [])];
  }

  private async otherCopies(executable: string, realPath: string) {
    const copies = new Map<string, string>([[realPath, '']]);
    const folders = (await this.shell.path()).split(this.delimiter).filter(Boolean);
    for (const found of folders.map((folder) => this.processes.which(executable, folder))) {
      if (!found) continue;
      const real = await this.fileSystem.realPath(found);
      if (!copies.has(real)) copies.set(real, found);
    }
    return [...copies.values()].filter(Boolean);
  }

  private async environmentOf(source?: InstallSource) {
    const path = await this.shell.path();
    return { PATH: source ? [this.ownFolders(source), path].join(this.delimiter) : path };
  }

  private async stepEnvironmentOf(source?: InstallSource) {
    const { env, unsetEnv } = upgradeEnvironmentOf(source);
    return { env: { ...(await this.environmentOf(source)), ...env }, unsetEnv };
  }

  private ownFolders({ root }: InstallSource) {
    return [`${root}/bin`, root].join(this.delimiter);
  }

  private get delimiter() {
    return this.paths.isWindows ? ';' : ':';
  }
}
