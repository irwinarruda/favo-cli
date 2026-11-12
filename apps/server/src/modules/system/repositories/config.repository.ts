import { ProviderId } from '@favo/domain/providers/provider';
import { DomainError, DomainErrorCode } from '@favo/domain/shared/domain-error';
import { z } from 'zod';
import type { FileSystem } from '@/modules/system/gateways/file-system';
import type { FavoPaths } from '@/shared/config/favo-paths';

const ProviderConfig = z.object({ launchArgs: z.array(z.string()).optional() });
const FavoConfig = z.object({
  theme: z.string().optional(),
  accountNames: z.record(z.string(), z.string()).optional(),
  providers: z.partialRecord(z.enum(ProviderId), ProviderConfig).optional(),
  usageView: z.unknown().optional(),
});

type Changes = (stored: Record<string, unknown>) => Record<string, unknown>;

export class ConfigRepository {
  private saving: Promise<void> = Promise.resolve();

  constructor(
    private readonly fileSystem: FileSystem,
    private readonly paths: FavoPaths
  ) {}

  async launchArgsOf(provider: ProviderId) {
    return (await this.read()).providers?.[provider]?.launchArgs ?? [];
  }

  async themeId() {
    return (await this.read()).theme;
  }

  async saveTheme(theme: string) {
    await this.save(() => ({ theme }));
  }

  async accountNames() {
    return (await this.read()).accountNames ?? {};
  }

  async saveAccountName(account: string, displayName: string | undefined) {
    await this.save((stored) => ({
      accountNames: { ...this.parse(stored).accountNames, [account]: displayName },
    }));
  }

  async usageView() {
    return (await this.read()).usageView;
  }

  async saveUsageView(usageView: unknown) {
    await this.save(() => ({ usageView }));
  }

  private save(changesOf: Changes) {
    const saved = this.saving.then(async () => {
      const stored = await this.readObject();
      const text = `${JSON.stringify({ ...stored, ...changesOf(stored) }, undefined, 2)}\n`;
      await this.fileSystem.replaceText(this.paths.configFile, text);
    });
    this.saving = saved.catch(() => undefined);
    return saved;
  }

  private async read() {
    return this.parse(await this.readObject());
  }

  private parse(stored: Record<string, unknown>) {
    const parsed = FavoConfig.safeParse(stored);
    if (parsed.success) return parsed.data;
    throw new DomainError(
      DomainErrorCode.invalidConfig,
      `${this.paths.configFile}: ${parsed.error.issues[0]?.message}`
    );
  }

  private async readObject(): Promise<Record<string, unknown>> {
    const text = await this.fileSystem.readText(this.paths.configFile);
    if (text === undefined) return {};
    try {
      return JSON.parse(text);
    } catch {
      throw new DomainError(DomainErrorCode.invalidConfig, `${this.paths.configFile} is not valid JSON.`);
    }
  }
}
