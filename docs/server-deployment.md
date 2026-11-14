# Keep Video 单站点部署

门户、九语言 SEO 页面和 /app/ 在线工具由同一个容器提供，替代原 Worker 部署。桌面入口保留在 /download/。

Web 服务与报表使用 Node 22.13+ 内置 SQLite，不需要另外部署数据库、安装 ORM 或原生模块。桌面设置、下载历史与解析缓存不变。

## 启动

1. 使用「Keep Video 镜像」工作流；main 发布 latest，版本 tag 发布版本标签。首次发布后将 GitHub Package 设为公开，或在服务器登录 GHCR。
2. 将 docker-compose.yml 和 docker/.env.example 复制到服务器同一目录，后者命名为 .env。
3. 设置 SITE_URL=https://keep.video 和 ANALYTICS_ENVIRONMENT=production，然后执行 docker compose pull 和 docker compose up -d。已有部署也必须补齐统计环境；非本地站点启用统计却未指定环境时会拒绝启动，不再静默记为 development。
4. HTTPS 反向代理转发到 127.0.0.1:6080，支持 WebSocket Upgrade，并将下载响应超时设置为足够长。应用只暴露回环端口。Caddy 可使用 keep.video 站点块内的 reverse_proxy 127.0.0.1:6080。
5. 确认首页、/zh/、/app/、/healthz 正常后，移除旧 Worker 自定义域绑定，再切换域名到服务器。

## 环境变量

完整的登录、管理员、Stripe、存储、额度与保留期填写方式，以及分阶段可复制示例，统一见 [环境变量填写汇总](environment-variables.md)；配套 `docker/.env.example` 已覆盖全部服务端配置。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| STORAGE_DRIVER | local | local 或 r2 |
| DOWNVID_DOWNLOADS | 容器 /data/downloads | 工作及本地文件目录 |
| DOWNVID_DATA_DIR | 容器 /data/userdata | 业务 SQLite 与独立统计目录 |
| R2_ENDPOINT | 空 | R2 S3 API HTTPS 地址 |
| R2_BUCKET | 空 | 私有桶名 |
| R2_ACCESS_KEY_ID | 空 | 桶范围 S3 密钥 ID |
| R2_SECRET_ACCESS_KEY | 空 | 桶范围 S3 密钥 |
| DOWNLOAD_HISTORY_RETENTION_DAYS | 90 | 管理员下载历史保留天数，与成品文件 TTL 分开 |
| FILE_TTL_HOURS | 24 | 从创建任务起算的保存时长 |
| WEB_CONCURRENCY | 3 | 全局并发下载上限 |
| WEB_MAX_QUEUED | 30 | 全局运行和等待任务上限 |
| WEB_SESSION_TASKS | 10 | 单会话保留任务上限 |
| WEB_PARSE_HOURLY_LIMIT | 60 | 单会话过去 1 小时的累计解析预留次数 |
| WEB_PARSE_DAILY_LIMIT | 200 | 单会话过去 24 小时的累计解析预留次数 |
| WEB_DOWNLOAD_DAILY_LIMIT | 30 | 单会话过去 24 小时的累计下载任务预留次数 |
| MAX_FILE_MB | 2048 | 单任务大小上限 |
| TASK_TIMEOUT_MINUTES | 60 | 下载任务超时 |
| ANALYTICS_ENABLED | 1 | 设为 0 关闭本地事件记录，不影响下载 |
| ANALYTICS_ENVIRONMENT | 本地 development | 非本地站点启用统计时必填；线上 production，预览显式 development 或 test |
| ANALYTICS_RETENTION_DAYS | 30 | 默认保留 30 天，可设为 1–180 个 UTC 日分区（含当日），与文件 TTL 独立 |
| ANALYTICS_MAX_DAILY_MB | 16 | 单日事件 JSON 逻辑字节上限，超过后丢弃统计；不含 SQLite 索引、WAL 与备份开销 |
| BETTER_AUTH_SECRET / GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET | 空 | 可选账户登录，详见下方账户配置 |
| ADMIN_USER_IDS / API_BETA_USER_IDS | 空 | 显式授权稳定账户，逗号分隔；空名单默认关闭 |
| STRIPE_SECRET_KEY / STRIPE_PRICE_ID / STRIPE_WEBHOOK_SECRET | 空 | 同时配置才启用周期订阅，详见账户与支付文档 |

local 指服务器磁盘；访客点击保存后由浏览器保存到设备下载目录。网页不能无提示写入访客任意本地目录。

R2 模式仍先本地下载合并，上传成功后删除工作文件。桶无需公开或配置浏览器 CORS，本站按 HttpOnly 会话授权后流式交付。R2 仍需持久化任务数据卷。密钥不得放进 VITE_* 或镜像构建参数。

切换存储驱动前先等待旧任务过期清理，或保留原实例处理旧任务。一个实例使用一种存储驱动。桶建议配置生命周期规则作为清理兜底，期限不短于 FILE_TTL_HOURS；同时配置失败分片上传清理。

## 更新与回滚

生产建议在 Compose 的 image 中固定版本或 digest。更新执行 docker compose pull 和 docker compose up -d。不要执行 docker compose down -v，否则会删除任务和会话。

### SQLite 与旧数据迁移

- 业务数据为 `DOWNVID_DATA_DIR/state.sqlite`，包括会话、任务和额度；统计数据为 `DOWNVID_DATA_DIR/analytics/analytics.sqlite`，不与业务共用写锁。视频仍由 local/R2 保存，数据库不得上传 R2 或放在共享网络文件系统。
- 首次升级前停止旧实例，等待下载／上传／解析收尾，对**整个持久化卷**做一致性备份。不能让新旧实例同时操作一份卷；SQLite 不会把内存下载调度器自动变成多实例队列。
- 启动时将旧 web-sessions.json、web-jobs.json、web-usage.json 在同一个事务中导入，成功后写迁移标记，重启不再导入。缺失文件按原来的空数据处理；存在但损坏、重复幂等键等情况拒绝启动，全部回滚，原件不覆盖。修复原件后可以重试。
- 统计 JSONL 流式分批导入，以文件名和行号防止中断重试重复写入；坏行计入报表 `reader.malformedLines`。迁移未完成时拒绝生成 SQLite 报表，不把部分数据冒充完整结果。统计迁移失败可重试且不使业务启动失败。
- 旧业务 JSON 保留为迁移原件，**不再持续更新**；统计原始 JSONL 保留到原始事件保留期届满。数据库迁移不是双写方案，不能仅切回旧镜像继续读取旧 JSON，否则会回退会话、任务与已消耗额度。
- 回退到文件版时，必须停服并恢复升级前同一批次的卷备份；升级后新任务及额度不会自动回写到备份。不要将旧额度与新文件目录混搭。仅支持同一 SQLite schema 版本的镜像才可以直接回退；遇到未来版本数据库明确拒绝启动。

业务库使用 WAL、FULL 同步提交与有界锁等待；额度检查和写入在同一事务，任务幂等键有唯一约束。统计库采用 NORMAL 同步和短批量事务，仍是尽力记录，不是审计账本。两库及其 WAL/SHM 文件、业务 JSON 原件与备份都包含敏感状态，不能公开或打进镜像。

备份优先停服后对整个卷做快照；在线备份需使用 SQLite 的备份接口或 `VACUUM INTO`，并另行保证业务文件的一致性，**不能只复制正在运行的 .sqlite 文件而漏掉 WAL**。数据库自动清理只删除逻辑记录，空闲页供后续复用，文件不会每次立即缩小；请额外预留索引、WAL、迁移原件和备份空间。备份的保留与销毁由部署方管理。

## 使用边界

在线模式仅支持公开 HTTP/HTTPS 链接，不接受访客 Cookie、服务器目录或代理配置；需要登录态的来源使用桌面版。关闭页面后服务器继续任务，同一浏览器可在下载历史查看结果。未认领的匿名任务清除 Cookie 后无法访问；登录账户可跨设备访问已经确认认领且未过期的结果。

来源要求真人验证与内容要求登录分开返回；不通过重复切换下载器客户端绕过验证。对同一会话、同一链接的这两类错误冷却 5 分钟，冷却期拒绝再次请求来源，其他链接仍可尝试。该缓存有界且只在内存保留，服务重启后消失；这不表示来源限制已经解除。桌面版同样不保证能处理受限内容。

累计额度按滚动窗口计算，不在整点或午夜清零。业务库 quota 表只保留稳定主体的 SHA-256 散列、操作类型及计额时间；与统计采集是否启用无关。同库 sessions 表含授权凭据，所以整个数据库仍须严格保密。请求先以事务检查并预留额度，提交后再执行；失败、取消和删除任务不退额，WebSocket 重连和服务重启也不清零。重复提交同一个已存在任务不再次扣额。解析预留在公网地址校验前进行，DNS／地址校验失败也会消耗额度；冷却或繁忙拒绝不扣额。数据库或迁移清单损坏时拒绝启动并保留原件，写入失败时拒绝新增操作，不静默放行。任务创建、幂等记录与预留同事务提交，提交失败全部回滚；执行开始后的失败不退次数。

这些额度只约束一个匿名会话，不能阻止攻击者新建会话；目前也不是全站日预算或交付字节配额。代理缓冲、重复保存和跨会话请求仍需部署方结合带宽／磁盘监控与入口防护控制，不应据此承诺已解决滥用或成本问题。

服务重启将执行中任务标记失败，可重新解析；已完成文件保留到过期。下载器经过受限公网代理，部署方还应设置容器出站网络策略。磁盘按并发与文件上限预留空间。

上游来源为 yxxbc/downvid 的 WebUI 架构和下载引擎；Keep Video 独立运营，不是上游官方托管服务。

在线工具默认使用英文，中文入口 /zh/app/；九语言地址与门户一致。公开在线页可索引并列入 sitemap，用户任务及文件仍由会话隔离，/api/ 保持 noindex。旧 /zh-cn/ 地址永久跳转到 /zh/。

## 本地统计

统计使用持久化卷中的独立 SQLite 与离线报表，不新增未鉴权的统计接口。原有 `analytics:report --dir` 参数不变，未迁移的 JSONL 目录仍能只读导出；存在 SQLite 时不再重复统计原件，数据库损坏也不会静默回退为旧 JSONL。指标定义、隐私边界、导出和回退见 [下载漏斗统计](analytics.md)。上线前设置 `ANALYTICS_ENVIRONMENT=production`；历史误标事件不会自动修改，须显式按其原环境单独导出并注明口径。

管理员登录后访问 `/admin/analytics`；原 `/see` 跳转到新入口，`SEE_PASSWORD` 不再使用。用户列表、逐用户用量与运行诊断分别位于 `/admin/users` 和 `/admin/operations`，都必须经账户与管理员授权，不开放原始业务数据库。详细指标定义见 [管理员在线统计](analytics.md#管理员在线统计页)。

## 账户、API 与付费

本轮重构使用原页 Google 登录弹框，登录后进入受保护的 `/dashboard`；普通用户与管理员共用布局，管理员增加管理导航。新增访客任务认领、API 内测和 Stripe 周期订阅，MCP 不实施。首次上线必须停服备份整个卷，不能让账户版和旧版同时操作同一 SQLite；旧版本无法理解稳定 owner 映射，不能仅按相同 schema 版本就回退镜像。升级后若有新写入，回退须保全新数据并设计回迁，不能直接用旧备份覆盖。

配置、默认额度、真实登录回调、管理员／内测资格、Stripe Webhook、价格、迁移与回退验收见 [账户、管理员、API 与订阅](accounts-and-billing.md)。所有配置仅在服务端 `.env`；未设置登录或支付时保持匿名服务可用，购买入口关闭。`docker/.env.example` 提供完整变量名，真实凭据不得提交仓库或进入镜像构建参数。
