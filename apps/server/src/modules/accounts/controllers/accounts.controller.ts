import { adoptAccount } from '@favo/contracts/rpc/accounts/adopt-account';
import { createAccount } from '@favo/contracts/rpc/accounts/create-account';
import { listAccounts } from '@favo/contracts/rpc/accounts/list-accounts';
import { removeAccount } from '@favo/contracts/rpc/accounts/remove-account';
import { renameAccount } from '@favo/contracts/rpc/accounts/rename-account';
import { installHooks } from '@favo/contracts/rpc/hooks/install-hooks';
import { listHooks } from '@favo/contracts/rpc/hooks/list-hooks';
import { refreshHooks } from '@favo/contracts/rpc/hooks/refresh-hooks';
import { uninstallHooks } from '@favo/contracts/rpc/hooks/uninstall-hooks';
import { getSeatStatus } from '@favo/contracts/rpc/seats/get-seat-status';
import { inspectSeat } from '@favo/contracts/rpc/seats/inspect-seat';
import { provisionSeat } from '@favo/contracts/rpc/seats/provision-seat';
import { repairSeats } from '@favo/contracts/rpc/seats/repair-seats';
import { listThreads } from '@favo/contracts/rpc/threads/list-threads';
import { recordThread } from '@favo/contracts/rpc/threads/record-thread';
import { reportThread } from '@favo/contracts/rpc/threads/report-thread';
import type { AccountsService } from '@/modules/accounts/services/accounts.service';
import type { HooksService } from '@/modules/accounts/services/hooks.service';
import type { SeatsService } from '@/modules/accounts/services/seats.service';
import type { ThreadsService } from '@/modules/accounts/services/threads.service';
import type { RpcRouter } from '@/shared/rpc/rpc-router';

export function registerAccountsController(
  router: RpcRouter,
  accounts: AccountsService,
  seats: SeatsService,
  threads: ThreadsService,
  hooks: HooksService
) {
  router.handle(listAccounts, () => accounts.list());
  router.handle(createAccount, ({ name }) => accounts.create(name));
  router.handle(renameAccount, ({ name, newName }) => accounts.rename(name, newName));
  router.handle(removeAccount, ({ name }) => accounts.remove(name));
  router.handle(adoptAccount, ({ name, provider, from }) => accounts.adopt(name, provider, from));
  router.handle(getSeatStatus, ({ account, provider }) => seats.status(account, provider));
  router.handle(inspectSeat, ({ account, provider }) => seats.inspect(account, provider));
  router.handle(provisionSeat, ({ account, provider }) => seats.reconcile(account, provider));
  router.handle(repairSeats, async ({ account }) => {
    const repairs = await seats.repairAll(account);
    await hooks.refresh();
    return repairs;
  });
  router.handle(listThreads, (params) => threads.list(params));
  router.handle(recordThread, (params) => threads.record(params));
  router.handle(reportThread, async ({ provider, id }) => {
    await threads.report(provider, id);
    return {};
  });
  router.handle(listHooks, () => hooks.list());
  router.handle(installHooks, () => hooks.install());
  router.handle(uninstallHooks, () => hooks.uninstall());
  router.handle(refreshHooks, async () => {
    await hooks.refresh();
    return {};
  });
}
