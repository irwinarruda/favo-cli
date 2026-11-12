---

name: client-architecture
description: Always load for any change under apps/client: placing code, adding a module, screen, service, repository, gateway or entity, or deciding what may import what. Use alongside client-service-styleguide and client-jsx-styleguide.
---

# Client architecture

## Model

Explicit MVVM with a DDD-style model:

```text
OpenTUI React View
  screen, component
        |
        v
Zustand Service (the ViewModel)
  workflow state, computed values, application actions
        |
        v
Repository or Gateway port
        |
        +------------------+
        v                  v
   Api* adapter       Test* adapter
   (RPC client)            |
                           v
                        mockDb

Class entities are the Model.
```

- **Service**: a Zustand state and action contract plus its creator. It is the application layer.
- **Repository**: a port plus class adapters for the backend.
- **Gateway**: a port plus class adapters for the terminal: clipboard, handing the terminal over.
- **Entity**: a class with semantic getters, built with `fromJSON`.

Do not add a second application class between a service and a repository. The application layer must not know the view: everything under an `app/` folder is reusable by a future web front end.

## Folders

```text
src/
  __tests__/   db.ts (mockDb), utils/, modules/, screens/, shared/
  libs/        generic infrastructure, each a folder with index.ts
  modules/<m>/
    app/       entities/ enums/ repositories/ gateways/ services/
    parsers/   pure transformations owned by the module
    components/ views shared by two screens of the module, as usage's Tokens and Cost
    screens/<ScreenName>/index.tsx, with private siblings beside it
  shared/      app/, components/, container/, error/, stores/, theme/
```

Add only folders with a real role.

## Dependency direction

```text
screen -> service -> repository/gateway
service -> entity
```

Views never reach a repository, a gateway or the container. Entities never reach Zustand or the container. `apps/server/test/architecture.test.ts` enforces the view and application boundaries.

Composition roots: `shared/container/app.ts` (production) and `shared/container/dev.ts` (`Test*` adapters). The production root must not import `__tests__`.

## Working references

- `src/modules/comb/`: the full vertical.
- `src/shared/stores/app.ts`: one flat store.
