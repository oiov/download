# app/ —— Keep Video 桌面客户端（Go 核心 + Wails + Svelte 5）

新版桌面客户端，同步自上游的 Wails 实现并清理了上游的标题、Logo、作者、赞助与插件内容。
与根目录的 Electron 版（`electron/` + `src/`）**并行发布**：Electron 老用户仍走原更新通道，
新客户端产物以 `KeepVideo-Desktop-` 为前缀，安装后通过 GitHub Releases 自行更新。
`src/`、`electron/`、`backend/` 仍被在线服务（`docker/`）复用，不能删除。

## 目录

```
app/
├── main.go / app.go / bindings_*.go   Wails 入口与暴露给前端的绑定
├── internal/                          互相零依赖的 Go 包
│   ├── activity/   下载热力图的每日计数（~/.keepvideo/activity.json，保留 400 天）
│   ├── download/   yt-dlp / aria2 参数组装（含 --limit-rate 限速）
│   ├── fetch/      直链分段下载（共享令牌桶限速）
│   ├── settings/   设置读写与校验（speedLimit 上限 1048576 KiB/s）
│   ├── update/     GitHub Releases 自更新（wmlUpdate + checksums.txt）
│   └── …           deps / parse / history / cookie / jsruntime / sidecar 等
├── sidecar/        依赖探测边车 keepvideo-deps（构建时内嵌进主二进制）
├── frontend/       Svelte 5 + Tailwind v4 界面
└── scripts/        build.sh（先编边车再 wails build）、prepare-embed-dir.sh
```

## 数据位置

- 设置：系统应用数据目录下的 `Framekeep/`（与 Electron 版同一目录）。
- 下载历史、运行依赖、热力图计数：`~/.keepvideo/`。首次启动会把 Electron 版留在 `Framekeep/`
  里的 `download-history.json` 与 `runtime/bin` **迁移**过来（新位置已有文件时不覆盖），
  因此历史自动沿用；迁移后 Electron 版需要重新下载托管依赖。

## 常用命令

前置：Go（版本见 `go.mod`）、Node ≥ 22、pnpm、Wails CLI v2.16.0
（`go install github.com/wailsapp/wails/v2/cmd/wails@v2.16.0`）。

```bash
bash app/scripts/prepare-embed-dir.sh            # main.go 的 go:embed 要求 frontend/dist 存在
(cd app && wails generate module)                # 生成 frontend/wailsjs（不入库）
(cd app && go vet ./... && go test ./...)        # Go 核心
(cd app/sidecar && go test ./...)                # 依赖边车
pnpm app:check && pnpm app:test                  # svelte-check + Vitest
pnpm app:dev                                     # wails dev（带边车）
pnpm app:build                                   # 当前平台构建，产物在 app/build/bin/
node scripts/sync-changelog.mjs                  # 把根 CHANGELOG.md 同步进应用内更新日志
```

## 约定

- 产物名 `KeepVideo-Desktop-<mac-universal|windows-x64|linux-x64>-<版本>.*` 被
  `internal/update/wml.go` 的 `wmlAssetRules` 引用，改名会切断已安装用户的自更新。
- 只能用 `scripts/build.sh` 构建：直接 `wails build` 的产物没有依赖探测边车。
- 改根 `CHANGELOG.md` 后运行 `node scripts/sync-changelog.mjs`，CI 会用 `--check` 校验。
- 界面文案走 `frontend/src/lib/i18n.svelte.ts`，颜色用 `app.css` 的语义变量（有测试禁止硬编码色值）。
