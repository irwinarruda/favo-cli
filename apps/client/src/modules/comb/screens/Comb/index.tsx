import { DesktopOpening } from '@favo/domain/desktop/desktop-app';
import type { ScrollBoxRenderable } from '@opentui/core';
import { useTerminalDimensions } from '@opentui/react';
import { useEffect, useRef, useState } from 'react';
import { AddAccount } from '@/modules/accounts/screens/AddAccount';
import { RenameAccount } from '@/modules/accounts/screens/RenameAccount';
import { Header } from '@/modules/comb/screens/Comb/Header';
import { HelpDialog } from '@/modules/comb/screens/Comb/HelpDialog';
import { KeyBar } from '@/modules/comb/screens/Comb/KeyBar';
import { MachineCard } from '@/modules/comb/screens/Comb/MachineCard';
import { SeatDetail } from '@/modules/comb/screens/Comb/SeatDetail';
import { useCombKeys } from '@/modules/comb/screens/Comb/useCombKeys';
import { DirectoryPicker } from '@/modules/directories/screens/DirectoryPicker';
import { AddMachine } from '@/modules/machines/screens/AddMachine';
import { ThemePicker } from '@/modules/themes/screens/ThemePicker';
import { ThreadPicker } from '@/modules/threads/screens/ThreadPicker';
import type { ProviderCliTarget } from '@/modules/updates/app/services/ProviderCliService';
import { ProviderClis } from '@/modules/updates/screens/ProviderClis';
import { Usage } from '@/modules/usage/screens/Usage';
import { UsageHelpKeys } from '@/modules/usage/screens/Usage/helpKeys';
import { type Confirmation, ConfirmDialog } from '@/shared/components/ConfirmDialog';
import { ToastLine } from '@/shared/components/ToastLine';
import { useError } from '@/shared/error/useError';
import { useApp } from '@/shared/stores/app';

const WideWidth = 100;
const DetailWidth = 44;
const TallHeight = 30;
const MinimumListHeight = 6;

export function Comb({ onQuit }: { onQuit(): void }) {
  const colors = useApp((state) => state.colors);
  const { width, height } = useTerminalDimensions();
  const machines = useApp((state) => state.machines);
  const loadFleet = useApp((state) => state.loadFleet);
  const selectedRow = useApp((state) => state.selectedRow);
  const selectedAccount = useApp((state) => state.selectedAccount);
  const selectedMachine = useApp((state) => state.selectedMachine);
  const removeSelectedAccount = useApp((state) => state.removeSelectedAccount);
  const forgetSelectedMachine = useApp((state) => state.forgetSelectedMachine);
  const updateProviderClis = useApp((state) => state.updateProviderClis);
  const isUpdatingProviderClis = useApp((state) => state.isUpdatingProviderClis);
  const openProviderClis = useApp((state) => state.openProviderClis);
  const selectedSeat = useApp((state) => state.selectedSeat);
  const selectedDesktopApp = useApp((state) => state.selectedDesktopApp);
  const canOpenDesktopApp = useApp((state) => state.canOpenDesktopApp);
  const isDesktopAppBusy = useApp((state) => state.isDesktopAppBusy);
  const openDesktopApp = useApp((state) => state.openDesktopApp);
  const isAddAccountOpen = useApp((state) => state.isAddAccountOpen);
  const isRenameAccountOpen = useApp((state) => state.isRenameAccountOpen);
  const isAddMachineOpen = useApp((state) => state.isAddMachineOpen);
  const isThemePickerOpen = useApp((state) => state.isThemePickerOpen);
  const isDirectoryPickerOpen = useApp((state) => state.isDirectoryPickerOpen);
  const isThreadPickerOpen = useApp((state) => state.isThreadPickerOpen);
  const needsThreadHook = useApp((state) => state.needsThreadHook);
  const canKeepThreads = useApp((state) => state.canKeepThreads);
  const goBackToThread = useApp((state) => state.goBackToThread);
  const installThreadHooks = useApp((state) => state.installThreadHooks);
  const isUsageOpen = useApp((state) => state.isUsageOpen);
  const isProviderClisOpen = useApp((state) => state.isProviderClisOpen);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const [runningClis, setRunningClis] = useState<ProviderCliTarget[]>([]);
  const scrollRef = useRef<ScrollBoxRenderable>(null);
  const error = useError();
  const isWide = width >= WideWidth;
  const isCompact = !isWide || height < TallHeight;
  const isScreenOpen =
    isHelpOpen ||
    isAddAccountOpen ||
    isRenameAccountOpen ||
    isAddMachineOpen ||
    isThemePickerOpen ||
    isDirectoryPickerOpen ||
    isThreadPickerOpen ||
    isUsageOpen;
  const isDialogOpen = isScreenOpen || isProviderClisOpen || confirmation !== undefined;
  const canAskAboutRunning = runningClis.length > 0 && !isScreenOpen && confirmation === undefined;

  function onRemoveAccount() {
    if (!selectedAccount) return;
    if (selectedAccount.isPersonal) {
      void error.handle(removeSelectedAccount)();
      return;
    }
    setConfirmation({
      title: 'delete cell',
      message: `Move ${selectedAccount.displayName} on ${selectedMachine?.name} to the trash? Its logins and threads go with it.`,
      onAccept: () => void error.handle(removeSelectedAccount)(),
    });
  }

  function onForgetMachine() {
    if (!selectedMachine || selectedMachine.isLocal) return;
    setConfirmation({
      title: 'forget machine',
      message: `Forget ${selectedMachine.name}? favo stays installed there.`,
      onAccept: () => void error.handle(forgetSelectedMachine)(),
    });
  }

  function onUpdateProviderClis() {
    if (confirmation) return;
    if (isUpdatingProviderClis) {
      void error.handle(openProviderClis)();
      return;
    }
    const behind = machines.filter((machine) => machine.canUpdate).map((machine) => machine.name);
    const favoFirst = behind.length > 0 ? ` favo on ${behind.join(', ')} is older, so it updates first.` : '';
    setConfirmation({
      title: 'update CLIs',
      message: `Update the provider CLIs on every machine? They update in the background, and the list shows each one as it goes. One that is running is left alone until you say so.${favoFirst}`,
      onAccept: () => void error.handle(onUpdateAccept)(),
    });
  }

  async function onUpdateAccept() {
    setRunningClis(await updateProviderClis());
  }

  function askAboutRunning() {
    const running = runningClis;
    const isOne = running.length === 1;
    const names = running.map(({ label, machineName }) => `${label} on ${machineName}`).join(', ');
    async function onUpdateRunningAccept() {
      setRunningClis(await updateProviderClis({ targets: running, isRunningIncluded: true }));
    }
    setRunningClis([]);
    setConfirmation({
      title: 'update running CLIs',
      message: `${names} ${isOne ? 'is' : 'are'} running, so favo left ${isOne ? 'it' : 'them'} alone. Update anyway?`,
      onAccept: () => void error.handle(onUpdateRunningAccept)(),
    });
  }

  async function onOpenDesktopApp() {
    if (!selectedSeat || !selectedDesktopApp || !canOpenDesktopApp) return;
    const seat = selectedSeat;
    const { label } = selectedDesktopApp;
    const displayName = selectedAccount?.displayName;
    const opening = await openDesktopApp(seat);
    if (opening !== DesktopOpening.stillOpen) return;
    async function onCloseAndReopen() {
      await openDesktopApp(seat, true);
    }
    setConfirmation({
      title: `close ${label}`,
      message: `${label} is open. Close it and reopen as ${displayName}? Anything running in it stops.`,
      onAccept: () => void error.handle(onCloseAndReopen)(),
    });
  }

  async function onGoBackToThread() {
    if (!canKeepThreads) return;
    if (!needsThreadHook) {
      await goBackToThread();
      return;
    }
    setConfirmation({
      title: 'remember threads',
      message: `Add favo's hook to your provider config on ${selectedMachine?.name}, so each seat remembers its threads? Your own hooks stay as they are, and favo hooks uninstall takes it out. Codex asks each seat once to trust it.`,
      onAccept: () => void error.handle(installThreadHooks)(),
    });
  }

  useCombKeys({
    isEnabled: !isDialogOpen && !isDesktopAppBusy,
    onHelp: () => setIsHelpOpen(true),
    onQuit,
    onRemoveAccount,
    onForgetMachine,
    onUpdateProviderClis,
    onOpenDesktopApp,
    onGoBackToThread,
  });

  useEffect(() => {
    void error.handle(loadFleet)();
  }, []);

  useEffect(() => {
    if (selectedRow) scrollRef.current?.scrollChildIntoView(selectedRow.key);
  }, [selectedRow?.key]);

  useEffect(() => {
    if (canAskAboutRunning) askAboutRunning();
  }, [canAskAboutRunning]);

  return (
    <box flexDirection="column" width="100%" height="100%" backgroundColor={colors.background}>
      <Header />
      <box flexGrow={1} flexDirection={isWide ? 'row' : 'column'} paddingX={1} minHeight={0}>
        <scrollbox
          ref={scrollRef}
          flexGrow={1}
          flexShrink={1}
          minHeight={MinimumListHeight}
          marginRight={isWide ? 1 : 0}
        >
          {machines.map((machine) => (
            <MachineCard key={machine.id} machine={machine} />
          ))}
        </scrollbox>
        <SeatDetail
          width={isWide ? DetailWidth : undefined}
          isCompact={isCompact}
          onRemoveAccount={onRemoveAccount}
          onGoBackToThread={onGoBackToThread}
        />
      </box>
      <ToastLine />
      <KeyBar
        onHelp={() => setIsHelpOpen(true)}
        onQuit={onQuit}
        onOpenDesktopApp={onOpenDesktopApp}
        onGoBackToThread={onGoBackToThread}
        onUpdateProviderClis={onUpdateProviderClis}
      />
      {isUsageOpen && <Usage isEnabled={!isHelpOpen} onHelp={() => setIsHelpOpen(true)} onQuit={onQuit} />}
      {isProviderClisOpen && (
        <ProviderClis
          isEnabled={!isHelpOpen && !confirmation}
          onHelp={() => setIsHelpOpen(true)}
          onQuit={onQuit}
          onUpdate={onUpdateProviderClis}
        />
      )}
      {isHelpOpen && <HelpDialog keys={isUsageOpen ? UsageHelpKeys : undefined} onClose={() => setIsHelpOpen(false)} />}
      {isAddAccountOpen && <AddAccount />}
      {isRenameAccountOpen && <RenameAccount />}
      {isAddMachineOpen && <AddMachine />}
      {isThemePickerOpen && <ThemePicker />}
      {isDirectoryPickerOpen && <DirectoryPicker />}
      {isThreadPickerOpen && <ThreadPicker />}
      {!!confirmation && <ConfirmDialog confirmation={confirmation} onClose={() => setConfirmation(undefined)} />}
    </box>
  );
}
