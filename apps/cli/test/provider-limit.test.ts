import { describe, expect, test } from 'bun:test';
import { ProviderLimitDetector } from '@/provider-limit';

describe('provider rate-limit detection', () => {
  test('recognizes a Claude usage limit across terminal output chunks', () => {
    const detector = new ProviderLimitDetector('claude');

    expect(detector.write('You have hit your usage ')).toBe(false);
    expect(detector.write('\u001b[31mlimit\u001b[0m. It resets in 4 hours.')).toBe(true);
  });

  test('recognizes a Codex rate limit message', () => {
    const detector = new ProviderLimitDetector('codex');

    expect(detector.write('Rate limit exceeded. Try again later.')).toBe(true);
  });

  test('does not treat ordinary discussion of a limit as an exhausted session', () => {
    const detector = new ProviderLimitDetector('claude');

    expect(detector.write('Please add rate limit handling to the API client.')).toBe(false);
  });
});
