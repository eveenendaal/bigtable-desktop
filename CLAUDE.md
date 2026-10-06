# CLAUDE.md

Bigtable Desktop is an Electron app for reading Google Cloud Bigtable data with the official `@google-cloud/bigtable` client. It is meant for *using* Bigtable, not administering it: discovery and reads only. Never add calls that create, update or delete instances, tables or data.

## Commands

`make help` lists Makefile shortcuts for the commands below. `make test-emulator` and `make demo` start an emulator via `scripts/with-emulator.sh` if none is running.

```sh
npm install                                    # also downloads the Electron binary
npm start                                      # run the app from source
npm test                                       # unit tests (node:test); emulator tests are skipped
BIGTABLE_EMULATOR_HOST=localhost:8086 npm test # also runs test/emulator.test.js
npm run seed:emulator                          # load sample data into demo-project/demo-instance
npx electron-builder --linux dir --publish never  # quick packaged build in dist/linux-unpacked
ruby -c Casks/bigtable-desktop.rb              # cask syntax check (run by CI)
make icons                                     # regenerate build/icon.png + icon.icns from build/icon.svg
```

Emulator: `gcloud beta emulators bigtable start --host-port=localhost:8086`, or `go install cloud.google.com/go/bigtable/cmd/emulator@latest` and run `emulator -host localhost -port 8086`. The emulator cannot list instances or clusters and does not support GoogleSQL (`PrepareQuery`), so those features can't be tested against it.

`BIGTABLE_DESKTOP_STATE=/path/workspace.json` points the app at a different state file. This is useful for UI testing with Playwright's `_electron` and a pre-seeded workspace.

## Architecture

- `src/main/`: Electron main process (ES modules, `"type": "module"`).
  - `main.js`: window, menu and IPC handlers. Each IPC handler returns `{ok, value}` or `{ok: false, error}`.
  - `bigtable.js`: `BigtableService`, which wraps the client. It also builds row sets and filters, and normalizes ReadRows and SQL results into one row model.
  - `store.js`: atomic JSON persistence of the workspace.
  - `errors.js`: gRPC errors → `{message, code, hint}`.
- `src/preload/preload.cjs`: a `contextBridge` API (`window.api`). It must stay CommonJS because the preload is sandboxed. Rejections are plain `{message, code, hint}` objects, because Error subclasses lose their properties crossing the bridge.
- `src/renderer/`: framework-free UI using plain ES modules with no bundler or build step. The renderer is served from the custom `app://bundle/` protocol, which only exposes `src/renderer` and `src/shared`. A strict CSP applies, so don't add inline scripts or remote resources.
  - `dom.js`: the `h()` element helper, icons, toasts and menus.
  - `state.js`: the persisted workspace (projects, tabs, settings). Call `persist()` after mutating it; saves are debounced.
  - `sidebar.js`: the project/instance/cluster/table tree.
  - `app.js`: tabs and commands.
  - `query-view.js`: one `QueryView` per tab, kept alive while the tab is open.
  - `grid.js`: the results grid.
  - `inspector.js`: the cell/row inspector, version timeline and diff.
  - `json-view.js`: JSON highlighting and the collapsible tree.
- `src/mcp/`: the built-in MCP server (official `@modelcontextprotocol/sdk`, stdio).
  - `server.js`: `createServer({service, loadState, loadSnapshot})` registers the read-only tools. It reuses `BigtableService` and the shared export and query code.
  - `stdio.js`: the entry point. MCP clients run the app binary with `ELECTRON_RUN_AS_NODE=1` and this file (inside `app.asar` when packaged). `bin/bigtable-desktop-mcp` does the same for Homebrew users. Keep stdout clean: it carries the protocol.
  - The server reads the workspace file on every call. It also reads result snapshots from `results/<tabId>.json` next to that file. Those snapshots are written by the renderer's *Copy MCP reference* through the `results:snapshot` IPC, and pruned at startup for closed tabs.
  - `src/main/mcp-config.js` builds the launch config and the `claude mcp add` command, and registers the server with the Claude Code CLI. It resolves PATH through the login shell, because GUI apps on macOS don't inherit it.
  - `src/main/paths.js` computes the workspace path without Electron. `APP_NAME` must match `productName`.
- `src/shared/`: code used by both processes. It must only use web-standard APIs (`Uint8Array`, `TextDecoder`, `btoa`), never Node's `Buffer`.
  - `bytes.js`: byte helpers.
  - `cells.js`: JSON, text and binary detection.
  - `time.js`: timestamp formatting.
  - `diff.js`: line diff.
  - `export.js`: JSON, NDJSON and CSV export.

### Row model (main → renderer)

```js
{ rows: [{ key: Uint8Array, synthetic?: bool,
           cells: [{ family, qualifier: Uint8Array,
                     versions: [{ timestampMicros: string|null, value: Uint8Array, labels? }] }] }],
  hasMore, lastKey, elapsedMs, cancelled }
```

- Versions are ordered newest first.
- Timestamps are microseconds since the epoch, kept as strings or BigInts so they don't lose precision. Never convert them to `Number` before dividing by 1000.
- In SQL results, column-family maps become `family:qualifier` cells. Plain columns have `family: ''`.

## Gotchas

- Read rows with `decode: false`. Even then, the client turns 8-byte values that look like safe integers into numbers, and `cellValueToBytes` turns them back into bytes. Qualifiers arrive as UTF-8 object keys, so non-UTF-8 qualifiers are lossy.
- Pass `metricsEnabled: false` to the `Bigtable` constructor. Otherwise the client tries to export metrics to Cloud Monitoring.
- `fast-crc32c` has an optional native `sse4_crc32` addon. The package config excludes it and sets `npmRebuild: false` so the app stays pure JS and macOS arm64/x64 builds cross-build cleanly. Don't add native dependencies.
- Keep CSS class names distinct between components. A shared `.versions` class once broke the grid's row heights.
- The app icon's source is `build/icon.svg`. `build/icon.png`, `build/icon.icns` and `src/renderer/assets/icon.svg` are generated from it with `make icons`, so edit the SVG and regenerate rather than editing those files.
- Pagination ("Load more") restarts strictly after `lastKey`. Prefix scans are turned into ranges using `prefixSuccessor`.

- The MCP server depends on Electron's `RunAsNode` fuse staying enabled (the default). Don't disable it in electron-builder's `electronFuses`.
- MCP tools must stay read-only and declare `readOnlyHint: true`.

## Conventions

- Match the existing style: 2-space indent, single quotes, semicolons, small focused modules, and comments only where the "why" isn't obvious.
- Add unit tests in `test/*.test.js` for `src/shared` and for the pure parts of `src/main/bigtable.js`. Add emulator tests for anything that reads data.
- After UI changes, run the app and check the change visually. Playwright's `_electron` under `xvfb-run` works headless.

## Release and Homebrew

- The repo is also a Homebrew tap (`Casks/bigtable-desktop.rb`).
- Pushing a `vX.Y.Z` tag runs `.github/workflows/release.yml`. So does running it manually (`workflow_dispatch`), which releases the `package.json` version and creates its tag. It builds the installers, publishes a GitHub release, then runs `scripts/update-cask.js` to commit the new version and checksums to the cask on the default branch.
- Don't hand-edit the cask's version or sha256 values.
- `uninstall quit:` makes `brew upgrade` quit the app and reopen it afterwards. The cask's `binary` stanza needs `bin/bigtable-desktop-mcp`, which is bundled through `mac.extraResources`.
- Artifact names must stay `bigtable-desktop-${version}-${arch}.dmg` to match the cask URL.
