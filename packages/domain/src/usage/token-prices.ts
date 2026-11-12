import { z } from 'zod';
import { ownValue } from '#domain/shared/own-value';
import type { TokenCounts } from '#domain/usage/token-usage';

export const PriceSourceName = 'litellm';
export const PriceSourceUrl =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
export const PricesFreshForMs = 24 * 3_600_000;
export const PricesRetryAfterMs = 10 * 60_000;
export const NoPriceTableMessage = 'No price table yet. favo fetches it the next time this computer is online.';
export const NotABillMessage = 'what the API would charge for these tokens, not your subscription bill';

const FirstPartyMakers = ['anthropic', 'deepseek', 'gemini', 'meta', 'mistral', 'openai', 'xai'];
const BedrockPrefix = 'anthropic.';
const UnpriceableModels = ['<synthetic>', 'synthetic', 'opus', 'sonnet', 'haiku', 'fable'];

export const TokenRate = z.strictObject({
  input: z.number().min(0),
  output: z.number().min(0),
  cacheRead: z.number().min(0),
  cacheWrite: z.number().min(0),
});
export type TokenRate = z.infer<typeof TokenRate>;

export const TokenRates = z.record(z.string(), TokenRate);
export type TokenRates = z.infer<typeof TokenRates>;

export const TokenPrices = z.strictObject({
  source: z.literal(PriceSourceName),
  fetchedAt: z.iso.datetime().optional(),
  rates: TokenRates,
});
export type TokenPrices = z.infer<typeof TokenPrices>;

export const NoTokenPrices: TokenPrices = { source: PriceSourceName, rates: {} };

type Alias = { rate: TokenRate | undefined; isFirstParty: boolean };

export function parsePriceTable(document: unknown): TokenRates {
  const rates: TokenRates = {};
  if (typeof document !== 'object' || document === null) return rates;
  for (const [name, entry] of Object.entries(document)) {
    const rate = rateOf(entry);
    const key = name.trim().toLowerCase();
    if (rate && key.length > 0) rates[key] = rate;
  }
  const aliases = new Map<string, Alias>();
  for (const [key, rate] of Object.entries(rates)) {
    const slash = key.indexOf('/');
    const alias = slash < 0 ? bedrockBaseOf(key) : bareNameOf(key);
    if (alias.length === 0 || alias === key || Object.hasOwn(rates, alias)) continue;
    const isFirstParty = slash >= 0 && FirstPartyMakers.includes(key.slice(0, slash));
    const held = aliases.get(alias);
    if (!held || (isFirstParty && !held.isFirstParty)) aliases.set(alias, { rate, isFirstParty });
    else if (held.rate && isFirstParty === held.isFirstParty && !isSameRate(held.rate, rate)) {
      aliases.set(alias, { rate: undefined, isFirstParty });
    }
  }
  for (const [alias, { rate }] of aliases) {
    if (rate) rates[alias] = rate;
  }
  return rates;
}

export function priceKeyOf(model: string) {
  const lowered = model.trim().toLowerCase();
  const bracket = lowered.indexOf('[');
  return bracket < 0 ? lowered : lowered.slice(0, bracket);
}

export function findTokenRate(rates: TokenRates, model: string) {
  const key = priceKeyOf(model);
  const bare = bareNameOf(key);
  if (bare.length === 0 || UnpriceableModels.includes(bare)) return undefined;
  return ownValue(rates, key);
}

export function ratesFor(rates: TokenRates, models: string[]): TokenRates {
  const found = models.flatMap((model) => {
    const rate = findTokenRate(rates, model);
    return rate ? [[priceKeyOf(model), rate] as const] : [];
  });
  return Object.fromEntries(found);
}

export function typeCostsOf(counts: TokenCounts, rate: TokenRate): TokenCounts {
  return {
    input: counts.input * rate.input,
    cacheRead: counts.cacheRead * rate.cacheRead,
    cacheWrite: counts.cacheWrite * rate.cacheWrite,
    output: counts.output * rate.output,
  };
}

export function cacheSavingsOf(counts: TokenCounts, rate: TokenRate) {
  return counts.cacheRead * Math.max(0, rate.input - rate.cacheRead);
}

function rateOf(entry: unknown): TokenRate | undefined {
  if (typeof entry !== 'object' || entry === null) return undefined;
  const raw: Record<string, unknown> = { ...entry };
  const input = priceOf(raw.input_cost_per_token);
  const output = priceOf(raw.output_cost_per_token);
  if (input === undefined || output === undefined) return undefined;
  return {
    input,
    output,
    cacheRead: priceOf(raw.cache_read_input_token_cost) ?? input,
    cacheWrite: priceOf(raw.cache_creation_input_token_cost) ?? input,
  };
}

function priceOf(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function bareNameOf(key: string) {
  return key.slice(key.lastIndexOf('/') + 1);
}

function bedrockBaseOf(key: string) {
  return key.startsWith(BedrockPrefix) ? key.slice(BedrockPrefix.length) : key;
}

function isSameRate(left: TokenRate, right: TokenRate) {
  return (
    left.input === right.input &&
    left.output === right.output &&
    left.cacheRead === right.cacheRead &&
    left.cacheWrite === right.cacheWrite
  );
}
