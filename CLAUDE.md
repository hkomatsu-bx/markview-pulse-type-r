# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Markview Pulse Type R — a Windows Markdown previewer built with **Tauri v2** (Rust backend + WebView2) and a framework-less **TypeScript + Vite** frontend, rendering Markdown via **markdown-it**. Comments and user-facing strings are in Japanese. See `README.md` for the end-user feature list and screenshots; the feature surfaces that matter for code navigation are detailed under **Architecture** below.

The product is specified against requirement codes (`FR-00` open, `FR-01` preview, `FR-02` file-watch, `FR-03` diff, `FR-04` tabs, `FR-08` OS-theme follow, `FR-15` CJK emphasis; `NFR-xx` non-functional). To keep docs and code decoupled, these codes are **not** embedded in source comments; traceability is retained in test names (e.g. `describe("viewMode（FR-17）")`) and the e2e spec filenames (`fr00-open.e2e.ts`). When changing behavior, trace the relevant `FR`/`NFR` via those test names.

## Commands

Frontend / tooling (run from repo root):

| Task | Command |
|------|---------|
| Dev server (Vite, port 1420, strict) | `npm run dev` |
| Type-check + build frontend | `npm run build` (`tsc && vite build`) |
| Run the desktop app (dev) | `npm run tauri dev` |
| Build the installer/binary | `npm run tauri build` |
| Unit tests (Vitest) | `npm test` / watch: `npm run test:watch` |
| Single unit test file | `npx vitest run tests/core/diffEngine.test.ts` |
| Single test by name | `npx vitest run -t "merges consecutive ops"` |
| Coverage (80% gate on `src/core`) | `npm run coverage` |
| Benchmarks | `npm run bench` |
| Lint / fix (src + tests) | `npm run lint` / `npm run lint:fix` |
| Format / check | `npm run format` / `npm run format:check` |

Rust backend (run from `src-tauri/`): `cargo test`, `cargo fmt`, `cargo clippy -- -D warnings`. Single Rust test: `cargo test mtime_changed_detects_difference`.

E2E (`npm run test:e2e`): drives the **real WebView2 binary** via WebdriverIO + `tauri-driver` (not Playwright, despite the generic rule files). Prerequisites are environmental and not auto-provisioned: `cargo install tauri-driver`, a matching `msedgedriver.exe`, and a built app. See the header of `wdio.conf.ts` and env vars `TAURI_APP_PATH` / `TAURI_NATIVE_DRIVER`. Type-check specs with `npm run typecheck:e2e`.

## Architecture

Three layers, with a hard rule: **pure logic stays free of DOM, Tauri, and I/O so it is unit-testable.**

### Frontend (`src/`)
- `main.ts` is the **composition root**. It is the *only* place that holds mutable state (`TabState`) and performs side effects (IPC, DOM wiring, tab-id generation). It applies pure functions from `core/` to produce new immutable state, then re-renders.
- `src/core/` — pure, framework-free logic:
  - `tabs/tabStore.ts` — immutable `TabState` transitions (`openTab`, `closeTab`, `setActiveTab`, `updateTabSource`, …). All `Tab` fields are `readonly`.
  - `markdown.ts` — markdown-it config. `html: false` disables raw HTML to close the XSS surface (untrusted `.md` is assumed). Single source of renderer config. Wires highlight.js (core + the languages registered in this file; unregistered languages fall back to plain escaping).
  - `diff/diffEngine.ts` — word-level LCS diff returning `equal`/`insert`/`delete` ops; `O(n*m)`. `diff/diffDom.ts` renders ops to DOM.
  - `theme/themeController.ts` — OS-theme follow plus runtime mode switching. `createThemeController` switches between light/dark (fixed) and system (OS-follow), disposing the prior subscription on each change. `ThemeSource` abstracts the Tauri dependency.
  - `view/contentWidth.ts`, `view/zoomLevel.ts` — pure preset/step logic for body max-width and content zoom; values are mirrored into CSS custom properties by `main.ts`.
  - `fs/fileClient.ts` — the **IPC bridge** (see below).
- `src/ui/` — `tabBar.ts`, `preview.ts`, `toolbar.ts`, `statusBar.ts`, `overflowMenu.ts`: pure render / DOM-wiring functions driven by state + callbacks.

### Backend (`src-tauri/src/`)
- `lib.rs` builds the Tauri app: registers the `single-instance` plugin (must be **first**), the dialog and opener plugins, the `WatchManager` managed state, and the app's Tauri commands (defined under `commands/` and enumerated below). The single-instance callback captures any later launch, forwards its `.md` argv to the running window via an `open-files` event, and focuses the window (so "Send to" / file-association launches reuse the one window).
- `commands/file.rs` — `read_markdown_file` (thin wrapper over pure `read_file_content`; reads content + mtime from one handle to avoid read/stat skew).
- `commands/watcher.rs` — `start_watch` / `stop_watch`; wraps `AppHandle` in a `TauriEmitter` that bridges changes to events.
- `commands/cli.rs` — `get_launch_files` / `get_launch_theme`; pure `extract_md_paths` pulls `.md`/`.markdown` from argv (strips leading hyphens to tolerate WebDriver `--<path>` switch-style args), `extract_theme_arg` normalizes `--theme`. `extract_md_paths` is reused by the single-instance callback.
- `watcher/mod.rs` — `notify` FS-event watching with **automatic mtime-polling fallback**, debounced 150 ms. Decoupled from Tauri via the `ChangeEmitter` trait; pure helpers (`Debouncer`, `mtime_changed`) are separated for unit tests. Mutex poison is recovered, never re-panicked.
- `error.rs` — `AppError` (`thiserror`) with Japanese messages; `Serialize` emits the Display string only, never internal structure.

### IPC contract (critical when touching either side)
- `invoke` is called with **camelCase** arg keys (`tabId`); Tauri maps them to Rust **snake_case** params (`tab_id`). Rust response structs use `#[serde(rename_all = "camelCase")]`.
- `file-changed` / `watch-error` events carry **only** ids/path/message — never file content. The frontend re-reads via `read_markdown_file` on notification. The `open-files` event (single-instance) carries only a path array; the frontend opens each as a tab.
- Every Rust→JS payload is validated at the boundary with **Zod** schemas in `fileClient.ts` (runtime types are erased; never trust the wire). Mirror any payload change in both the Rust struct and the Zod schema.

## Conventions

- **Strict TypeScript**: `strict` + `noUncheckedIndexedAccess` + no unused locals/params. ESLint runs `strict-type-checked` + `stylistic-type-checked`; Prettier owns formatting. `no-non-null-assertion` is intentionally **off** — `!` is permitted only for provably-safe indexing into pre-sized matrices (see `diffEngine.ts`).
- **Immutability**: prefer new objects/spreads over mutation; keep side effects in `main.ts` / `commands/*`, not in `core/`.
- **No silent failures**: background errors surface to the user (`reportError` → dialog) or, in Rust, are logged to stderr — never swallowed.
- **Security**: CSP is set in `src-tauri/tauri.conf.json` (`script-src 'self'`, `object-src 'none'`, etc.); capabilities are least-privilege in `src-tauri/capabilities/default.json`.
- Coverage gate (80%) applies to `src/core/**` only.
