# keep.video 搜索优化方案

依据：2026-10-14–10-26 的 GSC 导出、哥飞 SEO Agent 的三轮分析，以及本仓库对 `website/dist`、`docker/web`、`docker/server` 的实测核对。

本文只写**这个代码库能改的部分**；外链建设、媒体投放等站外工作单独列在第五节，不混进技术任务。

---

## 一、先纠正一个前提

Agent 的核心建议是「把工具搬进 `/youtube-video-downloader/`，别跳到 `/app/`」。方向上对，但**照做得先改三处基础设施**，否则页面会静默坏掉：

1. **会话 Cookie 只在 `/xx/app/` 下发。** `docker/server/index.ts:75` 用 `isWebPage()` 判断，而它只认 `/app/`、`/zh/app/` 这类路径（`shared/web-routes.ts:4`）。工具放到别的路径上，`keep_session` 不会创建，WebSocket 握手 `verifyClient` 直接 403，用户看到的是"连不上"，日志里不会有人管。
2. **语言解析绑定在 `/app/` 路径上。** `src/main.ts` 用 `webLocale(location.pathname)?.appLocale` 定语言，不在 `/app/` 就退化成 `en-US`。放进 `/pt-br/youtube-video-downloader/` 会渲染出英文界面——正好废掉我们最该打的市场。
3. **工具包不小。** `docker/dist-web/entry.js` 268 KB（gzip 84 KB）+ `main-*.js` 176 KB（gzip 51 KB），合计约 **135 KB gzip**。嵌进 45 个平台页，等于每个内容页都付一遍这个代价。

**所以采纳它的意图，不采纳它的落点**：把 `/app/` 本身做成钱页（它才是唯一带工具、带会话、带语言解析的页面），平台内容页负责导流并带上预填。下面 P0 就是这么拆的。

---

## 二、实测现状（这些数字决定了优先级）

| 事实 | 数值 | 来源 |
| --- | --- | --- |
| 总页数 | 117（13 页 × 9 语言） | `website/dist` 实际生成 |
| `/youtube-video-downloader/` 全文 | 486 词，**0 个输入框、0 个 `<script src>`** | 实测 HTML |
| 平台页之间的重复 | 36 句中 **24 句与 TikTok 页完全相同（约 68%）** | 句级对比 |
| 平台页站内入链 | 每页 **2 条**（首页平台条 + 指南目录） | 全站链接统计 |
| `/app/` 站内入链 | 23 条（导航、页脚、各页 CTA） | 同上 |
| `/app/` 静态出链 | 仅 2 条：`/download/`、`/guides/` | 实测 HTML |
| 首页 H1 | `Some moments. Yours to keep.`——无关键词 | 实测 |
| 首页出现 "save video" | 只在 meta description、og、JSON-LD 和一张指南卡里，**正文标题里没有** | 实测 |
| 平台页结构化数据 | `Article` 无 `datePublished` / `dateModified`，页面正文却写着 "Updated October 18, 2026"；无 `FAQPage` | 实测 JSON-LD |
| `og:type` | 平台页是 `website` 而非 `article` | 实测 |

加上 GSC：品牌词排 3.3 / CTR 18.2%，`/app/` 334 曝光只拿到 7.2% CTR。**这不是权重问题，是标题没接住意图 + 有工具的页面没内容、有内容的页面没工具。**

---

## 三、分阶段方案

### P0｜把 `/app/` 做成真正的落地页（1–2 天）

全部改动集中在 `website/online.mjs`、`scripts/build-website.mjs` 的 `onlineApp()`，不引入新路由。

**P0-1 标题保持平台中立，只补限定词**

`/app/` 是唯一服务八个平台的页面，也是 canonical 工具 URL。它的标题**不能**写成 `YouTube Video Downloader Online`——那会把 `/youtube-video-downloader/` 的词抢过来，两个页面争同一查询，Google 只留一个。

正确做法是让 `/app/` 停在平台之上，只补掉"泛词没胜算"的问题：

- `title`：`Online Video Downloader — Save Any Link in Your Browser | Keep Video`
- `h1`：`Online Video Downloader`
- 首段保留现有一句话，其后补一句自然包含 "save video" 的说明（一次即可，不堆砌）

词与页的归属必须一页一词，否则谁都不稳：

| 查询 | 归属页 |
| --- | --- |
| keep video 系列品牌词 | `/`（H1 不动） |
| online video downloader（201k 泛词） | `/app/` |
| save video（22.2k） | `/save-video/`（P2 新建） |
| youtube video downloader online（6.6k） | `/youtube-video-downloader/` |
| tiktok 等平台词 | 各自平台页 |

`lint:website` 的"在线/桌面"双定位词检查**只作用于 `-video-downloader/` 平台页与 `/guides/getting-started/`**，`/app/` 的标题除唯一性外不受约束（原稿写成"新标题必须带 online 和 desktop"，已按实际代码更正）。

**P0-2 页内补三块模块（这是 agent 提的"结果留得住"，我按可测性重排）**

1. **格式对照表**：MP4 / MP3 / SRT × 常见清晰度，并保留现有"高画质需要音视频合并"的解释。纯 HTML 表格，无 JS。
2. **平台支持表**：八个平台逐个链到 `/youtube-video-downloader/`、`/tiktok-video-downloader/` 等（顺带补上 X/Twitter——它现在在首页平台条里指向 `/app/`，是唯一的断链式不一致）。静态出链从 2 条增加到 10 条以上，这是"人均页数"最便宜的抓手。
3. **FAQ 扩到 7 条**：`/app/` 现在已经有 3 条问答和 `FAQPage`（`onlineFAQs` 与首页共用，`build-website.mjs` 的 `slug === 'app'` 分支在生成），缺的是长尾覆盖。补 4 条针对在线工具的具体问题——能否下载私人视频、文件保留多久、画质上限、是否需要安装——扩 `onlineFAQs` 数组即可，九种语言都要补词条。

**P0-3 平台页 → 工具页带预填**

平台页保持内容页定位，但把 `Use online` 的跳转从 `/app/` 改成 `/app/?url=<当前示例或空>`，并在 `src/components/UrlInput.vue` 增加：仅 `isWeb` 且存在 `?url=` 时预填输入框（不自动发起解析，用户仍点一次）。这样从内容页到工具页只掉一层，且不需要改会话、语言、打包任何一处。

**P0-4 顺手修结构化数据**

- 平台页与指南页 `Article` 补 `datePublished` / `dateModified`（与页面可见的更新时间同源，写进 `website/content.mjs` 与 `website/platforms.mjs` 的字段，不要在模板里硬编码日期）。
- 平台页 `og:type` 改 `article`。

**验收**：`pnpm lint:website` 全绿；`pnpm test:web` 全绿；`curl -s https://keep.video/app/` 能看到新标题、格式表、平台表、FAQ 与 `FAQPage`；GSC 观察 14 天后看 `/app/` 的 CTR 是否离开 7.2%。

---

### P1-0｜把工具做成可嵌入组件（不是路由问题）

目标是让任意页面都能放工具。**不需要 TanStack**：本站 117 页是预渲染静态 HTML，canonical / hreflang / sitemap 全由生成器产出，引入客户端路由等于给 URL 造第二套真相；而工具本身只有一个视图，没有路由可管。数据层也不是 HTTP——`docker/web/bridge.ts` 用 WebSocket RPC 模拟 `window.electronAPI`，全文只有一处 `fetch()`（取文件前 HEAD）。TanStack Query 的缓存与失效模型在这里没有对应物。

"抽成组件"其实已经做完了：工具就是 `DownloadView.vue`，`App.vue` 只是外面套了 Header / History / About。真正要做的是一个**不套 Header 与标签页的 slim entry**，外加四处解耦：

| # | 位置 | 现状 | 改法 |
| --- | --- | --- | --- |
| 1 | `scripts/build-website.mjs` 的 `shell()` | `id="app"` 与 `data-runtime="web"` 只写给 `/app/` | 改成按页面配置输出挂载点与入口脚本 |
| 2 | `docker/server/index.ts:75` | `isWebPage()` 只认 `/xx/app/`，别的路径不发 `keep_session`，WebSocket `verifyClient` 直接 403 | 会话下发改为按「导入了工具的页面」集合判断 |
| 3 | `src/main.ts` | 语言从 pathname 解析，非 `/app/` 退回 `en-US` | 改读 `document.documentElement.lang`——每页本来就是对的（`/pt-br/app/` 实测为 `pt-BR`），比解析路径干净 |
| 4 | 包体 | 工具 135 KB gzip，每个内容页都付一遍 | 入口改 `import()`，hover / 进入视口时才加载 |

**顺序**：先做 3（改动小、无副作用），再做 4（决定能不能铺开），最后 1 + 2 同批上线——只改生成器不改服务端，页面上的工具会静默连不上。

**第一个使用方是 `/youtube-video-downloader/`**：`youtube video downloader online` 的 SERP 十个位置全是独立工具站、没有平台固定位，纯内容页打不进去。

**首页也放工具**已按“只有输入框、解析前导到 `/app/`”落地（2026-11-14）：首屏表单以 GET 跳转 `/app/?url=…`，由 `shared/web-prefill.ts` 校验后预填并清理地址栏，首页本身不消耗 `docker/server/quota.ts` 的解析额度；`app-section` 改为纯 HTML 的浏览器样机示意。

### P1｜修内容重复与内链孤岛（2–3 天）

**P1-1 五个平台页去重**

现状 68% 句子共享，主要来自两段模板化的："安装并准备工具"和"解析失败时怎么做"。45 个页面（5 × 9）里大半是同一段话，这正是 agent 提到的"已抓取但未编入索引"最可能的成因，也是外链做起来以后最先反噬的地方。

做法：这两段合并为一段跨页共用的短说明（或搬进指南页，平台页只留一跳），把省下的篇幅换成**只属于该平台的实测细节**——标题、H1、描述已经分化过了，正文没有。每页正文目标 350–450 词且互不重复。

**P1-2 平台页互相链接**

平台页的 `related` 现在只指向 `getting-started`、`troubleshooting`，彼此之间零链接。改成"同组相关平台 + 一两篇指南"，把 5 个页面的入链从 2 提到 6–8。这是把首页权重分下去最便宜的手段，也是唯一能靠代码解决的"98 个孤岛"问题。

**P1-3 葡语优先，但不是删语言**

Agent 建议"五个语言收成一个"。**不采纳这个动作**，理由：九语言的 canonical / hreflang / sitemap 已经互相咬合，删语言等于大面积改 URL 与重定向，风险远大于收益，而且品牌词在巴西已有 41 次点击。可执行的部分是：优先审校 `/pt-br/` 的首页、YouTube 页、在线工具与错误提示——这件事已经写进 `docs/growth-and-developer-roadmap.md` 的 P1-01，本方案不重复立项，只是把它和本次改动排在同一批。

**验收**：`/pt-br/youtube-video-downloader/` 现有 321 曝光排 39.3，改完后 30 天看排名与曝光；平台页两两句级重复率降到 30% 以下（可用本次的对比脚本复核）。

---

### P2｜新建 `/save-video/` 落地页（1 天 + 翻译）

**结论：品牌词与需求词必须共存，但不能共页。** 这两条线不冲突，冲突的是把它们塞进同一个 H1。

| 线 | 词 | 量 | 落点 | 边界 |
| --- | --- | --- | --- | --- |
| 品牌线 | keep video / keep video downloader / keep youtube video | 390 + 390 + 590 | `/`，**H1、title、正文都不动** | 已有 224 点击排 3.3，改一个字都是净损失 |
| 需求线 | save video | 22,200 | `/save-video/` | 新页独占，首页不碰 |

首页正文目前只有 1 处出现 "save video"（一张指南卡片的描述里），这个程度可以留着，但**不要再往首页正文加**。两条线靠内链交叉，不靠同页堆词：

- 首页 → `/save-video/`：从平台条或功能卡片出一跳，锚文本用 "Save video"（英文）/ 对应语言词
- `/save-video/` → `/`：页脚已有一跳，另在正文里用品牌锚文本 "Keep Video" 指回首页

这样品牌词保住现有位置，需求词从零起量，两页各自有唯一的 title / H1 / description，`lint:website` 的重复检查也不会报。

**做法**：在 `website/content.mjs` 新增一篇，slug `save-video`，H1 `Save Video Online`，正文覆盖 "save video from link"、"save video from TikTok"（链到已有 TikTok 页）。该页按指南类输出为 `/save-video/`（不是 `guides/`），需要改 `build-website.mjs` 里 `platforms.includes(g)` 那两处特判——现在只有 `platforms` 数组会走一级路径。

**必须同步的清单**（漏一个就静默失效）：

- `website/locales/*.json` 全部 7 个文件补新词条（`choose()` 缺键会直接抛错，这个会立刻发现）
- `scripts/lint-website.mjs` 三处 `117`（第 60、89、160 行）改为 126
- `website/README.md`、`docs/website-seo.md`（4 处）、`CLAUDE.md` + `AGENTS.md`（两份必须同时改）里的页数

**风险**：这个页面如果只是又一篇 400 词的模板文，就变成第 6 个重复页。写之前先定好它与 `/app/` 的分工——建议它只做"通用 save video"意图，工具入口仍指向 `/app/`，不复制完整工具。

---

### P2｜行为指标目前测不到（先补测，再谈目标）

Agent 给的验收标准是"停留 3 分钟、跳出 40% 以下、人均 3.5 页"。**我们现在没有任何一条能算出停留和跳出**：

- 自有统计的事件只有 `tool_view`、`parse_requested`、`job_created`、`job_finished` 等业务事件，没有页面浏览与停留（`docs/growth-and-developer-roadmap.md` 第 4 节）
- Umami 的 24 小时导出里 `bounces` 与 `totaltime` **全为 0**，等于这份数据不能用

所以 P0/P1 的验收只能先用 GSC 的曝光 / 点击 / CTR / 平均排名，加上自有统计的"任务完成率"。想拿人均页数做指标，得先修 Umami 导出或补一个会话级页面事件——这件事本身是独立的 P1，不要在没数据的时候按别人的数字定目标。

---

## 四、与 Agent 建议的对照

| Agent 建议 | 处理 | 原因 |
| --- | --- | --- |
| 工具搬进 `/youtube-video-downloader/` | **改为改造 `/app/`** | 会话 Cookie、语言解析、135 KB 包体三处都绑在 `/app/` 路径上 |
| 加格式表 / 平台表 / FAQ | 采纳 | 纯静态 HTML，零风险，同时补出链 |
| 建 `/save-video/` | 采纳（P2） | 语义等价、量大 57 倍 |
| 首页不动 H1 | 采纳 | 品牌词 224 点击的来源 |
| 首页文案吃 "save video" | **不在首页改**，交给 `/save-video/` | 首页 H1 一旦改动，品牌词与整页排版一起冒险 |
| 五个语言收成一个 | **改为葡语优先审校** | 删语言要动 URL 与 hreflang，风险大于收益 |
| 外链从 0 到 30–50 个引用域 | 采纳，见第五节 | 这不是代码问题 |
| 蹭 youtube.com / tiktok.com 视频位 | 暂不做 | 需要拍视频，先不占用开发资源 |
| 目标"停留 3 分钟 / 人均 3.5 页" | **先补测量** | 当前数据源算不出这两项 |

---

## 五、站外工作（不在本仓库）

按性价比排，写清楚是为了一个月后能对账：

1. **30–50 个真实引用域**，分三个月，每月 10–15 个。优先：YouTube 下载类工具站目次、开源项目清单（本项目是 MIT、有真实 GitHub 仓库，这是 snapyt / y2mate 都没有的可信度资产）、开发者社区。
2. **`/save-video/` 与 `/youtube-video-downloader/` 的外链落点要分开**，不要都打到首页。
3. **葡语内容的母语校对**——机器初稿 + 模型复核已经是现状，缺的是人工那一道。

---

## 六、建议的落地顺序

1. P0-1 / P0-2 / P0-4（一天，纯 Python 生成器 + 文案，无运行时风险）
2. P0-3（半天，`UrlInput.vue` + `website/online.mjs`，需要 `pnpm test:web` 回归）
3. P1-1 / P1-2（两三天，纯内容，改完跑 `lint:website` 与句级重复率复核）
4. P2 `/save-video/`（一天 + 翻译，页数从 117 改到 126，六处同步）
5. P2 行为指标补测（独立，不要和上面几批并行改同一批文件）

任何一批改动前，先确认 `pnpm lint:website`、`pnpm test:web`、`pnpm lint:i18n` 在改动前的基线是绿的——这三条是唯一能挡住"静默失效"的检查。

---

## 七、实施进度（2026-10-29）

P0 已完成并验证（提交见 git 历史）。

| 项 | 状态 | 落点 |
| --- | --- | --- |
| P0-1 `/app/` 平台中立标题 | 完成 | `website/online.mjs` 的 `appTitle`；`build-website.mjs` 的 `shell(lang,'app',…)` 改用它；H1 仍是 `Online video downloader` |
| P0-2 格式表 / 平台表 | 完成 | `formatTable()`、`platformTable()`；表格与平台条均为静态 HTML，样式在 `website/assets/site.css` 的 `.web-table*` / `.web-platforms` |
| P0-2 FAQ 扩到 5 条 | 完成（原计划 7） | `appFAQs = onlineFAQs + quality + private`；首页仍用 `onlineFAQs` 的 3 条 |
| P0-4 结构化数据 | 完成 | Article 补 `datePublished` / `dateModified`；文章页 `og:type=article`。日期唯一来源是 `UPDATED_ISO`，可见文案用 `updatedLabel()` 按语言格式化，两者不会再各说一套 |
| P0-3 `?url=` 预填 | **未做** | 需改 `src/components/UrlInput.vue` 与平台页 CTA |
| P1-0 / P1 / P2 | 未开始 | 见第三、五节 |

实测结果（本地 `pnpm start:web` + 系统 Chrome）：

- `/app/` 首屏：工具挂载成功、输入框可用、无控制台错误；桌面 1280 与手机 390 均无横向溢出。
- 正文结构：H1 → 三步 → 格式表（MP4/MP3/SRT）→ 平台指南（5 条静态出链）→ 5 条问答；JSON-LD 为 `Organization / WebSite / WebApplication / FAQPage`。
- 站内重复检查：`/app/` 的 `<p>` 与 `<h2>` 在 en / de / pt-br 三种语言下均无互相包含的重复句。
- `pnpm lint:website`、`pnpm test:web` 全绿。

**已知但未处理的两点**

1. 工具自身的 H2（`Task queue` / `Download history` / `About`）在 DOM 里排在页面 H2 之前，因为 `App.vue` 先渲染。不违反标题层级（H1 唯一位于最前），但页内导航顺序不理想；要改需调整 `App.vue` 的组件顺序，属于 P1-0 的同一批改动。
2. 平台表只有 5 条链接：X / Twitter 没有独立页面，首页平台条把它指向 `/app/`。补一条 X 页面才有第 6 个出链。
