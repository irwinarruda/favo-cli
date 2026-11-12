export abstract class PriceSource {
  abstract fetchTable(): Promise<unknown>;
}
