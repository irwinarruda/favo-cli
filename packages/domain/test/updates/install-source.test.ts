import { describe, expect, it } from 'bun:test';
import { versionFrom } from '#domain/machines/machine';
import { canUpdateItself, Providers } from '#domain/providers/provider';
import {
  InstallMethod,
  installLabelOf,
  installSourceOf,
  shimTargetOf,
  upgradeArgumentsOf,
  upgradeEnvironmentOf,
} from '#domain/updates/install-source';

describe('how something was installed', () => {
  it('reads Homebrew from the Cellar and the Caskroom', () => {
    expect(installSourceOf('/opt/homebrew/Cellar/favo-cli/0.4.0/bin/favo')).toEqual({
      method: InstallMethod.homebrew,
      packageName: 'favo-cli',
      root: '/opt/homebrew',
      isCask: false,
    });
    expect(installSourceOf('/opt/homebrew/Caskroom/claude-code@latest/2.1.316/claude')).toEqual({
      method: InstallMethod.homebrew,
      packageName: 'claude-code@latest',
      root: '/opt/homebrew',
      isCask: true,
    });
  });
  it('calls a Homebrew formula that bundles an npm package Homebrew, not npm', () => {
    const bundled = '/home/linuxbrew/.linuxbrew/Cellar/opencode/1.0/libexec/lib/node_modules/opencode-ai/bin/opencode';
    expect(installSourceOf(bundled)).toMatchObject({ method: InstallMethod.homebrew, packageName: 'opencode' });
  });
  it('keeps a global npm package with the Node version that holds it', () => {
    const path = '/home/bee/.nvm/versions/node/v24.16.0/lib/node_modules/@openai/codex/bin/codex.js';
    expect(installSourceOf(path)).toEqual({
      method: InstallMethod.npm,
      packageName: '@openai/codex',
      root: '/home/bee/.nvm/versions/node/v24.16.0',
      isCask: false,
    });
    const mise = '/home/bee/.local/share/mise/installs/node/22/lib/node_modules/opencode-ai/bin/opencode.exe';
    expect(installSourceOf(mise)?.root).toBe('/home/bee/.local/share/mise/installs/node/22');
    const asdf = '/home/bee/.asdf/installs/nodejs/22.1.0/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe';
    expect(installSourceOf(asdf)?.root).toBe('/home/bee/.asdf/installs/nodejs/22.1.0');
  });
  it('takes the installed package, not one nested inside it', () => {
    const path = '/usr/local/lib/node_modules/@openai/codex/node_modules/@openai/codex-darwin-arm64/vendor/codex';
    expect(installSourceOf(path)?.packageName).toBe('@openai/codex');
  });
  it('reads a Windows path the same way', () => {
    const path = 'C:\\Users\\bee\\AppData\\Roaming\\npm\\node_modules\\favo-cli\\bin\\favo.mjs';
    expect(installSourceOf(path)).toMatchObject({
      method: InstallMethod.npm,
      packageName: 'favo-cli',
      root: 'C:/Users/bee/AppData/Roaming/npm',
    });
  });
  it('reads the Windows folders of nvm and fnm', () => {
    const nvm = 'C:/Users/bee/AppData/Roaming/nvm/v22.1.0/node_modules/favo-cli/bin/favo.mjs';
    expect(installSourceOf(nvm)).toMatchObject({
      method: InstallMethod.npm,
      root: 'C:/Users/bee/AppData/Roaming/nvm/v22.1.0',
    });
    const fnm =
      'C:/Users/bee/AppData/Roaming/fnm/node-versions/v22.1.0/installation/node_modules/favo-cli/bin/favo.mjs';
    expect(installSourceOf(fnm)).toMatchObject({ method: InstallMethod.npm, packageName: 'favo-cli' });
  });
  it('tells pnpm, yarn and bun apart from npm', () => {
    const pnpm = '/home/bee/.local/share/pnpm/global/5/.pnpm/favo-cli@0.4.0/node_modules/favo-cli/bin/favo.mjs';
    expect(installSourceOf(pnpm)?.method).toBe(InstallMethod.pnpm);
    expect(installSourceOf('/home/bee/.config/yarn/global/node_modules/favo-cli/bin/favo.mjs')?.method).toBe(
      InstallMethod.yarn
    );
    expect(installSourceOf('/home/bee/.bun/install/global/node_modules/favo-cli/bin/favo.mjs')?.method).toBe(
      InstallMethod.bun
    );
  });
  it('knows nothing about what no package manager holds', () => {
    expect(installSourceOf('/home/bee/.local/share/claude/versions/2.1.316')).toBeUndefined();
    expect(installSourceOf('/home/bee/.opencode/bin/opencode')).toBeUndefined();
    expect(installSourceOf('/home/bee/.favo/bin/favo')).toBeUndefined();
  });
  it('does not mistake a one-off or a project install for a global one', () => {
    expect(installSourceOf('/home/bee/.npm/_npx/a1b2/node_modules/favo-cli/bin/favo.mjs')).toBeUndefined();
    expect(installSourceOf('/home/bee/code/hive/node_modules/favo-cli/bin/favo.mjs')).toBeUndefined();
  });
});

describe('what a script points at', () => {
  it('reads a Windows npm script', () => {
    const head =
      'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\node_modules\\@openai\\codex\\bin\\codex.js" %*';
    expect(shimTargetOf('C:\\Users\\bee\\AppData\\Roaming\\npm\\codex.cmd', head)).toBe(
      'C:/Users/bee/AppData/Roaming/npm/node_modules/@openai/codex/bin/codex.js'
    );
  });
  it('reads a pnpm script', () => {
    const head = 'exec node  "$basedir/global/5/node_modules/@openai/codex/bin/codex.js" "$@"';
    expect(shimTargetOf('/home/bee/.local/share/pnpm/codex', head)).toBe(
      '/home/bee/.local/share/pnpm/global/5/node_modules/@openai/codex/bin/codex.js'
    );
  });
  it('finds nothing in a binary or a shim that hides the path', () => {
    expect(shimTargetOf('/usr/bin/claude', '\u0000ELF')).toBeUndefined();
    expect(shimTargetOf('/home/bee/.asdf/shims/codex', 'exec asdf exec "codex" "$@"')).toBeUndefined();
  });
});

describe('updating through a package manager', () => {
  const source = { packageName: 'favo-cli', root: '/usr/local', isCask: false };

  it('names only the one package in Homebrew', () => {
    expect(upgradeArgumentsOf({ ...source, method: InstallMethod.homebrew })).toEqual([
      'upgrade',
      '--formula',
      'favo-cli',
    ]);
    expect(upgradeArgumentsOf({ ...source, method: InstallMethod.homebrew, isCask: true })).toEqual([
      'upgrade',
      '--cask',
      'favo-cli',
    ]);
  });
  it('asks each node package manager for the latest version', () => {
    expect(upgradeArgumentsOf({ ...source, method: InstallMethod.npm })).toEqual([
      'install',
      '--global',
      'favo-cli@latest',
    ]);
    expect(upgradeArgumentsOf({ ...source, method: InstallMethod.pnpm })).toEqual([
      'add',
      '--global',
      'favo-cli@latest',
    ]);
    expect(upgradeArgumentsOf({ ...source, method: InstallMethod.bun })).toEqual([
      'add',
      '--global',
      'favo-cli@latest',
    ]);
    expect(upgradeArgumentsOf({ ...source, method: InstallMethod.yarn })).toEqual(['global', 'add', 'favo-cli@latest']);
  });
  it('makes Homebrew read its taps first, since a third-party tap is only as new as its last fetch', () => {
    expect(upgradeEnvironmentOf({ ...source, method: InstallMethod.homebrew })).toEqual({
      env: { HOMEBREW_AUTO_UPDATE_SECS: '0' },
      unsetEnv: ['HOMEBREW_NO_AUTO_UPDATE'],
    });
  });
  it('leaves every other package manager and an unknown install as they are', () => {
    expect(upgradeEnvironmentOf({ ...source, method: InstallMethod.npm })).toEqual({ env: {}, unsetEnv: [] });
    expect(upgradeEnvironmentOf(undefined)).toEqual({ env: {}, unsetEnv: [] });
  });
  it('says plainly where something came from', () => {
    expect(installLabelOf({ ...source, method: InstallMethod.homebrew, isCask: true })).toBe('Homebrew cask favo-cli');
    expect(installLabelOf({ ...source, method: InstallMethod.npm })).toBe('npm in /usr/local');
    expect(installLabelOf({ ...source, method: InstallMethod.bun })).toBe('bun');
  });
});

describe('which provider can update itself', () => {
  const homebrew = { method: InstallMethod.homebrew, packageName: 'x', root: '/opt/homebrew', isCask: true };
  const npm = { ...homebrew, method: InstallMethod.npm, isCask: false };

  it('leaves Homebrew out for Claude Code, which only prints what to run there', () => {
    expect(canUpdateItself(Providers.claude, homebrew)).toBe(false);
    expect(canUpdateItself(Providers.claude, npm)).toBe(true);
    expect(canUpdateItself(Providers.claude, undefined)).toBe(true);
  });
  it('trusts Codex and OpenCode everywhere', () => {
    for (const source of [homebrew, npm, undefined]) {
      expect(canUpdateItself(Providers.codex, source)).toBe(true);
      expect(canUpdateItself(Providers.opencode, source)).toBe(true);
    }
  });
  it('leaves Homebrew out for Antigravity, which updates through Homebrew there and agy update elsewhere', () => {
    expect(canUpdateItself(Providers.antigravity, homebrew)).toBe(false);
    expect(canUpdateItself(Providers.antigravity, npm)).toBe(true);
    expect(canUpdateItself(Providers.antigravity, undefined)).toBe(true);
  });
});

describe('reading a version', () => {
  it('reads what each provider prints', () => {
    expect(versionFrom('2.1.316 (Claude Code)')).toBe('2.1.316');
    expect(versionFrom('codex-cli 0.166.0')).toBe('0.166.0');
    expect(versionFrom('opencode v2.2.5')).toBe('2.2.5');
    expect(versionFrom('no numbers here')).toBeUndefined();
  });
});
