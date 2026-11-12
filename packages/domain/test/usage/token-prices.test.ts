import { describe, expect, it } from 'bun:test';
import { cacheSavingsOf, findTokenRate, parsePriceTable, ratesFor, typeCostsOf } from '#domain/usage/token-prices';

const Table = {
  sample_spec: { input_cost_per_token: 'not a model' },
  'claude-test-1': {
    input_cost_per_token: 0.000003,
    output_cost_per_token: 0.000015,
    cache_read_input_token_cost: 0.0000003,
    cache_creation_input_token_cost: 0.00000375,
  },
  'openai/gpt-test-1': { input_cost_per_token: 0.000002, output_cost_per_token: 0.000008 },
  'reseller/gpt-test-1': { input_cost_per_token: 0.000009, output_cost_per_token: 0.00009 },
  'anthropic.claude-test-2': { input_cost_per_token: 0.000001, output_cost_per_token: 0.000005 },
  'cloud-a/open-model': { input_cost_per_token: 0.000001, output_cost_per_token: 0.000002 },
  'cloud-b/open-model': { input_cost_per_token: 0.000004, output_cost_per_token: 0.000008 },
  'embed-test': { input_cost_per_token: 0.0000001 },
};

describe('the price table', () => {
  const rates = parsePriceTable(Table);

  it('reads the four rates of a model', () => {
    expect(findTokenRate(rates, 'claude-test-1')).toEqual({
      input: 0.000003,
      output: 0.000015,
      cacheRead: 0.0000003,
      cacheWrite: 0.00000375,
    });
  });
  it('falls back to the input rate when a cache rate is missing', () => {
    expect(findTokenRate(rates, 'gpt-test-1')).toMatchObject({ cacheRead: 0.000002, cacheWrite: 0.000002 });
  });
  it("finds a bare name under its maker's prefix, not a reseller's", () => {
    expect(findTokenRate(rates, 'gpt-test-1')?.output).toBe(0.000008);
    expect(findTokenRate(rates, 'claude-test-2')?.input).toBe(0.000001);
  });
  it('leaves a bare name unpriced when two resellers disagree', () => {
    expect(findTokenRate(rates, 'open-model')).toBeUndefined();
  });
  it('leaves a model with no input or no output rate unpriced', () => {
    expect(findTokenRate(rates, 'embed-test')).toBeUndefined();
    expect(findTokenRate(rates, 'never-heard-of-it')).toBeUndefined();
  });
  it('prices a bracketed variant as its base model', () => {
    expect(findTokenRate(rates, 'Claude-Test-1[1m]')).toEqual(findTokenRate(rates, 'claude-test-1'));
  });
  it('never prices a bare family name, or a property every object has', () => {
    expect(findTokenRate({ ...rates, opus: rates['claude-test-1']! }, 'opus')).toBeUndefined();
    expect(findTokenRate(rates, 'constructor')).toBeUndefined();
  });
  it('answers only for the models asked about, under the name a model is priced by', () => {
    const answer = ratesFor(rates, ['Claude-Test-1[1m]', 'gpt-test-1', 'nope']);
    expect(Object.keys(answer)).toEqual(['claude-test-1', 'gpt-test-1']);
    expect(findTokenRate(answer, 'Claude-Test-1[1m]')).toEqual(findTokenRate(rates, 'claude-test-1'));
    expect(findTokenRate(answer, 'gpt-test-1')?.output).toBe(0.000008);
  });
  it('is empty for anything that is not a table', () => {
    expect(parsePriceTable(undefined)).toEqual({});
    expect(parsePriceTable('<html>')).toEqual({});
  });
});

describe('pricing', () => {
  const rate = { input: 0.000003, output: 0.000015, cacheRead: 0.0000003, cacheWrite: 0.00000375 };
  const counts = { input: 1_000_000, cacheRead: 10_000_000, cacheWrite: 1_000_000, output: 100_000 };

  it('prices each type at its own rate', () => {
    const costs = typeCostsOf(counts, rate);
    expect(costs.input).toBeCloseTo(3);
    expect(costs.cacheRead).toBeCloseTo(3);
    expect(costs.cacheWrite).toBeCloseTo(3.75);
    expect(costs.output).toBeCloseTo(1.5);
  });
  it('says what the cache saved against the input rate', () => {
    expect(cacheSavingsOf(counts, rate)).toBeCloseTo(27);
    expect(cacheSavingsOf(counts, { ...rate, cacheRead: 1 })).toBe(0);
  });
});
