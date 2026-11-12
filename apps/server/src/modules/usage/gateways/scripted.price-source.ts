import { DomainError, DomainErrorCode } from '@favo/domain/shared/domain-error';
import { PriceSource } from '@/modules/usage/gateways/price-source';

export class ScriptedPriceSource extends PriceSource {
  table?: unknown;
  fetches = 0;

  async fetchTable() {
    this.fetches += 1;
    if (this.table === undefined) {
      throw new DomainError(DomainErrorCode.pricesUnavailable, 'Could not fetch the price table: offline');
    }
    return this.table;
  }
}
