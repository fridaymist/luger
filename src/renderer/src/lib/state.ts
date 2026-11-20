// Tiny global store (useSyncExternalStore) shared across screens.
import { useSyncExternalStore } from 'react'

export interface Claims { sub: string; kid: string; rid?: number; ver?: boolean; roles?: string[]; exp?: number; kx?: number | null }
export interface Me {
  verified: boolean
  robloxId: number | null
  roles: string[]
  user: any | null
  inventory: string[]
  achievements: { achievement: string; earned_at: string }[]
  playtime: { universe_id: number; seconds: number; last_played: string }[]
}
export interface Detected { id: number; name: string | null; displayName: string | null; avatar: string | null }
export interface Toast { id: number; kind: 'info' | 'error' | 'reward'; title?: string; text: string }

export interface AppState {
  ready: boolean
  info: { version: string; platform: string; offline: boolean; python: boolean; roblox: boolean; currency: string; locale: string } | null
  session: Claims | null
  me: Me | null
  detected: Detected | null
  settings: any
  page: string
  pageArg: any
  toasts: Toast[]
  running: string[]
  playing: { placeId: number; since: number } | null
  updateReady: boolean
  games: Record<number, any> // universe id -> game
}

let s: AppState = {
  ready: false, info: null, session: null, me: null, detected: null, settings: null, page: 'home', pageArg: null,
  toasts: [], running: [], playing: null, updateReady: false, games: {}
}
const subs = new Set<() => void>()

export const getState = () => s
export function setState(patch: Partial<AppState> | ((st: AppState) => Partial<AppState>)): void {
  s = { ...s, ...(typeof patch === 'function' ? patch(s) : patch) }
  subs.forEach((f) => f())
}
export function useStore<T>(pick: (st: AppState) => T): T {
  return useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => pick(s))
}

let toastId = 0
export function toast(text: string, kind: Toast['kind'] = 'info', title?: string): void {
  const id = ++toastId
  setState((st) => ({ toasts: [...st.toasts, { id, kind, text, title }] }))
  setTimeout(() => setState((st) => ({ toasts: st.toasts.filter((t) => t.id !== id) })), kind === 'error' ? 6500 : 4200)
}
export function fail(e: unknown): void {
  toast((e as Error)?.message ?? String(e), 'error')
}
export function go(page: string, pageArg: any = null): void {
  setState({ page, pageArg })
}
export function cacheGames(list: any[]): void {
  if (!list?.length) return
  setState((st) => ({ games: { ...st.games, ...Object.fromEntries(list.map((g) => [g.universe_id, g])) } }))
}
export const hasRole = (me: Me | null, ...roles: string[]) => !!me?.roles?.some((r) => roles.includes(r))
