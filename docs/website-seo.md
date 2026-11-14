# Keep Video 官网改版与 SEO

基于上线初期 GSC 与 Umami 数据的后续工作见 [下一阶段行动计划](growth-and-developer-roadmap.md)，包含下载漏斗、工具体验、可选登录、API 和 MCP 的待实施任务与验收条件。该计划不代表相关能力已经上线。

## 产品与页面

网站品牌为 Keep Video，正式域名 keep.video。网站承接搜索访问，主要引导进入在线工具，也提供桌面应用。门户与在线工具部署在同一站点，使用统一导航和九种语言。

首页、在线工具、三个带工具的保存落地页、下载中心、指南目录、四篇使用指南和五个平台页面，各有九种语言，共 144 页。页面各自覆盖独立意图；尚无关键词搜索量或难度数据，不将候选词称为已验证机会。

| 页面 | 搜索意图 |
| --- | --- |
| / | Keep Video、在线与桌面视频下载工具 |
| /app/ | 在线解析、格式选择与保存文件 |
| /download/ | macOS / Windows / Linux 安装包 |
| /guides/getting-started/ | 首次安装与运行依赖 |
| /guides/audio/ | 从视频保存 MP3 音频 |
| /guides/subtitles/ | 单独保存 SRT 字幕 |
| /guides/troubleshooting/ | 解析、登录、Cookie、合并失败 |

## 采用的方法

- [marketingskills / seo-audit](https://github.com/coreyhaines31/marketingskills/blob/main/skills/seo-audit/SKILL.md)：先验证可抓取与索引，再处理标题、页面意图和内容；同时检查原始 HTML 与浏览器。
- [marketingskills / site-architecture](https://github.com/coreyhaines31/marketingskills/blob/main/skills/site-architecture/SKILL.md)：目录、文章、下载入口分工，使用上下文内链和面包屑。
- [marketingskills / copywriting](https://github.com/coreyhaines31/marketingskills/blob/main/skills/copywriting/SKILL.md)：明确用户收益、使用场景与下一步；不虚构下载量或评论。
- [marketingskills / schema](https://github.com/coreyhaines31/marketingskills/blob/main/skills/schema/SKILL.md)：JSON-LD 只描述实际内容；WebSite、SoftwareApplication 和 BreadcrumbList，不添加虚构评分。
- [哥飞经验汇编](https://github.com/Jayin/gefei-seo-cookbook)：从具体长尾需求开始，优先完善少量真实有用页面。KGR、关键词密度等经验值不作为排名保证。本库是第三方整理，没有复制原公众号文章。
- 用户的 nb-gen 项目：复用独立语言 URL、明确公开页面、原始 HTML、生产域名和预览收录隔离的方法；视觉参考其大画幅摄影、排版、章节节奏。

## 素材

已复用 nb-gen 的 scripts/nbility-image.py 工作流，当前项目入口是 scripts/generate-website-art.py。通过 NBILITY_IMAGE_API_KEY 读取凭据，不写入代码和素材；图片下载不携带 API 密钥。website/art-direction.json 保存 Keep Video 专属提示词。

2026-11-14 落地页重新设计：白底双栏首屏（左侧标题与链接输入框，右侧方形主视觉），首屏图改为“视频帧分层为画面、音轨、字幕”的玻璃静物，三张格式卡片按同一风格重新生成。首屏图把白点提到 245，使背景与页面纯白衔接，再由 CSS 径向遮罩收边。平台标志来自 Simple Icons（CC0），保存在 website/assets/platforms。

| 文件 | 用途 |
| --- | --- |
| hero-keep.webp | 首屏主视觉：视频帧分层为画面、音轨与字幕 |
| card-video.webp | 视频格式卡片，也用于首页浏览器样机缩略图 |
| card-audio.webp | 音频格式卡片 |
| card-subtitles.webp | 字幕格式卡片 |

生成提示词保存在 website/art-direction.json。凭据与任务结果不提交。三款 Logo 是独立矢量设计，保存在 website/assets/brand，当前采用 frame-play.svg，另外两款为 folded-film.svg 与 keep-mark.svg；favicon 与导航标识保持一致。

## 收录与验证

不含正式域名的构建输出 noindex、空 sitemap，不输出虚构 canonical。配置 SITE_URL 后正式构建生成相互对应的语言标注及完整 sitemap；Vercel preview 或 SITE_PREVIEW=1 保持 noindex。站点有真正的 404，不用首页兜底未知路径。

pnpm lint:website 已复用原有三个平台 CI 的入口，检查 144 页独立标题与描述、资源和链接、JSON-LD、语言回链、分享图尺寸、生产/预览模式及非法域名。浏览器验证覆盖桌面、390px 和 320px；页面在无 JavaScript 时可导航。

上线时配置正式域名，核对实际安装包状态，提交 sitemap 到 Search Console，并检查中文首页、英文页与指南的实时抓取。后续依据曝光、点击和下载转化迭代。

## 域名候选（未核实注册状态）

优先 framekeep.app；其次 getframekeep.com、framekeep.io、framekeep.co。名称与域名是建议，注册可用性及名称冲突需确定品牌前另行查询。


## keep.video SEO / GEO

正式站点共 144 页，覆盖九种语言。五个平台页的标题、搜索描述、H1 与分享元数据同时覆盖在线和桌面版。Instagram 页面覆盖视频与 Reels；其余页面分别解释 YouTube 画质与字幕、Bilibili 分 P 与登录画质、TikTok 短链与可见性、Vimeo 隐私与作者下载选项。支持来自 yt-dlp 提取器，未声称每条 URL 均经过实测。

平台页与使用指南先说明在线操作，再以独立章节保留桌面版详细步骤。在线版无需本机安装运行依赖，不读取本机浏览器 Cookie；依赖安装、Cookie、输出目录等配置只属于桌面版。下载中心继续定位为桌面安装包页面。关键词自然体现在标题、描述和正文中，不使用 meta keywords 堆砌。

sitemap.xml 与 robots.txt 由构建生成；九语言 canonical、hreflang 和 x-default 相互对应。HTML 包含完整正文、Organization / WebSite / SoftwareApplication / Article / BreadcrumbList 数据，支持邮箱 support@keep.video。llms.txt 提供产品事实、边界与官方内容链接，仅是辅助发现文件。

页面通过清晰定义、独立回答段落、可见更新时间和 yt-dlp 官方来源链接便于 AI 引用。没有伪造评价、性能数据、第三方背书或 AI 推荐证据。搜索与 AI 引用效果需要上线后的 Search Console / Bing Webmaster 与实际问答引用监测；目前不声称已经获得排名或收录。


## 九语言版本

英语为根目录默认语言，中文 /zh/，新增 es、pt-br、de、fr、ja、ko、ru；共 144 页。每页有九个语言对应地址，x-default 为英语。旧 /en/ 通过 301 跳转，避免重复索引。语言菜单支持键盘和无 JavaScript 操作。翻译以公开文案的机器初稿为基础，经过模型复核并重写主要营销文案与关键平台描述，尚未经母语人工审校。

## 公开在线工具

/app/ 默认英文，/zh/app/ 为中文。语言选择由 URL 决定，不受系统语言或桌面设置覆盖；切换语言保持当前页面类型。旧 /zh-cn/… 使用永久重定向迁移到 /zh/…。导航、canonical、hreflang 与 sitemap 使用 shared/site-locales.json 的同一份配置。

/app/ 的标题、说明、三步流程、FAQ 和 WebApplication / FAQPage 数据直接生成在 HTML 中。用户与机器人收到相同内容；交互表单由 Vue 加载。文件有效期、来源限制、无需账户等说明必须与实际服务一致，不承诺支持每个链接。任务与文件接口 /api/ 保持 noindex/no-store 和会话隔离。
