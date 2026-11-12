import { assertDomain, DomainErrorCode } from '@favo/domain/shared/domain-error';
import { parseJson } from '@favo/domain/shared/parse-json';
import { MachineTokenUsage } from '@favo/domain/usage/token-usage';
import { z } from 'zod';
import type { FileSystem } from '@/modules/system/gateways/file-system';
import type { FavoPaths } from '@/shared/config/favo-paths';

const TokenUsageRecord = MachineTokenUsage.extend({ version: z.number() });
export type TokenUsageRecord = z.infer<typeof TokenUsageRecord>;

export class TokenUsageRepository {
  constructor(
    private readonly fileSystem: FileSystem,
    private readonly paths: FavoPaths
  ) {}

  async read(): Promise<TokenUsageRecord | undefined> {
    const file = this.paths.tokenUsageFile;
    const text = await this.fileSystem.readText(file);
    if (text === undefined) return undefined;
    const parsed = TokenUsageRecord.safeParse(parseJson(text));
    assertDomain(
      parsed.success,
      DomainErrorCode.invalidConfig,
      `${file} is not a record this favo can read, so it was left as it is. Move it away to start a new count.`
    );
    return parsed.data;
  }

  async save(record: TokenUsageRecord) {
    assertDomain(
      TokenUsageRecord.safeParse(record).success,
      DomainErrorCode.internal,
      'The count holds a number no record can keep, so it was not saved.'
    );
    await this.fileSystem.ensurePrivateDirectory(this.paths.usage);
    await this.fileSystem.replaceText(this.paths.tokenUsageFile, `${JSON.stringify(record)}\n`);
  }

  async readKept(machineId: string): Promise<MachineTokenUsage | undefined> {
    const parsed = MachineTokenUsage.safeParse(await this.readFile(this.keptFileOf(machineId)));
    return parsed.success ? parsed.data : undefined;
  }

  async saveKept(machineId: string, usage: MachineTokenUsage) {
    await this.fileSystem.ensurePrivateDirectory(this.paths.keptTokenUsage);
    await this.fileSystem.replaceText(this.keptFileOf(machineId), `${JSON.stringify(usage)}\n`);
  }

  private async readFile(path: string) {
    const text = await this.fileSystem.readText(path);
    return text === undefined ? undefined : parseJson(text);
  }

  private keptFileOf(machineId: string) {
    return `${this.paths.keptTokenUsage}/${encodeURIComponent(machineId)}.json`;
  }
}
