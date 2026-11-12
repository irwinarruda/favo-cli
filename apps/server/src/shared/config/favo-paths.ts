import { FavoVersion } from '@favo/contracts/version';

export type FavoPaths = ReturnType<typeof favoPathsOf>;

export function favoPathsOf(input: { home: string; favoHome?: string; configHome?: string; isWindows: boolean }) {
  const root = input.favoHome ?? `${input.home}/.favo`;
  return {
    isWindows: input.isWindows,
    home: input.home,
    configHome: input.configHome ?? `${input.home}/.config`,
    root,
    accounts: `${root}/accounts`,
    threads: `${root}/threads`,
    running: `${root}/running`,
    updates: `${root}/updates`,
    runtime: `${root}/runtime`,
    trash: `${root}/trash`,
    assets: `${root}/assets`,
    versionedAssets: `${root}/assets/${FavoVersion}`,
    themes: `${root}/themes`,
    usage: `${root}/usage`,
    tokenUsageFile: `${root}/usage/tokens.json`,
    priceTableFile: `${root}/usage/prices.json`,
    keptTokenUsage: `${root}/usage/machines`,
    emptyFolder: `${root}/empty`,
    machinesFile: `${root}/machines.json`,
    configFile: `${root}/config.json`,
  };
}
