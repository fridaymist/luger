// Stripe webhook: delivers paid keys and crystals automatically, keeps subscriptions in
// sync, and takes things back on refunds and chargebacks. Each event is processed once.
import catalog from '../_shared/catalog.json' with { type: 'json' }
import { createKeys } from '../_shared/keys.ts'
import * as roblox from '../_shared/roblox.ts'
import { stripe, verifyWebhook } from '../_shared/stripe.ts'
import { db, HttpError } from '../_shared/util.ts'

const GRACE_S = 24 * 3600 // keeps a renewing key alive while the next payment settles

async function ensureUser(rid: number): Promise<void> {
  const { data } = await db.from('users').select('roblox_id').eq('roblox_id', rid).maybeSingle()
  if (data) return
  const u = await roblox.userById(rid)
  await db.from('users').insert({ roblox_id: rid, username: u?.name ?? String(rid), display_name: u?.displayName ?? null })
}

async function onCheckoutCompleted(session: any, livemode: boolean): Promise<void> {
  if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') return
  const meta = session.metadata ?? {}
  const rid = Number(meta.roblox_id) || null
  const base = {
    id: session.id,
    roblox_id: rid,
    product: meta.product,
    amount: session.amount_total,
    currency: session.currency,
    status: 'paid',
    livemode,
    device_id: meta.device || null,
    stripe_session: session.id,
    customer: session.customer ?? null
  }
  if (rid && session.customer) {
    await ensureUser(rid)
    await db.from('users').update({ stripe_customer: session.customer }).eq('roblox_id', rid)
  }

  if (meta.kind === 'crystals') {
    const pack = catalog.crystalPacks.find((p) => p.id === meta.product)
    if (!pack || !rid) throw new Error(`bad crystals metadata ${JSON.stringify(meta)}`)
    await ensureUser(rid)
    await db.rpc('adjust_balance', { p_user: rid, p_ammo: 0, p_crystals: pack.crystals })
    await db.from('orders').upsert({ ...base, product: pack.id })
    return
  }

  if (meta.kind === 'key') {
    const product = catalog.keyProducts.find((p) => p.id === meta.product)
    if (!product) throw new Error(`bad key metadata ${JSON.stringify(meta)}`)
    if (rid) await ensureUser(rid)
    const recurring = product.kind !== 'lifetime'
    const expiresAt = recurring ? new Date(Date.now() + ((product as any).days * 86400 + GRACE_S) * 1000).toISOString() : null
    const [made] = await createKeys(1, {
      kind: product.kind as 'weekly' | 'monthly' | 'lifetime',
      label: `${product.name} (purchased)`,
      durationSeconds: null,
      startsOnUse: false,
      expiresAt,
      maxDevices: 2,
      boundRobloxId: rid,
      source: 'stripe',
      stripeRef: recurring ? session.subscription : session.payment_intent,
      note: session.customer_details?.email ? `Buyer: ${session.customer_details.email}` : ''
    })
    await db.from('orders').upsert({ ...base, key_id: made.id, key_plain_once: made.key })
  }
}

async function onInvoicePaid(invoice: any, livemode: boolean): Promise<void> {
  // The first invoice is covered by checkout.session.completed; extend on renewals.
  // Newer Stripe API versions moved the subscription id under parent.subscription_details.
  const subId = invoice.subscription ?? invoice.parent?.subscription_details?.subscription
  if (invoice.billing_reason !== 'subscription_cycle' || !subId) return
  const { data: key } = await db.from('keys').select('id, expires_at').eq('stripe_ref', subId).maybeSingle()
  if (!key) return
  const periodEnd = invoice.lines?.data?.[0]?.period?.end
  const target = periodEnd ? periodEnd * 1000 + GRACE_S * 1000 : Date.now() + 8 * 86400 * 1000
  const current = key.expires_at ? Date.parse(key.expires_at) : 0
  await db.from('keys').update({ expires_at: new Date(Math.max(current, target)).toISOString(), revoked: false }).eq('id', key.id)
  await db.from('orders').upsert({ id: invoice.id, product: 'renewal', amount: invoice.amount_paid, currency: invoice.currency, status: 'paid', livemode, key_id: key.id })
}

async function onSubscriptionEnded(sub: any): Promise<void> {
  // Let the key run to the end of what was paid for, then stop.
  const end = (sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end ?? sub.ended_at ?? Date.now() / 1000) * 1000
  await db.from('keys').update({ expires_at: new Date(end).toISOString() }).eq('stripe_ref', sub.id)
}

async function onRefundOrDispute(charge: any): Promise<void> {
  const pi = charge.payment_intent
  if (!pi) return
  // Lifetime keys reference the payment intent directly.
  await db.from('keys').update({ revoked: true, note: 'Revoked: refunded or disputed' }).eq('stripe_ref', pi)
  // Subscriptions and crystals: find the checkout session behind this payment.
  const sessions = await stripe(`/checkout/sessions?payment_intent=${pi}&limit=1`, undefined, 'GET').catch(() => null)
  let session = sessions?.data?.[0]
  // Newer API versions drop charge.invoice; find the invoice through its payment instead.
  let invoiceId = charge.invoice
  if (!session && !invoiceId) {
    const pays = await stripe(`/invoice_payments?payment[type]=payment_intent&payment[payment_intent]=${pi}&limit=1`, undefined, 'GET').catch(() => null)
    invoiceId = pays?.data?.[0]?.invoice ?? null
  }
  if (!session && invoiceId) {
    const inv = await stripe(`/invoices/${invoiceId}`, undefined, 'GET').catch(() => null)
    const subId = inv?.subscription ?? inv?.parent?.subscription_details?.subscription
    if (subId) {
      await db.from('keys').update({ revoked: true, note: 'Revoked: refunded or disputed' }).eq('stripe_ref', subId)
      await stripe(`/subscriptions/${subId}`, undefined, 'DELETE').catch(() => null)
    }
    return
  }
  if (session?.metadata?.kind === 'crystals') {
    const pack = catalog.crystalPacks.find((p) => p.id === session.metadata.product)
    const rid = Number(session.metadata.roblox_id)
    if (pack && rid) {
      const { data: u } = await db.from('users').select('crystals').eq('roblox_id', rid).single()
      const take = Math.min(pack.crystals, u?.crystals ?? 0)
      if (take) await db.rpc('adjust_balance', { p_user: rid, p_ammo: 0, p_crystals: -take })
    }
  }
  if (session) await db.from('orders').update({ status: 'refunded' }).eq('id', session.id)
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('POST only', { status: 405 })
  const raw = await req.text()
  let event: any
  try {
    event = await verifyWebhook(raw, req.headers.get('stripe-signature'))
  } catch (e) {
    return new Response(e instanceof HttpError ? e.message : 'Bad request', { status: 400 })
  }
  const { error: dup } = await db.from('processed_events').insert({ id: event.id })
  if (dup) return new Response('already processed', { status: 200 })
  try {
    const obj = event.data.object
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded':
        await onCheckoutCompleted(obj, !!event.livemode)
        break
      case 'invoice.paid':
        await onInvoicePaid(obj, !!event.livemode)
        break
      case 'customer.subscription.deleted':
        await onSubscriptionEnded(obj)
        break
      case 'charge.refunded':
      case 'charge.dispute.created':
        await onRefundOrDispute(event.type === 'charge.dispute.created' ? { payment_intent: obj.payment_intent, invoice: null } : obj)
        break
    }
    return new Response('ok', { status: 200 })
  } catch (e) {
    console.error('webhook failed', event.type, e)
    await db.from('processed_events').delete().eq('id', event.id) // let Stripe retry
    return new Response('retry', { status: 500 })
  }
})
