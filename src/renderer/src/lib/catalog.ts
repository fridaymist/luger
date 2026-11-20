import data from '../../../../supabase/functions/_shared/catalog.json'

export const catalog = data
export type Theme = (typeof data.themes)[number]
export const themeById = new Map(data.themes.map((t) => [t.id, t]))
export const itemById = new Map<string, any>([...data.themes.map((t) => [t.id, { ...t, kind: 'theme' }] as const), ...data.items.map((i) => [i.id, i] as const)])
export const gameByPlace = new Map(data.games.map((g) => [g.placeId, g]))

export interface Achievement { id: string; name: string; desc: string; game?: string; minutes?: number; reward: any }
export const achievements: Achievement[] = [
  ...data.generalAchievements.map((a) => ({ ...a })),
  ...data.games.flatMap((g) => g.achievements.map((a) => ({ id: a.id, name: a.name, desc: a.minutes ? `Play ${g.name} for ${fmtMinutes(a.minutes)}` : `Join ${g.name}`, game: g.name, minutes: a.minutes, reward: a.reward })))
]
export const achievementById = new Map(achievements.map((a) => [a.id, a]))

export function fmtMinutes(m: number): string {
  if (m < 60) return `${m} min`
  const h = m / 60
  return `${Number.isInteger(h) ? h : h.toFixed(1)} hour${h === 1 ? '' : 's'}`
}

/** Every title a user can equip: earned from achievements or bought. */
export function titlesFrom(inventory: string[]): string[] {
  const out = new Set<string>()
  for (const i of inventory) {
    if (i.startsWith('title:')) out.add(i.slice(6))
    else if (i.startsWith('title.')) out.add(itemById.get(i)?.name ?? i)
  }
  return [...out]
}
