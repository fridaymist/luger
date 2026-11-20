// Luger API. Every request is POST {action, ...}. Most actions need the signed session
// token from a redeemed key; the few public ones are listed in PUBLIC.
import catalog from '../_shared/catalog.json' with { type: 'json' }
import * as discord from '../_shared/discord.ts'
import { createKeys, redeem, sessionFor, touchDevice, type KeyKind } from '../_shared/keys.ts'
import { moderate } from '../_shared/moderation.ts'
import { award, levelFor } from '../_shared/progress.ts'
import * as roblox from '../_shared/roblox.ts'
import { looksLikeAhk, scanPython } from '../_shared/scan.ts'
import { createCheckout, portalUrl } from '../_shared/stripe.ts'
import {
  clientIp, db, getSetting, handle, HttpError, int, limit, liveProviders, randomToken, readSession, requireRole, requireSession, requireVerified,
  type Session, str, unseal
} from '../_shared/util.ts'

const OWNER_ID = Number(Deno.env.get('OWNER_ROBLOX_ID') ?? 0)
const MODERATORS = ['owner', 'developer', 'editor']
const ASSIGNABLE = ['developer', 'editor', 'plus', 'supporter']
const THEMES = new Map(catalog.themes.map((t) => [t.id, t]))
const ITEMS = new Map(catalog.items.map((i) => [i.id, i]))

type Ctx = { req: Request; body: any; s?: Session }
type Action = (c: Ctx) => Promise<unknown>

// ------------------------------------------------------------------ helpers
function device(body: any): string {
  const d = String(body.device ?? '')
  if (!/^[a-f0-9]{64}$/.test(d)) throw new HttpError(400, 'Device id is invalid.')
  return d
}

function robloxId(v: unknown): number | undefined {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : undefined
}

async function verifiedCreators(ids: number[]): Promise<Set<number>> {
  if (!ids.length) return new Set()
  const { data } = await db.from('creator_stats').select('*').in('author_id', ids)
  return new Set((data ?? []).filter((r) => r.macros >= 10 && r.reviews >= 10 && Number(r.avg_stars) >= 4).map((r) => r.author_id))
}

async function authors(ids: number[]) {
  const unique = [...new Set(ids)].filter(Boolean)
  if (!unique.length) return new Map()
  const [{ data }, verified] = await Promise.all([
    db.from('users').select('roblox_id, username, display_name, avatar_url, roles, title').in('roblox_id', unique),
    verifiedCreators(unique)
  ])
  return new Map((data ?? []).map((u) => [u.roblox_id, { ...u, verified: verified.has(u.roblox_id) }]))
}

function priceOf(id: string): number | null {
  const theme = THEMES.get(id) as { price?: number } | undefined
  if (theme) return theme.price ?? null
  return (ITEMS.get(id) as { price?: number } | undefined)?.price ?? null
}

function todayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10)
}

function rotation(day: string): { featured: string[]; regular: string[] } {
  const pool = [...catalog.themes.filter((t: any) => t.price).map((t) => t.id), ...catalog.items.filter((i: any) => i.price).map((i) => i.id)].sort()
  let seed = [...day].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7)
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return { featured: pool.slice(0, 3), regular: pool.slice(3, 11) }
}

async function rates(): Promise<Record<string, number>> {
  const cached = await getSetting<{ rates: Record<string, number>; fetched: number | null }>('rates', { rates: { GBP: 1 }, fetched: null })
  if (cached.fetched && Date.now() - cached.fetched < 24 * 3600 * 1000) return cached.rates
  for (const url of ['https://api.frankfurter.dev/v1/latest?base=GBP', 'https://api.frankfurter.app/latest?from=GBP']) {
    try {
      const res = await fetch(url)
      if (!res.ok) continue
      const data = await res.json()
      const r = { GBP: 1, ...data.rates }
      await db.from('settings').upsert({ key: 'rates', value: { base: 'GBP', rates: r, fetched: Date.now() } })
      return r
    } catch { /* try the next source */ }
  }
  return cached.rates
}

const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'HUF', 'TWD', 'IDR'])

function localPrice(gbp: number, currency: string, r: Record<string, number>): { amount: number; currency: string } {
  const rate = r[currency]
  // Pounds are what checkout charges, so show them exactly; other currencies are estimates.
  if (currency === 'GBP' || !rate) return { amount: gbp, currency: 'GBP' }
  const raw = gbp * rate
  // Round to a natural-looking price in that currency (x.49 / x.99 style where it fits).
  if (ZERO_DECIMAL.has(currency)) return { amount: Math.max(1, Math.round(raw / 10) * 10 - (raw > 100 ? 1 : 0)), currency }
  // Round up to the next .49 or .99 so the estimate is never lower than the real charge.
  const whole = Math.floor(raw)
  const amount = [whole + 0.49, whole + 0.99, whole + 1.49].find((x) => x >= raw - 0.005)!
  return { amount: Math.round(amount * 100) / 100, currency }
}

// ------------------------------------------------------------------ public actions
const PUBLIC: Record<string, Action> = {
  async redeem({ req, body }) {
    const dev = device(body)
    await limit(`redeem:${dev}`, 5, 600)
    await limit(`redeem-ip:${clientIp(req)}`, 20, 600)
    return redeem(str(body.key, 64, 'Key'), dev, robloxId(body.robloxId))
  },

  async refresh({ body }) {
    // Accept a recently expired token (up to 7 days) so a sleeping laptop does not lose its session.
    const s = await readSession(body.token, 7 * 24 * 3600)
    const dev = device(body)
    if (s.sub !== dev) throw new HttpError(401, 'This session belongs to another device.')
    await limit(`refresh:${dev}`, 30, 3600)
    return sessionFor(s.kid, dev, robloxId(body.robloxId) ?? s.rid)
  },

  async prices({ body }) {
    const currency = String(body.currency ?? 'GBP').toUpperCase().slice(0, 3)
    const r = await rates()
    return {
      keys: catalog.keyProducts.map((p) => ({ ...p, local: localPrice(p.gbp, currency, r) })),
      crystals: catalog.crystalPacks.map((p) => ({ ...p, local: localPrice(p.gbp, currency, r) })),
      note: 'Checkout charges in your own currency where available. Shown prices are close estimates.'
    }
  },

  async 'checkout.key'({ body }) {
    const dev = device(body)
    await limit(`checkout:${dev}`, 10, 3600)
    const product = catalog.keyProducts.find((p) => p.id === body.product)
    if (!product) throw new HttpError(400, 'Unknown product.')
    const rid = robloxId(body.robloxId)
    return createCheckout(
      { name: `Luger ${product.name} key`, description: product.recurring ? `Renews every ${product.recurring}. Cancel any time.` : 'One payment, never expires.', gbp: product.gbp, recurring: product.recurring as 'week' | 'month' | undefined },
      { kind: 'key', product: product.id, device: dev, roblox_id: rid ? String(rid) : '' },
      body.locale
    )
  },

  /** Buying on lugerhub.fun: no app or device needed; the key is shown on the thank-you page. */
  async 'checkout.web'({ req, body }) {
    await limit(`webbuy:${clientIp(req)}`, 15, 3600)
    const product = catalog.keyProducts.find((p) => p.id === body.product)
    if (!product) throw new HttpError(400, 'Unknown product.')
    return createCheckout(
      { name: `Luger ${product.name} key`, description: product.recurring ? `Renews every ${product.recurring}. Cancel any time.` : 'One payment, never expires.', gbp: product.gbp, recurring: product.recurring as 'week' | 'month' | undefined },
      { kind: 'key', product: product.id, device: '', roblox_id: '', source: 'website' },
      typeof body.locale === 'string' ? body.locale : undefined
    )
  },

  async 'checkout.claim'({ body }) {
    const dev = device(body)
    await limit(`claim:${dev}`, 60, 600)
    const { data } = await db.from('orders').select('id, key_plain_once, product').eq('device_id', dev).not('key_plain_once', 'is', null)
    const keys = (data ?? []).map((o) => ({ product: o.product, key: o.key_plain_once }))
    if (keys.length) await db.from('orders').update({ key_plain_once: null }).in('id', data!.map((o) => o.id))
    return { keys }
  },

  async 'site.stats'() {
    const count = async (q: any) => (await q).count ?? 0
    const [players, macros, keys] = await Promise.all([
      count(db.from('users').select('roblox_id', { count: 'exact', head: true })),
      count(db.from('macros').select('id', { count: 'exact', head: true }).eq('status', 'live')),
      count(db.from('key_redemptions').select('key_id', { count: 'exact', head: true }))
    ])
    return { players, macros, keys, games: catalog.games.length }
  },

  // ---------------------------------------------------------------- Discord verification (lugerhub.fun/verify)
  async 'discord.start'({ req, body }) {
    await limit(`dstart:${clientIp(req)}`, 20, 3600)
    if (body.accepted !== true || body.consentVersion !== discord.CONSENT_VERSION) throw new HttpError(400, 'Agree to the terms first.')
    let state = typeof body.t === 'string' && /^[a-f0-9]{48}$/.test(body.t) ? body.t : null
    if (state) {
      const { data } = await db.from('discord_states').select('created_at').eq('state', state).maybeSingle()
      if (!data || Date.now() - Date.parse(data.created_at) > 30 * 60 * 1000) state = null
    }
    if (!state) {
      state = randomToken(24)
      await db.from('discord_states').insert({ state })
    }
    await db.from('discord_states').delete().lt('created_at', new Date(Date.now() - 3600 * 1000).toISOString())
    return { url: discord.authorizeUrl(state) }
  },

  async 'discord.finish'({ req, body }) {
    await limit(`dfinish:${clientIp(req)}`, 20, 3600)
    const state = String(body.state ?? '')
    const code = String(body.code ?? '')
    if (!/^[a-f0-9]{48}$/.test(state) || !/^[\w-]{10,100}$/.test(code)) throw new HttpError(400, 'This verification link is broken. Start again.')
    const { data: st } = await db.from('discord_states').delete().eq('state', state).select('roblox_id, created_at').maybeSingle()
    if (!st || Date.now() - Date.parse(st.created_at) > 30 * 60 * 1000) throw new HttpError(400, 'This verification expired. Start again.')
    const t = await discord.exchangeCode(code)
    const user = await discord.me(t.access_token)
    await discord.saveLink(t, user, st.roblox_id ?? null)
    const roles = [Deno.env.get('DISCORD_VERIFIED_ROLE_ID')].filter(Boolean) as string[]
    const guild = Deno.env.get('DISCORD_GUILD_ID')
    const joined = guild ? await discord.joinGuild(guild, user.id, t.access_token, roles) : 'failed'
    return {
      username: user.global_name ?? user.username,
      avatar: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128` : null,
      joined,
      linkedToLuger: !!st.roblox_id
    }
  },

  async 'checkpoint.providers'() {
    const cfg = await getSetting('checkpoint', { providers: ['lootlabs', 'linkvertise', 'workink'] } as any)
    return { providers: liveProviders(cfg.providers) }
  },

  async 'checkpoint.start'({ body }) {
    const dev = device(body)
    await limit(`cp-start:${dev}`, 10, 3600)
    const cfg = await getSetting('checkpoint', { steps: 2, providers: ['lootlabs', 'linkvertise', 'workink'] } as any)
    const providers = liveProviders(cfg.providers)
    if (!providers.length) throw new HttpError(503, 'Free keys are not set up yet. Buy a key or try again later.')
    const provider = providers.includes(body.provider) ? body.provider : providers[0]
    const { data, error } = await db.from('checkpoint_sessions').insert({ device_id: dev, provider, steps: cfg.steps }).select('id').single()
    if (error) throw error
    const site = Deno.env.get('LUGER_SITE_URL') ?? 'https://lugerhub.fun'
    return { url: `${site}/key/?s=${data.id}`, session: data.id, providers }
  },

  async 'checkpoint.claim'({ body }) {
    const dev = device(body)
    await limit(`cp-claim:${dev}`, 120, 600)
    const { data } = await db.from('checkpoint_sessions').select('id, step, steps, done, key_plain_once, device_id').eq('id', String(body.session ?? '')).maybeSingle()
    if (!data || data.device_id !== dev) throw new HttpError(404, 'Checkpoint not found. Start again.')
    if (data.done && data.key_plain_once) {
      await db.from('checkpoint_sessions').update({ key_plain_once: null }).eq('id', data.id)
      return { done: true, key: data.key_plain_once }
    }
    return { done: data.done, step: data.step, steps: data.steps }
  }
}

// ------------------------------------------------------------------ signed-in actions
const PRIVATE: Record<string, Action> = {
  async me({ s, body }) {
    const base = { device: s!.sub, verified: !!s!.ver, robloxId: s!.rid ?? null, roles: s!.roles ?? [] }
    if (!s!.ver || !s!.rid) return { ...base, user: null }
    const [{ data: user }, { data: inv }, { data: ach }, { data: play }] = await Promise.all([
      db.from('users').select('*').eq('roblox_id', s!.rid).single(),
      db.from('inventory').select('item').eq('roblox_id', s!.rid),
      db.from('user_achievements').select('achievement, earned_at').eq('roblox_id', s!.rid),
      db.from('playtime').select('universe_id, seconds, last_played').eq('roblox_id', s!.rid).order('seconds', { ascending: false })
    ])
    const newly = body.macroCount !== undefined ? await award(s!.rid, Number(body.macroCount) || 0) : []
    return {
      ...base,
      user: { ...user, stripe_customer: undefined, levelInfo: levelFor(user?.xp ?? 0) },
      inventory: (inv ?? []).map((i) => i.item),
      achievements: ach ?? [],
      playtime: play ?? [],
      newly
    }
  },

  async 'identity.start'({ s, body }) {
    const rid = robloxId(body.robloxId)
    if (!rid) throw new HttpError(400, 'Roblox account not detected. Open Roblox once, then try again.')
    await limit(`id-start:${s!.sub}`, 10, 3600)
    const words = ['brass', 'barrel', 'trigger', 'holster', 'sight', 'chamber', 'magazine', 'muzzle', 'rifling', 'grip', 'casing', 'primer', 'scope', 'sling', 'bolt', 'hammer']
    const pick = () => words[crypto.getRandomValues(new Uint32Array(1))[0] % words.length]
    const phrase = `luger ${pick()} ${pick()} ${crypto.getRandomValues(new Uint16Array(1))[0] % 9000 + 1000}`
    await db.from('devices').update({ proof_phrase: `${rid}|${phrase}`, proof_expires: new Date(Date.now() + 30 * 60 * 1000).toISOString() }).eq('id', s!.sub)
    return { phrase, expiresInMinutes: 30 }
  },

  async 'identity.check'({ s, body }) {
    const rid = robloxId(body.robloxId)
    if (!rid) throw new HttpError(400, 'Roblox account not detected.')
    await limit(`id-check:${s!.sub}`, 20, 3600)
    const { data: dev } = await db.from('devices').select('proof_phrase, proof_expires').eq('id', s!.sub).single()
    if (!dev?.proof_phrase || Date.parse(dev.proof_expires) < Date.now()) throw new HttpError(400, 'That phrase expired. Get a new one.')
    const [forId, phrase] = dev.proof_phrase.split('|')
    if (Number(forId) !== rid) throw new HttpError(400, 'The phrase was made for a different account. Get a new one.')
    const profile = await roblox.userById(rid)
    if (!profile) throw new HttpError(502, 'Could not reach Roblox. Try again in a minute.')
    if (!profile.description.toLowerCase().includes(phrase)) {
      throw new HttpError(400, 'The phrase is not in your Roblox About section yet. Roblox can take a minute to update.')
    }
    const avatar = (await roblox.headshots([rid]))[rid] ?? null
    const { data: existing } = await db.from('users').select('roles').eq('roblox_id', rid).maybeSingle()
    const roles = new Set<string>(existing?.roles ?? [])
    if (rid === OWNER_ID) roles.add('owner')
    await db.from('users').upsert({ roblox_id: rid, username: profile.name, display_name: profile.displayName, avatar_url: avatar, roles: [...roles] })
    await db.from('devices').update({ verified_for: rid, roblox_id: rid, proof_phrase: null, proof_expires: null }).eq('id', s!.sub)
    await award(rid, 0)
    return sessionFor(s!.kid, s!.sub, rid)
  },

  async 'restore'({ s }) {
    const rid = requireVerified(s!)
    const { data } = await db.from('keys').select('id, max_devices, expires_at, kind').eq('bound_roblox_id', rid).eq('revoked', false).in('kind', ['weekly', 'monthly', 'lifetime'])
    const valid = (data ?? []).filter((k) => !k.expires_at || Date.parse(k.expires_at) > Date.now())
    if (!valid.length) throw new HttpError(404, 'No active purchases found for this Roblox account.')
    const best = valid.find((k) => k.kind === 'lifetime') ?? valid.sort((a, b) => Date.parse(b.expires_at) - Date.parse(a.expires_at))[0]
    const { data: used } = await db.from('key_redemptions').select('device_id').eq('key_id', best.id)
    const devices = (used ?? []).map((u) => u.device_id)
    if (!devices.includes(s!.sub)) {
      if (devices.length >= best.max_devices) {
        // Purchases follow the buyer: move the oldest device off this key.
        await db.from('key_redemptions').delete().eq('key_id', best.id).eq('device_id', devices[0])
      }
      await db.from('key_redemptions').insert({ key_id: best.id, device_id: s!.sub, roblox_id: rid })
    }
    return sessionFor(best.id, s!.sub, rid)
  },

  async 'billing.portal'({ s }) {
    await limit(`portal:${s!.sub}`, 10, 3600)
    let customer: string | null = null
    if (s!.rid && s!.ver) {
      const { data } = await db.from('users').select('stripe_customer').eq('roblox_id', s!.rid).maybeSingle()
      customer = data?.stripe_customer ?? null
    }
    if (!customer) {
      const { data } = await db.from('orders').select('customer').eq('device_id', s!.sub).not('customer', 'is', null).order('created_at', { ascending: false }).limit(1).maybeSingle()
      customer = data?.customer ?? null
    }
    if (!customer) throw new HttpError(404, 'No purchases found for this account or computer.')
    return { url: await portalUrl(customer) }
  },

  async 'discord.linkToken'({ s }) {
    const rid = requireVerified(s!)
    await limit(`dlink:${rid}`, 10, 3600)
    const state = randomToken(24)
    await db.from('discord_states').insert({ state, roblox_id: rid })
    return { url: `${Deno.env.get('LUGER_SITE_URL') ?? 'https://lugerhub.fun'}/verify/?t=${state}` }
  },

  async 'discord.status'({ s }) {
    if (!s!.rid || !s!.ver) return { linked: false }
    const { data } = await db.from('discord_links').select('username, global_name, revoked').eq('roblox_id', s!.rid).order('updated_at', { ascending: false }).limit(1).maybeSingle()
    return data && !data.revoked ? { linked: true, username: data.global_name ?? data.username } : { linked: false }
  },

  // -------------------------------------------------------------- games
  async 'games.get'({ body }) {
    const universes = (body.universeIds ?? []).map(Number).filter(Number.isInteger)
    const places = (body.placeIds ?? []).map(Number).filter(Number.isInteger)
    const [a, b] = await Promise.all([roblox.gamesByUniverse(universes), roblox.gamesByPlace(places)])
    const seen = new Set<number>()
    return { games: [...a, ...b].filter((g) => !seen.has(g.universe_id) && seen.add(g.universe_id)) }
  },

  async 'games.popular'() {
    return { games: await roblox.popular() }
  },

  async 'games.macroFriendly'() {
    return { games: await roblox.gamesByPlace(catalog.games.map((g) => g.placeId)) }
  },

  async 'games.search'({ s, body }) {
    await limit(`search:${s!.sub}`, 60, 60)
    return { games: await roblox.search(str(body.q, 80, 'Search')) }
  },

  // -------------------------------------------------------------- progress
  async 'playtime.report'({ s, body }) {
    const rid = requireVerified(s!)
    await limit(`play:${rid}`, 30, 3600)
    const { data: user } = await db.from('users').select('last_report, luger_seconds').eq('roblox_id', rid).single()
    const now = Date.now()
    const elapsed = user?.last_report ? (now - Date.parse(user.last_report)) / 1000 : 6 * 3600
    const cap = Math.min(elapsed, 24 * 3600) + 120
    const sessions: { placeId: number; seconds: number }[] = (body.sessions ?? []).slice(0, 50)
    const total = sessions.reduce((a, x) => a + Math.max(0, Number(x.seconds) || 0), 0)
    const scale = total > cap ? cap / total : 1
    for (const x of sessions) {
      const secs = Math.floor(Math.max(0, Number(x.seconds) || 0) * scale)
      if (!secs) continue
      const universe = await roblox.universeForPlace(Number(x.placeId))
      if (!universe) continue
      const { data: row } = await db.from('playtime').select('seconds').eq('roblox_id', rid).eq('universe_id', universe).maybeSingle()
      await db.from('playtime').upsert({ roblox_id: rid, universe_id: universe, seconds: (row?.seconds ?? 0) + secs, last_played: new Date().toISOString() })
    }
    const luger = Math.floor(Math.min(Math.max(0, Number(body.lugerSeconds) || 0), cap))
    await db.from('users').update({ luger_seconds: (user?.luger_seconds ?? 0) + luger, last_report: new Date(now).toISOString() }).eq('roblox_id', rid)
    return { newly: await award(rid, Number(body.macroCount) || 0) }
  },

  // -------------------------------------------------------------- official (staff-pushed) macros
  async 'macros.official'() {
    const { data } = await db.from('macros').select('id, name, description, universe_id, tags, source, version, allow_remove, author_id, updated_at').eq('official', true).eq('status', 'live')
    const a = await authors((data ?? []).map((m) => m.author_id))
    return { macros: (data ?? []).map((m) => ({ ...m, author: a.get(m.author_id) ?? null })) }
  },

  // -------------------------------------------------------------- explore
  async 'explore.list'({ body }) {
    const page = Math.max(0, Number(body.page) || 0)
    let q = db.from('macros').select('id, name, description, universe_id, tags, version, installs, author_id, created_at, updated_at').eq('public', true).eq('status', 'live')
    if (body.universeId) q = q.eq('universe_id', Number(body.universeId))
    if (body.q) q = q.ilike('name', `%${String(body.q).replace(/[%_]/g, '').slice(0, 60)}%`)
    if (body.since) q = q.gte('created_at', new Date(Date.now() - Number(body.since) * 86400000).toISOString())
    q = body.sort === 'installs' ? q.order('installs', { ascending: false }) : q.order('created_at', { ascending: false })
    const { data } = await q.range(page * 30, page * 30 + 59)
    const rows = data ?? []
    const ids = rows.map((r) => r.id)
    const { data: revs } = ids.length ? await db.from('reviews').select('macro_id, stars').in('macro_id', ids) : { data: [] }
    const stats = new Map<string, { n: number; sum: number }>()
    for (const r of revs ?? []) {
      const st = stats.get(r.macro_id) ?? { n: 0, sum: 0 }
      st.n++
      st.sum += r.stars
      stats.set(r.macro_id, st)
    }
    const a = await authors(rows.map((r) => r.author_id))
    let list = rows.map((r) => {
      const st = stats.get(r.id)
      return { ...r, rating: st ? st.sum / st.n : null, reviews: st?.n ?? 0, author: a.get(r.author_id) ?? null }
    })
    if (body.verifiedOnly) list = list.filter((m) => m.author?.verified)
    if (body.sort === 'rating') list.sort((x, y) => (y.rating ?? 0) - (x.rating ?? 0) || y.reviews - x.reviews)
    const games = await roblox.gamesByUniverse(list.map((m) => m.universe_id).filter(Boolean))
    return { macros: list.slice(0, 30), more: list.length > 30, games }
  },

  async 'explore.get'({ body }) {
    const { data: m } = await db.from('macros').select('*').eq('id', String(body.id)).eq('public', true).neq('status', 'removed').maybeSingle()
    if (!m) throw new HttpError(404, 'This macro was removed.')
    const { data: revs } = await db.from('reviews').select('author_id, stars, body, created_at').eq('macro_id', m.id).order('created_at', { ascending: false }).limit(50)
    const a = await authors([m.author_id, ...(revs ?? []).map((r) => r.author_id)])
    return {
      macro: { ...m, scan: m.scan, author: a.get(m.author_id) ?? null },
      reviews: (revs ?? []).map((r) => ({ ...r, author: a.get(r.author_id) ?? null }))
    }
  },

  async 'explore.publish'({ s, body }) {
    const rid = requireVerified(s!)
    const { data: user } = await db.from('users').select('created_at, banned').eq('roblox_id', rid).single()
    const isStaff = s!.roles?.some((r) => MODERATORS.includes(r))
    if (!isStaff && Date.now() - Date.parse(user!.created_at) < 24 * 3600 * 1000) {
      throw new HttpError(403, 'New accounts can publish 24 hours after proving their Roblox account.')
    }
    await limit(`publish:${rid}`, 5, 24 * 3600, 'You can publish up to 5 macros a day.')
    const source = str(body.source, 200_000, 'Macro code')
    if (looksLikeAhk(source)) throw new HttpError(400, 'Explore only accepts Python. Convert AutoHotkey scripts in Macros first.')
    const scan = scanPython(source)
    if (scan.verdict === 'malicious') {
      return { status: 'rejected', scan }
    }
    const row = {
      author_id: rid,
      name: moderate(str(body.name, 60, 'Name'), 'Name'),
      description: moderate(String(body.description ?? '').slice(0, 2000), 'Description'),
      universe_id: robloxId(body.universeId) ?? null,
      tags: (Array.isArray(body.tags) ? body.tags : []).slice(0, 6).map((t: unknown) => moderate(String(t).slice(0, 20), 'Tag')),
      source,
      public: true,
      status: scan.verdict === 'clean' || isStaff ? 'live' : 'held',
      scan
    }
    if (body.id) {
      const { data: mine } = await db.from('macros').select('author_id, version').eq('id', String(body.id)).single()
      if (mine?.author_id !== rid) throw new HttpError(403, 'You can only update your own macros.')
      await db.from('macros').update({ ...row, version: mine.version + 1, updated_at: new Date().toISOString() }).eq('id', String(body.id))
      return { status: row.status, id: body.id, scan }
    }
    const { data, error } = await db.from('macros').insert(row).select('id').single()
    if (error) throw error
    await award(rid, 0)
    return { status: row.status, id: data.id, scan }
  },

  async 'explore.delete'({ s, body }) {
    const rid = requireVerified(s!)
    const { data: m } = await db.from('macros').select('author_id').eq('id', String(body.id)).single()
    if (m?.author_id !== rid && !s!.roles?.some((r) => MODERATORS.includes(r))) throw new HttpError(403, 'You can only delete your own macros.')
    await db.from('macros').update({ status: 'removed', public: false }).eq('id', String(body.id))
    return { ok: true }
  },

  async 'explore.review'({ s, body }) {
    const rid = requireVerified(s!)
    await limit(`review:${rid}`, 20, 24 * 3600)
    const { data: m } = await db.from('macros').select('author_id').eq('id', String(body.id)).eq('status', 'live').single()
    if (!m) throw new HttpError(404, 'Macro not found.')
    if (m.author_id === rid) throw new HttpError(400, 'You cannot review your own macro.')
    await db.from('reviews').upsert({ macro_id: String(body.id), author_id: rid, stars: int(body.stars, 'Stars', 1, 5), body: moderate(String(body.body ?? '').slice(0, 1000), 'Review') })
    await award(m.author_id, 0)
    return { ok: true }
  },

  async 'explore.install'({ body }) {
    const { data: m } = await db.from('macros').select('installs, source, name, description, universe_id, tags, version').eq('id', String(body.id)).eq('status', 'live').single()
    if (!m) throw new HttpError(404, 'Macro not found.')
    await db.from('macros').update({ installs: m.installs + 1 }).eq('id', String(body.id))
    return { macro: m }
  },

  async report({ s, body }) {
    requireVerified(s!)
    await limit(`report:${s!.sub}`, 20, 24 * 3600)
    const kind = ['macro', 'user', 'review'].includes(body.kind) ? body.kind : 'macro'
    await db.from('reports').insert({ reporter: s!.rid, target_kind: kind, target_id: String(body.id).slice(0, 80), reason: str(body.reason, 500, 'Reason') })
    return { ok: true }
  },

  // -------------------------------------------------------------- profiles
  async 'profile.get'({ body }) {
    const rid = robloxId(body.robloxId)
    if (!rid) throw new HttpError(400, 'Unknown user.')
    const { data: u } = await db.from('users').select('roblox_id, username, display_name, verified, roles, description, banner_url, avatar_url, profile_theme, frame, effect, title, showcase, level, xp, luger_seconds, created_at').eq('roblox_id', rid).maybeSingle()
    if (!u) throw new HttpError(404, 'This player has not set up a Luger profile yet.')
    const [{ data: ach }, { data: macros }, { data: play }, verified] = await Promise.all([
      db.from('user_achievements').select('achievement, earned_at').eq('roblox_id', rid),
      db.from('macros').select('id, name, universe_id, installs').eq('author_id', rid).eq('public', true).eq('status', 'live').order('installs', { ascending: false }).limit(12),
      db.from('playtime').select('universe_id, seconds').eq('roblox_id', rid).order('seconds', { ascending: false }).limit(12),
      verifiedCreators([rid])
    ])
    const { count: reviews } = (macros ?? []).length
      ? await db.from('reviews').select('macro_id', { count: 'exact', head: true }).in('macro_id', macros!.map((m) => m.id))
      : { count: 0 }
    return { user: { ...u, creatorVerified: verified.has(rid), levelInfo: levelFor(u.xp) }, achievements: ach ?? [], macros: macros ?? [], playtime: play ?? [], reviews: reviews ?? 0 }
  },

  async 'profile.update'({ s, body }) {
    const rid = requireVerified(s!)
    await limit(`profile:${rid}`, 30, 3600)
    const { data: inv } = await db.from('inventory').select('item').eq('roblox_id', rid)
    const owned = new Set((inv ?? []).map((i) => i.item))
    const owns = (id: string) => owned.has(id) || (THEMES.get(id) as any)?.free
    const patch: Record<string, unknown> = {}
    if (body.description !== undefined) patch.description = moderate(String(body.description).slice(0, 300), 'Description')
    if (body.profile_theme !== undefined) {
      if (!owns(body.profile_theme)) throw new HttpError(403, 'Unlock that theme first.')
      patch.profile_theme = body.profile_theme
    }
    for (const slot of ['frame', 'effect'] as const) {
      if (body[slot] !== undefined) {
        if (body[slot] !== null && !owned.has(body[slot])) throw new HttpError(403, 'Unlock that first.')
        patch[slot] = body[slot]
      }
    }
    if (body.title !== undefined) {
      if (body.title !== null && !owned.has(`title:${body.title}`) && !owned.has(`title.${String(body.title).toLowerCase()}`)) throw new HttpError(403, 'Earn that title first.')
      patch.title = body.title
    }
    if (body.showcase !== undefined) patch.showcase = (Array.isArray(body.showcase) ? body.showcase : []).slice(0, 6).map(String)
    const storage = `${Deno.env.get('SUPABASE_URL')}/storage/v1/object/public/profile/${rid}/`
    for (const slot of ['banner_url', 'avatar_url'] as const) {
      if (body[slot] !== undefined) {
        const v = body[slot]
        if (v !== null && !(typeof v === 'string' && (v.startsWith(storage) || /^banner\.\w+$/.test(v) || /^https:\/\/tr\.rbxcdn\.com\//.test(v)))) throw new HttpError(400, 'Upload the picture through Luger.')
        if (slot === 'banner_url' && typeof v === 'string' && /^banner\.\w+$/.test(v) && !owned.has(v)) throw new HttpError(403, 'Unlock that banner first.')
        patch[slot] = v
      }
    }
    if (patch.avatar_url === null) patch.avatar_url = (await roblox.headshots([rid]))[rid] ?? null // back to the Roblox headshot
    await db.from('users').update(patch).eq('roblox_id', rid)
    return { ok: true }
  },

  async 'profile.uploadUrl'({ s, body }) {
    const rid = requireVerified(s!)
    await limit(`upload:${rid}`, 10, 3600)
    const kind = body.kind === 'avatar' ? 'avatar' : 'banner'
    const ext = body.contentType === 'image/jpeg' ? 'jpg' : body.contentType === 'image/webp' ? 'webp' : 'png'
    const path = `${rid}/${kind}-${crypto.randomUUID()}.${ext}`
    const { data, error } = await db.storage.from('profile').createSignedUploadUrl(path)
    if (error) throw error
    return { uploadUrl: data.signedUrl, token: data.token, path, publicUrl: `${Deno.env.get('SUPABASE_URL')}/storage/v1/object/public/profile/${path}` }
  },

  // -------------------------------------------------------------- marketplace
  async 'shop.today'() {
    const day = todayKey()
    const r = rotation(day)
    const next = new Date()
    next.setUTCHours(24, 0, 0, 0)
    const price = (id: string) => ({ id, crystals: priceOf(id), ammo: (priceOf(id) ?? 0) * catalog.ammoPerCrystal })
    return { day, resetsAt: next.toISOString(), featured: r.featured.map(price), regular: r.regular.map(price) }
  },

  async 'shop.buy'({ s, body }) {
    const rid = requireVerified(s!)
    await limit(`buy:${rid}`, 30, 3600)
    const id = String(body.item)
    const r = rotation(todayKey())
    const unlockable = [...catalog.themes, ...catalog.items].find((x: any) => x.id === id && x.unlock && x.price)
    if (![...r.featured, ...r.regular].includes(id) && !unlockable) throw new HttpError(400, 'That item is not in the shop today.')
    const crystals = priceOf(id)
    if (!crystals) throw new HttpError(400, 'That item cannot be bought.')
    const currency = body.currency === 'crystals' ? 'crystals' : 'ammo'
    const { data: have } = await db.from('inventory').select('item').eq('roblox_id', rid).eq('item', id).maybeSingle()
    if (have) throw new HttpError(400, 'You already own this.')
    const cost = currency === 'crystals' ? crystals : crystals * catalog.ammoPerCrystal
    const { data: ok } = await db.rpc('adjust_balance', { p_user: rid, p_ammo: currency === 'ammo' ? -cost : 0, p_crystals: currency === 'crystals' ? -cost : 0 })
    if (!ok) throw new HttpError(400, `Not enough ${currency}.`)
    const { error } = await db.from('inventory').insert({ roblox_id: rid, item: id })
    if (error) {
      await db.rpc('adjust_balance', { p_user: rid, p_ammo: currency === 'ammo' ? cost : 0, p_crystals: currency === 'crystals' ? cost : 0 })
      throw new HttpError(400, 'You already own this.')
    }
    return { ok: true }
  },

  async 'checkout.crystals'({ s, body }) {
    const rid = requireVerified(s!)
    const pack = catalog.crystalPacks.find((p) => p.id === body.pack)
    if (!pack) throw new HttpError(400, 'Unknown crystal pack.')
    await limit(`checkout:${s!.sub}`, 10, 3600)
    const { data: u } = await db.from('users').select('stripe_customer').eq('roblox_id', rid).maybeSingle()
    return createCheckout({ name: `${pack.crystals} Luger crystals`, gbp: pack.gbp }, { kind: 'crystals', product: pack.id, device: s!.sub, roblox_id: String(rid) }, body.locale, u?.stripe_customer ?? null)
  },

  // -------------------------------------------------------------- owner and staff
  async 'admin.keys.create'({ s, body }) {
    requireRole(s!, ['owner'])
    const count = int(body.count ?? 1, 'Amount', 1, 1000)
    const kinds: KeyKind[] = ['ad', 'weekly', 'monthly', 'lifetime', 'gift', 'staff']
    const kind = kinds.includes(body.kind) ? body.kind : 'gift'
    let bound: number | null = null
    if (body.boundUsername) {
      const u = await roblox.userByName(String(body.boundUsername))
      if (!u) throw new HttpError(404, `No Roblox user called ${body.boundUsername}.`)
      bound = u.id
    }
    const custom = body.custom ? str(body.custom, 64, 'Key text') : undefined
    if (custom && count > 1) throw new HttpError(400, 'Custom key text only works for a single key.')
    const keys = await createKeys(count, {
      kind,
      label: String(body.label ?? '').slice(0, 80),
      durationSeconds: body.durationSeconds === null || body.durationSeconds === undefined ? null : int(body.durationSeconds, 'Duration', 60),
      startsOnUse: body.startsOnUse !== false,
      expiresAt: body.startsOnUse === false && body.durationSeconds ? new Date(Date.now() + Number(body.durationSeconds) * 1000).toISOString() : null,
      maxUses: body.maxUses ? int(body.maxUses, 'Uses', 1, 1_000_000) : null,
      maxDevices: int(body.maxDevices ?? 1, 'Devices', 1, 100),
      boundRobloxId: bound,
      note: String(body.note ?? '').slice(0, 500),
      createdBy: s!.rid,
      source: 'owner',
      custom
    })
    return { keys }
  },

  async 'admin.keys.list'({ s, body }) {
    requireRole(s!, ['owner'])
    const page = Math.max(0, Number(body.page) || 0)
    let q = db.from('keys').select('id, key_hint, label, kind, duration_s, starts_on_use, expires_at, max_uses, uses, max_devices, bound_roblox_id, note, revoked, source, created_at', { count: 'exact' })
    if (body.kind) q = q.eq('kind', body.kind)
    if (body.status === 'revoked') q = q.eq('revoked', true)
    if (body.status === 'active') q = q.eq('revoked', false).or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    if (body.status === 'expired') q = q.lt('expires_at', new Date().toISOString())
    if (body.q) {
      const t = String(body.q).replace(/[^\w -]/g, '').slice(0, 40)
      q = q.or(`label.ilike.%${t}%,note.ilike.%${t}%,key_hint.ilike.%${t.toUpperCase().slice(-4)}%`)
    }
    const { data, count } = await q.order('created_at', { ascending: false }).range(page * 50, page * 50 + 49)
    const ids = (data ?? []).map((k) => k.id)
    const { data: reds } = ids.length ? await db.from('key_redemptions').select('key_id').in('key_id', ids) : { data: [] }
    const devices = new Map<string, number>()
    for (const r of reds ?? []) devices.set(r.key_id, (devices.get(r.key_id) ?? 0) + 1)
    const a = await authors((data ?? []).map((k) => k.bound_roblox_id).filter(Boolean))
    return { keys: (data ?? []).map((k) => ({ ...k, devices: devices.get(k.id) ?? 0, bound: a.get(k.bound_roblox_id)?.username ?? (k.bound_roblox_id ? String(k.bound_roblox_id) : null) })), total: count ?? 0 }
  },

  async 'admin.keys.reveal'({ s, body }) {
    requireRole(s!, ['owner'])
    const { data } = await db.from('keys').select('key_sealed').eq('id', String(body.id)).single()
    if (!data?.key_sealed) throw new HttpError(404, 'This key cannot be revealed.')
    return { key: await unseal(data.key_sealed) }
  },

  async 'admin.keys.update'({ s, body }) {
    requireRole(s!, ['owner'])
    const ids: string[] = (Array.isArray(body.ids) ? body.ids : [body.id]).map(String).slice(0, 1000)
    const patch: Record<string, unknown> = {}
    if (typeof body.revoked === 'boolean') patch.revoked = body.revoked
    if (body.label !== undefined) patch.label = String(body.label).slice(0, 80)
    if (body.note !== undefined) patch.note = String(body.note).slice(0, 500)
    if (body.maxDevices !== undefined) patch.max_devices = int(body.maxDevices, 'Devices', 1, 100)
    if (body.maxUses !== undefined) patch.max_uses = body.maxUses === null ? null : int(body.maxUses, 'Uses', 1, 1_000_000)
    if (Object.keys(patch).length) await db.from('keys').update(patch).in('id', ids)
    if (body.extendSeconds) {
      const extra = int(body.extendSeconds, 'Extension', 60)
      const { data } = await db.from('keys').select('id, expires_at, duration_s').in('id', ids)
      for (const k of data ?? []) {
        if (k.expires_at) {
          const from = Math.max(Date.now(), Date.parse(k.expires_at))
          await db.from('keys').update({ expires_at: new Date(from + extra * 1000).toISOString() }).eq('id', k.id)
        } else if (k.duration_s !== null) {
          await db.from('keys').update({ duration_s: k.duration_s + extra }).eq('id', k.id)
        }
      }
    }
    if (body.lifetime === true) await db.from('keys').update({ expires_at: null, duration_s: null }).in('id', ids)
    if (body.resetDevices) await db.from('key_redemptions').delete().in('key_id', ids)
    return { ok: true }
  },

  async 'admin.keys.delete'({ s, body }) {
    requireRole(s!, ['owner'])
    const ids: string[] = (Array.isArray(body.ids) ? body.ids : [body.id]).map(String).slice(0, 1000)
    if (ids.includes(s!.kid)) throw new HttpError(400, 'You cannot delete the key you are signed in with.')
    await db.from('orders').update({ key_id: null }).in('key_id', ids)
    await db.from('keys').delete().in('id', ids)
    return { ok: true }
  },

  async 'admin.staff.list'({ s }) {
    requireRole(s!, ['owner'])
    const { data } = await db.from('users').select('roblox_id, username, display_name, avatar_url, roles').neq('roles', '{}')
    return { staff: data ?? [] }
  },

  async 'admin.staff.set'({ s, body }) {
    requireRole(s!, ['owner'])
    const role = String(body.role)
    if (!ASSIGNABLE.includes(role)) throw new HttpError(400, 'Unknown role.')
    const u = await roblox.userByName(str(body.username, 30, 'Username'))
    if (!u) throw new HttpError(404, `No Roblox user called ${body.username}.`)
    const { data: existing } = await db.from('users').select('roles').eq('roblox_id', u.id).maybeSingle()
    const roles = new Set<string>(existing?.roles ?? [])
    body.on === false ? roles.delete(role) : roles.add(role)
    if (existing) await db.from('users').update({ roles: [...roles] }).eq('roblox_id', u.id)
    else {
      const avatar = (await roblox.headshots([u.id]))[u.id] ?? null
      await db.from('users').insert({ roblox_id: u.id, username: u.name, display_name: u.displayName, avatar_url: avatar, roles: [...roles] })
    }
    return { ok: true, robloxId: u.id, username: u.name, roles: [...roles] }
  },

  async 'admin.users.ban'({ s, body }) {
    requireRole(s!, ['owner', 'developer'])
    const rid = robloxId(body.robloxId)
    if (!rid || rid === OWNER_ID) throw new HttpError(400, 'Cannot ban this user.')
    await db.from('users').update({ banned: body.banned !== false }).eq('roblox_id', rid)
    if (body.banned !== false) await db.from('macros').update({ status: 'removed', public: false }).eq('author_id', rid)
    return { ok: true }
  },

  async 'admin.official.publish'({ s, body }) {
    requireRole(s!, MODERATORS)
    const source = str(body.source, 200_000, 'Macro code')
    if (looksLikeAhk(source)) throw new HttpError(400, 'Public scripts must be Python. Convert it in Macros first.')
    const scan = scanPython(source)
    if (scan.verdict === 'malicious') return { status: 'rejected', scan }
    const row = {
      name: str(body.name, 60, 'Name'),
      description: String(body.description ?? '').slice(0, 2000),
      universe_id: robloxId(body.universeId) ?? null,
      tags: (Array.isArray(body.tags) ? body.tags : []).slice(0, 6).map(String),
      source,
      official: true,
      public: body.listInExplore === true,
      allow_remove: body.allowRemove === true,
      status: 'live' as const,
      scan,
      updated_at: new Date().toISOString()
    }
    if (body.id) {
      const { data: m } = await db.from('macros').select('version').eq('id', String(body.id)).single()
      await db.from('macros').update({ ...row, version: (m?.version ?? 0) + 1 }).eq('id', String(body.id))
      return { status: 'live', id: body.id, scan }
    }
    const { data, error } = await db.from('macros').insert({ ...row, author_id: s!.rid }).select('id').single()
    if (error) throw error
    return { status: 'live', id: data.id, scan }
  },

  async 'admin.official.setRemovable'({ s, body }) {
    requireRole(s!, MODERATORS)
    await db.from('macros').update({ allow_remove: body.allowRemove === true }).eq('id', String(body.id)).eq('official', true)
    return { ok: true }
  },

  async 'admin.official.list'({ s }) {
    requireRole(s!, MODERATORS)
    const { data } = await db.from('macros').select('id, name, description, universe_id, tags, version, allow_remove, public, installs, updated_at, author_id').eq('official', true).eq('status', 'live').order('updated_at', { ascending: false })
    const a = await authors((data ?? []).map((m) => m.author_id))
    return { macros: (data ?? []).map((m) => ({ ...m, author: a.get(m.author_id) ?? null })) }
  },

  async 'admin.official.remove'({ s, body }) {
    requireRole(s!, MODERATORS)
    await db.from('macros').update({ status: 'removed', official: false, public: false }).eq('id', String(body.id))
    return { ok: true }
  },

  async 'admin.moderation.list'({ s }) {
    requireRole(s!, MODERATORS)
    const [{ data: held }, { data: reports }] = await Promise.all([
      db.from('macros').select('id, name, description, author_id, scan, created_at, source').eq('status', 'held').order('created_at'),
      db.from('reports').select('*').eq('resolved', false).order('created_at').limit(200)
    ])
    const a = await authors([...(held ?? []).map((h) => h.author_id), ...(reports ?? []).map((r) => r.reporter)])
    return { held: (held ?? []).map((h) => ({ ...h, author: a.get(h.author_id) ?? null })), reports: (reports ?? []).map((r) => ({ ...r, reporterUser: a.get(r.reporter) ?? null })) }
  },

  async 'admin.moderation.resolve'({ s, body }) {
    requireRole(s!, MODERATORS)
    const id = String(body.id)
    if (body.kind === 'macro') {
      await db.from('macros').update(body.action === 'approve' ? { status: 'live' } : { status: 'removed', public: false }).eq('id', id)
    } else {
      const { data: r } = await db.from('reports').select('*').eq('id', id).single()
      if (r && body.action === 'remove') {
        if (r.target_kind === 'macro') await db.from('macros').update({ status: 'removed', public: false }).eq('id', r.target_id)
        if (r.target_kind === 'user') await db.from('users').update({ description: '', banner_url: null, avatar_url: null }).eq('roblox_id', Number(r.target_id))
        if (r.target_kind === 'review') {
          const [macroId, authorId] = r.target_id.split(':')
          await db.from('reviews').delete().eq('macro_id', macroId).eq('author_id', Number(authorId))
        }
      }
      await db.from('reports').update({ resolved: true }).eq('id', id)
    }
    return { ok: true }
  },

  async 'admin.settings.get'({ s }) {
    requireRole(s!, ['owner'])
    const { data } = await db.from('settings').select('*').in('key', ['checkpoint', 'fflags'])
    return { settings: Object.fromEntries((data ?? []).map((r) => [r.key, r.value])) }
  },

  async 'admin.settings.set'({ s, body }) {
    requireRole(s!, ['owner'])
    if (body.key === 'checkpoint') {
      const v = body.value ?? {}
      const value = {
        steps: int(v.steps, 'Checkpoints', 1, 5),
        ad_key_hours: int(v.ad_key_hours, 'Free key hours', 1, 24 * 30),
        ad_key_devices: int(v.ad_key_devices, 'Free key devices', 1, 10),
        min_seconds: int(v.min_seconds, 'Minimum seconds', 5, 300),
        providers: (Array.isArray(v.providers) ? v.providers : []).filter((p: string) => ['lootlabs', 'linkvertise', 'workink'].includes(p))
      }
      if (!value.providers.length) throw new HttpError(400, 'Keep at least one ad provider switched on.')
      await db.from('settings').upsert({ key: 'checkpoint', value })
    } else if (body.key === 'fflags') {
      await db.from('settings').upsert({ key: 'fflags', value: Array.isArray(body.value) ? body.value.slice(0, 50) : [] })
    } else throw new HttpError(400, 'Unknown setting.')
    return { ok: true }
  },

  async 'admin.stats'({ s }) {
    requireRole(s!, ['owner'])
    const day = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
    const week = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString()
    const count = async (q: any) => (await q).count ?? 0
    const [keys, adKeysDay, redeemsDay, users, macros, held, reportsOpen, ordersWeek] = await Promise.all([
      count(db.from('keys').select('id', { count: 'exact', head: true })),
      count(db.from('keys').select('id', { count: 'exact', head: true }).eq('source', 'checkpoint').gte('created_at', day)),
      count(db.from('key_redemptions').select('key_id', { count: 'exact', head: true }).gte('redeemed_at', day)),
      count(db.from('users').select('roblox_id', { count: 'exact', head: true })),
      count(db.from('macros').select('id', { count: 'exact', head: true }).eq('status', 'live').eq('public', true)),
      count(db.from('macros').select('id', { count: 'exact', head: true }).eq('status', 'held')),
      count(db.from('reports').select('id', { count: 'exact', head: true }).eq('resolved', false)),
      db.from('orders').select('amount, currency, product').eq('status', 'paid').eq('livemode', true).gte('created_at', week)
    ])
    const { data: allPaid } = await db.from('orders').select('amount, currency').eq('status', 'paid').eq('livemode', true)
    const revenueTotal: Record<string, number> = {}
    for (const o of allPaid ?? []) revenueTotal[o.currency ?? 'gbp'] = (revenueTotal[o.currency ?? 'gbp'] ?? 0) + (o.amount ?? 0) / 100
    const revenue: Record<string, number> = {}
    for (const o of ordersWeek.data ?? []) revenue[o.currency ?? 'gbp'] = (revenue[o.currency ?? 'gbp'] ?? 0) + (o.amount ?? 0) / 100
    return { keys, adKeysDay, redeemsDay, users, macros, held, reportsOpen, ordersWeek: (ordersWeek.data ?? []).length, revenueWeek: revenue, revenueTotal }
  },

  async 'admin.discord.stats'({ s }) {
    requireRole(s!, ['owner'])
    const count = async (q: any) => (await q).count ?? 0
    const [total, active, withLuger] = await Promise.all([
      count(db.from('discord_links').select('discord_id', { count: 'exact', head: true })),
      count(db.from('discord_links').select('discord_id', { count: 'exact', head: true }).eq('revoked', false)),
      count(db.from('discord_links').select('discord_id', { count: 'exact', head: true }).eq('revoked', false).not('roblox_id', 'is', null))
    ])
    return { total, active, withLuger, mainGuild: Deno.env.get('DISCORD_GUILD_ID') ?? null }
  },

  /** Add verified members to a server the Luger bot is in, a batch at a time. */
  async 'admin.discord.pull'({ s, body }) {
    requireRole(s!, ['owner'])
    const guildId = String(body.guildId ?? '')
    if (!/^\d{17,20}$/.test(guildId)) throw new HttpError(400, 'Server ID must be the long number from Discord (Copy Server ID).')
    const roleId = body.roleId ? String(body.roleId) : ''
    if (roleId && !/^\d{17,20}$/.test(roleId)) throw new HttpError(400, 'Role ID must be a long number.')
    let q = db.from('discord_links').select('*').eq('revoked', false).order('discord_id').limit(15)
    if (body.cursor) q = q.gt('discord_id', String(body.cursor))
    const { data } = await q
    const tally = { added: 0, already: 0, failed: 0, revoked: 0 }
    for (const link of data ?? []) {
      const access = await discord.accessFor(link)
      if (!access) { tally.revoked++; continue }
      tally[await discord.joinGuild(guildId, link.discord_id, access, roleId ? [roleId] : [])]++
    }
    const rows = data ?? []
    return { ...tally, next: rows.length ? rows[rows.length - 1].discord_id : null, done: rows.length < 15 }
  },

  async 'fflags'() {
    const extra = await getSetting<any[]>('fflags', [])
    return { fflags: [...catalog.fflags, ...extra] }
  }
}

Deno.serve((req) =>
  handle(req, async (body) => {
    const action = String(body.action ?? '')
    if (PUBLIC[action]) return PUBLIC[action]({ req, body })
    if (PRIVATE[action]) {
      const s = await requireSession(req)
      if (s.rid && s.ver) {
        const { data } = await db.from('users').select('banned').eq('roblox_id', s.rid).maybeSingle()
        if (data?.banned) throw new HttpError(403, 'This account is banned from Luger.')
      }
      await touchDevice(s.sub, s.ver ? s.rid : undefined)
      return PRIVATE[action]({ req, body, s })
    }
    throw new HttpError(400, 'Unknown action.')
  })
)
