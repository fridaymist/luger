// Configures Stripe for Luger using the secret key in .secrets.env (test or live):
//   - the webhook that delivers keys and crystals (its signing secret is saved to .secrets.env)
//   - the customer portal where buyers cancel subscriptions and get receipts
// Run again after switching to live keys:  node scripts/stripe-setup.mjs
import { readFileSync, writeFileSync } from 'node:fs'

const file = '.secrets.env'
let env = readFileSync(file, 'utf8')
const get = (k) => (env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1] ?? '').replace(/^'|'$/g, '').trim()
const key = get('STRIPE_SECRET_KEY')
if (!/^sk_(test|live)_/.test(key)) { console.error('Put your Stripe secret key in .secrets.env first.'); process.exit(1) }
const live = key.startsWith('sk_live_')
const ref = JSON.parse(readFileSync('luger.config.json', 'utf8')).functions.split('//')[1].split('.')[0]
const hook = `https://${ref}.supabase.co/functions/v1/stripe-webhook`
const EVENTS = ['checkout.session.completed', 'checkout.session.async_payment_succeeded', 'invoice.paid', 'customer.subscription.deleted', 'charge.refunded', 'charge.dispute.created']

async function stripe(path, params, method = 'POST') {
  const body = new URLSearchParams()
  const add = (k, v) => (Array.isArray(v) ? v.forEach((x, i) => add(`${k}[${i}]`, x)) : v && typeof v === 'object' ? Object.entries(v).forEach(([kk, vv]) => add(`${k}[${kk}]`, vv)) : v !== undefined && body.append(k, String(v)))
  Object.entries(params ?? {}).forEach(([k, v]) => add(k, v))
  const res = await fetch(`https://api.stripe.com/v1${path}`, { method, headers: { authorization: `Bearer ${key}` }, body: method === 'GET' ? undefined : body })
  const data = await res.json()
  if (!res.ok) throw new Error(`${path}: ${data.error?.message}`)
  return data
}

console.log(`Stripe ${live ? 'LIVE' : 'TEST'} mode`)
const hooks = await stripe('/webhook_endpoints?limit=100', null, 'GET')
const existing = hooks.data.find((w) => w.url === hook)
if (existing && get('STRIPE_WEBHOOK_SECRET').startsWith('whsec_')) {
  await stripe(`/webhook_endpoints/${existing.id}`, { enabled_events: EVENTS, disabled: false })
  console.log('Webhook: already set up, events checked')
} else {
  if (existing) await stripe(`/webhook_endpoints/${existing.id}`, null, 'DELETE')
  const created = await stripe('/webhook_endpoints', { url: hook, enabled_events: EVENTS, description: 'Luger payments' })
  env = env.match(/^STRIPE_WEBHOOK_SECRET=/m) ? env.replace(/^STRIPE_WEBHOOK_SECRET=.*$/m, `STRIPE_WEBHOOK_SECRET=${created.secret}`) : env + `\nSTRIPE_WEBHOOK_SECRET=${created.secret}\n`
  writeFileSync(file, env)
  console.log('Webhook: created, signing secret saved to .secrets.env')
}

const configs = await stripe('/billing_portal/configurations?limit=10&active=true', null, 'GET')
const portal = {
  business_profile: { headline: 'Manage your Luger key', privacy_policy_url: 'https://lugerhub.fun/privacy/', terms_of_service_url: 'https://lugerhub.fun/terms/' },
  default_return_url: 'https://lugerhub.fun/',
  features: {
    subscription_cancel: { enabled: true, mode: 'at_period_end', cancellation_reason: { enabled: true, options: ['too_expensive', 'unused', 'missing_features', 'other'] } },
    payment_method_update: { enabled: true },
    invoice_history: { enabled: true },
    customer_update: { enabled: false }
  }
}
const def = configs.data.find((c) => c.is_default)
if (def) { await stripe(`/billing_portal/configurations/${def.id}`, portal); console.log('Customer portal: updated') }
else { await stripe('/billing_portal/configurations', portal); console.log('Customer portal: created') }
console.log('\nNext: npx supabase secrets set --env-file .secrets.env')
