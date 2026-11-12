import { DomainError, DomainErrorCode } from '@favo/domain/shared/domain-error';
import { PriceSourceUrl } from '@favo/domain/usage/token-prices';
import { PriceSource } from '@/modules/usage/gateways/price-source';

const FetchTimeoutMs = 20_000;

export class LitellmPriceSource extends PriceSource {
  constructor(
    private readonly url = PriceSourceUrl,
    private readonly timeoutMs = FetchTimeoutMs
  ) {
    super();
  }

  async fetchTable(): Promise<unknown> {
    try {
      const response = await fetch(this.url, { signal: AbortSignal.timeout(this.timeoutMs) });
      if (!response.ok) throw new Error(`the server answered ${response.status}`);
      return await response.json();
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new DomainError(DomainErrorCode.pricesUnavailable, `Could not fetch the price table: ${reason}`);
    }
  }
}
