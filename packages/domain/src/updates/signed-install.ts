import { z } from 'zod';

export const CodesignCommand = '/usr/bin/codesign';
export const XattrCommand = '/usr/bin/xattr';

const QuarantineAttribute = 'com.apple.quarantine';
const CaskVersionFolder = /^(.*\/Caskroom\/[^/]+\/[^/]+)\//;
const DesignatedRequirement = /^designated => (.+)$/m;

export const SignedInstall = z.strictObject({
  folder: z.string(),
  signers: z.record(z.string(), z.string()),
});
export type SignedInstall = z.infer<typeof SignedInstall>;

export function caskFolderOf(realPath: string) {
  return CaskVersionFolder.exec(realPath.replaceAll('\\', '/'))?.[1];
}

export function signerFrom(output: string) {
  return DesignatedRequirement.exec(output)?.[1];
}

export function signerArguments(path: string) {
  return ['--display', '--requirements', '-', path];
}

export function signedByArguments(path: string, signer: string) {
  return ['--verify', `-R=${signer}`, path];
}

export function quarantineArguments(path: string) {
  return ['-p', QuarantineAttribute, path];
}

export function releaseArguments(path: string) {
  return ['-d', QuarantineAttribute, path];
}

export function inheritedFilesOf(before: SignedInstall, folder?: string) {
  if (folder === undefined || folder === before.folder) return [];
  return Object.entries(before.signers).map(([file, signer]) => ({ path: `${folder}/${file}`, signer }));
}
