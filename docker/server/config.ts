import path from 'node:path'

/** 只在服务端读取；存储凭据不会注入前端构建。 */
export function readConfig(env = process.env) {
  const positive = (name: string, fallback: number) => {
    const value = Number(env[name] || fallback)
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`配置 ${name} 必须为正整数`)
    return value
  }
  const storage = env.STORAGE_DRIVER || 'local'
  if (!['local', 'r2'].includes(storage)) throw new Error('STORAGE_DRIVER 仅支持 local 或 r2')
  const origin = new URL(env.SITE_URL || 'http://localhost:6080')
  if (!['http:', 'https:'].includes(origin.protocol) || origin.pathname !== '/' || origin.username || origin.password || origin.search || origin.hash) throw new Error('SITE_URL 必须是站点源地址')
  const dataDir = path.resolve(env.DOWNVID_DATA_DIR || 'data/userdata')
  const analyticsEnvironment = env.ANALYTICS_ENVIRONMENT || 'development'
  const localOrigin = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname)
  if (!localOrigin && env.ANALYTICS_ENABLED !== '0' && !env.ANALYTICS_ENVIRONMENT) {
    throw new Error('非本地站点必须显式设置 ANALYTICS_ENVIRONMENT=production、development 或 test，避免统计环境误标')
  }
  if (!['production', 'development', 'test'].includes(analyticsEnvironment)) throw new Error('统计环境必须为 production、development 或 test')
  if (positive('ANALYTICS_RETENTION_DAYS', 30) > 180) throw new Error('统计原始事件最多保留 180 天')
  const workDir = path.resolve(env.DOWNVID_DOWNLOADS || 'data/downloads')
  const r2 = { endpoint: env.R2_ENDPOINT || '', bucket: env.R2_BUCKET || '', accessKeyId: env.R2_ACCESS_KEY_ID || '', secretAccessKey: env.R2_SECRET_ACCESS_KEY || '' }
  if (storage === 'r2') {
    if (Object.values(r2).some(value => !value)) throw new Error('R2 配置不完整')
    const endpoint = new URL(r2.endpoint)
    if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password) throw new Error('R2_ENDPOINT 必须使用 HTTPS')
  }
  const authSecret = env.BETTER_AUTH_SECRET || ''
  const googleClientId = env.GOOGLE_CLIENT_ID || ''
  const googleClientSecret = env.GOOGLE_CLIENT_SECRET || ''
  if (authSecret && authSecret.length < 32) throw new Error('BETTER_AUTH_SECRET 必须至少 32 字符')
  if (!!googleClientId !== !!googleClientSecret || (googleClientId && !authSecret)) throw new Error('Google 登录配置不完整')
  if (authSecret && !localOrigin && origin.protocol !== 'https:') throw new Error('启用账户时非本地 SITE_URL 必须使用 HTTPS')
  const list = (name: string) => (env[name] || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean)
  const stripeSecret = env.STRIPE_SECRET_KEY || '', stripeWebhookSecret = env.STRIPE_WEBHOOK_SECRET || '', stripePriceId = env.STRIPE_PRICE_ID || ''
  if ([stripeSecret, stripeWebhookSecret, stripePriceId].some(Boolean) && ![authSecret, googleClientId, stripeSecret, stripeWebhookSecret, stripePriceId].every(Boolean)) throw new Error('Stripe 订阅配置不完整')
  return { storage, origin: origin.origin, dataDir, workDir, r2,
    authSecret, googleClientId, googleClientSecret, adminEmails: list('ADMIN_EMAILS'), apiBetaEmails: list('API_BETA_EMAILS'), adminIds: list('ADMIN_USER_IDS'), apiBetaIds: list('API_BETA_USER_IDS'),
    stripeSecret, stripeWebhookSecret, stripePriceId,
    accountParseDaily: positive('ACCOUNT_PARSE_DAILY_LIMIT', 500), accountDownloadDaily: positive('ACCOUNT_DOWNLOAD_DAILY_LIMIT', 100),
    proParseDaily: positive('PRO_PARSE_DAILY_LIMIT', 2000), proDownloadDaily: positive('PRO_DOWNLOAD_DAILY_LIMIT', 500),
    accountGeneratedBytes: positive('ACCOUNT_GENERATED_DAILY_MB', 10240) * 1048576, proGeneratedBytes: positive('PRO_GENERATED_DAILY_MB', 51200) * 1048576,
    accountDeliveryBytes: positive('ACCOUNT_DELIVERY_DAILY_MB', 20480) * 1048576, proDeliveryBytes: positive('PRO_DELIVERY_DAILY_MB', 102400) * 1048576,
    guestGeneratedBytes: positive('WEB_GENERATED_DAILY_MB', 4096) * 1048576, guestDeliveryBytes: positive('WEB_DELIVERY_DAILY_MB', 10240) * 1048576,
    ownerConcurrency: positive('WEB_OWNER_CONCURRENCY', 2),
    historyRetentionDays: positive('DOWNLOAD_HISTORY_RETENTION_DAYS', 90),
    analyticsEnabled: env.ANALYTICS_ENABLED !== '0', analyticsEnvironment: analyticsEnvironment as 'production' | 'development' | 'test',
    analyticsRetentionDays: positive('ANALYTICS_RETENTION_DAYS', 30),
    analyticsMaxDailyBytes: positive('ANALYTICS_MAX_DAILY_MB', 16) * 1024 * 1024,
    port: positive('DOWNVID_WEB_PORT', 6080), host: env.DOWNVID_WEB_HOST || '127.0.0.1',
    concurrency: positive('WEB_CONCURRENCY', 3), maxQueued: positive('WEB_MAX_QUEUED', 30),
    parseHourlyLimit: positive('WEB_PARSE_HOURLY_LIMIT', 60), parseDailyLimit: positive('WEB_PARSE_DAILY_LIMIT', 200),
    downloadDailyLimit: positive('WEB_DOWNLOAD_DAILY_LIMIT', 30),
    maxSessionTasks: positive('WEB_SESSION_TASKS', 10), ttl: positive('FILE_TTL_HOURS', 24) * 3600000,
    taskTimeout: positive('TASK_TIMEOUT_MINUTES', 60) * 60000,
    maxFileBytes: positive('MAX_FILE_MB', 2048) * 1024 * 1024,
  }
}
export type Config = ReturnType<typeof readConfig>
