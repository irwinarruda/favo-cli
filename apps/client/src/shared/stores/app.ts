import { create, type StateCreator } from 'zustand';
import { composeServices, computed } from '@/libs/zustand';
import { type AccountService, createAccountService } from '@/modules/accounts/app/services/AccountService';
import { createFleetService, type FleetService } from '@/modules/comb/app/services/FleetService';
import { createSelectionService, type SelectionService } from '@/modules/comb/app/services/SelectionService';
import { createDirectoryService, type DirectoryService } from '@/modules/directories/app/services/DirectoryService';
import { createMachineService, type MachineService } from '@/modules/machines/app/services/MachineService';
import { createSessionService, type SessionService } from '@/modules/sessions/app/services/SessionService';
import { createThemeService, type ThemeService } from '@/modules/themes/app/services/ThemeService';
import { createThreadService, type ThreadService } from '@/modules/threads/app/services/ThreadService';
import { createProviderCliService, type ProviderCliService } from '@/modules/updates/app/services/ProviderCliService';
import { createLimitsService, type LimitsService } from '@/modules/usage/app/services/LimitsService';
import { createTokensService, type TokensService } from '@/modules/usage/app/services/TokensService';
import { createUsageService, type UsageService } from '@/modules/usage/app/services/UsageService';
import { createToastService, type ToastService } from '@/shared/app/services/ToastService';

export type AppService = ThemeService &
  DirectoryService &
  FleetService &
  SelectionService &
  SessionService &
  ThreadService &
  AccountService &
  MachineService &
  UsageService &
  LimitsService &
  TokensService &
  ProviderCliService &
  ToastService;

export type ServiceCreator<T> = StateCreator<AppService, [], [], T>;

export const useApp = create<AppService>()(
  computed((...args) =>
    composeServices(
      createThemeService(...args),
      createFleetService(...args),
      createSelectionService(...args),
      createDirectoryService(...args),
      createSessionService(...args),
      createThreadService(...args),
      createAccountService(...args),
      createMachineService(...args),
      createUsageService(...args),
      createLimitsService(...args),
      createTokensService(...args),
      createProviderCliService(...args),
      createToastService(...args)
    )
  )
);
