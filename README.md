# Dojo

Dojo is a Foldkit application delivered as an installable web app and an Electron desktop app. The repository currently contains only the application shell and project tooling.

## Development

Development requires Bun 1.3.14 or newer.

```sh
bun install
bun run dev
```

`bun run dev` builds the Electron main process, starts the Vite renderer, waits for it to become available, and launches Electron. Use `bun run dev:web` to run only the browser/PWA version.

The default ports are `7780` for the renderer and `7781` for the Foldkit DevTools MCP relay. `direnv allow` is optional and loads those values from `.envrc`.

## Verification

```sh
bun run check
bun run test:e2e
```

`check` runs typechecking, linting, unit tests, and production builds. `test:e2e` additionally runs browser and Electron smoke tests.

## Packaging

```sh
bun run package
```

The generated Electron artifacts are written to `packages/desktop/release/`. Signing, notarization, publishing, and automatic updates are intentionally not configured yet.

## Structure

- `packages/app`: browser-safe Foldkit renderer and PWA configuration
- `packages/desktop`: hardened Electron shell and packaging configuration
- `packages/shared`: portable cross-runtime contracts when they become necessary
- `scripts`: development-process orchestration
- `e2e`: browser and Electron smoke tests
- `docs`: product planning, visual references, and generated concept art
