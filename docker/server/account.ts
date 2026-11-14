import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Auth } from './auth'
import type { Api } from './api'
import type { Jobs } from './jobs'
import type { Billing } from './billing'
import { scopes } from './platform-store'
import { formBody, HttpError, privateHeaders, redirect, json } from './http'
import { page, table, platformStyle, esc, bytes, date, badge, heading, siteLocale, heatmap } from './platform-page'
import { accountTranslator } from '../../src/i18n/account'

const dashboardRoutes = ['/dashboard', '/dashboard/', '/dashboard/tasks', '/dashboard/keys', '/dashboard/account']

export function createAccount(auth: Auth, api: Api, jobs: Jobs, billing: Billing, revokeSockets: (owner: string) => void) {
  async function handle(req: IncomingMessage, res: ServerResponse, url: URL) {
    if (!['/pricing', '/developers', '/account', '/login', '/api/account/session', '/api/account/login', ...dashboardRoutes].includes(url.pathname) && !url.pathname.startsWith('/account/')) return false
    privateHeaders(res)
    res.setHeader('Content-Security-Policy', String(res.getHeader('Content-Security-Policy')).replace("form-action 'self'", "form-action 'self' https://accounts.google.com https://checkout.stripe.com https://billing.stripe.com"))
    const locale = siteLocale(url.searchParams.get('lang')), lang = locale.prefix || 'en', t = accountTranslator(locale.appLocale), suffix = '?lang=' + lang
    const home = locale.prefix ? `/${locale.prefix}/` : '/', loginLocation = home + '?login=1'
    if (['/pricing', '/developers'].includes(url.pathname)) res.setHeader('Content-Security-Policy', String(res.getHeader('Content-Security-Policy')).replace("script-src 'none'", "script-src 'self'").replace("default-src 'none'", "default-src 'none'; connect-src 'self'"))
    const send = (status: number, html: string, type = 'text/html; charset=utf-8') => { res.writeHead(status, { 'Content-Type': type }); res.end(req.method === 'HEAD' ? undefined : html) }
    const button = (action: string, key: Parameters<typeof t>[0], extra = '', className = 'primary') => `<form action="${action}${suffix}" method="post">${extra}<button class="${className}">${esc(t(key))}</button></form>`
    const toolHref = home + 'app/'
    try {
      if (url.pathname === '/account/style.css' && ['GET', 'HEAD'].includes(req.method || '')) { send(200, platformStyle, 'text/css; charset=utf-8'); return true }
      const identity = await auth.identity(req)
      const account = identity?.account
      const user = account ? { name: account.name, email: account.email } : undefined
      const administrator = !!account && auth.store.admin(account)
      const dashboardLink = (key: Parameters<typeof t>[0], path = '/dashboard') => account ? `<a class="button" href="${path}${suffix}">${esc(t(key))}</a>` : `<button type="button" class="button" data-login-trigger data-dashboard-label="${esc(t('dashboard'))}">${esc(t('signIn'))}</button>`
      if (url.pathname === '/api/account/session') {
        if (!['GET', 'HEAD'].includes(req.method || '')) throw new HttpError(405, 'method-not-allowed')
        if (req.method === 'HEAD') res.writeHead(200).end()
        else json(res, 200, { authenticated: !!account, loginEnabled: !!jobs.config.googleClientId })
        return true
      }
      if (req.method === 'POST') {
        if (req.headers.origin !== jobs.config.origin) throw new HttpError(403, 'invalid-origin')
        if (url.pathname === '/account/login' || url.pathname === '/api/account/login') {
          await formBody(req)
          if (!jobs.config.googleClientId) throw new HttpError(503, 'login-unavailable')
          const response = await auth.call(req, 'sign-in/social', { provider: 'google', callbackURL: '/dashboard' + suffix, errorCallbackURL: loginLocation, disableRedirect: true })
          auth.cookies(response, res)
          if (!response.ok) throw new HttpError(503, 'login-unavailable')
          const result = await response.json() as { url?: string }
          if (!result.url || new URL(result.url).origin !== 'https://accounts.google.com') throw new HttpError(503, 'login-unavailable')
          if (url.pathname === '/api/account/login') json(res, 200, { url: result.url })
          else redirect(res, result.url)
          return true
        }
        if (!account || !identity) throw new HttpError(401, 'login-required')
        const input = await formBody(req)
        if (url.pathname === '/account/logout') {
          const response = await auth.call(req, 'sign-out', {})
          if (!response.ok) throw new HttpError(503, 'logout-failed')
          auth.cookies(response, res); revokeSockets(identity.owner)
          redirect(res, home); return true
        }
        if (url.pathname === '/account/claim') {
          if (!identity.guest || input.get('confirm') !== 'yes') throw new HttpError(400, 'confirmation-required')
          jobs.claim(identity.guest, identity.owner); revokeSockets(identity.guest)
          redirect(res, '/dashboard' + suffix); return true
        }
        if (url.pathname === '/account/keys') {
          const key = api.createKey(identity, { label: input.get('label'), scopes: input.getAll('scopes'), days: input.get('days') })
          send(201, page('keys', heading(esc(t('keys'))) + `<p class="notice">${esc(t('token'))}</p><pre class="secret">${esc(key.token)}</pre><a class="button" href="/dashboard/keys${suffix}">${esc(t('keys'))}</a>`, lang, false, '/dashboard/keys', { dashboard: true, administrator, user })); return true
        }
        if (url.pathname === '/account/keys/revoke') {
          api.revoke(identity.owner, input.get('id') || ''); redirect(res, '/dashboard/keys' + suffix); return true
        }
        if (['/account/checkout', '/account/billing'].includes(url.pathname)) {
          if (!account.verified) throw new HttpError(403, 'verified-account-required')
          redirect(res, url.pathname.endsWith('/checkout') ? await billing.checkout(identity.owner) : await billing.portal(identity.owner)); return true
        }
        throw new HttpError(404, 'not-found')
      }
      if (!['GET', 'HEAD'].includes(req.method || '')) throw new HttpError(405, 'method-not-allowed')
      if (url.pathname === '/pricing') {
        const config = jobs.config
        let price: Awaited<ReturnType<typeof billing.price>>, priceFailed = false
        try { price = await billing.price() } catch { priceFailed = true }
        const guest = auth.store.limits('guest'), currentPlan = identity && account ? auth.store.limits(identity.owner).plan : ''
        const plans = [
          { ...guest, plan: 'guest' },
          { ...guest, plan: 'free', parses: config.accountParseDaily, downloads: config.accountDownloadDaily, generatedBytes: config.accountGeneratedBytes, deliveredBytes: config.accountDeliveryBytes },
          { ...guest, plan: 'pro', parses: config.proParseDaily, downloads: config.proDownloadDaily, generatedBytes: config.proGeneratedBytes, deliveredBytes: config.proDeliveryBytes },
        ]
        const priceText = price ? new Intl.NumberFormat(locale.appLocale, { style: 'currency', currency: price.currency }).format(price.amount / (['bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf'].includes(price.currency) ? 1 : 100)) + ' / ' + price.intervalCount + ' ' + t(({ day: 'subscriptionDay', week: 'subscriptionWeek', month: 'subscriptionMonth', year: 'subscriptionYear' } as const)[price.interval as 'day']) : ''
        const cards = plans.map(plan => `<section class="plan${plan.plan === currentPlan ? ' current' : ''}"><div class="inline"><h2>${esc(t(plan.plan as 'guest'))}</h2>${plan.plan === currentPlan ? `<span class="badge badge-info">${esc(t('currentPlan'))}</span>` : ''}</div><p>${plan.plan === 'pro' ? esc(priceText || t(priceFailed ? 'priceUnavailable' : 'billingUnavailable')) : esc(t(plan.plan === 'guest' ? 'anonymous' : 'signedIn'))}</p><dl>${[['parses', plan.parses], ['hourlyParses', plan.hourlyParses], ['downloads', plan.downloads], ['generated', bytes(plan.generatedBytes)], ['delivered', bytes(plan.deliveredBytes)], ['maxFile', bytes(plan.maxFileBytes)], ['concurrency', plan.concurrent], ['retainedTasks', plan.retainedTasks], ['timeout', plan.timeoutMs / 60000], ['expiry', config.ttl / 3600000 + ' ' + t('hour')]].map(([key, value]) => `<div><dt>${esc(t(key as 'parses'))}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>${plan.plan === 'guest' ? `<a class="button" href="${toolHref}">${esc(t('tool'))}</a>` : plan.plan === 'pro' && price && account && currentPlan !== 'pro' ? button('/account/checkout', 'purchase') : dashboardLink('dashboard')}</section>`).join('')
        send(200, page('pricing', heading(esc(t('pricing')), esc(t('planNote'))) + `<div class="plan-grid">${cards}</div><p class="note">${esc(t('usageNote'))}</p>`, lang, false, '/pricing', { publicLogin: true, user })); return true
      }
      if (url.pathname === '/developers') {
        const example = `curl '${jobs.config.origin}/api/v1/parse' \\\n  -H 'Authorization: Bearer YOUR_API_KEY' \\\n  -H 'Content-Type: application/json' \\\n  --data '{"url":"https://www.youtube.com/watch?v=YOUR_VIDEO_ID"}'\n\ncurl '${jobs.config.origin}/api/v1/downloads' \\\n  -H 'Authorization: Bearer YOUR_API_KEY' \\\n  -H 'Idempotency-Key: your-task-unique-id' \\\n  -H 'Content-Type: application/json' \\\n  --data '{"parseId":"PARSE_ID","formatId":"FORMAT_ID"}'\n\ncurl '${jobs.config.origin}/api/v1/downloads/JOB_ID' -H 'Authorization: Bearer YOUR_API_KEY'\ncurl '${jobs.config.origin}/api/v1/files/JOB_ID' -H 'Authorization: Bearer YOUR_API_KEY' -o video.mp4`
        send(200, page('developers', heading(esc(t('developers')), esc(t('developerIntro')), dashboardLink('keys', '/dashboard/keys')) + `<section class="card"><div class="card-head"><div><h2>${esc(t('apiSteps'))}</h2><p>${esc(t('apiNote'))}</p></div></div><pre class="secret">${esc(example)}</pre></section><section class="card flush">${table(['API', t('scopes')], [['POST /api/v1/parse', 'media:parse'], ['POST /api/v1/downloads', 'downloads:create'], ['GET /api/v1/downloads/:id', 'downloads:read'], ['POST /api/v1/downloads/:id/cancel', 'downloads:cancel'], ['GET /api/v1/files/:id', 'files:read'], ['GET /api/v1/usage', 'downloads:read']].map(row => [`<code>${esc(row[0])}</code>`, `<code>${esc(row[1])}</code>`]))}</section><p class="note">${esc(t('beta'))}</p>`, lang, false, '/developers', { publicLogin: true, user })); return true
      }
      if (['/account', '/account/', '/login'].includes(url.pathname)) {
        redirect(res, account ? '/dashboard' + suffix : loginLocation); return true
      }
      if (!dashboardRoutes.includes(url.pathname)) throw new HttpError(404, 'not-found')
      if (!account || !identity) { redirect(res, loginLocation); return true }
      const route = url.pathname.replace(/\/$/, '')
      const shell = (title: Parameters<typeof t>[0], content: string) => page(title, content, lang, false, route, { dashboard: true, administrator, user })
      const usage = auth.store.usage(identity.owner), limits = auth.store.limits(identity.owner), beta = auth.store.beta(account)
      const customer = auth.store.db.prepare('SELECT 1 FROM billing_customers WHERE owner = ?').get(identity.owner)
      const startButton = `<a class="button primary" href="${toolHref}">${esc(t('startDownload'))}</a>`
      const tasks = jobs.list(identity.owner).filter(job => Date.parse(job.expiresAt) > Date.now())
      const taskTable = (rows: typeof tasks) => rows.length ? table(['title', 'status', 'expires', 'save'].map(key => t(key as 'title')), rows.map(job => [`<span class="task-title">${esc(job.title)}</span>`, badge(job.status, locale.appLocale), esc(date(Date.parse(job.expiresAt))), job.fileExists ? `<a class="button small" href="${esc(job.filePath)}" download>${esc(t('save'))}</a>` : '—'])) : `<div class="empty-state"><p>${esc(t('noTasks'))}</p>${startButton}</div>`
      const planActions = `${billing.stripe && limits.plan !== 'pro' ? button('/account/checkout', 'purchase') : ''}${customer && billing.stripe ? button('/account/billing', 'manage', '', '') : ''}<a class="button" href="/pricing${suffix}">${esc(t('comparePlans'))}</a>`
      const planNotice = billing.stripe ? '' : `<p class="note">${esc(t('billingUnavailable'))}</p>`
      if (route === '/dashboard/tasks') {
        send(200, shell('tasks', heading(esc(t('tasks')), esc(t('tasksIntro')), startButton) + `<section class="card flush tasks">${taskTable(tasks)}</section>`)); return true
      }
      if (route === '/dashboard/keys') {
        const keys = api.keys(identity.owner)
        const keyTable = table(['label', 'scopes', 'expires', 'lastUsed', ''].map(key => key ? t(key as 'label') : ''), keys.map(key => [esc(key.label) + `<div class="key-prefix">${esc(key.prefix)}…</div>`, `<div class="scope-list">${(JSON.parse(String(key.scopes)) as string[]).map(scope => `<code>${esc(scope)}</code>`).join('')}</div>`, esc(date(Number(key.expires_at))), esc(date(key.last_used === null ? null : Number(key.last_used))), key.revoked_at || Number(key.expires_at) <= Date.now() ? '—' : button('/account/keys/revoke', 'revoke', `<input type="hidden" name="id" value="${esc(key.id)}">`, 'danger small')]))
        const keyForm = beta ? `<section class="card"><div class="card-head"><h2>${esc(t('newKey'))}</h2></div><form class="key-form" action="/account/keys${suffix}" method="post"><label>${esc(t('label'))}<input name="label" type="text" maxlength="80" required></label><label>${esc(t('days'))}<input name="days" type="number" min="1" max="365" value="90" required></label><fieldset><legend>${esc(t('scopes'))}</legend><div class="scopes">${scopes.map(scope => `<label><input type="checkbox" name="scopes" value="${scope}">${scope}</label>`).join('')}</div></fieldset><div class="form-actions"><button class="primary">${esc(t('createKey'))}</button></div></form></section>` : `<p class="notice">${esc(t('beta'))}</p>`
        send(200, shell('keys', heading(esc(t('keys')), esc(t('keyNote')), `<a class="button" href="/developers${suffix}">${esc(t('viewDocs'))}</a>`) + keyForm + (beta || keys.length ? `<section class="card flush"><div class="card-head"><h2>${esc(t('existingKeys'))}</h2></div>${keyTable}</section>` : ''))); return true
      }
      if (route === '/dashboard/account') {
        const subscriptions = auth.store.db.prepare('SELECT status,period_end FROM subscriptions WHERE owner = ? ORDER BY updated_at DESC LIMIT 5').all(identity.owner)
        const facts = [['nameField', esc(account.name)], ['email', esc(account.email)], ['accountId', `<code>${esc(account.id)}</code>`], ['currentPlan', esc(t(limits.plan as 'free'))]].map(([key, value]) => `<div><dt>${esc(t(key as 'email'))}</dt><dd>${value}</dd></div>`).join('')
        send(200, shell('accountPage', heading(esc(t('accountPage'))) + `<section class="card"><div class="card-head"><h2>${esc(t('profile'))}</h2>${button('/account/logout', 'logout', '', 'danger small')}</div><dl class="facts">${facts}</dl></section><section class="card"><div class="card-head"><div><h2>${esc(t('subscription'))}</h2><p>${esc(t('planNote'))}</p></div></div><div class="inline">${planActions}</div>${planNotice}${subscriptions.length ? `<div class="history-block">` + table([t('status'), t('expires')], subscriptions.map(row => [badge(row.status, locale.appLocale), esc(date(Number(row.period_end)))])) + '</div>' : ''}</section>`)); return true
      }
      const meter = (key: Parameters<typeof t>[0], used: number, limit: number, format: (n: number) => string | number = n => n) => `<div class="usage-card"><dt>${esc(t(key))}</dt><dd>${esc(format(used))} <small>/ ${esc(format(limit))}</small></dd><progress max="${Math.max(1, limit)}" value="${Math.min(used, limit)}" aria-label="${esc(t(key))}"></progress></div>`
      const claim = identity.guest && jobs.state.jobsForOwner(identity.guest).length ? `<section class="card section"><div class="card-head"><div><h2>${esc(t('claimTitle'))}</h2><p>${esc(t('claimBody'))}</p></div>${button('/account/claim', 'claim', '<input type="hidden" name="confirm" value="yes">')}</div></section>` : ''
      const pending = url.searchParams.get('checkout') === 'pending' && !auth.store.paid(identity.owner) ? `<p class="notice">${esc(t('pending'))}</p>` : ''
      const activity = auth.store.activity(identity.owner), activityTotal = activity.counts.reduce((sum, n) => sum + n, 0)
      const fill = (text: string, values: Record<string, string | number>) => text.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''))
      const numberFormat = new Intl.NumberFormat(locale.appLocale)
      const activityCard = heatmap(activity, {
        title: t('activityTitle'), summary: fill(t('activitySummary'), { total: numberFormat.format(activityTotal) }),
        day: (day, count) => fill(t('activityDay'), { date: day, count: numberFormat.format(count) }),
        less: t('activityLess'), more: t('activityMore'), note: t('activityNote'),
      })
      const overview = heading(esc(t('dashboard')), esc(t('intro')), startButton) + pending + claim
        + `<section id="usage" class="section"><div class="card-head"><h2>${esc(t('usage'))}</h2></div><dl class="usage-grid">${meter('downloads', usage.downloads, limits.downloads)}${meter('parses', usage.parses, limits.parses)}${meter('generated', usage.generatedBytes, limits.generatedBytes, bytes)}${meter('delivered', usage.deliveredBytes, limits.deliveredBytes, bytes)}</dl><details class="details-note"><summary>${esc(t('usageDetails'))}</summary><p>${esc(t('reserved'))}: ${bytes(usage.reservedBytes)} · ${esc(t('deliveryUnconfirmed'))}: ${bytes(usage.uncertainDeliveryBytes)}</p><p>${esc(t('usageNote'))}</p></details></section>`
        + activityCard
        + `<div class="grid-2"><section class="card flush tasks"><div class="card-head"><h2>${esc(t('recentTasks'))}</h2>${tasks.length ? `<a class="text-link" href="/dashboard/tasks${suffix}">${esc(t('viewAll'))} →</a>` : ''}</div>${taskTable(tasks.slice(0, 5))}</section><section class="card plan-card"><div class="card-head"><h2>${esc(t('currentPlan'))}</h2></div><p class="plan-name">${esc(t(limits.plan as 'free'))}</p><p>${esc(t('planNote'))}</p><div class="actions">${planActions}</div>${planNotice}</section></div>`
      send(200, shell('dashboard', overview)); return true
    } catch (error) {
      const safe = error instanceof HttpError ? error : new HttpError(503, 'unavailable')
      if (req.method === 'POST') res.setHeader('Connection', 'close')
      if (url.pathname.startsWith('/api/') || safe.status === 401) { json(res, safe.status, { error: safe.code }); return true }
      send(safe.status, page('dashboard', `<h1>${esc(t('account'))}</h1><p class="notice" role="alert">${esc(t('error'))}</p><a class="button" href="/dashboard${suffix}">${esc(t('back'))}</a>`, lang))
    }
    return true
  }
  return { handle }
}
