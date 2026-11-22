import { describe, expect, it } from 'bun:test';
import { caskFolderOf, inheritedFilesOf, signerFrom } from '#domain/updates/signed-install';

const Anthropic =
  'identifier "com.anthropic.claude-code" and anchor apple generic and certificate leaf[subject.OU] = Q6L2SF6YDW';
const Before = {
  folder: '/opt/homebrew/Caskroom/codex/0.171.0',
  signers: { 'bin/codex': 'identifier codex', 'codex-path/rg': 'identifier rg' },
};

describe('the folder a Homebrew cask keeps one version in', () => {
  it('is read from the real path of anything inside it', () => {
    expect(caskFolderOf('/opt/homebrew/Caskroom/claude-code@latest/2.1.330/claude')).toBe(
      '/opt/homebrew/Caskroom/claude-code@latest/2.1.330'
    );
    expect(caskFolderOf('/opt/homebrew/Caskroom/antigravity-cli/1.5.14,53/.homebrew-command-wrappers/agy')).toBe(
      '/opt/homebrew/Caskroom/antigravity-cli/1.5.14,53'
    );
  });
  it('is nothing for a formula or an install outside Homebrew', () => {
    expect(caskFolderOf('/opt/homebrew/Cellar/opencode-v2/2.3.2/bin/opencode')).toBeUndefined();
    expect(caskFolderOf('/home/bee/.local/bin/claude')).toBeUndefined();
  });
});

describe('who signed a file', () => {
  it('is the requirement codesign prints for it', () => {
    expect(signerFrom(`designated => ${Anthropic}\n`)).toBe(Anthropic);
  });
  it('is nobody for a file that is not signed', () => {
    expect(signerFrom('')).toBeUndefined();
  });
});

describe('the files of a new version that inherit an approval', () => {
  it('are the ones at the same place as a signed file of the old version, each with its old signer', () => {
    expect(inheritedFilesOf(Before, '/opt/homebrew/Caskroom/codex/0.172.0')).toEqual([
      { path: '/opt/homebrew/Caskroom/codex/0.172.0/bin/codex', signer: 'identifier codex' },
      { path: '/opt/homebrew/Caskroom/codex/0.172.0/codex-path/rg', signer: 'identifier rg' },
    ]);
  });
  it('are none while the version has not changed', () => {
    expect(inheritedFilesOf(Before, Before.folder)).toEqual([]);
  });
  it('are none while the install is away', () => {
    expect(inheritedFilesOf(Before, undefined)).toEqual([]);
  });
});
