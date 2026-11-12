import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const RepoRoot = path.resolve(import.meta.dir, '../../..');
const ModuleLevels: Record<string, number> = {
  system: 1,
  providers: 2,
  themes: 2,
  directories: 2,
  herdr: 2,
  accounts: 3,
  machines: 4,
  desktop: 4,
  usage: 4,
  terminal: 5,
};
const StaticImport = /^\s*(?:import|export)(\s+type)?\s+(?:[\w$*{},\s]*?from\s*)?['"]([^'"]+)['"]/gm;
const DynamicImport = /(?<![\w$.])import\s*\(\s*['"]([^'"]+)['"]/g;
const ServerLayers: Record<string, RegExp[]> = {
  controllers: [/^@\/modules\/[^/]+\/services\//, /^@\/shared\//],
  services: [
    /^@\/modules\/[^/]+\/services\//,
    /^@\/modules\/[^/]+\/repositories\//,
    /^@\/modules\/[^/]+\/gateways\/[a-z-]+$/,
    /^@\/modules\/[^/]+\/utils\//,
    /^@\/shared\/config\//,
  ],
  repositories: [/^@\/modules\/[^/]+\/gateways\/[a-z-]+$/, /^@\/shared\/config\//],
  gateways: [/^@\/modules\/[^/]+\/gateways\//, /^@\/modules\/[^/]+\/utils\//, /^@\/shared\/rpc\//],
  utils: [],
};
const ClientForbiddenInViews = [/\/repositories\//, /\/gateways\//, /@\/shared\/container/];
const ClientForbiddenInApp = [/@opentui/, /^react$/, /\/screens\//, /\/components\//];
const TestAdapter = /^@\/(?:__tests__|.*\/Test[A-Z])/;

function readSources(directory: string) {
  const root = path.join(RepoRoot, directory);
  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((file) => /\.tsx?$/.test(file))
    .map((file) => ({ file: file.replaceAll('\\', '/'), source: readFileSync(path.join(root, file), 'utf8') }));
}

function importsOf(source: string) {
  return [...source.matchAll(StaticImport)]
    .map((match) => match[2]!)
    .concat([...source.matchAll(DynamicImport)].map((match) => match[1]!));
}

function offenders(directory: string, isBad: (file: string, specifier: string) => boolean) {
  return readSources(directory).flatMap(({ file, source }) =>
    importsOf(source)
      .filter((specifier) => isBad(file, specifier))
      .map((specifier) => `${directory}/${file} imports ${specifier}`)
  );
}

describe('the code base', () => {
  const productionRoots = [
    'packages/domain/src',
    'packages/contracts/src',
    'apps/server/src',
    'apps/cli/src',
    'apps/client/src',
  ];

  it('has no parent-relative imports', () => {
    const roots = [
      ...productionRoots,
      'apps/server/test',
      'apps/cli/test',
      'packages/domain/test',
      'packages/contracts/test',
    ];
    expect(roots.flatMap((root) => offenders(root, (_file, specifier) => specifier.includes('../')))).toEqual([]);
  });

  it('has no comments in production code', () => {
    const commented = productionRoots.flatMap((root) =>
      readSources(root)
        .filter(({ file }) => !file.startsWith('__tests__') && !file.startsWith('libs/zustand'))
        .filter(({ source }) => /^\s*(?:\/\/|\/\*)/m.test(source))
        .map(({ file }) => `${root}/${file}`)
    );
    expect(commented).toEqual([]);
  });

  it('has no TS enums', () => {
    const found = productionRoots.flatMap((root) =>
      readSources(root)
        .filter(({ source }) => /^\s*(?:export\s+)?(?:const\s+)?enum\s/m.test(source))
        .map(({ file }) => `${root}/${file}`)
    );
    expect(found).toEqual([]);
  });
});

describe('domain', () => {
  it('is pure: no I/O, no framework, no implicit clock', () => {
    const bad = offenders('packages/domain/src', (_file, specifier) => {
      return !/^(zod|#domain\/.+|\.\/.+)$/.test(specifier);
    });
    expect(bad).toEqual([]);
    const clocks = readSources('packages/domain/src')
      .filter(({ source }) => /new Date\(\)|Date\.now\(\)|process\.|Bun\./.test(source))
      .map(({ file }) => file);
    expect(clocks).toEqual([]);
  });
});

describe('contracts', () => {
  it('imports only zod, the domain and itself', () => {
    const bad = offenders('packages/contracts/src', (_file, specifier) => {
      return !/^(zod|@favo\/domain\/.+|#contracts\/.+|\.\/.+)$/.test(specifier);
    });
    expect(bad).toEqual([]);
  });
});

describe('server', () => {
  const moduleFile = /^modules\/([^/]+)\/([^/]+)\//;

  it('keeps every layer to its table', () => {
    const bad = offenders('apps/server/src', (file, specifier) => {
      const match = moduleFile.exec(file);
      if (!match || !specifier.startsWith('@/')) return false;
      const [, moduleName, layer] = match;
      if (specifier.startsWith(`@/modules/${moduleName}/${layer}/`)) return false;
      return !(ServerLayers[layer!] ?? []).some((pattern) => pattern.test(specifier));
    });
    expect(bad).toEqual([]);
  });

  it('imports modules only downward', () => {
    const bad = offenders('apps/server/src', (file, specifier) => {
      const from = moduleFile.exec(file)?.[1];
      const to = /^@\/modules\/([^/]+)\//.exec(specifier)?.[1];
      if (!from || !to || from === to) return false;
      return (ModuleLevels[to] ?? 99) >= (ModuleLevels[from] ?? 0);
    });
    expect(bad).toEqual([]);
  });

  it('reads the environment only at the composition root', () => {
    const readers = readSources('apps/server/src')
      .filter(({ file, source }) => file !== 'production.ts' && source.includes('process.env'))
      .map(({ file }) => file);
    expect(readers).toEqual([]);
  });

  it('never runs a process outside the process gateway', () => {
    const spawners = readSources('apps/server/src')
      .filter(({ source }) => /Bun\.spawn|Bun\.\$|node:child_process/.test(source))
      .map(({ file }) => file);
    expect(spawners).toEqual(['modules/system/gateways/bun.process-runner.ts']);
  });

  it('keeps test doubles out of production wiring', () => {
    const wiring = readSources('apps/server/src').filter(({ file }) => file === 'production.ts');
    const doubles = /scripted\.|memory\.|loopback\.|static\.tailscale|fixed\.clock/;
    expect(wiring.flatMap(({ source }) => importsOf(source)).filter((specifier) => doubles.test(specifier))).toEqual(
      []
    );
  });
});

describe('client', () => {
  const isApplication = (file: string) => /\/app\//.test(file) || file.startsWith('shared/app/');
  const isView = (file: string) => /\/(screens|components)\//.test(file);

  it('keeps the application layer free of the view', () => {
    const bad = offenders('apps/client/src', (file, specifier) => {
      if (!isApplication(file) || file.startsWith('__tests__')) return false;
      return ClientForbiddenInApp.some((pattern) => pattern.test(specifier));
    });
    expect(bad).toEqual([]);
  });

  it('never lets a view reach a repository or gateway', () => {
    const bad = offenders('apps/client/src', (file, specifier) => {
      if (!isView(file)) return false;
      return ClientForbiddenInViews.some((pattern) => pattern.test(specifier));
    });
    expect(bad).toEqual([]);
  });

  it('never hardcodes a color, so every screen follows the theme', () => {
    const colored = readSources('apps/client/src')
      .filter(({ file }) => !file.startsWith('__tests__'))
      .filter(({ source }) => /['"`]#[0-9a-fA-F]{3,8}['"`]/.test(source))
      .map(({ file }) => file);
    expect(colored).toEqual([]);
  });

  it('keeps test adapters out of the production root', () => {
    const bad = offenders('apps/client/src', (file, specifier) => {
      if (file !== 'main.tsx' && file !== 'shared/container/app.ts' && file !== 'App.tsx') return false;
      return TestAdapter.test(specifier) || specifier.includes('container/dev');
    });
    expect(bad).toEqual([]);
  });
});
