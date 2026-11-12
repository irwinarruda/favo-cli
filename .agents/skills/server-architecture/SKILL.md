---

name: server-architecture
description: Use for any change under apps/server: adding or changing a module, controller, service, repository, gateway or wiring, or deciding where backend code belongs and what it may import. Also use when the request only says "add a method", "call this command" or "where does this go". Not for apps/client.
---

# Server architecture

## Authority

This skill owns placement and dependency direction in `apps/server`. How services and gateways are written comes from `server-service-styleguide`. Rules come from `domain-styleguide`.

## Module template

```text
src/
  server.ts       composition root, receives every gateway
  production.ts   the real gateways; the only reader of the environment
  shared/         level 0: config, rpc
  modules/<m>/
    controllers/  <area>.controller.ts: one handler per contract method
    services/     <capability>.service.ts: every application rule
    repositories/ <aggregate>.repository.ts: favo's own files
    gateways/     per external thing: the interface, the real one, the test one
    utils/        stateless helpers
```

Modules and levels: `system` (1), `providers`, `themes`, `directories` and `herdr` (2), `accounts` (3), `machines`, `desktop` and `usage` (4), `terminal` (5). A module imports only lower levels.

## Import rule

| Folder          | May import                                                                                 | Never                                                    |
| --------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| `controllers/`  | services, `shared/`, contracts                                                             | repositories, gateways                                   |
| `services/`     | services, repositories, gateway interfaces, utils, `shared/config`, domain, contract types | a gateway implementation, `process.env`, `Bun`, `node:*` |
| `repositories/` | gateway interfaces, `shared/config`, domain                                                | services, controllers                                    |
| `gateways/`     | gateways, utils, `shared/rpc`, domain                                                      | services, repositories, controllers                      |

`apps/server/test/architecture.test.ts` fails on a violation. Change the test and this table together.

## Remote machines

One rule in `shared/rpc/rpc-router.ts`: a request with a `machineId` for a `machine` method is forwarded. `favo serve --stdio` is the same router over a pipe, so a remote machine is not a special case anywhere else.

## Working references

- `src/modules/accounts/`: the layered module end to end.
- `src/modules/machines/gateways/`: an interface with real and test implementations side by side.

## Checklist

1. Each new file sits in the folder its role names.
2. `bun test apps/server` passes, including the architecture test.
