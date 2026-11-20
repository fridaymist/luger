// Offline stand-in for the server, used only by `npm run dev:offline` in an unpackaged
// build so the interface can be tried before Supabase is set up. Never active in releases.
import catalog from '../../supabase/functions/_shared/catalog.json'

const now = () => Math.floor(Date.now() / 1000)
const fake = (payload: object) => `x.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.y`

const db = {
  user: {
    roblox_id: 1, username: 'lugerowner', display_name: 'Luger Owner', verified: true, roles: ['owner'],
    description: 'Testing Luger offline.', banner_url: null as string | null, avatar_url: null as string | null,
    profile_theme: 'theme.brass', frame: null as string | null, effect: null as string | null, title: null as string | null,
    showcase: [] as string[], level: 4, xp: 2100, ammo: 4200, crystals: 120, luger_seconds: 36000, created_at: new Date().toISOString()
  },
  inventory: ['theme.oxide', 'frame.brass', 'title:Old Hand'],
  achievements: ['luger.first_launch', 'luger.first_macro', 'fisch.welcome', 'fisch.angler', 'bss.welcome'],
  keys: [] as any[],
  staff: [] as any[]
}

const games = catalog.games.map((g, i) => ({
  universe_id: 1000 + i, root_place_id: g.placeId, name: g.name, description: `${g.name} on Roblox.`, creator: 'Roblox creator',
  icon_url: null, thumb_url: null, playing: 12000 - i * 1500, visits: 1e9 - i * 1e8,
  controls: { ...catalog.robloxDefaults, ...g.controls }, macro_friendly: true
}))

// Real game details from Roblox's public APIs so the offline preview looks like the real thing.
let realGames: any[] | null = null
async function loadRealGames(): Promise<void> {
  if (realGames) return
  try {
    const { net } = await import('electron')
    const unis = await Promise.all(catalog.games.map((g) => net.fetch(`https://apis.roblox.com/universes/v1/places/${g.placeId}/universe`).then((r) => r.json()).then((d) => d.universeId)))
    const ids = unis.filter(Boolean).join(',')
    const [details, icons, thumbs] = await Promise.all([
      net.fetch(`https://games.roblox.com/v1/games?universeIds=${ids}`).then((r) => r.json()),
      net.fetch(`https://thumbnails.roblox.com/v1/games/icons?universeIds=${ids}&size=256x256&format=Png&isCircular=false`).then((r) => r.json()),
      net.fetch(`https://thumbnails.roblox.com/v1/games/multiget/thumbnails?universeIds=${ids}&countPerUniverse=1&size=768x432&format=Png&isCircular=false`).then((r) => r.json())
    ])
    realGames = details.data.map((g: any) => {
      const known = catalog.games.find((c) => c.placeId === g.rootPlaceId)
      return {
        universe_id: g.id, root_place_id: g.rootPlaceId, name: g.name, description: g.description, creator: g.creator?.name,
        icon_url: icons.data.find((i: any) => i.targetId === g.id)?.imageUrl ?? null,
        thumb_url: thumbs.data.find((t: any) => t.universeTargetId === g.id)?.thumbnails?.[0]?.imageUrl ?? null,
        playing: g.playing, visits: g.visits, controls: { ...catalog.robloxDefaults, ...(known?.controls ?? {}) }, macro_friendly: true
      }
    })
    games.splice(0, games.length, ...realGames!)
  } catch {
    realGames = games
  }
}

const sampleSource = "import luger\nfrom luger import ui\n\nui.window('Auto cast')\nspeed = ui.slider('speed', 'Cast delay', 100, 2000, default=600, unit='ms')\n\n@luger.hotkey('f1')\ndef cast():\n    luger.click('mouse1', action='down')\n    luger.wait_ms(speed.value)\n    luger.click('mouse1', action='up')\n\nluger.run()\n"

export async function mockCall(action: string, body: any, token: string | null): Promise<any> {
  await new Promise((r) => setTimeout(r, 120))
  if (action.startsWith('games.') || action === 'me' || action === 'explore.list' || action === 'macros.official' || action === 'profile.get') await loadRealGames()
  const session = () => ({ token: fake({ sub: body.device ?? 'dev', kid: 'k1', rid: 1, ver: true, roles: db.user.roles, iss: 'luger', iat: now(), exp: now() + 43200, kx: null }), expires: now() + 43200, key: { kind: 'lifetime', label: 'Offline', expires: null } })
  switch (action) {
    case 'redeem':
      if (!String(body.key).trim()) throw new Error('Enter a key.')
      return session()
    case 'refresh':
    case 'identity.check':
    case 'restore':
      return session()
    case 'identity.start':
      return { phrase: 'luger brass trigger 4821', expiresInMinutes: 30 }
    case 'prices':
      return { keys: catalog.keyProducts.map((p) => ({ ...p, local: { amount: p.gbp, currency: 'GBP' } })), crystals: catalog.crystalPacks.map((p) => ({ ...p, local: { amount: p.gbp, currency: 'GBP' } })), note: 'Offline preview prices.' }
    case 'checkout.key':
    case 'checkout.crystals':
      return { url: 'https://lugerhub.fun/thanks', id: 'cs_test_offline' }
    case 'checkout.claim':
      return { keys: [] }
    case 'discord.linkToken':
      return { url: 'https://lugerhub.fun/verify/' }
    case 'discord.status':
      return { linked: false }
    case 'admin.discord.stats':
      return { total: 42, active: 40, withLuger: 31, mainGuild: '123456789012345678' }
    case 'admin.discord.pull':
      return { added: 12, already: 3, failed: 0, revoked: 0, next: null, done: true }
    case 'checkpoint.providers':
      return { providers: ['lootlabs', 'linkvertise', 'workink'] }
    case 'checkpoint.start':
      return { url: 'https://lugerhub.fun/key/?s=offline', session: '00000000-0000-0000-0000-000000000000', providers: ['lootlabs', 'linkvertise', 'workink'] }
    case 'checkpoint.claim':
      return { done: false, step: 0, steps: 2 }
    case 'me': {
      const xp = db.user.xp
      return { device: 'dev', verified: true, robloxId: 1, roles: db.user.roles, user: { ...db.user, levelInfo: { level: db.user.level, into: xp % 800, needed: 800 } }, inventory: db.inventory, achievements: db.achievements.map((a) => ({ achievement: a, earned_at: new Date().toISOString() })), playtime: games.slice(0, 4).map((g, i) => ({ universe_id: g.universe_id, seconds: (5 - i) * 9000, last_played: new Date(Date.now() - i * 86400000).toISOString() })), newly: [] }
    }
    case 'games.get':
      return { games: games.filter((g) => (body.universeIds ?? []).includes(g.universe_id) || (body.placeIds ?? []).includes(g.root_place_id)) }
    case 'games.popular':
    case 'games.macroFriendly':
      return { games }
    case 'games.search':
      return { games: games.filter((g) => g.name.toLowerCase().includes(String(body.q).toLowerCase())) }
    case 'playtime.report':
      return { newly: [] }
    case 'macros.official':
      return { macros: [{ id: 'off-1', name: 'Fisch auto cast', description: 'Holds and releases cast on F1.', universe_id: games[0].universe_id, tags: ['fishing'], source: sampleSource, version: 2, allow_remove: false, author: { username: db.user.username, roles: db.user.roles, verified: true } }] }
    case 'explore.list':
      return { macros: [0, 1, 2, 3, 4, 5].map((i) => ({ id: `ex-${i}`, name: ['Perfect reel', 'Hive converter', 'Sprinkler loop', 'Aura roller', 'Egg hatcher', 'Combo spammer'][i], description: 'Community macro.', universe_id: games[i % games.length].universe_id, tags: [], version: 1, installs: 900 - i * 120, created_at: new Date(Date.now() - i * 86400000 * 3).toISOString(), rating: 4.6 - i * 0.3, reviews: 30 - i * 4, author: { roblox_id: 10 + i, username: ['reelking', 'beekeeper', 'greenthumb', 'rngod', 'hatchy', 'combo'][i], roles: i === 0 ? ['editor'] : [], verified: i < 2 } })), more: false, games }
    case 'explore.get':
      return { macro: { id: body.id, name: 'Perfect reel', description: 'Keeps the reel bar centred.', source: sampleSource, universe_id: games[0].universe_id, tags: ['fishing'], version: 2, installs: 900, scan: { verdict: 'clean', findings: [] }, author: { roblox_id: 10, username: 'reelking', roles: ['editor'], verified: true } }, reviews: [{ author: { username: 'beekeeper', roles: [] }, stars: 5, body: 'Works perfectly at Moosewood.', created_at: new Date().toISOString() }] }
    case 'explore.install':
      return { macro: { name: 'Perfect reel', description: 'Keeps the reel bar centred.', source: sampleSource, universe_id: games[0].universe_id, tags: ['fishing'], version: 2 } }
    case 'explore.publish':
      return { status: 'live', id: 'ex-new', scan: { verdict: 'clean', findings: [] } }
    case 'explore.review':
    case 'explore.delete':
    case 'report':
    case 'admin.official.remove':
    case 'admin.moderation.resolve':
    case 'admin.users.ban':
    case 'admin.settings.set':
      return { ok: true }
    case 'profile.get':
      return { user: { ...db.user, creatorVerified: true, levelInfo: { level: db.user.level, into: 500, needed: 800 } }, achievements: db.achievements.map((a) => ({ achievement: a })), macros: [], playtime: games.slice(0, 4).map((g, i) => ({ universe_id: g.universe_id, seconds: (5 - i) * 9000 })), reviews: 12 }
    case 'profile.update':
      Object.assign(db.user, Object.fromEntries(Object.entries(body).filter(([k]) => k !== 'action')))
      return { ok: true }
    case 'profile.uploadUrl':
      throw new Error('Uploading pictures needs the Luger server.')
    case 'shop.today': {
      const buyable = [...catalog.themes.filter((t: any) => t.price), ...catalog.items.filter((i: any) => i.price)].map((x: any) => ({ id: x.id, crystals: x.price, ammo: x.price * catalog.ammoPerCrystal }))
      const next = new Date(); next.setUTCHours(24, 0, 0, 0)
      return { day: new Date().toISOString().slice(0, 10), resetsAt: next.toISOString(), featured: buyable.slice(0, 3), regular: buyable.slice(3, 11) }
    }
    case 'shop.buy': {
      const item: any = [...catalog.themes, ...catalog.items].find((x: any) => x.id === body.item)
      const cost = body.currency === 'crystals' ? item.price : item.price * catalog.ammoPerCrystal
      const bal = body.currency === 'crystals' ? 'crystals' : 'ammo'
      if (db.user[bal] < cost) throw new Error(`Not enough ${bal}.`)
      db.user[bal] -= cost
      db.inventory.push(item.id)
      return { ok: true }
    }
    case 'fflags':
      return { fflags: catalog.fflags }
    case 'admin.keys.create': {
      const made = Array.from({ length: Number(body.count) || 1 }, (_, i) => ({ id: `k${db.keys.length + i}`, key: body.custom || `LUGER-${Math.random().toString(36).slice(2, 6).toUpperCase()}-OFFL-INE0-${String(i).padStart(4, '0')}` }))
      for (const m of made) db.keys.unshift({ id: m.id, key_hint: m.key.slice(-4), label: body.label ?? '', kind: body.kind, duration_s: body.durationSeconds, expires_at: null, max_uses: body.maxUses ?? null, uses: 0, max_devices: body.maxDevices ?? 1, devices: 0, bound: body.boundUsername ?? null, note: body.note ?? '', revoked: false, source: 'owner', created_at: new Date().toISOString(), _key: m.key })
      return { keys: made }
    }
    case 'admin.keys.list':
      return { keys: db.keys, total: db.keys.length }
    case 'admin.keys.reveal':
      return { key: db.keys.find((k) => k.id === body.id)?._key }
    case 'admin.keys.update':
      for (const k of db.keys) if ((body.ids ?? [body.id]).includes(k.id) && typeof body.revoked === 'boolean') k.revoked = body.revoked
      return { ok: true }
    case 'admin.keys.delete':
      db.keys = db.keys.filter((k) => !(body.ids ?? [body.id]).includes(k.id))
      return { ok: true }
    case 'admin.staff.list':
      return { staff: [{ roblox_id: 1, username: db.user.username, display_name: db.user.display_name, roles: ['owner'] }, ...db.staff] }
    case 'admin.staff.set':
      db.staff = db.staff.filter((s) => s.username !== body.username)
      if (body.on !== false) db.staff.push({ roblox_id: 99, username: body.username, display_name: body.username, roles: [body.role] })
      return { ok: true }
    case 'admin.moderation.list':
      return { held: [], reports: [] }
    case 'admin.settings.get':
      return { settings: { checkpoint: { steps: 2, ad_key_hours: 24, ad_key_devices: 1, min_seconds: 12, providers: ['lootlabs', 'linkvertise', 'workink'] }, fflags: [] } }
    case 'admin.stats':
      return { keys: db.keys.length, adKeysDay: 14, redeemsDay: 31, users: 120, macros: 48, held: 0, reportsOpen: 0, ordersWeek: 6, revenueWeek: { gbp: 54.94 } }
    case 'admin.official.list':
      return { macros: [{ id: 'off-1', name: 'Fisch auto cast', description: 'Holds and releases cast on F1.', universe_id: games[0].universe_id, tags: ['fishing'], version: 2, allow_remove: false, public: false, installs: 0, updated_at: new Date().toISOString(), author: { username: db.user.username, roles: db.user.roles } }] }
    case 'admin.official.setRemovable':
      return { ok: true }
    case 'admin.official.publish':
      return { status: 'live', id: 'off-new', scan: { verdict: 'clean', findings: [] } }
  }
  void token
  throw new Error(`Offline preview does not support "${action}".`)
}
