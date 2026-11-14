# 服务端环境变量填写汇总

配套模板：[docker/.env.example](../docker/.env.example)。此文面向仓库的单实例 Docker Compose 部署；变量由服务端读取，桌面应用不需要这些账户、R2 或支付配置。

## 先复制模板，再按阶段填写

把 `docker/.env.example` 复制为 **`docker-compose.yml` 同目录下的 `.env`**。不要直接修改示例文件来保存真实密钥，也不要给密钥添加 `VITE_` 前缀。模板中的空值表示该可选能力未配置，不能保留示例占位文字后就启动。

第一阶段，只开放匿名在线工具，最少修改自己的域名；其余沿用模板：

```dotenv
SITE_URL=https://你的域名
ANALYTICS_ENVIRONMENT=production
STORAGE_DRIVER=local
BETTER_AUTH_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
ADMIN_USER_IDS=
ADMIN_EMAILS=
API_BETA_USER_IDS=
API_BETA_EMAILS=
STRIPE_SECRET_KEY=
STRIPE_PRICE_ID=
STRIPE_WEBHOOK_SECRET=
```

第二阶段，启用 Google 登录与管理员，只补以下配置，其他值保留：

```dotenv
BETTER_AUTH_SECRET=填写你生成并持久保存的随机密钥
GOOGLE_CLIENT_ID=填写Google控制台的Web客户端ID
GOOGLE_CLIENT_SECRET=填写同一客户端的Secret
ADMIN_EMAILS=你的Google邮箱
```

使用 `openssl rand -hex 32` 生成认证密钥。Google OAuth Web 应用的回调地址必须为 **`https://你的域名/api/auth/callback/google`**，来源与 `SITE_URL` 一致。点击右上角登录弹框，Google 登录成功后进入 `/dashboard`。经验证的配置邮箱首次登录会取得管理权限；推荐随后复制面板展示的完整 `u:…` 账户标识，填入 `ADMIN_USER_IDS` 并清空 `ADMIN_EMAILS`。多个管理员用英文逗号分隔，不会自动把首个注册用户设为管理员。

第三阶段，开放付费，先使用同一个 Stripe 账户和测试模式中的三项值：

```dotenv
STRIPE_SECRET_KEY=sk_test_你的测试SecretKey
STRIPE_PRICE_ID=price_你的周期价格ID
STRIPE_WEBHOOK_SECRET=whsec_该Webhook端点的签名密钥
```

以上都是格式示例，不是真实凭据。Price 必须是**固定单价、按数量计价的周期价格**，不能填 Product ID、一次性价格或发布到浏览器的 `pk_` 公钥。金额和币种从该 Price 读取，没有额外的售价环境变量。配置 Customer Portal；Webhook 端点为 **`https://你的域名/api/billing/webhook`**。正式端点与 Stripe CLI 转发端点各有自己的签名密钥，不能混用。完成真实测试付款、取消和通知重试验收后，再将三项一起换成正式模式对应值；测试与正式模式的 Price、Customer、Webhook Secret 不能混搭。

需要 API 内测时，在 `API_BETA_USER_IDS` 中填允许的完整账户标识；也可用 `API_BETA_EMAILS` 首次引导。管理员或 Pro 身份不会自动获得 API 资格。

## 完整变量表

下列默认值指配套 Docker 模板或镜像。源码直接启动时，监听地址默认是 `127.0.0.1`，数据目录默认是相对当前目录的 `data/userdata` 与 `data/downloads`。Compose 会读取 `.env`；直接执行源码不会自动加载该文件。

### 站点、监听与持久化

| 变量 | 模板／镜像默认值 | 怎么填 |
| --- | --- | --- |
| `SITE_URL` | `https://keep.video` | 改为浏览器实际访问的站点源地址，例如 `https://video.your-domain.com`。不带子路径、查询串或用户名密码；启用登录的非本地站点必须 HTTPS |
| `DOWNVID_WEB_HOST` | `0.0.0.0` | 容器内监听，通常保持默认；Compose 仍只映射宿主机回环地址 |
| `DOWNVID_WEB_PORT` | `6080` | 容器监听端口，通常不改；更改时同步 Compose 端口映射与健康检查 |
| `DOWNVID_DATA_DIR` | `/data/userdata` | 业务库、认证、用量、下载历史与独立统计库所在目录，必须位于本地持久化卷 |
| `DOWNVID_DOWNLOADS` | `/data/downloads` | 本地成品与下载／合并工作目录，R2 模式也必须保留可写磁盘空间 |
| `FILE_TTL_HOURS` | `24` | 从任务创建时起算的文件有效期，单位小时；不是从完成时起算 |
| `DOWNLOAD_HISTORY_RETENTION_DAYS` | `90` | 管理员下载历史保留天数；文件到期或用户删除任务不立即删除历史。仍在任务清单内的记录不提前清理。业务用量账本不随此变量删除 |

`SITE_URL` 同时影响 **构建时的静态官网 canonical／sitemap** 和 **运行时的登录／支付回调**。换成自己的域名时，镜像构建阶段也要传入同一个 `SITE_URL` build arg；只改运行时 `.env` 不会重新生成镜像内的静态 SEO 文件。`SITE_PREVIEW=1`、`VERCEL_ENV=preview` 只用于静态网站构建时强制 noindex，不是账户功能开关；生产不要设置。

### local 或 R2 存储

| 变量 | 默认值 | 怎么填 |
| --- | --- | --- |
| `STORAGE_DRIVER` | `local` | `local` 使用服务器持久化磁盘；`r2` 使用私有 R2 桶 |
| `R2_ENDPOINT` | 空 | `r2` 必填，填写 R2 的 S3 API HTTPS endpoint；不要填公开下载域名，不含桶路径 |
| `R2_BUCKET` | 空 | `r2` 必填，桶名 |
| `R2_ACCESS_KEY_ID` | 空 | `r2` 必填，具有该桶读写删除权限的 S3 Access Key ID |
| `R2_SECRET_ACCESS_KEY` | 空 | `r2` 必填，与上项配对的 Secret Access Key |

`local` 模式可将四项 R2 配置留空。R2 桶保持私有，本站按用户授权流式交付，不要求浏览器直接访问桶或配置桶 CORS。R2 只保存成品，SQLite 不能迁到 R2。切换存储驱动前需处理旧任务；现有任务的文件驱动与新配置不一致时会拒绝启动。

### 登录、管理员与 API 名单

| 变量 | 默认值 | 怎么填 |
| --- | --- | --- |
| `BETTER_AUTH_SECRET` | 空 | 随机且至少 32 字符，建议 `openssl rand -hex 32`；启用 Google 时必填，已有部署不要随意更换 |
| `GOOGLE_CLIENT_ID` | 空 | Google OAuth Web 应用的客户端 ID |
| `GOOGLE_CLIENT_SECRET` | 空 | 同一 Web 应用的客户端 Secret，与 ID 成对配置 |
| `ADMIN_USER_IDS` | 空 | 推荐的正式管理员名单；完整 `u:…` 稳定账户标识，逗号分隔 |
| `ADMIN_EMAILS` | 空 | 首次引导的已验证 Google 邮箱名单；首次匹配后绑定到稳定账户，不自动转授同邮箱的新主体 |
| `API_BETA_USER_IDS` | 空 | API 内测账户名单；格式同管理员 ID，和管理员权限独立 |
| `API_BETA_EMAILS` | 空 | API 内测的验证邮箱引导名单，绑定规则同管理员 |

留空名单代表不授权。撤销管理员需同时检查 ID 和邮箱两份名单；只移除其中一项，而另一项仍匹配时，权限仍在。API Key 由已获资格的用户在 Dashboard 创建；不用把用户 Key 填进服务端 `.env`。

### 全局限制与每主体共享限制

| 变量 | 默认值 | 含义 |
| --- | --- | --- |
| `WEB_CONCURRENCY` | `3` | 全局同时执行的下载任务数，也限制同时解析数 |
| `WEB_OWNER_CONCURRENCY` | `2` | 单个稳定用户／访客主体的同时执行任务数，仍受全局上限约束 |
| `WEB_MAX_QUEUED` | `30` | 全局运行与等待任务合计上限 |
| `WEB_SESSION_TASKS` | `10` | 单主体在当前任务清单中保留的任务上限，不是管理员历史条数上限 |
| `WEB_PARSE_HOURLY_LIMIT` | `60` | 所有套餐均适用的单主体滚动小时解析上限 |
| `MAX_FILE_MB` | `2048` | 单任务处理文件大小上限，按 MiB 换算 |
| `TASK_TIMEOUT_MINUTES` | `60` | 单下载任务处理时限，分钟 |

### 匿名、免费账户与 Pro 的滚动 24 小时额度

| 资源 | 匿名变量／默认值 | 免费账户变量／默认值 | Pro 变量／默认值 |
| --- | --- | --- | --- |
| 解析请求次数 | `WEB_PARSE_DAILY_LIMIT=200` | `ACCOUNT_PARSE_DAILY_LIMIT=500` | `PRO_PARSE_DAILY_LIMIT=2000` |
| 创建下载任务次数 | `WEB_DOWNLOAD_DAILY_LIMIT=30` | `ACCOUNT_DOWNLOAD_DAILY_LIMIT=100` | `PRO_DOWNLOAD_DAILY_LIMIT=500` |
| 成品大小预算 | `WEB_GENERATED_DAILY_MB=4096` | `ACCOUNT_GENERATED_DAILY_MB=10240` | `PRO_GENERATED_DAILY_MB=51200` |
| 交付流量预算 | `WEB_DELIVERY_DAILY_MB=10240` | `ACCOUNT_DELIVERY_DAILY_MB=20480` | `PRO_DELIVERY_DAILY_MB=102400` |

整数额度必须大于 0，**不能用 0 关闭功能**。网页与 API、多个浏览器和多个 Key 共用同一账户预算。生成任务会先预留一个 `MAX_FILE_MB`，结束后按实际成功成品结算，因此每档生成预算应至少容得下一个文件上限，并为希望支持的并发数留足空间。失败和取消仍计任务次数。交付包含重复保存与 Range；HEAD 不计流量。小时额度也会约束日额度，例如把日解析设得很高不会绕过每小时 60 次。

### 本地统计

| 变量 | 默认值 | 怎么填 |
| --- | --- | --- |
| `ANALYTICS_ENABLED` | `1` | `0` 关闭新统计事件采集；不会关闭下载业务、账户用量账本或管理员历史 |
| `ANALYTICS_ENVIRONMENT` | `production`（模板） | 正式站点填 `production`，预览／验收填 `development` 或 `test`；非本地启用统计时漏填会拒绝启动 |
| `ANALYTICS_RETENTION_DAYS` | `30` | 1–30 天原始统计保留，与文件和下载历史保留期独立 |
| `ANALYTICS_MAX_DAILY_MB` | `16` | 每日统计事件逻辑字节预算，按 MiB 换算，不含数据库索引、WAL 和备份占用 |

### Stripe 订阅

| 变量 | 默认值 | 怎么填 |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | 空 | 测试模式 `sk_test_…`，正式模式 `sk_live_…`；服务端 Secret Key |
| `STRIPE_PRICE_ID` | 空 | 同一账户和模式的 `price_…` 周期价格 ID |
| `STRIPE_WEBHOOK_SECRET` | 空 | 本站 Webhook 端点对应的 `whsec_…` 签名密钥 |

三项同时留空代表不开放购买；任意一项有值时必须完整配置 Google 登录和全部 Stripe 变量。还需在 Stripe 后台配置 Portal 和事件订阅：`customer.subscription.created`、`customer.subscription.updated`、`customer.subscription.deleted`、`checkout.session.completed`、`invoice.paid`、`invoice.payment_failed`；使用延迟支付时加上 `checkout.session.async_payment_succeeded`。支付返回页面不直接授予权益，只有服务端核验的有效订阅才使用 Pro 额度。

## 修改配置与上线核对

新部署先准备 `.env`、HTTPS 反向代理和持久化卷；已有部署先按 [部署文档](server-deployment.md#sqlite-与旧数据迁移) 停服备份，再升级镜像。加载修改后的环境变量使用：

```bash
docker compose up -d --force-recreate website
```

`docker compose restart` 不读取改动后的 `.env`；`docker compose down -v` 会删除持久化卷，不能用于普通更新。不要把 `docker compose config` 的完整输出粘到 Issue 或提交到仓库，它会展开配置中的密钥。

上线后依次检查 `/healthz`、公开在线工具、登录弹框、`/dashboard`、管理员导航、`/admin/downloads` 和真实测试支付。普通用户直访 `/admin/downloads` 必须被拒绝；更改管理员名单后重新创建服务并再次核对。

高级目录覆盖 `APP_ROOT`、`WEBSITE_DIST`、`DOWNVID_WEB_DIST` 只供开发或定制镜像，标准 Compose 不填写；`KEEP_WEB_MODE` 由服务入口设置。构建辅助变量 `EXPORT_CATALOG` 不属于生产配置。系统 `PATH`、临时目录和 CI 构建变量也不需要复制到此模板。
