import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Auth } from './auth'
import type { Api } from './api'
import type { Jobs } from './jobs'
import type { Billing } from './billing'
import { scopes } from './platform-store'
import { formBody, HttpError, privateHeaders, redirect, json } from './http'
import { page, table, platformStyle, esc, bytes, date, stateLabel } from './platform-page'
import { accountTranslator } from '../../src/i18n/account'

export function createAccount(auth: Auth, api: Api, jobs: Jobs, billing: Billing, revokeSockets: (owner: string) => void) {
  async function handle(req: IncomingMessage, res: ServerResponse, url: URL) {
    if (!['/pricing', '/developers', '/account', '/dashboard', '/dashboard/', '/login', '/api/account/session', '/api/account/login'].includes(url.pathname) && !url.pathname.startsWith('/account/')) return false
    privateHeaders(res)
    res.setHeader('Content-Security-Policy', String(res.getHeader('Content-Security-Policy')).replace("form-action 'self'", "form-action 'self' https://accounts.google.com https://checkout.stripe.com https://billing.stripe.com"))
    const lang = url.searchParams.get('lang') === 'zh' ? 'zh' : 'en', t = accountTranslator(lang), suffix = '?lang=' + lang
    const loginLocation = (lang === 'zh' ? '/zh/' : '/') + '?login=1'
    if (['/pricing', '/developers'].includes(url.pathname)) res.setHeader('Content-Security-Policy', String(res.getHeader('Content-Security-Policy')).replace("script-src 'none'", "script-src 'self'").replace("default-src 'none'", "default-src 'none'; connect-src 'self'"))
    const send = (status: number, html: string, type = 'text/html; charset=utf-8') => { res.writeHead(status, { 'Content-Type': type }); res.end(req.method === 'HEAD' ? undefined : html) }
    const button = (action: string, key: Parameters<typeof t>[0], extra = '') => `<form action="${action}${suffix}" method="post">${extra}<button class="primary">${esc(t(key))}</button></form>`
    try {
      if (url.pathname === '/account/style.css' && ['GET', 'HEAD'].includes(req.method || '')) { send(200, platformStyle, 'text/css; charset=utf-8'); return true }
      const identity = await auth.identity(req)
      const account = identity?.account
      const dashboardLink = (key: Parameters<typeof t>[0]) => account ? `<a class="button" href="/dashboard${suffix}">${esc(t(key))}</a>` : `<button type="button" class="button" data-login-trigger data-dashboard-label="${esc(t('dashboard'))}">${esc(t('signIn'))}</button>`
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
          redirect(res, lang === 'zh' ? '/zh/' : '/'); return true
        }
        if (url.pathname === '/account/claim') {
          if (!identity.guest || input.get('confirm') !== 'yes') throw new HttpError(400, 'confirmation-required')
          jobs.claim(identity.guest, identity.owner); revokeSockets(identity.guest)
          redirect(res, '/dashboard' + suffix); return true
        }
        if (url.pathname === '/account/keys') {
          const key = api.createKey(identity, { label: input.get('label'), scopes: input.getAll('scopes'), days: input.get('days') })
          send(201, page('keys', `<h1>${esc(t('keys'))}</h1><p class="notice">${esc(t('token'))}</p><pre class="secret">${esc(key.token)}</pre><a class="button" href="/dashboard${suffix}">${esc(t('back'))}</a>`, lang, false, '/dashboard', { dashboard: true, administrator: auth.store.admin(account) })); return true
        }
        if (url.pathname === '/account/keys/revoke') {
          api.revoke(identity.owner, input.get('id') || ''); redirect(res, '/dashboard' + suffix); return true
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
        const guest = auth.store.limits('guest')
        const plans = [
          { ...guest, plan: 'guest' },
          { ...guest, plan: 'free', parses: config.accountParseDaily, downloads: config.accountDownloadDaily, generatedBytes: config.accountGeneratedBytes, deliveredBytes: config.accountDeliveryBytes },
          { ...guest, plan: 'pro', parses: config.proParseDaily, downloads: config.proDownloadDaily, generatedBytes: config.proGeneratedBytes, deliveredBytes: config.proDeliveryBytes },
        ]
        const priceText = price ? new Intl.NumberFormat(lang, { style: 'currency', currency: price.currency }).format(price.amount / (['bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf'].includes(price.currency) ? 1 : 100)) + ' / ' + price.intervalCount + ' ' + t(({ day: 'subscriptionDay', week: 'subscriptionWeek', month: 'subscriptionMonth', year: 'subscriptionYear' } as const)[price.interval as 'day']) : ''
        const cards = plans.map(plan => `<section class="plan"><h2>${esc(t(plan.plan as 'guest'))}</h2><p>${plan.plan === 'pro' ? esc(priceText || t(priceFailed ? 'priceUnavailable' : 'billingUnavailable')) : esc(t(plan.plan === 'guest' ? 'anonymous' : 'signedIn'))}</p><dl>${[['parses', plan.parses], ['hourlyParses', plan.hourlyParses], ['downloads', plan.downloads], ['generated', bytes(plan.generatedBytes)], ['delivered', bytes(plan.deliveredBytes)], ['maxFile', bytes(plan.maxFileBytes)], ['concurrency', plan.concurrent], ['retainedTasks', plan.retainedTasks], ['timeout', plan.timeoutMs / 60000], ['expiry', config.ttl / 3600000 + ' ' + t('hour')]].map(([key, value]) => `<div><dt>${esc(t(key as 'parses'))}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>${plan.plan === 'guest' ? `<a class="button" href="${lang === 'zh' ? '/zh' : ''}/app/">${esc(t('tool'))}</a>` : plan.plan === 'pro' && price && account ? button('/account/checkout', 'purchase') : dashboardLink('dashboard')}</section>`).join('')
        send(200, page('pricing', `<h1>${esc(t('pricing'))}</h1><p class="intro">${esc(t('planNote'))}</p><div class="plan-grid">${cards}</div><p class="note">${esc(t('usageNote'))}</p>`, lang, false, '', { publicLogin: true })); return true
      }
      if (url.pathname === '/developers') {
        const example = `curl '${jobs.config.origin}/api/v1/parse' \\\n  -H 'Authorization: Bearer YOUR_API_KEY' \\\n  -H 'Content-Type: application/json' \\\n  --data '{"url":"https://www.youtube.com/watch?v=YOUR_VIDEO_ID"}'\n\ncurl '${jobs.config.origin}/api/v1/downloads' \\\n  -H 'Authorization: Bearer YOUR_API_KEY' \\\n  -H 'Idempotency-Key: your-task-unique-id' \\\n  -H 'Content-Type: application/json' \\\n  --data '{"parseId":"PARSE_ID","formatId":"FORMAT_ID"}'\n\ncurl '${jobs.config.origin}/api/v1/downloads/JOB_ID' -H 'Authorization: Bearer YOUR_API_KEY'\ncurl '${jobs.config.origin}/api/v1/files/JOB_ID' -H 'Authorization: Bearer YOUR_API_KEY' -o video.mp4`
        send(200, page('developers', `<h1>${esc(t('developers'))}</h1><p class="intro">${esc(t('developerIntro'))}</p><section class="section"><h2>${esc(t('apiSteps'))}</h2><p>${esc(t('apiNote'))}</p><pre class="secret">${esc(example)}</pre></section>${table(['API', t('scopes')], [['POST /api/v1/parse', 'media:parse'], ['POST /api/v1/downloads', 'downloads:create'], ['GET /api/v1/downloads/:id', 'downloads:read'], ['POST /api/v1/downloads/:id/cancel', 'downloads:cancel'], ['GET /api/v1/files/:id', 'files:read'], ['GET /api/v1/usage', 'downloads:read']].map(row => row.map(esc)))}<p class="note">${esc(t('beta'))}</p>${dashboardLink('keys')}`, lang, false, '', { publicLogin: true })); return true
      }
      if (['/account', '/account/', '/login'].includes(url.pathname)) {
        redirect(res, account ? '/dashboard' + suffix : loginLocation); return true
      }
      if (!['/dashboard', '/dashboard/'].includes(url.pathname)) throw new HttpError(404, 'not-found')
      if (!account || !identity) { redirect(res, loginLocation); return true }
      const usage = auth.store.usage(identity.owner), limits = auth.store.limits(identity.owner), beta = auth.store.beta(account)
      const stats = `<dl class="metrics account-metrics">${[['downloads', usage.downloads + ' / ' + limits.downloads], ['parses', usage.parses + ' / ' + limits.parses], ['generated', bytes(usage.generatedBytes) + ' / ' + bytes(limits.generatedBytes)], ['delivered', bytes(usage.deliveredBytes) + ' / ' + bytes(limits.deliveredBytes)]].map(([key, value]) => `<div class="metric"><dt>${esc(t(key as 'downloads'))}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>`
      const tasks = jobs.list(identity.owner).filter(job => Date.parse(job.expiresAt) > Date.now())
      const taskTable = table(['title', 'status', 'expires', 'save'].map(key => t(key as 'title')), tasks.map(job => [esc(job.title), esc(stateLabel(job.status, lang)), esc(date(Date.parse(job.expiresAt))), job.fileExists ? `<a href="${esc(job.filePath)}" download>${esc(t('save'))}</a>` : '—']))
      const claim = identity.guest && jobs.state.jobsForOwner(identity.guest).length ? `<section class="section"><h2>${esc(t('claimTitle'))}</h2><p>${esc(t('claimBody'))}</p>${button('/account/claim', 'claim', '<input type="hidden" name="confirm" value="yes">')}</section>` : ''
      const keyTable = table(['label', 'scopes', 'expires', 'lastUsed', 'revoke'].map(key => t(key as 'label')), api.keys(identity.owner).map(key => [esc(key.label) + `<div class="status">${esc(key.prefix)}…</div>`, esc(JSON.parse(String(key.scopes)).join(', ')), esc(date(Number(key.expires_at))), esc(date(key.last_used === null ? null : Number(key.last_used))), key.revoked_at || Number(key.expires_at) <= Date.now() ? '—' : button('/account/keys/revoke', 'revoke', `<input type="hidden" name="id" value="${esc(key.id)}">`)]))
      const keyForm = beta ? `<form class="key-form" action="/account/keys${suffix}" method="post"><label>${esc(t('label'))}<input name="label" type="text" maxlength="80" required></label><label>${esc(t('days'))}<input name="days" type="number" min="1" max="365" value="90" required></label><fieldset><legend>${esc(t('scopes'))}</legend><div class="scopes">${scopes.map(scope => `<label><input type="checkbox" name="scopes" value="${scope}">${scope}</label>`).join('')}</div></fieldset><button class="primary">${esc(t('createKey'))}</button></form>` : `<p class="notice">${esc(t('beta'))}</p>`
      const customer = auth.store.db.prepare('SELECT 1 FROM billing_customers WHERE owner = ?').get(identity.owner)
      const subscriptions = auth.store.db.prepare('SELECT status,period_end FROM subscriptions WHERE owner = ? ORDER BY updated_at DESC LIMIT 5').all(identity.owner)
      send(200, page('dashboard', `<div class="inline"><h1 class="identity">${esc(account.name)}</h1>${button('/account/logout', 'logout')}${auth.store.admin(account) ? `<a class="button" href="/admin">${esc(t('admin'))}</a>` : ''}</div><p class="intro identity">${esc(account.email)} · ${esc(t(limits.plan as 'free'))}</p><p class="status identity">${esc(t('accountId'))}: ${esc(account.id)}</p>${url.searchParams.get('checkout') === 'pending' && !auth.store.paid(identity.owner) ? `<p class="notice">${esc(t('pending'))}</p>` : ''}${claim}<section id="usage" class="section"><h2>${esc(t('usage'))}</h2>${stats}<p class="note">${esc(t('reserved'))}: ${bytes(usage.reservedBytes)} · ${esc(t('deliveryUnconfirmed'))}: ${bytes(usage.uncertainDeliveryBytes)} · ${esc(t('usageNote'))}</p></section><section id="subscription" class="section"><h2>${esc(t('pricing'))}</h2><p>${esc(t('planNote'))}</p><div class="inline">${billing.stripe ? button('/account/checkout', 'purchase') : `<p class="note">${esc(t('billingUnavailable'))}</p>`}${customer && billing.stripe ? button('/account/billing', 'manage') : ''}<a class="button" href="/pricing${suffix}">${esc(t('pricing'))}</a></div>${subscriptions.length ? table([t('status'), t('expires')], subscriptions.map(row => [esc(stateLabel(row.status, lang)), esc(date(Number(row.period_end)))])) : ''}</section><section id="tasks" class="section"><h2>${esc(t('tasks'))}</h2>${taskTable}</section><section id="keys" class="section"><h2>${esc(t('keys'))}</h2><p>${esc(t('keyNote'))}</p>${keyForm}${keyTable}</section>`, lang, false, '/dashboard', { dashboard: true, administrator: auth.store.admin(account) })); return true
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
