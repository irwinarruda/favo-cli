import { arch, homedir, hostname, platform } from 'node:os';
import { basename, delimiter } from 'node:path';
import { ProviderId } from '@favo/domain/providers/provider';
import { HeadlessDesktopApps } from '@/modules/desktop/gateways/headless.desktop-apps';
import { LinuxDesktopApps } from '@/modules/desktop/gateways/linux.desktop-apps';
import { MacDesktopApps } from '@/modules/desktop/gateways/mac.desktop-apps';
import { SshDesktopApps } from '@/modules/desktop/gateways/ssh.desktop-apps';
import { WindowsDesktopApps } from '@/modules/desktop/gateways/windows.desktop-apps';
import { CliHerdr } from '@/modules/herdr/gateways/cli.herdr';
import { CliTailscale } from '@/modules/machines/gateways/cli.tailscale';
import { GithubReleaseAssets } from '@/modules/machines/gateways/github.release-assets';
import { OpenSsh } from '@/modules/machines/gateways/open.ssh';
import { SshRemoteBackends } from '@/modules/machines/gateways/ssh.remote-backends';
import { AntigravityProviderCli } from '@/modules/providers/gateways/antigravity.provider-cli';
import { ClaudeProviderCli } from '@/modules/providers/gateways/claude.provider-cli';
import { CodexProviderCli } from '@/modules/providers/gateways/codex.provider-cli';
import { OpencodeProviderCli } from '@/modules/providers/gateways/opencode.provider-cli';
import { BunProcessRunner } from '@/modules/system/gateways/bun.process-runner';
import { InheritedShellEnvironment } from '@/modules/system/gateways/inherited.shell-environment';
import { LoginShellEnvironment } from '@/modules/system/gateways/login.shell-environment';
import { NodeFileSystem } from '@/modules/system/gateways/node.file-system';
import { SystemClock } from '@/modules/system/gateways/system.clock';
import { DiskTokenLogs } from '@/modules/usage/gateways/disk.token-logs';
import { LitellmPriceSource } from '@/modules/usage/gateways/litellm.price-source';
import { createServer } from '@/server';
import { favoPathsOf } from '@/shared/config/favo-paths';

const FavoBinaryName = 'favo';

export function createProductionServer(env: Record<string, string | undefined>) {
  const isWindows = platform() === 'win32';
  const home = forwardSlashes(env.HOME ?? homedir());
  const paths = favoPathsOf({
    home,
    favoHome: env.FAVO_HOME ? forwardSlashes(env.FAVO_HOME) : undefined,
    configHome: env.XDG_CONFIG_HOME ? forwardSlashes(env.XDG_CONFIG_HOME) : undefined,
    isWindows,
  });
  const processes = new BunProcessRunner(env, isWindows);
  const inheritedPath = [env.PATH ?? '', `${home}/.local/bin`].join(delimiter);
  const isInSshSession = env.SSH_CONNECTION !== undefined || env.FAVO_LOGIN_SHELL !== undefined;
  const needsLoginShell = isInSshSession && !isWindows;
  const shell = needsLoginShell
    ? new LoginShellEnvironment(processes, env.SHELL ?? '/bin/sh', inheritedPath)
    : new InheritedShellEnvironment(inheritedPath);
  const ssh = new OpenSsh(processes);
  const name = (env.FAVO_HOSTNAME ?? hostname()).split('.')[0]!.toLowerCase();
  const fileSystem = new NodeFileSystem(platform());
  return createServer(
    {
      fileSystem,
      processes,
      shell,
      clock: new SystemClock(),
      clis: {
        [ProviderId.claude]: new ClaudeProviderCli(processes),
        [ProviderId.codex]: new CodexProviderCli(processes),
        [ProviderId.antigravity]: new AntigravityProviderCli(processes),
        [ProviderId.opencode]: new OpencodeProviderCli(processes),
      },
      ssh,
      tailscale: new CliTailscale(processes),
      remotes: new SshRemoteBackends(ssh),
      releaseAssets: new GithubReleaseAssets(),
      desktopApps: desktopAppsFor(isInSshSession),
      herdr: new CliHerdr(processes),
      tokenLogs: new DiskTokenLogs(),
      priceSource: new LitellmPriceSource(env.FAVO_PRICES_URL),
    },
    {
      paths,
      host: { hostname: name, platform: platform(), arch: arch(), home, directory: process.cwd() },
      callerEnv: env,
      pid: process.pid,
      binary: basename(process.execPath).startsWith(FavoBinaryName) ? process.execPath : undefined,
    }
  );

  function desktopAppsFor(isOverSsh: boolean) {
    const installed = installedDesktopApps(isOverSsh);
    return isOverSsh ? new SshDesktopApps(installed) : installed;
  }

  function installedDesktopApps(isOverSsh: boolean) {
    if (platform() === 'darwin') return new MacDesktopApps(processes, fileSystem, home);
    if (isWindows) return new WindowsDesktopApps(processes, fileSystem, env.LOCALAPPDATA ?? `${home}/AppData/Local`);
    if (isOverSsh || env.DISPLAY || env.WAYLAND_DISPLAY) {
      return new LinuxDesktopApps(processes, fileSystem, paths.configHome);
    }
    return new HeadlessDesktopApps();
  }
}

function forwardSlashes(path: string) {
  return path.replaceAll('\\', '/');
}
