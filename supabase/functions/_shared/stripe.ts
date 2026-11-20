// Minimal Stripe client: Checkout sessions and webhook signature checks, via the REST API.
import { HttpError, hmac, safeEqual } from './util.ts'

const API = 'https://api.stripe.com/v1'

function form(obj: Record<string, unknown>, prefix = '', out = new URLSearchParams()): URLSearchParams {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue
    const key = prefix ? `${prefix}[${k}]` : k
    if (Array.isArray(v)) v.forEach((item, i) => (typeof item === 'object' ? form(item as any, `${key}[${i}]`, out) : out.append(`${key}[${i}]`, String(item))))
    else if (typeof v === 'object') form(v as Record<string, unknown>, key, out)
    else out.append(key, String(v))
  }
  return out
}

export async function stripe(path: string, params?: Record<string, unknown>, method = 'POST', quiet = false): Promise<any> {
  const secret = Deno.env.get('STRIPE_SECRET_KEY')
  if (!secret) throw new HttpError(503, 'Payments are not set up yet.')
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/x-www-form-urlencoded' },
    body: method === 'GET' ? undefined : form(params ?? {})
  })
  const data = await res.json()
  if (!res.ok) {
    if (quiet) return { error: data.error }
    console.error('stripe error', data)
    throw new HttpError(502, 'The payment service refused the request. Try again shortly.')
  }
  return data
}

export interface CheckoutItem {
  name: string
  description?: string
  gbp: number
  recurring?: 'week' | 'month'
}

export async function createCheckout(item: CheckoutItem, metadata: Record<string, string>, locale?: string, customer?: string | null): Promise<{ url: string; id: string }> {
  const site = Deno.env.get('LUGER_SITE_URL') ?? 'https://lugerhub.fun'
  const params: Record<string, unknown> = {
    customer: customer ?? undefined,
    mode: item.recurring ? 'subscription' : 'payment',
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'gbp',
        unit_amount: Math.round(item.gbp * 100),
        product_data: { name: item.name, description: item.description },
        recurring: item.recurring ? { interval: item.recurring } : undefined
      }
    }],
    adaptive_pricing: { enabled: true },
    automatic_tax: Deno.env.get('STRIPE_AUTOMATIC_TAX') === 'true' ? { enabled: true } : undefined,
    allow_promotion_codes: true,
    locale: locale && /^[a-z]{2}(-[A-Z]{2})?$/.test(locale) ? locale : 'auto',
    metadata,
    subscription_data: item.recurring ? { metadata } : undefined,
    payment_intent_data: item.recurring ? undefined : { metadata },
    customer_creation: item.recurring || customer ? undefined : 'always',
    success_url: `${site}/thanks?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${site}/cancelled`
  }
  // Adaptive Pricing shows the price in the buyer's currency. If the account or mode
  // does not support it, fall back to pounds rather than failing the sale.
  let session = await stripe('/checkout/sessions', params, 'POST', true)
  if (session.error) {
    delete params.adaptive_pricing
    session = await stripe('/checkout/sessions', params)
  }
  return { url: session.url, id: session.id }
}

/** Verify Stripe-Signature (t=..., v1=...) against the raw body. */
export async function verifyWebhook(raw: string, header: string | null): Promise<any> {
  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET')
  if (!secret || !header) throw new HttpError(400, 'Missing signature')
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]))
  const sigs = header.split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3))
  const t = Number(parts.t)
  if (!t || Math.abs(Date.now() / 1000 - t) > 300) throw new HttpError(400, 'Stale signature')
  const expected = await hmac(secret, `${t}.${raw}`)
  if (!sigs.some((s) => safeEqual(s, expected))) throw new HttpError(400, 'Bad signature')
  return JSON.parse(raw)
}

/** A Stripe-hosted page where buyers cancel subscriptions and see receipts. */
export async function portalUrl(customer: string): Promise<string> {
  const site = Deno.env.get('LUGER_SITE_URL') ?? 'https://lugerhub.fun'
  const session = await stripe('/billing_portal/sessions', { customer, return_url: `${site}/` })
  return session.url
}
