import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeUsageFixture } from './usage-fixture';

const UnreachablePrices = 'http://127.0.0.1:9/prices.json';
const SystemPath = '/usr/bin:/bin';
const ClearScreen = '\u001b[2J\u001b[3J\u001b[H';
const [readyFile, ...args] = Bun.argv.slice(2);
const home = mkdtempSync(join(tmpdir(), 'favo-cli-scene-'));

try {
  writeUsageFixture(home);
  console.log(`${ClearScreen}\n  $ favo ${args.join(' ')}\n`);
  const favo = Bun.spawn([process.execPath, 'apps/cli/src/main.ts', ...args], {
    env: {
      PATH: SystemPath,
      TERM: process.env.TERM,
      COLORTERM: process.env.COLORTERM,
      HOME: home,
      FAVO_HOSTNAME: 'macbook',
      FAVO_PRICES_URL: UnreachablePrices,
    },
    stdin: 'ignore',
    stdout: 'inherit',
    stderr: 'inherit',
  });
  await favo.exited;
} finally {
  rmSync(home, { recursive: true, force: true });
}
if (readyFile) await Bun.write(readyFile, '');
await new Promise(() => {});
