import type { DesktopAppView, ThreadView } from '@favo/contracts/rpc/views';
import { DesktopLogin, DesktopOpening } from '@favo/domain/desktop/desktop-app';
import { isOlderFavoError } from '@favo/domain/machines/machine';
import { Providers } from '@favo/domain/providers/provider';
import { ownValue } from '@favo/domain/shared/own-value';
import { TerminalAction } from '@favo/domain/terminal/terminal-plan';
import { handoffPromptOf } from '@favo/domain/threads/handoff-prompt';
import { compute } from '@/libs/zustand';
import type { Seat } from '@/modules/comb/app/entities/Seat';
import { ToastKind } from '@/shared/app/services/ToastService';
import { container } from '@/shared/container';
import type { AppService, ServiceCreator } from '@/shared/stores/app';

const AppLoginPollMs = 3_000;
const AppLoginPolls = 60;

export type AppLoginWatch = { seatKey: string };

export type SessionService = {
  pendingHandoff?: { source: Seat; directory: string; transcript?: string };
  desktopApps: Record<string, DesktopAppView[]>;
  selectedDesktopApp?: DesktopAppView;
  canOpenDesktopApp: boolean;
  isDesktopAppBusy: boolean;
  appLoginWatch?: AppLoginWatch;
  loadDesktopApps(machineId: string): Promise<void>;
  loadAppLogin(seat: Seat): Promise<void>;
  watchAppLogin(seat: Seat): Promise<void>;
  openDesktopApp(seat: Seat, canClose?: boolean): Promise<DesktopOpening | undefined>;
  openSelectedSeat(): Promise<void>;
  launchSelectedSeat(): Promise<void>;
  resumeSeatThread(seat: Seat, thread: ThreadView): Promise<void>;
  signInSelectedSeat(): Promise<void>;
  signOutSelectedSeat(): Promise<void>;
  copySelectedPath(): Promise<void>;
  repairSelectedMachine(): Promise<void>;
  closeHandoff(): void;
  continueHandoff(seat: Seat): Promise<void>;
};

export const createSessionService: ServiceCreator<SessionService> = (set, get) => ({
  ...compute(get, ({ desktopApps, selectedSeat, selectedMachine }) => {
    const selectedDesktopApp = selectedSeat && _appOf(desktopApps, selectedSeat);
    return { selectedDesktopApp, canOpenDesktopApp: !!selectedDesktopApp?.canOpen && !!selectedMachine?.isLocal };
  }),
  desktopApps: {},
  isDesktopAppBusy: false,
  appLoginWatch: undefined,
  pendingHandoff: undefined,
  async loadDesktopApps(machineId) {
    const previousApps = ownValue(get().desktopApps, machineId) ?? [];
    const desktopApps = await _appsOn(machineId);
    set((state) => ({ desktopApps: { ...state.desktopApps, [machineId]: desktopApps } }));
    if (_ownLoginProviders(desktopApps).join() === _ownLoginProviders(previousApps).join()) return;
    const { accounts, loadAppLogin } = get();
    const seats = accounts
      .filter((account) => account.machineId === machineId)
      .flatMap((account) => account.visibleSeats);
    await Promise.all(seats.map((seat) => loadAppLogin(seat)));
  },
  async loadAppLogin(seat) {
    const { desktopApps, updateSeat } = get();
    if (!_hasOwnLogin(desktopApps, seat)) {
      if (seat.hasAppLogin) updateSeat(seat.key, (current) => current.withAppLogin(undefined));
      return;
    }
    const desktopRepository = container.get('IDesktopRepository');
    const appLogin = await desktopRepository.getLogin(seat);
    const hasOwnLogin = _hasOwnLogin(get().desktopApps, seat);
    updateSeat(seat.key, (current) => current.withAppLogin(hasOwnLogin ? appLogin : undefined));
  },
  async watchAppLogin(seat) {
    const watch = { seatKey: seat.key };
    set({ appLoginWatch: watch });
    for (let poll = 0; poll < AppLoginPolls && _isWaiting(get(), watch); poll++) {
      await _wait(AppLoginPollMs);
      if (!_isWaiting(get(), watch) || !(await _isRead(get().loadAppLogin, seat))) break;
    }
    if (get().appLoginWatch === watch) set({ appLoginWatch: undefined });
  },
  async openDesktopApp(seat, canClose = false) {
    const { accounts, isDesktopAppBusy, refreshSeat, watchAppLogin, showToast } = get();
    if (isDesktopAppBusy) return undefined;
    try {
      set({ isDesktopAppBusy: true });
      const desktopRepository = container.get('IDesktopRepository');
      const { opening, label } = await desktopRepository.open(seat, canClose);
      if (opening === DesktopOpening.stillOpen) return opening;
      const account = accounts.find(({ machineId, name }) => machineId === seat.machineId && name === seat.account);
      showToast(`${label} is opening as ${account?.displayName}.`);
      await refreshSeat(seat);
      void watchAppLogin(seat);
      return opening;
    } finally {
      set({ isDesktopAppBusy: false });
    }
  },
  async openSelectedSeat() {
    const { selectedSeat, launchSelectedSeat, signInSelectedSeat } = get();
    if (!selectedSeat) return;
    if (selectedSeat.isSignedIn) await launchSelectedSeat();
    else await signInSelectedSeat();
  },
  async launchSelectedSeat() {
    const { selectedSeat, launchDirectories, refreshSeat, loadSelectedThreads } = get();
    if (!selectedSeat) return;
    const directory = ownValue(launchDirectories, selectedSeat.machineId);
    const result = await _runInTerminal(
      selectedSeat,
      TerminalAction.launch,
      refreshSeat,
      directory,
      undefined,
      [],
      true
    );
    await loadSelectedThreads();
    if (result.rateLimitDetected)
      set({ pendingHandoff: _handoffOf(selectedSeat, directory, get().selectedThreads[0]) });
  },
  async resumeSeatThread(seat, thread) {
    const { refreshSeat, loadSelectedThreads } = get();
    const result = await _runInTerminal(
      seat,
      TerminalAction.resume,
      refreshSeat,
      thread.directory,
      thread.id,
      [],
      true
    );
    await loadSelectedThreads();
    if (result.rateLimitDetected)
      set({ pendingHandoff: _handoffOf(seat, thread.directory, get().selectedThreads[0] ?? thread) });
  },
  closeHandoff() {
    set({ pendingHandoff: undefined });
  },
  async continueHandoff(seat) {
    const pendingHandoff = get().pendingHandoff;
    if (!pendingHandoff) return;
    const prompt = handoffPromptOf({
      sourceProvider: pendingHandoff.source.provider,
      transcript: pendingHandoff.transcript,
      directory: pendingHandoff.directory,
    });
    const args = [...Providers[seat.provider].initialPromptArguments, prompt];
    set({ pendingHandoff: undefined });
    let result: Awaited<ReturnType<typeof _runInTerminal>>;
    try {
      result = await _runInTerminal(
        seat,
        TerminalAction.launch,
        get().refreshSeat,
        pendingHandoff.directory,
        undefined,
        args,
        true
      );
    } catch (error) {
      set({ pendingHandoff });
      throw error;
    }
    if (result.rateLimitDetected) {
      const thread = await _latestThreadOf(seat, pendingHandoff.directory);
      set({ pendingHandoff: _handoffOf(seat, pendingHandoff.directory, thread) });
    }
  },
  async signInSelectedSeat() {
    const { selectedSeat } = get();
    if (selectedSeat) await _runInTerminal(selectedSeat, TerminalAction.login, get().refreshSeat);
  },
  async signOutSelectedSeat() {
    const { selectedSeat } = get();
    if (selectedSeat) await _runInTerminal(selectedSeat, TerminalAction.logout, get().refreshSeat);
  },
  async copySelectedPath() {
    const { selectedSeat, updateSeat, showToast } = get();
    if (!selectedSeat) return;
    const fleetRepository = container.get('IFleetRepository');
    const clipboardGateway = container.get('IClipboardGateway');
    await fleetRepository.provisionSeat(selectedSeat);
    updateSeat(selectedSeat.key, (seat) => seat.withProvisioned());
    const isCopied = await clipboardGateway.copy(selectedSeat.path);
    if (isCopied) showToast(`Copied. Paste it into T3 Code as ${selectedSeat.pathHint}.`);
    else showToast(`Could not reach the clipboard: ${selectedSeat.path}`, ToastKind.error);
  },
  async repairSelectedMachine() {
    const { selectedMachine, refreshMachine, showToast } = get();
    if (!selectedMachine?.isOnline) return;
    const fleetRepository = container.get('IFleetRepository');
    const linked = await fleetRepository.repairMachine(selectedMachine.id);
    await refreshMachine(selectedMachine.id);
    showToast(linked > 0 ? `Mended ${linked} shared links.` : 'Every wall is sound.');
  },
});

function _appOf(desktopApps: Record<string, DesktopAppView[]>, seat: Seat) {
  return ownValue(desktopApps, seat.machineId)?.find((app) => app.provider === seat.provider);
}

async function _appsOn(machineId: string) {
  try {
    const desktopRepository = container.get('IDesktopRepository');
    return await desktopRepository.getApps(machineId);
  } catch (error) {
    if (isOlderFavoError(error)) return [];
    throw error;
  }
}

function _isWaiting({ appLoginWatch, accounts }: AppService, watch: AppLoginWatch) {
  const seat = accounts.flatMap((account) => account.seats).find(({ key }) => key === watch.seatKey);
  return appLoginWatch === watch && !!seat?.hasAppLogin && !seat.isAppSignedIn;
}

async function _isRead(loadAppLogin: (seat: Seat) => Promise<void>, seat: Seat) {
  try {
    await loadAppLogin(seat);
    return true;
  } catch {
    return false;
  }
}

function _wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function _hasOwnLogin(desktopApps: Record<string, DesktopAppView[]>, seat: Seat) {
  return _ownLoginProviders(ownValue(desktopApps, seat.machineId) ?? []).includes(seat.provider);
}

function _ownLoginProviders(desktopApps: DesktopAppView[]) {
  return desktopApps.filter((app) => app.login === DesktopLogin.separate).map((app) => app.provider);
}

async function _runInTerminal(
  seat: Seat,
  action: TerminalAction,
  refreshSeat: (seat: Seat) => Promise<void>,
  directory?: string,
  thread?: string,
  args: string[] = [],
  monitorLimits = false
) {
  const terminalRepository = container.get('ITerminalRepository');
  const terminalGateway = container.get('ITerminalGateway');
  const plan = await terminalRepository.plan(seat, action, directory, thread, args);
  const result = await terminalGateway.run(plan, monitorLimits ? { monitorLimits: seat.provider } : undefined);
  await refreshSeat(seat);
  return result;
}

function _handoffOf(source: Seat, directory: string | undefined, thread: ThreadView | undefined) {
  return { source, directory: thread?.directory ?? directory ?? process.cwd(), transcript: thread?.transcript };
}

async function _latestThreadOf(seat: Seat, directory: string) {
  const threadRepository = container.get('IThreadRepository');
  try {
    return (await threadRepository.getThreads(seat, directory))[0];
  } catch {
    return undefined;
  }
}
