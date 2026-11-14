import Stripe from 'stripe'
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Config } from './config'
import type { PlatformStore } from './platform-store'
import { hash } from './platform-store'
import { transaction } from './sqlite'
import { body, HttpError, json, privateHeaders } from './http'

/** 浏览器返回页不授予权益；只从验证签名后重新读取的订阅状态更新权益。 */
export class Billing {
  readonly stripe?: Stripe
  private priceCache?: { at: number; value: { amount: number; currency: string; interval: string; intervalCount: number } }
  private priceLoading?: Promise<{ amount: number; currency: string; interval: string; intervalCount: number }>
  private priceFailedAt = 0
  private events: Promise<unknown> = Promise.resolve()
  constructor(readonly config: Config, readonly store: PlatformStore, stripe?: Stripe) {
    this.stripe = stripe || (config.stripeSecret ? new Stripe(config.stripeSecret, { timeout: 15000, maxNetworkRetries: 2 }) : undefined)
  }
  async price() {
    if (!this.stripe) return undefined
    if (this.priceCache && Date.now() - this.priceCache.at < 300000) return this.priceCache.value
    if (this.priceLoading) return this.priceLoading
    if (Date.now() - this.priceFailedAt < 30000) throw new HttpError(503, 'billing-unavailable')
    this.priceLoading = this.stripe.prices.retrieve(this.config.stripePriceId).then(price => {
      if (!price.active || price.type !== 'recurring' || !price.recurring || price.unit_amount === null || price.billing_scheme !== 'per_unit' || price.recurring.usage_type !== 'licensed') throw new HttpError(503, 'billing-unavailable')
      const value = { amount: price.unit_amount, currency: price.currency, interval: String(price.recurring.interval), intervalCount: price.recurring.interval_count }
      this.priceCache = { at: Date.now(), value }
      return value
    }).catch(error => { this.priceFailedAt = Date.now(); throw error }).finally(() => { this.priceLoading = undefined })
    return this.priceLoading
  }
  async customer(owner: string) {
    if (!this.stripe) throw new HttpError(503, 'billing-unavailable')
    const row = this.store.db.prepare('SELECT customer_id FROM billing_customers WHERE owner = ?').get(owner)
    if (row) return String(row.customer_id)
    const account = this.store.account(owner)
    if (!account || account.disabled || !account.verified) throw new HttpError(403, 'verified-account-required')
    const customer = await this.stripe.customers.create({ email: account.email, name: account.name, metadata: { keep_owner: owner } }, { idempotencyKey: 'keep-customer:' + hash(owner) })
    this.store.db.prepare('INSERT INTO billing_customers VALUES (?, ?) ON CONFLICT(owner) DO NOTHING').run(owner, customer.id)
    return String(this.store.db.prepare('SELECT customer_id FROM billing_customers WHERE owner = ?').get(owner)!.customer_id)
  }
  async checkout(owner: string) {
    if (!this.stripe) throw new HttpError(503, 'billing-unavailable')
    await this.price()
    if (this.store.paid(owner)) return this.portal(owner)
    const customer = await this.customer(owner)
    // 门户管理已有订阅，避免付款重试或网络中断产生第二份有效订阅。
    const subscriptions = await this.stripe.subscriptions.list({ customer, status: 'all', limit: 100 })
    if (subscriptions.data.some(sub => !['canceled', 'incomplete_expired'].includes(sub.status))) return this.portal(owner)
    const sessions = await this.stripe.checkout.sessions.list({ customer, status: 'open', limit: 10 })
    const open = sessions.data.find(session => session.metadata?.keep_owner === owner && session.mode === 'subscription')
    if (open?.url) return open.url
    const now = Date.now()
    const request = transaction(this.store.db, () => {
      const row = this.store.db.prepare('SELECT * FROM billing_requests WHERE owner = ? AND expires_at > ?').get(owner, now)
      if (row && Number(row.expires_at) > now + 31 * 60000) return { id: String(row.request_id), expires: Number(row.expires_at) }
      const value = { id: randomUUID(), expires: now + 35 * 60000 }
      this.store.db.prepare('INSERT OR REPLACE INTO billing_requests VALUES (?,?,?)').run(owner, value.id, value.expires)
      return value
    })
    const checkout = await this.stripe.checkout.sessions.create({ mode: 'subscription', customer, client_reference_id: owner,
      line_items: [{ price: this.config.stripePriceId, quantity: 1 }],
      success_url: this.config.origin + '/dashboard?checkout=pending', cancel_url: this.config.origin + '/dashboard',
      expires_at: Math.floor(request.expires / 1000), metadata: { keep_owner: owner }, subscription_data: { metadata: { keep_owner: owner } },
    }, { idempotencyKey: 'keep-checkout:' + request.id })
    if (!checkout.url) throw new HttpError(503, 'billing-unavailable')
    return checkout.url
  }
  async portal(owner: string) {
    if (!this.stripe) throw new HttpError(503, 'billing-unavailable')
    const row = this.store.db.prepare('SELECT customer_id FROM billing_customers WHERE owner = ?').get(owner)
    if (!row) throw new HttpError(404, 'subscription-not-found')
    const portal = await this.stripe.billingPortal.sessions.create({ customer: String(row.customer_id), return_url: this.config.origin + '/dashboard' })
    return portal.url
  }
  private async process(event: Stripe.Event) {
    const db = this.store.db
    if (db.prepare('SELECT 1 FROM billing_events WHERE id = ?').get(event.id)) return
    const object = event.data.object as any
    let id: string | undefined
    if (event.type.startsWith('customer.subscription.')) id = object.id
    else if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') id = typeof object.subscription === 'string' ? object.subscription : object.subscription?.id
    else if (event.type === 'invoice.paid' || event.type === 'invoice.payment_failed') {
      const reference = object.parent?.subscription_details?.subscription || object.subscription
      id = typeof reference === 'string' ? reference : reference?.id
    }
    if (!id) { db.prepare('INSERT OR IGNORE INTO billing_events VALUES (?,?)').run(event.id, Date.now()); return }
    // 串行消费且每次读取上游当前状态，重放或乱序通知不会恢复已取消权益。
    const subscription = await this.stripe!.subscriptions.retrieve(id)
    const customer = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id
    const account = db.prepare('SELECT owner FROM billing_customers WHERE customer_id = ?').get(customer)
    if (!account) {
      if (subscription.metadata?.keep_owner?.startsWith('u:')) throw new HttpError(503, 'billing-customer-not-ready')
      db.prepare('INSERT OR IGNORE INTO billing_events VALUES (?,?)').run(event.id, Date.now()); return
    }
    const item = subscription.items.data.find(value => value.price.id === this.config.stripePriceId)
    const period = item?.current_period_end || 0
    transaction(db, () => {
      db.prepare(`INSERT INTO subscriptions VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET price_id=excluded.price_id,status=excluded.status,period_end=excluded.period_end,updated_at=excluded.updated_at WHERE subscriptions.owner=excluded.owner AND subscriptions.customer_id=excluded.customer_id`)
        .run(subscription.id, String(account.owner), customer, item?.price.id || '', subscription.status, period * 1000, Date.now())
      db.prepare('INSERT OR IGNORE INTO billing_events VALUES (?,?)').run(event.id, Date.now())
    })
  }
  async webhook(req: IncomingMessage, res: ServerResponse) {
    privateHeaders(res)
    if (!this.stripe) throw new HttpError(404, 'not-found')
    if (req.method !== 'POST') throw new HttpError(405, 'method-not-allowed')
    const signature = req.headers['stripe-signature']
    if (typeof signature !== 'string') throw new HttpError(400, 'invalid-signature')
    const payload = await body(req, 1048576)
    let event: Stripe.Event
    try { event = this.stripe.webhooks.constructEvent(payload, signature, this.config.stripeWebhookSecret) }
    catch { throw new HttpError(400, 'invalid-signature') }
    const work = this.events.then(() => this.process(event))
    this.events = work.catch(() => {})
    await work
    json(res, 200, { received: true })
  }
  async close() { await this.events }
}
