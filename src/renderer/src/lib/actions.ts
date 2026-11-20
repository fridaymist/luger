import { achievementById } from './catalog'
import { api, invoke, on } from './bridge'
import { applySettings } from './theme'
import { getState, setState, toast } from './state'

export async function refreshMe(): Promise<void> {
  const s = getState().session
  if (!s) return setState({ me: null })
  try {
    const macros = await invoke<any[]>('macros:list')
    const me = await api('me', { macroCount: macros.filter((m) => m.origin !== 'official').length })
    setState({ me })
    announce(me.newly)
  } catch {
    setState({ me: { verified: false, robloxId: s.rid ?? null, roles: s.roles ?? [], user: null, inventory: [], achievements: [], playtime: [] } })
  }
}

function announce(newly: { id: string; reward: any }[] | undefined): void {
  for (const a of newly ?? []) {
    const def = achievementById.get(a.id)
    const bits = [a.reward?.ammo && `+${a.reward.ammo} ammo`, a.reward?.xp && `+${a.reward.xp} XP`, a.reward?.title && `title “${a.reward.title}”`].filter(Boolean)
    toast(bits.join(' · ') || 'Achievement unlocked', 'reward', def ? def.name : a.id.includes('.mastery.') ? 'Mastery level up' : 'Achievement')
  }
}

export async function saveSettings(patch: Record<string, unknown>): Promise<void> {
  const settings = await invoke('settings:set', patch)
  setState({ settings })
  applySettings(settings)
}

export async function boot(): Promise<void> {
  const [info, settings] = await Promise.all([invoke('app:info'), invoke('settings:get')])
  applySettings(settings)
  setState({ info, settings })
  const [session, detected, running, play] = await Promise.all([
    invoke('session:get'),
    invoke('identity:detect').catch(() => null),
    invoke('macros:running'),
    invoke('roblox:playtime')
  ])
  setState({ session, detected, running, playing: play.nowPlaying, ready: true })
  if (session) refreshMe()

  on('session:changed', (c) => {
    setState({ session: c })
    if (c) refreshMe()
    else setState({ me: null })
  })
  on('macro:running', (ids) => setState({ running: ids }))
  on('roblox:playing', (p) => setState({ playing: p }))
  on('progress:newly', (n) => {
    announce(n)
    refreshMe()
  })
  on('toast', (t) => toast(t.text, t.kind))
  on('update:ready', () => setState({ updateReady: true }))
  // Collect any purchase that finished while Luger was closed.
  invoke('session:collectPurchases').then(async (keys: any[]) => {
    if (keys.length && !getState().session) {
      await invoke('session:redeem', keys[0].key)
      toast('Your purchased key is active.', 'reward', 'Thanks for supporting Luger')
    }
  }).catch(() => {})
}
