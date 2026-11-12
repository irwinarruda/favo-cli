import { parseJson } from '@favo/domain/shared/parse-json';
import { TokenRates } from '@favo/domain/usage/token-prices';
import { z } from 'zod';
import type { FileSystem } from '@/modules/system/gateways/file-system';
import type { FavoPaths } from '@/shared/config/favo-paths';

const PriceTable = z.strictObject({ fetchedAt: z.iso.datetime(), rates: TokenRates });
export type PriceTable = z.infer<typeof PriceTable>;

export class PriceTableRepository {
  constructor(
    private readonly fileSystem: FileSystem,
    private readonly paths: FavoPaths
  ) {}

  async read(): Promise<PriceTable | undefined> {
    const text = await this.fileSystem.readText(this.paths.priceTableFile);
    const parsed = PriceTable.safeParse(text === undefined ? undefined : parseJson(text));
    return parsed.success ? parsed.data : undefined;
  }

  async save(table: PriceTable) {
    await this.fileSystem.ensurePrivateDirectory(this.paths.usage);
    await this.fileSystem.replaceText(this.paths.priceTableFile, `${JSON.stringify(table)}\n`);
  }
}
