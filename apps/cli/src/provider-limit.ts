import type { ProviderId } from '@favo/domain/providers/provider';

const MaxLimitTextLength = 4_096;
const AnsiControl = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'g');
const LimitSignals: Record<ProviderId, RegExp[]> = {
  claude: [
    /you(?:'ve| have) hit your (?:usage|message) limit/i,
    /you(?:'ve| have) reached your usage limit/i,
    /(?:usage|message) limit (?:reached|exceeded)/i,
  ],
  codex: [
    /rate limit exceeded/i,
    /you(?:'ve| have) (?:hit|reached) your (?:usage|weekly|monthly) limit/i,
    /(?:usage|weekly|monthly) limit (?:reached|exceeded)/i,
  ],
  antigravity: [
    /quota (?:has been )?(?:exceeded|reached)/i,
    /you(?:'ve| have) (?:hit|reached) (?:your )?(?:quota|rate limit)/i,
    /rate limit exceeded/i,
  ],
  opencode: [
    /(?:rate|usage|provider) limit (?:reached|exceeded)/i,
    /quota (?:has been )?(?:exceeded|reached)/i,
    /too many requests/i,
  ],
};

export class ProviderLimitDetector {
  private output = '';

  constructor(private readonly provider: ProviderId) {}

  write(chunk: string | Uint8Array) {
    const text = typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk);
    this.output = `${this.output}${text.replace(AnsiControl, '')}`.slice(-MaxLimitTextLength);
    return LimitSignals[this.provider].some((signal) => signal.test(this.output));
  }
}
