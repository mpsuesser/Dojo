## Architecture

- This is a Foldkit application. Read the Foldkit skill and pinned Foldkit reference before changing renderer architecture.
- Keep `view` and `update` pure. Put one-shot effects in Commands and ongoing external events in Subscriptions.
- Messages describe past events. Command results use `Completed*`, `Succeeded*`, or `Failed*` names.
- Keep `packages/app` browser-safe so the same renderer works as a PWA and in Electron.
- Keep native capabilities behind narrow, schema-decoded IPC contracts owned by `packages/shared` and an isolated preload bridge.
- Do not import Node or Electron modules from `packages/app` or platform modules from `packages/shared`.

## Verification

- Use Bun 1.3.14 or newer.
- Run `bun run check` for source and tooling changes.
- Run `bun run test:e2e` for renderer, Electron-shell, or packaging changes.
