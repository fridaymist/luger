// Roblox public web APIs, cached in the `games` table.
import { db } from './util.ts'
import catalog from './catalog.json' with { type: 'json' }

const UA = { 'user-agent': 'Luger/1 (+https://lugerhub.fun)' }
const STALE_MS = 45 * 60 * 1000

async function getJson(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, { ...init, headers: { ...UA, ...(init?.headers ?? {}) } })
  if (!res.ok) throw new Error(`Roblox API ${res.status} for ${url}`)
  return res.json()
}

export async function userById(id: number): Promise<{ id: number; name: string; displayName: string; description: string } | null> {
  try {
    return await getJson(`https://users.roblox.com/v1/users/${id}`)
  } catch {
    return null
  }
}

export async function userByName(name: string): Promise<{ id: number; name: string; displayName: string } | null> {
  const data = await getJson('https://users.roblox.com/v1/usernames/users', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ usernames: [name], excludeBannedUsers: false })
  })
  return data.data?.[0] ?? null
}

export async function headshots(ids: number[]): Promise<Record<number, string>> {
  if (!ids.length) return {}
  const data = await getJson(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${ids.join(',')}&size=150x150&format=Png&isCircular=false`)
  return Object.fromEntries((data.data ?? []).map((d: any) => [d.targetId, d.imageUrl]))
}

export async function universeForPlace(placeId: number): Promise<number | null> {
  const { data } = await db.from('games').select('universe_id').eq('root_place_id', placeId).maybeSingle()
  if (data) return data.universe_id
  try {
    return (await getJson(`https://apis.roblox.com/universes/v1/places/${placeId}/universe`)).universeId ?? null
  } catch {
    return null
  }
}

const macroPlaces = new Map(catalog.games.map((g) => [g.placeId, g]))

/** Fetch fresh details for universes and store them. */
export async function refreshGames(universeIds: number[]): Promise<void> {
  const ids = [...new Set(universeIds)].filter(Boolean)
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50).join(',')
    const [details, icons, thumbs] = await Promise.all([
      getJson(`https://games.roblox.com/v1/games?universeIds=${chunk}`),
      getJson(`https://thumbnails.roblox.com/v1/games/icons?universeIds=${chunk}&returnPolicy=PlaceHolder&size=256x256&format=Png&isCircular=false`),
      getJson(`https://thumbnails.roblox.com/v1/games/multiget/thumbnails?universeIds=${chunk}&countPerUniverse=1&defaults=true&size=768x432&format=Png&isCircular=false`)
    ])
    const icon = Object.fromEntries((icons.data ?? []).map((d: any) => [d.targetId, d.imageUrl]))
    const thumb = Object.fromEntries((thumbs.data ?? []).map((d: any) => [d.universeTargetId, d.thumbnails?.[0]?.imageUrl]))
    const rows = (details.data ?? []).map((g: any) => {
      const known = macroPlaces.get(g.rootPlaceId)
      return {
        universe_id: g.id,
        root_place_id: g.rootPlaceId,
        name: g.name,
        description: (g.description ?? '').slice(0, 4000),
        creator: g.creator?.name ?? '',
        icon_url: icon[g.id] ?? null,
        thumb_url: thumb[g.id] ?? null,
        playing: g.playing ?? 0,
        visits: g.visits ?? 0,
        controls: known ? { ...catalog.robloxDefaults, ...known.controls } : catalog.robloxDefaults,
        macro_friendly: Boolean(known),
        refreshed_at: new Date().toISOString()
      }
    })
    if (rows.length) await db.from('games').upsert(rows)
  }
}

export async function gamesByUniverse(universeIds: number[]): Promise<any[]> {
  const ids = [...new Set(universeIds)].filter(Boolean).slice(0, 100)
  if (!ids.length) return []
  const { data: cached } = await db.from('games').select('*').in('universe_id', ids)
  const fresh = new Set((cached ?? []).filter((g) => Date.now() - Date.parse(g.refreshed_at) < STALE_MS).map((g) => g.universe_id))
  const stale = ids.filter((id) => !fresh.has(id))
  if (stale.length) {
    try {
      await refreshGames(stale)
    } catch (e) {
      console.error('game refresh failed', e) // serve whatever is cached
    }
    const { data } = await db.from('games').select('*').in('universe_id', ids)
    return data ?? []
  }
  return cached ?? []
}

export async function gamesByPlace(placeIds: number[]): Promise<any[]> {
  const universes = (await Promise.all(placeIds.slice(0, 50).map(universeForPlace))).filter((u): u is number => !!u)
  return gamesByUniverse(universes)
}

/** Popular games right now, from Roblox's own explore sorts. Cached for 30 minutes. */
export async function popular(): Promise<any[]> {
  const { data: cache } = await db.from('settings').select('value').eq('key', 'popular_cache').maybeSingle()
  if (cache && Date.now() - cache.value.at < 30 * 60 * 1000) return gamesByUniverse(cache.value.ids)
  let ids: number[] = []
  try {
    const session = crypto.randomUUID()
    const data = await getJson(`https://apis.roblox.com/explore-api/v1/get-sorts?sessionId=${session}&device=computer&country=all`)
    const sort = (data.sorts ?? []).find((s: any) => /top.?playing|popular|trending/i.test(s.sortId ?? s.topic ?? '')) ?? (data.sorts ?? []).find((s: any) => s.games?.length)
    ids = (sort?.games ?? []).map((g: any) => g.universeId).filter(Boolean).slice(0, 24)
  } catch (e) {
    console.error('explore sorts failed', e)
  }
  if (!ids.length) {
    ids = (await Promise.all(catalog.games.map((g) => universeForPlace(g.placeId)))).filter((u): u is number => !!u)
  }
  await db.from('settings').upsert({ key: 'popular_cache', value: { at: Date.now(), ids } })
  return gamesByUniverse(ids)
}

export async function search(q: string): Promise<any[]> {
  try {
    const session = crypto.randomUUID()
    const data = await getJson(`https://apis.roblox.com/search-api/omni-search?searchQuery=${encodeURIComponent(q)}&sessionId=${session}&pageType=all`)
    const ids: number[] = []
    for (const group of data.searchResults ?? []) {
      for (const c of group.contents ?? []) if (c.universeId) ids.push(c.universeId)
    }
    return gamesByUniverse(ids.slice(0, 20))
  } catch (e) {
    console.error('search failed', e)
    const { data } = await db.from('games').select('*').ilike('name', `%${q}%`).limit(20)
    return data ?? []
  }
}
