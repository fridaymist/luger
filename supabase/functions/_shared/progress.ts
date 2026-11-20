// Levels, achievements and rewards. The catalog is shared with the app so both agree.
import catalog from './catalog.json' with { type: 'json' }
import { gamesByUniverse } from './roblox.ts'
import { db } from './util.ts'

export type Reward = { ammo?: number; xp?: number; theme?: string; frame?: string; title?: string }

export function levelFor(xp: number): { level: number; into: number; needed: number } {
  const { xpBase, xpGrowth } = catalog.levels
  let level = 1
  let need = xpBase
  let left = xp
  while (left >= need) {
    left -= need
    level += 1
    need = Math.round(xpBase * Math.pow(xpGrowth, level - 1))
  }
  return { level, into: left, needed: need }
}

const gameByPlace = new Map(catalog.games.map((g) => [g.placeId, g]))

/** Every achievement id a user qualifies for, given their stats. */
export function qualifying(stats: {
  playtimeByPlace: Map<number, number> // seconds
  macros: number
  published: number
  reviewsReceived: number
  lugerSeconds: number
}): { id: string; reward: Reward }[] {
  const out: { id: string; reward: Reward }[] = []
  for (const [placeId, seconds] of stats.playtimeByPlace) {
    const game = gameByPlace.get(placeId)
    if (!game) continue
    const minutes = seconds / 60
    for (const a of game.achievements) if (minutes >= a.minutes) out.push({ id: a.id, reward: a.reward })
    const m = game.mastery as { endless: boolean; repeatEveryMinutes?: number; repeatReward?: Reward }
    if (m.endless && m.repeatEveryMinutes) {
      const last = game.achievements[game.achievements.length - 1].minutes
      const extra = Math.floor((minutes - last) / m.repeatEveryMinutes)
      for (let i = 1; i <= extra; i++) out.push({ id: `${game.id}.mastery.${i}`, reward: m.repeatReward ?? {} })
    }
  }
  const g = Object.fromEntries(catalog.generalAchievements.map((a) => [a.id, a.reward]))
  out.push({ id: 'luger.first_launch', reward: g['luger.first_launch'] })
  if (stats.macros >= 1) out.push({ id: 'luger.first_macro', reward: g['luger.first_macro'] })
  if (stats.macros >= 10) out.push({ id: 'luger.ten_macros', reward: g['luger.ten_macros'] })
  if (stats.published >= 1) out.push({ id: 'luger.first_publish', reward: g['luger.first_publish'] })
  if (stats.reviewsReceived >= 1) out.push({ id: 'luger.first_review', reward: g['luger.first_review'] })
  if (stats.reviewsReceived >= 10) out.push({ id: 'luger.ten_reviews', reward: g['luger.ten_reviews'] })
  const hours = stats.lugerSeconds / 3600
  if (hours >= 10) out.push({ id: 'luger.hours_10', reward: g['luger.hours_10'] })
  if (hours >= 100) out.push({ id: 'luger.hours_100', reward: g['luger.hours_100'] })
  if (hours >= 500) out.push({ id: 'luger.hours_500', reward: g['luger.hours_500'] })
  return out
}

/** Grant any newly earned achievements. Returns what was newly earned. */
export async function award(robloxId: number, localMacroCount: number): Promise<{ id: string; reward: Reward }[]> {
  const [{ data: user }, { data: play }, { data: have }, { count: published }, { data: mine }] = await Promise.all([
    db.from('users').select('luger_seconds').eq('roblox_id', robloxId).single(),
    db.from('playtime').select('universe_id, seconds').eq('roblox_id', robloxId),
    db.from('user_achievements').select('achievement').eq('roblox_id', robloxId),
    db.from('macros').select('id', { count: 'exact', head: true }).eq('author_id', robloxId).eq('public', true).eq('status', 'live'),
    db.from('macros').select('id').eq('author_id', robloxId)
  ])
  const ids = (mine ?? []).map((m) => m.id)
  const { count: reviewsReceived } = ids.length
    ? await db.from('reviews').select('macro_id', { count: 'exact', head: true }).in('macro_id', ids)
    : { count: 0 }
  const universes = (play ?? []).map((p) => p.universe_id)
  // gamesByUniverse fills the cache for games we have not looked up yet.
  const games = universes.length ? await gamesByUniverse(universes) : []
  const placeOf = new Map((games ?? []).map((g) => [g.universe_id, g.root_place_id]))
  const playtimeByPlace = new Map<number, number>()
  for (const p of play ?? []) {
    const place = placeOf.get(p.universe_id)
    if (place) playtimeByPlace.set(place, p.seconds)
  }
  const owned = new Set((have ?? []).map((a) => a.achievement))
  const fresh = qualifying({
    playtimeByPlace,
    macros: Math.max(0, Math.min(localMacroCount, 10000)),
    published: published ?? 0,
    reviewsReceived: reviewsReceived ?? 0,
    lugerSeconds: user?.luger_seconds ?? 0
  }).filter((a) => !owned.has(a.id))
  if (!fresh.length) return []
  const { data: inserted } = await db
    .from('user_achievements')
    .upsert(fresh.map((a) => ({ roblox_id: robloxId, achievement: a.id })), { onConflict: 'roblox_id,achievement', ignoreDuplicates: true })
    .select('achievement')
  const really = new Set((inserted ?? []).map((r) => r.achievement))
  const granted = fresh.filter((a) => really.has(a.id))
  let ammo = 0
  let xp = 0
  const items: string[] = []
  for (const a of granted) {
    ammo += a.reward.ammo ?? 0
    xp += a.reward.xp ?? 0
    if (a.reward.theme) items.push(a.reward.theme)
    if (a.reward.frame) items.push(a.reward.frame)
    if (a.reward.title) items.push(`title:${a.reward.title}`)
  }
  if (ammo) await db.rpc('adjust_balance', { p_user: robloxId, p_ammo: ammo, p_crystals: 0 })
  if (xp) {
    const { data: u } = await db.from('users').select('xp').eq('roblox_id', robloxId).single()
    const total = (u?.xp ?? 0) + xp
    await db.from('users').update({ xp: total, level: levelFor(total).level }).eq('roblox_id', robloxId)
  }
  if (items.length) {
    await db.from('inventory').upsert(items.map((item) => ({ roblox_id: robloxId, item })), { onConflict: 'roblox_id,item', ignoreDuplicates: true })
  }
  return granted
}
