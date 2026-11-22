import type { HookView } from '@favo/contracts/rpc/views';
import { nativePath } from '@favo/domain/directories/directory-input';
import {
  HookBlockReason,
  HookState,
  hookBlockReasonOf,
  hookPathOf,
  hookStateOf,
  withHook,
  withoutHook,
} from '@favo/domain/hooks/provider-hook';
import {
  HookKind,
  type ProviderId,
  ProviderOrder,
  type ProviderSpec,
  Providers,
} from '@favo/domain/providers/provider';
import { assertDomain, DomainError, DomainErrorCode } from '@favo/domain/shared/domain-error';
import { EntryKind, isItemHealthy, SharedItemState } from '@favo/domain/sharing/shared-item';
import type { AccountRepository } from '@/modules/accounts/repositories/account.repository';
import type { SeatsService } from '@/modules/accounts/services/seats.service';
import type { ProvidersService } from '@/modules/providers/services/providers.service';
import OpencodePlugin from '@/modules/providers/utils/opencode-plugin.txt';
import type { FileSystem } from '@/modules/system/gateways/file-system';
import type { FavoPaths } from '@/shared/config/favo-paths';

export class HooksService {
  constructor(
    private readonly fileSystem: FileSystem,
    private readonly accounts: AccountRepository,
    private readonly seats: SeatsService,
    private readonly providers: ProvidersService,
    private readonly paths: FavoPaths
  ) {}

  async list() {
    return Promise.all(ProviderOrder.map((provider) => this.viewOf(provider)));
  }

  async install() {
    await this.forEachProvider(async (provider) => {
      if (await this.providers.binaryOf(provider)) await this.write(provider);
    });
    return this.list();
  }

  async uninstall() {
    await this.forEachProvider((provider) => this.remove(provider));
    return this.list();
  }

  async refresh() {
    await this.forEachProvider(async (provider) => {
      if ((await this.stateOf(provider)).state === HookState.outdated) await this.write(provider);
    }).catch((error: unknown) => {
      if (!(error instanceof DomainError)) throw error;
    });
  }

  async isInstalled() {
    const states = await Promise.all(ProviderOrder.map((provider) => this.stateOf(provider)));
    return states.some(({ state }) => state !== HookState.absent);
  }

  private async forEachProvider(action: (provider: ProviderId) => Promise<void>) {
    let failure: DomainError | undefined;
    for (const provider of ProviderOrder) {
      await action(provider).catch((error: unknown) => {
        if (!(error instanceof DomainError)) throw error;
        failure ??= error;
      });
    }
    if (failure) throw failure;
  }

  private async write(provider: ProviderId) {
    const spec = Providers[provider];
    const path = this.pathOf(provider);
    const text = await this.fileSystem.readText(path);
    const { kind } = await this.fileSystem.entry(path);
    assertDomain(
      text !== undefined || kind === EntryKind.missing,
      DomainErrorCode.invalidConfig,
      `favo could not read ${nativePath(path, this.paths.isWindows)}, so it left it alone.`
    );
    const hooked = spec.hook.kind === HookKind.plugin ? OpencodePlugin : withHook(spec, text, this.paths.isWindows);
    await this.fileSystem.replaceText(path, hooked);
  }

  private async remove(provider: ProviderId) {
    const spec = Providers[provider];
    const path = this.pathOf(provider);
    const text = await this.fileSystem.readText(path);
    if (hookStateOf(spec, text) === HookState.absent) return;
    const remaining = withoutHook(spec, text!);
    if (remaining === undefined) await this.fileSystem.unlink(path);
    else await this.fileSystem.replaceText(path, remaining);
  }

  private async viewOf(provider: ProviderId): Promise<HookView> {
    const spec = Providers[provider];
    const { state, problem } = await this.stateOf(provider);
    const text = await this.fileSystem.readText(this.pathOf(provider));
    const blockReason = problem === undefined ? hookBlockReasonOf(spec, text) : undefined;
    const seatProblems = state === HookState.absent ? [] : await this.seatProblems(provider);
    return {
      provider,
      state,
      label: spec.label,
      isProviderInstalled: (await this.providers.binaryOf(provider)) !== undefined,
      needsTrust: spec.hook.needsTrust === true,
      file: nativePath(this.pathOf(provider), this.paths.isWindows),
      problems: [
        ...(problem ? [problem] : []),
        ...(blockReason ? [blockedMessageOf(spec, blockReason)] : []),
        ...seatProblems,
      ],
    };
  }

  private async stateOf(provider: ProviderId): Promise<{ state: HookState; problem?: string }> {
    try {
      const text = await this.fileSystem.readText(this.pathOf(provider));
      return { state: hookStateOf(Providers[provider], text) };
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      return { state: HookState.absent, problem: error.message };
    }
  }

  private async seatProblems(provider: ProviderId) {
    const item = Providers[provider].hook.sharedItem;
    if (!item) return [];
    const problems: string[] = [];
    for (const account of await this.accounts.names()) {
      if (!(await this.seats.isProvisioned(account, provider))) continue;
      const state = await this.seats.sharedItemState(account, provider, item);
      if (!isItemHealthy(state) && state !== SharedItemState.needsLink) {
        problems.push(`${account}: ${item} is not shared here, so this seat never runs the hook.`);
      }
    }
    return problems;
  }

  private pathOf(provider: ProviderId) {
    return hookPathOf(Providers[provider], this.paths);
  }
}

function blockedMessageOf({ hook }: ProviderSpec, reason: HookBlockReason) {
  if (reason === HookBlockReason.disabledBlock) return `favo's hook is disabled in ${hook.file}, so hooks never run.`;
  const location = hook.kind === HookKind.namedBlock ? hook.file : hook.sharedItem;
  return `disableAllHooks is on in ${location}, so hooks never run.`;
}
