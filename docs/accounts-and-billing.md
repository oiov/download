# Web 账户、管理员、API 与订阅

本轮保留 Vue、Node、SQLite、容器和原下载引擎，实现可选 Google 登录、稳定任务归属、管理员后台、有限额的 API 内测及 Stripe 订阅。MCP 不在本轮范围。公开门户保持九语言；账户、套餐与开发者页提供中英文，管理后台使用中文。桌面端无需登录。

## 页面与权限

| 地址 | 用途 | 权限 |
| --- | --- | --- |
| 官网与在线页右上角「登录」 | 原页面弹出 Google 登录框；不跳转到账户页 | 公开入口 |
| `/dashboard`（概览）、`/dashboard/tasks`、`/dashboard/keys`、`/dashboard/account`，均支持 `?lang=<站点前缀>`（`zh`、`es`、`pt-br`、`de`、`fr`、`ja`、`ko`、`ru`，缺省英文） | 认领访客任务与用量概览、未过期结果、API Key、账户信息与订阅 | 必须登录，未登录返回首页并打开登录框 |
| `/account` | 旧入口兼容跳转 | 已登录跳转 Dashboard；未登录返回登录流程 |
| `/pricing` | 当前部署的真实额度与 Stripe 实时价格 | 公开访问，不包含个人数据 |
| `/developers` | API 权限与调用示例 | 公开说明，调用 API 需要内测资格 |
| `/admin` | 管理总览 | 显式授权的管理员账户 |
| `/admin/users` | 姓名／邮箱搜索、每页 25 个账户、时间筛选 | 管理员 |
| `/admin/users/:id` | 解析次数、下载任务、成功数、失败数、成品大小、交付字节、预留和最近 50 条用量 | 管理员，不返回视频地址、标题、文件路径或凭据 |
| `/admin/downloads`、`/admin/downloads/:id` | 所有账户及匿名访客的下载历史、搜索筛选、分页与任务详情 | 仅管理员；普通账户与 API Key 均不能访问 |
| `/admin/analytics` | 原 `/see` 的聚合报表，语言／平台／UTM／referrer 分组 | 管理员 |
| `/admin/operations` | 两库版本、迁移标记、记录数、写入异常、WAL/SHM 与存储诊断 | 管理员，只读 |

`/see` 与 `/see/report.json` 跳转到新的管理员入口；旧 `/see/login` 与其他旧子路由返回 410，`SEE_PASSWORD` 已移除，不再授予访问权。全部 Dashboard 和管理员响应禁缓存、禁索引、禁止嵌入，不加载第三方统计或客户端脚本。公开套餐与开发者页仅增加同域登录弹框脚本，登录状态接口只返回是否登录与渠道是否开启，不返回姓名、邮箱或权限。公开 SEO 页面、地址、语言回链和站点地图继续保留。

用户列表的下载次数是**创建的任务次数**，成功成品大小只累计成功任务的字节；交付量包含重复保存及 Range，不能解释成设备保存量。任务和文件清理不会删除用量记录。迁移之前已经清理的任务、旧遥测缺失的交付字节无法补造；管理员页面会说明历史边界。业务账本独立于尽力采集的统计库。

## 登录及管理员配置

1. 在服务端设置随机、至少 32 字符的 `BETTER_AUTH_SECRET`，可用 `openssl rand -hex 32` 生成。已有部署不要随意更换；只在 `.env` 或密钥管理服务保存，禁止放入 Vite、构建参数或仓库。
2. 在 Google OAuth 控制台创建 Web 应用，设置站点来源和回调 **`https://你的域名/api/auth/callback/google`**。设置 `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`。`SITE_URL` 必须与真实浏览器地址一致；非本地启用账户必须 HTTPS。
3. 点击官网右上角「登录」，在弹框中选择 Google，成功后自动进入 `/dashboard`。面板展示稳定的 `u:…` 账户标识。将完整标识加入 `ADMIN_USER_IDS`，重建容器后访问 `/admin`。多个标识用英文逗号分隔，不会自动提升第一个用户。
4. 也可用 `ADMIN_EMAILS` 引导首次授权。仅经 Google 验证的邮箱可以绑定，首次匹配后将邮箱授权固定到该账户主体；相同邮箱后来对应不同主体也不会自动继承授权。推荐完成引导后改用 `ADMIN_USER_IDS`。移除配置并重建容器会撤销授权；不会自动将旧绑定转交新主体。
5. API 内测使用 `API_BETA_USER_IDS`，或者以相同绑定规则使用 `API_BETA_EMAILS`。空名单默认关闭 API；管理员身份本身不授予 API 资格，付费也不会绕过内测名单。

普通用户和管理员使用相同的 Dashboard 顶部导航、侧栏与内容布局。普通用户仅看到个人用量、任务、套餐和 API Key；管理员在同一侧栏额外看到管理总览、用户列表、全站下载历史、下载统计与运行状态。所有 `/admin` 页面及查询、导出都再次由服务端核验管理员权限，隐藏入口不能代替鉴权。

以仓库的 Docker Compose 部署为例，取得本人账户标识后，在服务器 `.env` 中设置：

```dotenv
ADMIN_USER_IDS=u:你的账户标识
```

随后执行以下命令重新创建服务以加载环境变量（普通 `docker compose restart` 不会加载修改后的 `.env`）：

```bash
docker compose up -d --force-recreate website
```

重新打开 Dashboard 后侧栏就会出现管理模块。多个完整标识以英文逗号分隔。撤销管理员时从该变量移除标识并重新创建服务；若同时配置了 `ADMIN_EMAILS`，也需移除对应邮箱，否则邮箱授权仍然有效。无法预先获取 ID 时，可先设置自己的 `ADMIN_EMAILS`，经验证的 Google 邮箱首次登录后绑定到该稳定账户，再改用 ID 配置。全程不需要手工修改 SQLite。

Better Auth 使用当前业务 SQLite 的独立认证表，不另开后台密码。关闭 Cookie 会话缓存，每次私有请求和 WebSocket 消息重新验证会话；事件发送前也重新验证。退出会撤销当前浏览器会话并关闭该账户现有连接；其他设备的有效会话及独立 API Key 不被意外删除。会话过期／撤销、Key 撤销、移除资格或账户停用后不能继续读取，长连接及正在传输的文件最多每 5 秒复核一次。

账户 `disabled` 是服务端状态，不接受用户自报。当前后台是只读的，不提供在线停用、提权、改库或任意 SQL；如需调整账号状态，必须另行设计受控运维流程。

## 任务认领与升级

升级前按 [持久化卷备份与回退](server-deployment.md#sqlite-与旧数据迁移) 停止旧实例，等待解析／下载／上传收尾，备份整个卷。

- `accounts-v1` 在事务中把旧凭据 owner 映射到稳定 `g:…` 主体，同步任务 JSON 与滚动额度散列；既有访客 Cookie 继续通过映射访问本人任务。文件键、实际路径和 R2 对象不改名。`account-grants-v1` 增加稳定授权绑定。
- 使用独立表保存账户、Key 的散列及权限、幂等结果、资源账本、支付客户和订阅；Better Auth 按锁定版本执行认证表增量迁移。不能重新导入已停止更新的旧 JSON 覆盖当前库。
- 登录**不会自动认领**访客任务。Dashboard 显示当前访客的任务时，用户点击确认后，事务迁移该会话的任务、用量与滚动额度；其他访客或其他账户任务无法认领。客户端提供的任意 guestId 不用于授权。
- 认领后旧访客凭据改为新的空主体，旧连接关闭；账户获取任务访问权。到期时间仍从原创建时间计算，已过期资源不会恢复公开。相同客户端任务号冲突时整次认领失败，不覆盖任一账户任务。
- 未过期 API 幂等结果在重启后仍可重放；过期或已删除任务返回 410，不重新创建或扣额。解析结果仍为有界内存缓存，重启／超过 20 分钟后必须重新解析。
- 不能只因为 `PRAGMA user_version` 相同就回退到账户重构之前的镜像：旧版本不能理解新的主体映射。切流后有新写入时，先停服保全整卷，再设计保留新数据的回迁；直接恢复旧备份会丢失新账户、任务、额度和支付状态，不属于无损回滚。

## API 契约

Key 在 `/dashboard/keys` 创建，明文只展示一次；数据库只保存 SHA-256 散列及短前缀。每个账户最多 10 个有效 Key，有效期 1–365 天，支持到期、主动撤销和最后使用时间。权限由服务端固定白名单限定；浏览器 Cookie、账户 ID 和 Key 明文均不用于文件目录名。

| 接口 | 权限 | 行为 |
| --- | --- | --- |
| `POST /api/v1/parse` | `media:parse` | 只接受 `{url}`；返回 parseId、到期时间及服务器解析出的格式 |
| `POST /api/v1/downloads` | `downloads:create` | 只接受本人未过期 parseId 中的格式、模式、音轨和字幕；202 返回 jobId 与查询地址 |
| `GET /api/v1/downloads/:id` | `downloads:read` | 异步状态、结构化错误、文件有效期，不返回路径 |
| `POST /api/v1/downloads/:id/cancel` | `downloads:cancel` | 等实际停止后返回状态；停止失败返回 409，槽位不提前释放 |
| `GET /api/v1/files/:id` | `files:read` | 归属与到期校验、HEAD／Range、私有 local/R2 流式交付 |
| `GET /api/v1/usage` | `downloads:read` | 账户过去 24 小时用量与当前额度 |

创建任务要求 `Idempotency-Key`：8–120 位字母、数字、`_` 或 `-`。唯一范围是“账户＋创建任务＋键”，换 Key 不会重置幂等。相同键和参数重放原任务，不同参数返回 409；任务、次数预留、资源预留和幂等记录在同一事务提交，任一步失败全部回滚。业务执行开始之后的失败与取消仍计次数。

没有有效 Key 为 401，缺权限或内测资格为 403；别人的任务和不存在任务都为 404；失效解析及清理掉的幂等任务为 410。超额或过频为 429 并带 `Retry-After`。每账户每分钟 API 请求上限 120；多个 Key 不增加额度。媒体请求、重定向和分片继续经过既有 SSRF 与出站限制，不接受 Cookie、任意下载器参数、代理或服务器路径。

## 资源额度

默认值是站点运维配置，不是不可变的商业套餐承诺。`/pricing` 显示运行中配置；网页、API 共用账户账本与全局队列。

| 配置 | 默认值 | 范围 |
| --- | --- | --- |
| `WEB_PARSE_HOURLY_LIMIT` | 60 | 每主体滚动小时解析上限 |
| `WEB_PARSE_DAILY_LIMIT` / `WEB_DOWNLOAD_DAILY_LIMIT` | 200 / 30 | 匿名主体滚动 24 小时次数 |
| `ACCOUNT_PARSE_DAILY_LIMIT` / `ACCOUNT_DOWNLOAD_DAILY_LIMIT` | 500 / 100 | 免费账户滚动 24 小时次数 |
| `PRO_PARSE_DAILY_LIMIT` / `PRO_DOWNLOAD_DAILY_LIMIT` | 2000 / 500 | 有效 Pro 账户滚动 24 小时次数 |
| `WEB_GENERATED_DAILY_MB` | 4096 | 匿名成品字节预算 |
| `ACCOUNT_GENERATED_DAILY_MB` / `PRO_GENERATED_DAILY_MB` | 10240 / 51200 | 免费／Pro 成品字节预算 |
| `WEB_DELIVERY_DAILY_MB` | 10240 | 匿名交付字节预算 |
| `ACCOUNT_DELIVERY_DAILY_MB` / `PRO_DELIVERY_DAILY_MB` | 20480 / 102400 | 免费／Pro 交付字节预算 |
| `WEB_OWNER_CONCURRENCY` | 2 | 每主体执行并发，同时受全局 `WEB_CONCURRENCY` 限制 |

`MAX_FILE_MB`、`TASK_TIMEOUT_MINUTES`、`WEB_SESSION_TASKS`、全局队列长度与文件 TTL 仍统一生效。生成任务先保守预留一个单文件上限，收尾后按成功成品实际字节结算并释放剩余预留；所以应让日生成预算大于单文件上限。失败和取消的次数不返还。文件响应先原子预留完整响应或 Range 的长度，结束后按实际流经响应的字节结算；HEAD 不扣流量。强制终止导致实际交付未知时保留“未确认预留”，直到滚动窗口过期，不能靠重启恢复额度；它不会冒充已确认交付字节。

业务用量记录和支付状态长期保存在持久化卷，文件 TTL 与原始统计默认 30 天（可配置为最多 180 天）的保留期不删除它们。当前未提供在线删除账户及账本清理功能；部署方应按业务要求确定这些记录、密钥元数据和备份的保留策略。账本只含主体、事件类型、状态、时间和字节数，不保存视频标题或地址。

## Stripe 订阅

本次实现一个可配置的 Pro 周期套餐，使用 Checkout `mode: subscription` 和 Customer Portal，不自建续费循环。

1. 在 Stripe 创建固定单价、按数量计价的周期 Price；设置 `STRIPE_SECRET_KEY`、`STRIPE_PRICE_ID`、`STRIPE_WEBHOOK_SECRET`。支持月付／年付等周期，页面实时读取实际金额和币种，不编造价格。
2. 配置 Customer Portal，允许客户管理付款方式和取消。Webhook 地址是 **`https://你的域名/api/billing/webhook`**，至少订阅 `customer.subscription.created`、`customer.subscription.updated`、`customer.subscription.deleted`、`checkout.session.completed`、`invoice.paid`、`invoice.payment_failed`。也处理异步 Checkout 成功通知。
3. 先使用测试模式完整验证 Google 回调、Checkout、门户、Webhook 重试、续费失败、取消和到期，再启用正式密钥。代码、本地替身及签名回归通过不能代替商户的真实联调。

服务端按稳定账户建立 Stripe Customer，使用幂等请求避免重复创建；Checkout 重复请求复用幂等标识，已有未结束订阅转入 Portal。客户端不能提交任意 Price、Customer、回调或账户 ID。

Webhook 使用原始请求体与 SDK 验证签名，持久化事件 ID 防重放，串行处理并从 Stripe 重新读取当前订阅，避免乱序通知恢复已经取消的权益。Customer 必须映射到当前账户，且订阅必须包含服务端配置的 Price；只有 `active`／`trialing` 且付费期未结束时使用 Pro 额度。`past_due`、取消或到期降回免费；周期末取消在上游仍 active 时持续到期末。支付返回页只显示“核验中”，不授予权益。未配置支付时关闭购买按钮，匿名和免费功能继续工作。

## 验证与发布边界

`pnpm test:web` 包含服务端／Web 类型检查、SQLite 与旧数据迁移、匿名业务回归、local/S3 存储、只读报表，以及真实 Better Auth 签名会话下的账户／管理员／API HTTP 回归和 Stripe 签名测试；现有三个平台 integration job 都调用这一入口。测试使用临时库、示例账户和本地下载／支付替身，不使用真实商户或用户凭据。新增账户账本和支付安全分支还做变异反证。

上线前需单独核验真实 Google 应用、Stripe 测试支付及门户配置、生产名单、最终售价和额度、反代 HTTPS／WebSocket，以及备份和旧数据文件授权。代码修改不代表已经部署、接通真实支付或取得线上运营数据。

## 管理员全站下载历史

`/admin/downloads` 展示账户和匿名访客的任务，支持按用户 ID、用户类型、状态、时间筛选以及姓名／邮箱／标题／任务 ID 搜索，每页 25 条。用户详情页可直接进入对应用户的历史。详情包含任务 ID、用户、标题、来源平台与清洗后的来源页面、视频／音频／字幕模式、格式、画质、音轨、字幕、状态、进度、文件名与大小、存储方式、创建／开始／结束／文件到期／移除时间、排队／下载／上传耗时以及安全错误类别和说明。

按用户新增授权，下载历史可展示标题和来源；原聚合统计仍不采集这些字段。来源只保留页面路径与允许的媒体 ID 参数，不保存 URL 用户名密码、签名参数、片段、服务器路径、存储对象键、Cookie 或原始下载器异常。页面不提供绕过文件归属的管理员下载入口。

`download-history-v1` 在业务库新增独立记录，和任务插入／更新使用保存点原子提交；认领访客时同步历史主体。文件 TTL 与用户删除任务不立即删除历史，默认保留 90 天，由 `DOWNLOAD_HISTORY_RETENTION_DAYS` 调整；仍在当前任务清单中的记录不提前清理。旧任务可回填仍有的数据，已清理任务只能从用量账本恢复可靠的次数、状态和成品大小；缺失的标题、来源与结束时间显示未知，不补造。详细历史按配置过期清理，聚合用量账本继续保留。

环境变量逐项默认值、填写示例及部署生效命令统一见 [环境变量填写汇总](environment-variables.md)。
