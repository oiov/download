# CLAUDE.md

Guidance when working in this repository. Mirror of `AGENTS.md` (Chinese) — **keep the two in sync**.

This project has more coupling than its file count suggests: several things are **hand-maintained in
multiple places**, and missing one fails silently (no error, feature just doesn't work). Read
"Change-impact checklist" before touching anything.

---

## Commands

```bash
pnpm install
pnpm dev                    # vite dev server + electron, hot reload; also compiles the Go sidecar
pnpm vue-tsc --noEmit       # renderer/main type check (strict + noUnusedLocals + noUnusedParameters)
pnpm test                   # pure-logic unit tests (Vitest, tests/*.test.ts)
pnpm test:runtime:windows    # native Windows exe integration regression (requires Go)
pnpm test:download:integration # local HTTP/file/store integration regression
pnpm test:parse:integration # parser chain: fallbacks, round cap, cookie lifecycle
pnpm test:acceleration      # acceleration benchmark; see docs/download-acceleration.md
pnpm test:updater           # updater state machine, cache, fallback, install modes
pnpm test:settings:migration # settings defaults/merge and the "no bypass" static scan
pnpm test:package           # unpacked-artifact contents (needs a prior --dir build)
pnpm lint:ipc               # static check of the hand-maintained IPC wiring
pnpm lint:icons             # icon names must be valid (a typo renders as literal text)
pnpm lint:website           # website: bilingual pages, assets, links, SEO modes
pnpm lint:docs              # AGENTS.md ↔ CLAUDE.md parity + referenced paths/numbers exist
pnpm deps:manifest:check    # is the dependency manifest behind upstream?
pnpm build                  # vue-tsc && vite build && electron-builder (current platform)
pnpm build:mac:arm64        # also :mac:x64 :win :linux:x64 :linux:arm64
cd backend && gofmt -l . && go vet ./... && go test ./...
```

Requires **Node ≥ 22.13, pnpm ≥ 8, Go ≥ 1.24**. yt-dlp / ffmpeg need *not* be preinstalled.

No ESLint/Prettier — **do not add them** (formatting churn would swamp the history). TypeScript is
pinned to 5.x: vue-tsc can't run on TypeScript 7 (the Go port drops `typescript/lib/tsc`); Dependabot
ignores its major bumps.

### Tests

Two layers: Go sidecar (`backend/internal/*/**_test.go`) and renderer/main pure logic
(`tests/*.test.ts`, Vitest, `environment: 'node'` — deliberately no jsdom).

- Cover **pure functions only**: format selection, dependency-error parsing, yt-dlp arg assembly,
  parser shared helpers, the updater state machine.
- Do **not** unit-test anything needing the DOM or a real subprocess — type check, `lint:ipc` and
  real-app verification cover that instead.
- Target **branches that have actually broken before**, not coverage numbers.
- **Mutation-check every new test**: break the implementation, confirm the test fails.
  A test that cannot fail is worthless.
- `vitest.config.ts` is separate from `vite.config.ts` on purpose — the latter runs `go build`
  in `buildStart`, which tests must not trigger.

### CI workflow split

Tests are split into three per-platform workflows (`.github/workflows/ci-linux.yml`, `ci-macos.yml`,
`ci-windows.yml`), each with its own jobs, so a failure names the platform *and* the layer:

| job | Contents |
| --- | --- |
| `backend` | gofmt / vet / `go test -shuffle=on` / cross-compile (all 5 targets on Linux, host only on macOS/Windows) |
| `frontend` | type check / IPC contract / icon names / landing page / unit tests / updater / settings migration |
| `main-process` | Linux only: updater / settings migration / manifest check |
| `integration` | download integration / acceleration benchmark / parse integration |
| `native-runtime` | Windows only: native exe runtime-deps regression |
| `package` / `packaging` | build / pack to a directory / artifact contents / manifest & release-notes script self-checks |

For routine pushes / PRs, `.github/workflows/desktop-changes.yml` calls
`scripts/desktop-ci.mjs` to gate desktop packaging. Website-only, Docker-server-only or docs-only
changes skip the three platforms' `package` / `packaging` jobs; all other tests still run.
`src/`, `electron/`, `backend/`, `shared/`, desktop assets, dependencies and build configuration
still trigger packaging. Update the filter and `tests/desktop-ci.test.ts` when adding desktop
build inputs. Manual runs always package, detection failures conservatively package, and tagged
releases remain unchanged.

**Every new test script must be wired into all three per-platform workflows** — `test:acceleration`
was once added without CI wiring and the acceleration logic went unverified for a long time. Likewise
**`git add` a new workflow file before committing**: when the single test workflow was split into
`ci-*.yml`, the deletion was staged while the three new files were still untracked, so one
`git commit -a` would have left `main` with no CI at all (`scripts/lint-docs.mjs` checks that every
workflow named in the docs exists).

---

## Cross-platform build traps

All four have bitten us for real; the CI windows job caught them, not local macOS.

1. **`process.platform` is not `GOOS`.** Node says `win32`, Go says `windows`. Passing it through
   yields `unsupported GOOS/GOARCH pair win32/amd64`. macOS/Linux pass only because the names
   coincide — that's why local and the ubuntu/macos CI jobs are blind to it. See
   `GOOS_BY_PLATFORM` in `vite.config.ts` and `scripts/build-backend.sh`.
2. **The default shell differs.** Windows runners use PowerShell: `/tmp` resolves to `D:\tmp` and
   `test ! -s` doesn't exist. Add `shell: bash` for POSIX semantics.
3. **Line endings.** Windows defaults to `core.autocrlf=true`, so files check out as CRLF — and CRLF
   is not what `gofmt` emits, so `gofmt -l` flags **every** Go file. The repo root `.gitattributes`
   (`* text=auto eol=lf`) normalizes this. **Do not delete that file.**
4. **Path assertions.** Never hardcode `/tmp/out/...` in tests; production code uses `path.join`,
   which yields backslashes on Windows. Build expectations with `path.join`.

**Hard rule**: any new CI build/check step must first be reproduced locally under
non-host-platform semantics (cross-compile to `win32`, check out with `core.autocrlf=true`).
Validating YAML syntax is not enough.

---

## Architecture

Three components: **renderer** (Vue 3 UI), **main process** (Node — downloading, parsing, updates),
and a **Go sidecar** (detects and installs yt-dlp / ffmpeg). They talk over IPC and NDJSON.

| Path | Contents | Output |
|------|----------|--------|
| `backend/` | Go dependency sidecar | `backend/build/<platform>-<arch>/` |
| `electron/` | main process | `dist-electron/` |
| `src/` | Vue 3 renderer (`<script setup>`, Tailwind v4, Pinia) | `dist/` |
| `shared/app.ts` | **single source** of repo coordinates and external links | imported by all three |
| `tests/` | Vitest pure-logic tests | — |
| `website/` | static website (Node generation, separate language URLs) | — |
| `scripts/` | manifest generation, sidecar build, IPC / website lint, release notes | — |

Both Electron processes are built by `vite-plugin-electron/simple` from one `vite.config.ts`;
the Go sidecar comes from the `goBackend()` plugin in that same file.

### Change-impact checklist

**1. New renderer-callable main capability → three files must change together:**

| # | File | Change |
|---|------|--------|
| 1 | `electron/ipc/<domain>.ts` | `ipcMain.handle(...)`, registered from `electron/main.ts` |
| 2 | `electron/preload.ts` | `contextBridge` entry |
| 3 | `src/env.d.ts` | `Window.electronAPI` type |

`pnpm lint:ipc` cross-checks all three (registered-but-not-exposed, exposed-but-not-implemented,
declared-but-not-exposed, API-group coverage both ways).

> `src/env.d.ts` must have **no top-level import/export** — that turns it from a global declaration
> script into a module and `interface Window` stops applying. Reference dependency types inline:
> `import('./types/deps')`. A second `Window.electronAPI` in `electron/electron-env.d.ts` used to
> shadow the real one and hide broken call sites from the type checker. That file is deleted —
> don't restore it.

**2. New broadcast event (main → renderer) → four places:**

1. the send site (`broadcast('…')` / `webContents.send('…')`)
2. `electron/preload.ts` `ipcRenderer.on` returning an unsubscribe closure
3. the type in `src/env.d.ts`
4. subscribers **must call unsubscribe on unmount** (otherwise hot reload accumulates listeners)

Existing: `download:progress`, `history:updated`, `update:status`, `menu:showAbout`, `deps:progress`.
A broadcast event must **not** double as an `ipcMain.handle` channel (`lint:ipc` enforces this).

**3. Changing user settings shape → silently breaks existing users.**

Settings live in `localStorage['settings']` (**not** Pinia). Fields: `downloadDir`,
`filenameTemplate`, `preferredQuality`, `cookieMode`, `cookiesFile`, `proxy`, `depPaths`,
`acceleration` (enabled/concurrency/optional aria2c path), `autoCheckUpdate` (default on),
`autoDownloadUpdate` (default off), `language` (UI language: `'auto'` follows the system,
`'zh-CN'` or `'en-US'`; default `'auto'`).

**The only entry points are `readSettings()` / `updateSettings()` in `src/stores/settings.ts`:**

- Reads must go through `readSettings()` (it fills defaults and sanitizes `depPaths` /
  `acceleration`); `grep -rn "localStorage.getItem('settings')"` should only match settings.ts
  itself. `deps.ts`, `download.ts` and `DownloadView.vue` each used to carry their own copy, which
  is how `filenameTemplate` ended up with two different defaults
  (`%(title)s` vs `%(title)s.%(ext)s`)
- Writes must go through `updateSettings(patch)` — a raw `setItem` overwrites everything and wipes
  other components' fields (real incident: one "Save" in the settings panel erased `depPaths`)
- **Removing or renaming a field is a MAJOR change** (see `docs/release.md`)
- Update `src/components/SettingsView.vue` and `src/components/DepPanel.vue` too
- `scripts/test-settings-migration.mjs` enforces the above, including the "no bypassing" scan

**4. Runtime dependencies (yt-dlp / ffmpeg / ffprobe):**

- New dep kind → `backend/internal/runtime` (`Kinds`/`Optional`/candidates) + `DepKind` in `src/types/deps.ts`
- Source or version change → only edit the asset table in `scripts/gen-deps-manifest.mjs`, then
  `pnpm deps:manifest`. **Never hand-edit** `assets.gen.go` (generated)
- New platform → manifest asset table + `electron-builder.json5` + `release.yml` matrix
- The `[[deps-missing:<kind>]]` marker is a contract between `electron/utils/binary.ts` (produces)
  and `readMissingKinds` in `src/stores/deps.ts` (parses) — covered by `tests/deps-error.test.ts`

**5. Changing release artifacts → cuts off auto-update for existing users.**

Names are referenced by older clients' `latest*.yml`. Renaming `Keep Video-Setup-*`,
`Keep Video-Portable-*`, `Keep Video-<arch>-Mac-*`, `Keep Video-x86_64-Linux-*` breaks every installed copy.
`lint:ipc` checks the `artifactName` entries. Linux uses `amd64`/`x86_64`, not `x64`.

**6. Repo coordinates / links** live only in `shared/app.ts` (main re-exports via
`electron/constants.ts`). `electron-builder.json5`'s `publish` is build-time config that runtime
can't read — `lint:ipc` cross-checks it. Moving repos means editing `shared/app.ts` + `publish` +
workflow references, all three.

### 7. 产品官网（website/）

官网现在使用无第三方依赖的 Node 静态生成器，中文与英文拥有独立 URL。
用户授权的 SEO 重构替代原先单文件与官网配色同步约定；桌面应用主题保持独立。

- 内容：`website/content.mjs`；品牌、域名与发布状态：`website/config.mjs`。
- 生成：`scripts/build-website.mjs`；预览：`scripts/serve-website.mjs`。
- 运行 pnpm website:build、pnpm lint:website；部署输出目录为 website/dist。
- SITE_URL 或配置中的 origin 为空时输出 noindex、空 sitemap，不输出占位域名。
- Vercel 预览及 SITE_PREVIEW=1 始终 noindex；生产 URL 统一尾斜杠。
- 九语言正文、canonical、hreflang、站点地图、内链必须一起维护。
- 资源放 website/assets，不依赖原仓库 raw URL；不编造评分和下载量。
- 新仓库发布安装包后才把 releaseAvailable 改为 true；上游下载入口必须标注来源。
- 详细发布和维护流程见 `website/README.md`。

### Runtime dependencies (yt-dlp / ffmpeg)

**The installer ships no binaries** (was ~80 MB per arch, and Git LFS pushed the repo past 800 MB).
A Go sidecar resolves them at startup, "prefer the machine's own, download only if missing":

1. Paths set manually in settings (`localStorage['settings'].depPaths`) — **detection only**
2. `userData/runtime/bin/` (Keep Video-installed, safe to overwrite)
3. login shell `PATH` (GUI apps get a stripped `PATH`, so this step is essential) + per-platform
   common install dirs
4. bare command names, left to `PATH`

- Sidecar has two subcommands, `detect` and `fetch`. **stdout carries NDJSON only; logs go to
  stderr** — Electron parses stdout line by line, so a stray log line breaks parsing.
- Go standard library only: it's cross-compiled into five binaries shipped in the installer, so
  auditability wins over convenience. Think twice before adding a third-party dep.
- gzip artifacts are verified **as downloaded** (hash of the compressed file), then extracted.
  Writes go to `.part` and are atomically renamed — a failure never leaves half an executable.
- macOS install must `xattr -c` + `codesign --force --sign -`: network-downloaded executables carry
  quarantine and Apple Silicon kills them outright (`killed: 9`).
- URLs in error messages get their query string stripped — GitHub's signed JWT is hundreds of
  characters and would swamp the UI.
- `electron/utils/runtime.ts` locates the sidecar (packaged: `resources/downvid-deps/`), runs it,
  caches detection 60 s, broadcasts `deps:progress`. Downloads run in main, so closing the window
  doesn't abort them. `electron/ipc/deps.ts` exposes
  `deps:status/check/download/cancel/openDir/diagnostics`.
- Detection has an 80 s total budget (90 s on the Electron side), 45 s per dependency. Candidate
  execution budgets **differ by source**: 15 s for the managed copy, 5 s for system copies. Scanning
  has its own 18 s budget. Windows directories honor actual environment variables; downloading is
  only needed when no usable copy is found. **Do not shrink these numbers casually**: yt-dlp's
  official macOS build (PyInstaller, ~37 MB) takes 8–10 s here for `--version`, and up to 12.4 s on
  its first run, while Homebrew / uv ship a Python zipapp that answers in 0.2 s. Below 15 s the
  **freshly downloaded managed copy is judged "execution timed out, file may be corrupt"**, so the
  UI keeps showing "Download" after a successful download (this really happened). Conversely system
  copies must **not** get a long budget: the candidate list can hold a dozen paths and one hung copy
  at 15 s each drags a single detection out to minutes (the Windows CI job caught exactly that).
  Each number has a **single source of truth** — never restate it elsewhere: total budget
  `rt.DetectTimeout`, per dependency `probeTimeLimit`, candidates `probe.CandidateTimeout` /
  `probe.SystemCandidateTimeout`, scanning `scanTimeLimit` (all under `backend/internal/`). The
  Electron side only owns the 90 s `runSidecar` timeout and **must not pass `--timeout`** (it used to
  hardcode 70, silently overriding the 80 s Go default).
- `cmd.WaitDelay` in `probe.run` **must stay**: on timeout only the direct child is killed, but
  candidates may be shell scripts or PyInstaller launchers whose grandchild still holds the stdout
  pipe, so `cmd.Run()` waits on I/O forever. A `sleep 300` fake binary turned a 5 s budget into
  300 s in a real measurement.
- `resolveDependency()` in `electron/utils/binary.ts` is the single entry point; on failure it throws
  `MissingDependencyError` carrying a `[[deps-missing:<kind>]]` marker the renderer turns into a
  one-click download prompt (same trick as the cookie hint's `\n\n提示：`).
- **Manual paths only affect detection**; `fetch` ignores them, so a user's own install is never
  overwritten.
- `pnpm deps:manifest` (or the `Update dependencies manifest` workflow) refreshes
  `assets.gen.go`. A stale manifest or hash mismatch shows up as "download then checksum failure" on
  user machines, hence `deps:manifest:check` in CI. ffmpeg-static has no published checksums, so the
  script downloads each gzip to hash it (~130 MB of traffic).

### Parse dispatch (`ytdlp:parse`)

Douyin and Kuaishou have bespoke parsers: platform API first, headless `puppeteer-core` (launched via
`electron/utils/browser.ts`) driving a *system-installed* Chrome/Edge as fallback. Every failure is
swallowed by an empty `catch` and falls through to `parseWithYtdlp`. When debugging a parse bug, check
which branch actually ran — the errors are invisible.

### Download has two entirely separate paths

Implementation lives in `electron/download/`; `electron/ipc/download.ts` only dispatches.

- **`direct.ts`**: `directUrl` present (Douyin/Kuaishou only) → `fetch` and a small-block queue,
  8 workers by default (maximum 16). HTTP 429/503 reduces concurrency; segments resume from their written offsets.
  `.part.json` checkpoints accept legacy four-segment layouts and survive connection-setting changes.
  Pause via an `AbortController` in `activeDownloads`. This path exists because those CDN URLs expire
  fast and going through yt-dlp would re-hit the platform API for a different URL.
- **`ytdlp.ts`**: `spawn(yt-dlp)`, using `--load-info-json <parse cacheFile>` when the parse is
  < 20 min old (falls back to the URL if it fails before downloading starts). Progress comes from
  `--progress-template` lines prefixed `[dvp]` (stdout) / `[dvpp]` (postprocess — **stderr** under
  the quiet mode `--print` implies); video/audio final paths come from `--print after_move`.
  Subtitle-only downloads must use `--print after_video` for converted subtitle paths:
  `--skip-download` skips `after_move`, otherwise files are created but the returned path is empty. Format selector,
  audio-only, subtitle-only and YouTube multi-audio-track are assembled in `buildYtdlpArgs`.
- **`progress.ts`**: shared broadcast + throttle (≤1 IPC per 200 ms per task). Progress formatting is
  defined here only — don't duplicate it.

`buildYtdlpArgs` is a **pure function**: paths and JS runtime arrive via `BuildArgsContext`, so arg
lists can be asserted without spawning anything (`tests/ytdlp-args.test.ts`).

Optional aria2c (>=1.36) is detected by `electron/download/aria2.ts` via manual path, PATH,
Scoop/WinGet and common install paths. It is neither auto-installed nor a required runtime dependency.
Only HTTP transfers use it; HLS/DASH stay native. Temporary pieces live under `.downvid-aria2`
and a paused task keeps its selected engine, preventing sparse pieces from being treated as sequential data.
The `acceleration` settings field contains enabled/maxConnections/aria2Path.

Formats are built by the pure `electron/parsers/formats.ts`. Three regressions it guards (all
tested): keep formats without `vcodec` (X/Twitter mp4 has none), keep m3u8 only for heights with no
direct link, and offer a `bv*+ba/b` fallback when nothing reports a height.

Pause uses `electron/download/process-tree.ts`: a dedicated POSIX process group or Windows
`taskkill /T /F`. Remove the active entry only after the whole tree and download call have stopped.
A failed stop keeps the task, files and queue slot; it must not permit resume or removal.
Resume re-spawns and continues from the `.part` file. **No cross-restart resume.**

- Exit and update installation call `stopAllDownloads()`; success keeps the start gate closed.
  Only a failed installation calls its returned release function, including installer error events.
- `shared/download-filename.ts` adds a format suffix only for new video tasks. Each task fixes its
  own template; legacy tasks keep their old names so partial files remain resumable.
- `electron/parsers/info-cache.ts` caps the cache at 100 entries / 30 minutes, using a private
  directory and random JSON filenames. Queued and running Web jobs retain references; eviction
  deletes files only after the last reader releases them. Process exit cleans all remaining files.
- `electron/utils/atomic-file.ts` provides same-directory atomic replacement. Corrupt desktop
  history is backed up first; read or backup failures must not overwrite the original records.

### Task-level concurrency gate (`src/stores/download-rules.ts`)

**At most 3 tasks run at once** (`MAX_CONCURRENT_DOWNLOADS`); the rest stay `pending` in the queue.
`pumpQueue()` is the single enforcement point: `startDownload` / `resumeTask` / `retryTask` all funnel
through it, the pure `selectStartableTasks()` decides who starts, and a finishing task frees its slot
and refills the queue.

- **Never call `processDownload()` directly** — that's the low-level "start this one task" entry, and
  bypassing it breaks the limit. `isDownloading` cannot stop rapid clicking: it's reset to `false`
  synchronously inside `startDownload`.
- Without this gate, clicking "Download" a few times starts several tasks at once, each opening 8–16
  block requests that **compete for bandwidth** (every task gets slower — hard to attribute), and
  site 429s get likelier.
- `merging` occupies a slot too (ffmpeg competes for CPU and disk); `paused` / `error` / `completed`
  release their slots only after the old download call has fully settled.
- Scheduling is by ascending `createdAt` (FIFO), otherwise the queue looks broken.
- Failed tasks can be **retried** (`retryTask`, reset rules in `retryReset()`): it must return to
  `pending` to be rescheduled — staying on `error` makes "Retry" look like it does nothing.

### yt-dlp environment quirks

- `--ffmpeg-location` takes a **directory**, not a file: yt-dlp looks for both ffmpeg and ffprobe
  there, which is what makes a managed-dir install work.
- YouTube needs an installed Node / Deno; `checkJsRuntime()` in `utils/js-runtime.ts` must never return the Electron binary.
  It probes asynchronously, requiring Node >=22 / Deno >=2.3, with a six-second total budget and one second per candidate.
  It checks WinGet, Scoop and the user's `.deno/bin` as well as PATH
  so a GUI process with an old PATH can still find the runtime. The sidecar does not install JS runtimes.
- YouTube parsing keeps yt-dlp's default clients. Format/page-reload errors each allow one fallback, at most three rounds.
  Retries share one Cookie lifecycle; downloads reuse successful client arguments and the UI displays a recovery notice.
  `shared/parse-error.ts` emits only categories and validated versions; Issue drafts exclude raw output and environment details.
- **Subtitle mode doesn't need ffmpeg** — it isn't resolved, and no `--ffmpeg-location` is passed.
- Cookies go through `utils/cookies.ts` `runWithCookies`: manual file → none, or (auto) each installed
  browser → snapshot `userData/ytdlp-cookies/browser-cookies.txt` → none. It only moves to the next
  source on a cookie *load* error (`isCookieError`), never on auth errors; an exception while
  preparing a source only skips that source. Downloads prefer a fresh (<30 min) snapshot to match the
  parse. Read failures append a `cookieFailureHint` after the `\n\n提示：` marker, which the renderer
  splits into the error modal's `hint`.
- **Never create anything in `userData` whose name case-insensitively matches a Chromium file**
  (`Cookies`, `Network`, `Preferences`, `Local Storage`…): macOS/Windows filesystems are
  case-insensitive (issue #31 — `userData/cookies` hit `EEXIST`).

### State

| State | Where |
|-------|-------|
| Download queue / selection / orchestration | Pinia `src/stores/download.ts` |
| User settings | **not** Pinia — `localStorage['settings']` |
| Download history | main process, `userData/download-history.json`, merged by local file path, capped at 100, rebroadcast on change |
| Runtime dependencies | Pinia `src/stores/deps.ts` |

- Deps UI: `src/components/DepPanel.vue` (settings section) and `DepsPrompt.vue` (download prompt).
  The "Update" button **must** go through `isOutdated()` (comparing `version` against
  `requiredVersion`) rather than checking `managed` alone — the latter showed "Update" even when the
  installed version already matched the manifest, so users re-downloaded 37 MB for nothing
  mounted in `App.vue`).
- No router. `App.vue` `v-show`s views; navigation uses `window` CustomEvents (`tab-changed`,
  `navigate-to-settings`).
- The updater state machine is `src/composables/useUpdater.ts` (extracted from `UpdateModal.vue`).
  Two easy-to-miss points are documented there: IPC return values and `update:status` broadcasts are
  **two sources that both need handling**, and an error while downloading must be classified as the
  download phase or the retry button jumps back to "check".

### UI conventions

- Avoid unnecessary secondary labels and descriptions. Let the layout do the explaining.
- **All UI strings go through `t('key')`** (`src/i18n/`); never write a literal. `pnpm lint:i18n`
  scans `src/` and rejects hardcoded Chinese. Three easy traps:
  - `t()` reads a reactive `ref`, so **never call it at module top level** — language switches would
    not re-render. Use `computed(() => t('...'))`, or `get label()` for list items.
  - A new key must be added to **both** `zh-CN` and `en-US` with the same placeholder set
    (`lint:i18n` checks both directions).
  - Main-process (`electron/`) error strings are hardcoded Chinese and cannot see the renderer's
    locale; `src/i18n/main-messages.ts` maps known originals to keys and passes unknown text through.
  - **Protocol markers must not be translated** (translation breaks the match): `未找到可用的`
    (matched by `readMissingKinds`), `需要登录` (`friendlyDownloadError` keyword), `\n\n提示：`,
    `更新内容`.
- **Tailwind v4**, CSS-first — no `tailwind.config.js`. Material-3 semantic tokens
  (`bg-surface`, `text-on-surface-variant`, `surface-container-high`, …) are defined in `src/style.css`
  `@theme`. **Use tokens, not raw hex.**
- `@custom-variant dark` is declared but nothing ever toggles the class — there is **no dark mode
  toggle**; don't claim otherwise in docs.
- Icons: generic ones via `src/components/icons/MaterialIcon.vue` (Material Symbols). **Brand icons need
  a dedicated SVG component** (e.g. `GitHubIcon.vue`) — don't substitute a generic Material glyph (a
  `code` chevron was previously standing in for the GitHub mark).
- Most `window.electronAPI` call sites use optional chaining (`?.`) because module-level calls can run
  before preload finishes. Keep that habit.

---

## Release

Bump `package.json` → add a `## [x.y.z]` section to `CHANGELOG.md` → push tag `v*` (or run
`release.yml` manually with a `version` equal to `package.json`'s; the workflow creates the tag).

`release.yml` builds 5 arch targets (each job installs only Go + Node — no binaries are checked in),
then regenerates every `latest*.yml` from the **final artifacts** via
`scripts/gen-update-manifests.mjs` (per-job manifests would overwrite each other).

Release body is generated by `scripts/gen-release-notes.mjs`: clickable download badges on top, and
links are built from **scanned artifacts** so they can't 404. Re-test it against fake artifacts after
editing the template.

Artifact names are what old clients' updater manifests point at — don't rename them.

### A pushed tag is not a published release

**Verify the tag ↔ Release pair.** This really happened: the `v1.3.5` tag was pushed and the
CHANGELOG updated, but the `Build & Release` run was **cancelled after 3 minutes**, so there was no
GitHub Release for it and the updater channel (`/releases/latest`) still pointed at v1.3.4 — the fixes
in that version **could never reach any user**. Nothing signals this: the tag exists, the CHANGELOG
entry exists, `package.json` is bumped; only the Releases page is one entry short, which is the least
noticeable place of all.

- `pnpm verify:release` (`scripts/verify-release.mjs`) checks a tag really has a Release with the
  `latest*.yml` manifests for every platform. `release.yml` runs it once at the end.
- `.github/workflows/release-audit.yml` is a **daily audit independent of the release flow**: it only
  looks at the outcome (newest tag ↔ Release) and opens a `release-audit`-labelled issue on mismatch.
- During local development it is normal for the version to equal the published one; **don't bump the
  version early just to make `verify:release` pass.**

### Unreleased work goes in `[Unreleased]`

With no release planned, keep `package.json` at the **latest published version** and accumulate changes
under `## [Unreleased]`. When releasing, rewrite it to `## [x.y.z] - <date>` and bump the version.

---

## Gotchas

- `electron/main.ts` has one `commandLine.appendSwitch('disable-gpu-sandbox')` — a macOS Tahoe +
  Electron crash workaround. **Don't remove it.**
- The app menu (`electron/menu.ts`) is registered **only on macOS**: on Windows/Linux Electron
  renders it as an in-window menu bar on top of the custom header (`titleBarStyle: 'hidden'`), which
  users saw as a stray tab strip.
- Updates live in `electron/updater.ts` (IPC in `ipc/app.ts` just delegates). Windows/Linux use
  electron-updater with `autoDownload = false`; macOS is unsigned so Squirrel can't work — it
  downloads the arch zip, verifies sha512, strips quarantine, ad-hoc signs, and a detached bash script
  swaps the `.app` after quit (with rollback). Unsupported installs (tar.gz, Windows portable, running
  from DMG) get a GitHub-API check and a "go to releases" button. electron-updater uses its own
  session partition, so `app:setProxy` sets the proxy there too.
- Main logs to `userData/downvid.log` (5 s heartbeat); Settings reads the last 500 lines via
  `app:getLog` — the fastest way to diagnose a packaged-app crash.
- All UI strings, comments and commit bodies are **Chinese** — match that.
- Branch names `feat/…` `fix/…` `docs/…` `chore/…`, Conventional Commits. `main` is **not** protected;
  the maintainer pushes directly. PR conventions are advice for outside contributors.
- `AGENTS.md` (Chinese) and `CLAUDE.md` (this file) are the same knowledge in two languages —
  **changing one means changing the other.**


## 单站点服务器模式

- scripts/build-website.mjs 生成 144 个 SEO 页面，docker/web/ 构建工具，docker/server/ 同域托管；/app/ 和 /api/ 不覆盖门户。
- pnpm build:web 构建两份产物；pnpm test:web 验证会话、私有文件与路由，三个平台 integration job 均运行。镜像工作流 .github/workflows/docker.yml 替代 Worker 部署。
- STORAGE_DRIVER=local|r2 选择存储；R2_ENDPOINT、R2_BUCKET、R2_ACCESS_KEY_ID、R2_SECRET_ACCESS_KEY 仅服务端读取。R2 仍需本地工作目录与持久化业务数据库。详见 docs/server-deployment.md。
- 服务端负责全局队列和匿名会话隔离，不能公开桌面管理 IPC；仅接受服务端解析出的格式。成品经 /api/files/:id 授权交付。

- 在线页默认英文 /app/，中文 /zh/app/，其余语言与 shared/site-locales.json 一致；旧 /zh-cn/ 永久跳转到 /zh/。公开说明与表单共用导航，HTML 可索引，私有 /api/ 保持 noindex。浏览器额外七语词条位于 src/i18n/web-locales.json，账户页面七语词条位于 src/i18n/account-locales.json（管理后台专用词条回退英文），新增键须同步并通过 lint:i18n。

- Web 队列以真实下载调用收尾为释放槽位和删除目录的依据，不能只看 paused/error 状态。停止服务必须等待下载、上传及正在解析的请求。
- 容器使用清单生成器提供的 `YtDlpTag` 与 `YtDlpZipappSHA256`，下载校验后才能执行；保留非 root、发行版 ffmpeg 和 local/R2 存储，不引入上游品牌或架构迁移。
- 非本地站点启用统计时必须显式设置 ANALYTICS_ENVIRONMENT；报表遇到环境筛选空数据须提示，不自动改写历史记录。
- `docker/server/quota.ts` 使用业务 SQLite 事务检查并预留滚动解析／下载额度，提交后才能执行；重连、取消和删除任务不返还额度，幂等重放不得重复扣额。数据库或旧清单损坏保留原件并拒绝启动，不可依赖尽力记录的统计作为额度账本。
- 真人验证使用 verification-required，与 authentication 分开；相同会话的受限链接冷却，不做绕过来源权限的重试。新错误词条仍须同步九语言。

- Web 使用 Node 22.13+ 内置 SQLite：`docker/server/state.ts` 保存会话、逐条任务及额度；`docker/server/analytics-store.ts` 使用独立统计库，故障不得阻断下载。数据库放本地持久化卷，不能放 R2／共享网络盘；当前仍只支持单实例调度。
- 旧业务 JSON 在同一事务中一次性导入，旧统计 JSONL 按文件与行号幂等导入；保留原件，原始统计仍按保留期清理。迁移后不双写 JSON，降级到旧文件版必须恢复同批次卷备份，不能只换镜像。热备不得仅复制主数据库而丢掉 WAL。
- `docker/server/analytics-reader.ts` 使用只读快照、SQL 去重与关联实体查询；不得只按报表窗口截断跨日终态或更早起点。`scripts/test-web-sqlite.mjs` 已并入 pnpm test:web，三个平台现有 integration job 均执行；新增测试仍须做变异反证。
- Web 账户由 `docker/server/auth.ts` 使用 Better Auth 与业务 SQLite 提供，Google 登录可选；匿名下载继续可用。`platform-store.ts` 将访客映射到稳定主体，任务认领必须由当前已验证访客确认，并在事务中迁移任务和用量、撤销旧访客访问，不能按任意 guestId 认领。会话、Key 和账户状态须在请求、事件发送及连接复核时校验。
- 登录入口使用原页弹框，成功进入受保护的 `/dashboard`；普通用户与管理员共用面板布局，只有管理员侧栏显示管理模块，页面与接口仍逐次鉴权。管理员入口为 `/admin`，原 `/see` 跳转 `/admin/analytics`；旧密码登录已删除。`ADMIN_USER_IDS` 显式绑定稳定账户，邮箱引导授权首次绑定后不得转授新主体；普通下载 Key 不授予管理权。用户列表和详情展示任务次数、成功成品字节和交付流量，不展示视频地址、标题、路径或凭据。所有管理响应禁缓存、禁索引，不加入公开导航或 sitemap。
- 下载聚合继续由 `see-report.ts` 的独立只读 CLI 生成；用户和运行诊断通过 `admin-reports.ts` 的只读有时限子进程查询。保留单查询并发、有界缓存和停服等待，不开放任意 SQL、路径或原始数据库。`src/i18n/see.ts`、`src/i18n/account.ts` 为独立词条，不引入私有页面遥测。
- `/api/v1/` 内测、网页共用任务服务与主体额度；Key 只存散列、明文仅创建时显示。任务、次数／字节预留与账户范围幂等记录须同事务提交；文件交付校验归属、期限和 scope，保留 Range。业务用量不会随文件过期删除；中断交付保留未确认预留，不能靠重启恢复流量额度。
- Stripe Checkout／Portal 仅在服务端配置完整时启用；签名通知防重放并重新读取上游当前订阅，支付返回页不能直接授予权益。凭据只留服务端，MCP 本轮不实施。迁移、额度、权限与支付配置见 `docs/accounts-and-billing.md`；`scripts/test-web-accounts.mjs` 和服务端／Web 类型检查并入 pnpm test:web，沿用三平台 integration job，新增安全分支须有变异反证。

- 按用户授权新增 `/admin/downloads` 全站下载历史与详情，允许管理员查看标题和清洗后的公开来源链接；不展示凭据、签名查询串、服务器路径或原始错误。`download-history.ts` 独立迁移并与任务原子保存，认领同步归属，文件清理不删历史；`DOWNLOAD_HISTORY_RETENTION_DAYS` 默认 90 天。环境变量完整模板和填写说明见 `docker/.env.example` 与 `docs/environment-variables.md`。
