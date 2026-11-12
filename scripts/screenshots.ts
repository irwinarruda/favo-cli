import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Scenes, windowColorsOf } from '@favo/client/scenes';
import { $ } from 'bun';

const GhosttyApp = '/Applications/Ghostty.app';
const GhosttyBinary = 'MacOS/ghostty';
const Tools = 'scripts/screenshot-tools.swift';
const ImageRatio = 2240 / 1572;
const RatioTolerance = 0.01;
const FocusAttempts = 5;
const PollMs = 100;
const ReadyTimeoutMs = 15_000;
const WindowSettleMs = 1_000;
const ScaleConfig: Record<number, string[]> = {
  1: ['--window-width=129', '--adjust-cell-height=30%'],
  2: ['--window-width=128', '--adjust-cell-height=20%'],
};
const StandardConfig = [
  '--config-default-files=false',
  '--font-family=FiraCode Nerd Font Mono Med',
  '--font-size=14',
  '--window-height=36',
  '--window-padding-x=8',
  '--window-padding-y=4',
  '--window-save-state=never',
  '--confirm-close-surface=false',
  '--quit-after-last-window-closed=true',
  '--shell-integration=none',
  '--cursor-opacity=0',
  '--title=favo',
];

const CommandTheme = { themeId: 'honey', keys: [] };
const CommandScenes: Record<string, string[]> = {
  'favo-usage-tokens-cli': ['usage', '--tokens'],
  'favo-usage-cost-cli': ['usage', '--cost'],
};

async function waitFor<T>(what: string, read: () => Promise<T | undefined> | T | undefined) {
  const deadline = Date.now() + ReadyTimeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await Bun.sleep(PollMs);
  }
  throw new Error(`Timed out waiting for ${what}.`);
}

async function ghosttyPidOf(readyFile: string) {
  const pid = await $`pgrep -f ${`${GhosttyBinary} .*${readyFile}`}`.nothrow().text();
  return pid.trim() || undefined;
}

async function windowIdOf(pid: string) {
  const id = await $`swift ${Tools} window-id ${pid}`.text();
  return id.trim() || undefined;
}

type Screen = { scale: number; config: string[] };

async function screenConfig(): Promise<Screen> {
  const scale = Number(await $`swift ${Tools} scale`.text());
  const config = ScaleConfig[scale];
  if (!config) throw new Error(`No Ghostty settings for a ${scale}x screen.`);
  return { scale, config };
}

async function hasFocusedChrome(shot: string, scale: number) {
  const check = await $`swift ${Tools} has-focused-chrome ${shot} ${scale}`.nothrow().quiet();
  return check.exitCode === 0;
}

function assertImageRatio(file: string) {
  const png = readFileSync(file);
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (Math.abs(width / height / ImageRatio - 1) <= RatioTolerance) return;
  throw new Error(
    `${file} is ${width}x${height}, out of the ${ImageRatio.toFixed(3)} proportion. Is FiraCode Nerd Font installed?`
  );
}

async function isSameImage(file: string, shot: string) {
  if (!existsSync(file)) return false;
  const comparison = await $`swift ${Tools} is-same ${file} ${shot}`.nothrow().quiet();
  return comparison.exitCode === 0;
}

async function capture(name: string, shot: string, readyFile: string, config: string[]) {
  const scene = Scenes[name];
  const args = CommandScenes[name];
  if (!scene && !args) throw new Error(`No scene called ${name}. Scenes: ${SceneNames.join(', ')}`);
  const colors = windowColorsOf(scene ?? CommandTheme);
  const command = args
    ? `${process.execPath} scripts/cli-scene.ts ${readyFile} ${args.join(' ')}`
    : `${process.execPath} apps/client/src/dev.tsx ${name} ${readyFile}`;
  rmSync(readyFile, { force: true });
  const launch = Bun.spawn(
    [
      'open',
      '-n',
      '-a',
      GhosttyApp,
      '--args',
      ...StandardConfig,
      ...config,
      `--background=${colors.background}`,
      `--foreground=${colors.text}`,
      `--working-directory=${process.cwd()}`,
      `--command=${command}`,
    ],
    { stdout: 'ignore', stderr: 'ignore' }
  );
  await launch.exited;
  const pid = await waitFor(`the ${name} Ghostty`, () => ghosttyPidOf(readyFile));
  try {
    await waitFor(`${name} to reach its screen`, () => existsSync(readyFile));
    const windowId = await waitFor(`the ${name} window`, () => windowIdOf(pid));
    await Bun.sleep(WindowSettleMs);
    await $`screencapture -l ${windowId} -o -x ${shot}`;
  } finally {
    process.kill(Number(pid));
    await waitFor(`the ${name} Ghostty to close`, async () => !(await ghosttyPidOf(readyFile)));
  }
}

async function shoot(name: string, outputFolder: string, workFolder: string, screen: Screen) {
  const shot = join(workFolder, `${name}.png`);
  const readyFile = join(workFolder, `${name}.ready`);
  let isFocused = false;
  for (let attempt = 0; attempt < FocusAttempts && !isFocused; attempt++) {
    await capture(name, shot, readyFile, screen.config);
    assertImageRatio(shot);
    isFocused = await hasFocusedChrome(shot, screen.scale);
  }
  if (!isFocused) throw new Error(`${name} never had focus. Leave the keyboard and mouse alone during the run.`);
  const file = join(outputFolder, `${name}.png`);
  if (await isSameImage(file, shot)) {
    console.log(`unchanged ${file}`);
    return;
  }
  copyFileSync(shot, file);
  console.log(`changed   ${file}`);
}

const SceneNames = [...Object.keys(Scenes), ...Object.keys(CommandScenes)];
const outputFolder = process.env.FAVO_SCREENSHOTS_DIR ?? 'docs/assets';
const requested = process.argv.slice(2);
const names = requested.length > 0 ? requested : SceneNames;
const screen = await screenConfig();
const workFolder = mkdtempSync(join(tmpdir(), 'favo-screenshots-'));
mkdirSync(outputFolder, { recursive: true });
try {
  for (const name of names) await shoot(name, outputFolder, workFolder, screen);
} finally {
  rmSync(workFolder, { recursive: true });
}
