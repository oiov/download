# 上游更新评估（2026-11-14）

## 检查范围与基线

- 用户授权：检查上游近期更新，核心逻辑的修复与优化按需移植，值得借鉴的同步过来。
- 当前分支 `main`：`0387a5e27778870decc677fc62a51537856c1bca`，`fix(server): 私有页面禁止 CDN 改写，修复邮箱显示为占位文字`；与 `origin/main`（`https://github.com/oiov/keep.video.git`）一致，开始时工作区干净。
- 上游 `upstream/main`：`https://github.com/yxxbc/downvid.git`，`770bd3e3bf6157f1a2dd0ccb67ea6ce2a4b31807`，2026-11-11，`chore(website): 发布后同步官网版本号与 Gitee 清单至 v1.12.0`。
- 共同祖先（最后通过祖先关系继承的上游点）：`75572cd3dc06c1a3ed2c17d3535475fe4c7f4145`。
- 上次评估点：`af5a3ef`（2026-10-24 报告，当时仍为 needs inspection）；本次上游新增 **121** 个非合并提交，期间发布 v1.7.2 至 v1.12.0。
- 按祖先关系：HEAD 独有 39 个提交，上游独有 211 个提交。这不是待移植数量。

## 架构差异（决定移植方式）

- 上游自 v1.6.0 起改为 Wails + Go 核心（`app/internal`）+ Svelte 前端，并删除了 Electron / Vue 代码；本项目保持 Electron 主进程（TS）+ Vue 渲染进程 + 同域 Web 服务。
- 两边仍直接共享的只有依赖边车 `backend/internal` 与少量 `shared/`。其余修复只能把**行为**手工移植到 `electron/` / `src/` / `docker/server/`，不能 cherry-pick。
- 结论：不做分支合并；按候选逐条手工移植，并为每条修复补对应回归。

## 产品边界

- 保留 Keep Video 品牌、仓库坐标、安装包名称、更新通道（GitHub Release + electron-updater / 自研 macOS 更新）。
- 跳过：插件系统、CLI、赞助商、Gitee / CNB 更新源与镜像、wmlUpdate、AUR、官网与发布脚本、Wails 专属的 Windows Shell / 自更新实现、依赖目录迁移到 `~/.downvid`。
- 优先：解析错误分类、Cookie 读取、依赖探测、下载进程与缓存、更新状态展示等共享逻辑缺陷。

## 候选与状态

| 上游提交 | 内容 | 结论 | 本地处理 |
| --- | --- | --- | --- |
| `8e16c98` | 扩展导出的 JSON Cookie 转 Netscape | 已移植 | `parseJsonCookies` / `toNetscapeCookies`；手动文件为 JSON 时写入临时文件，原文件不交给 yt-dlp（yt-dlp 退出时会把空 Cookie 罐写回）。另补上游未处理的 `#HttpOnly_` 前缀 |
| `72000cb` | 直连解析复用浏览器 Cookie 快照；短链缺登录态；抖音/快手 Unsupported URL 改判 | 已移植 | `browserCookieSnapshot()`（公共服务器不借用）、`classifyParseErrorForSite()`；快手直连本地不接 Cookie，未扩展 |
| `e2c159a` | 失效抖音短链直接报失效 | 已移植 | `douyinVideoIdFromRedirect()` 仅在跳到首页时下结论；`modal_id` 链接与图文页沿用原后备解析 |
| `09cae6e` | 「需要新鲜 Cookie」归为需要登录 | 已移植（分类部分） | 骨架屏、历史两段确认、禁用右键菜单属 Svelte 界面，跳过 |
| `9bf5294` | 浏览器探测要求可读 Cookie 库；macOS 提示完全磁盘访问 | 部分移植 | 只移植 macOS 提示；本地已有 10 分钟失败冷却，且 Chrome 新版 Cookie 位于 `Network/` 下，按固定路径过滤有漏检风险 |
| `af5a3ef` | 版本管理器安装的 Node / Deno | 已移植 | 上游同提交含 Electron 版，`js-runtime.ts` 无冲突整体采用，测试按增量补丁合入（保留本地品牌名） |
| `ca149f2` | aria2 临时目录按任务隔离并清理 | 已移植 | `.downvid-aria2/<taskId>`，完成后只删本任务；`--load-info-json` 本地早已接入 |
| `2ea8da8` | Windows 隐藏 yt-dlp 控制台 | 已覆盖 + 小修 | 其余子进程均有 `windowsHide`；`checkFfmpeg` 补上并加 15 秒超时 |
| `dc0a475` | 解析缓存只用一小时内 | 已覆盖 | 本地 `INFO_JSON_TTL` 为 20 分钟 |
| `d944771` | 检查更新失败不显示「已是最新」 | 已覆盖 | 本地双通道都失败时返回 `error`，界面进入失败态 |
| `7c61d61` | 开发构建误报新版本 | 不适用 | Wails 版本注入问题；Electron 版本取自 `package.json` |
| `a3228d5` | 点下载后立即显示「准备中」 | 已覆盖 | 任务进入 downloading 即显示状态文案 |
| `bbf6e9f` | 暂停立即应答、路径缓存 10 分钟 | 跳过 | 本地约定必须等进程树真正结束才确认暂停，避免续传与旧进程并发写入 |
| `9d938b2` | 歌曲识别、自动字幕、纯音频站点音质 | 有条件 | 新功能，涉及解析结果形状与界面；待产品决定 |
| `5e0bf57` | 解析/下载不走代理开关 | 有条件 | 改设置形状，需经 `readSettings()` / `updateSettings()` 与迁移测试 |
| `94778b3` | 删除/清空历史确认 | 有条件 | 纯界面，可后续随整站交互改版处理 |
| `569727d` / `fbcd88b` / `b7adf61` | yt-dlp 改 zipapp + Python 3.11 探测 | 有条件 | 解析 11s→2s 收益明显，但改变依赖形态与探测预算，需单独评估 |
| `922fedd` / `aca031e` | 数据目录迁移到 `~/.downvid` | 跳过 | 产品边界 |

## 验证

- `pnpm test`、`pnpm vue-tsc --noEmit`、`pnpm lint:docs` 等，见提交说明。
- 每条移植均做变异验证：撤销改动后对应用例失败。
- aria2 外部引擎回归需设置 `DOWNVID_TEST_ARIA2` 与 `DOWNVID_TEST_YTDLP`；本机与 CI 均未提供 aria2，该段会跳过。任务目录与清理逻辑由 `tests/ytdlp-args.test.ts` 覆盖，真实引擎续传需在装有 aria2 的环境补跑。
