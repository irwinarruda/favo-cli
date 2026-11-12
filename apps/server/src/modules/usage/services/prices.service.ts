import { DomainError } from '@favo/domain/shared/domain-error';
import {
  NoTokenPrices,
  PriceSourceName,
  PricesFreshForMs,
  PricesRetryAfterMs,
  parsePriceTable,
  ratesFor,
  type TokenPrices,
} from '@favo/domain/usage/token-prices';
import type { Clock } from '@/modules/system/gateways/clock';
import type { PriceSource } from '@/modules/usage/gateways/price-source';
import type { PriceTable, PriceTableRepository } from '@/modules/usage/repositories/price-table.repository';

export class PricesService {
  private fetching?: Promise<PriceTable | undefined>;
  private failedAt?: number;

  constructor(
    private readonly source: PriceSource,
    private readonly tables: PriceTableRepository,
    private readonly clock: Clock
  ) {}

  async read(models: string[], isFresh: boolean): Promise<TokenPrices> {
    const stored = await this.tables.read();
    const now = this.clock.now().getTime();
    const isDue = !stored || now - Date.parse(stored.fetchedAt) >= PricesFreshForMs;
    const hasJustFailed = this.failedAt !== undefined && now - this.failedAt < PricesRetryAfterMs;
    const table = isFresh || (isDue && !hasJustFailed) ? ((await this.fetch()) ?? stored) : stored;
    if (!table) return NoTokenPrices;
    return { source: PriceSourceName, fetchedAt: table.fetchedAt, rates: ratesFor(table.rates, models) };
  }

  private fetch() {
    this.fetching ??= this.fetchTable().finally(() => {
      this.fetching = undefined;
    });
    return this.fetching;
  }

  private async fetchTable() {
    try {
      this.failedAt = this.clock.now().getTime();
      const rates = parsePriceTable(await this.source.fetchTable());
      if (Object.keys(rates).length === 0) return undefined;
      const table = { fetchedAt: this.clock.now().toISOString(), rates };
      await this.tables.save(table);
      this.failedAt = undefined;
      return table;
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      return undefined;
    }
  }
}
