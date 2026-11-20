import { Compass, Crown, Gamepad2, Layers, Settings as Cog, ShoppingBag, SlidersHorizontal, UserRound } from 'lucide-react'
import { useEffect } from 'react'
import logo from './assets/luger-logo.png'
import { Avatar, Badges } from './components/identity'
import { Toasts } from './components/ui'
import { boot } from './lib/actions'
import { catalog } from './lib/catalog'
import { go, hasRole, useStore } from './lib/state'
import Apps from './screens/Apps'
import Explore from './screens/Explore'
import Home from './screens/Home'
import KeyGate from './screens/KeyGate'
import Macros from './screens/Macros'
import Marketplace from './screens/Marketplace'
import Owner from './screens/Owner'
import Profile from './screens/Profile'
import Settings from './screens/Settings'

const NAV = [
  { id: 'home', label: 'Bootstrapper', icon: Gamepad2 },
  { id: 'apps', label: 'Apps', icon: Layers },
  { id: 'macros', label: 'Macros', icon: SlidersHorizontal },
  { id: 'explore', label: 'Explore', icon: Compass },
  { id: 'profile', label: 'Profile', icon: UserRound },
  { id: 'market', label: 'Marketplace', icon: ShoppingBag }
]

const SCREENS: Record<string, () => JSX.Element | null> = {
  home: Home, apps: Apps, macros: Macros, explore: Explore, profile: Profile, market: Marketplace, settings: Settings, owner: Owner
}

export default function App() {
  const ready = useStore((s) => s.ready)
  const session = useStore((s) => s.session)
  const settings = useStore((s) => s.settings)
  useEffect(() => {
    boot()
  }, [])
  if (!ready) return <div className="boot"><img src={logo} alt="" /></div>
  const bg = settings?.customBackground
  return (
    <>
      {bg && <div className="backdrop" style={{ backgroundImage: `url("luger-bg://img/${encodeURIComponent(bg)}")`, ['--dim' as any]: settings.backgroundDim }} />}
      {session ? <Shell /> : <KeyGate />}
      <Toasts />
    </>
  )
}

function Shell() {
  const page = useStore((s) => s.page)
  const me = useStore((s) => s.me)
  const detected = useStore((s) => s.detected)
  const playing = useStore((s) => s.playing)
  const games = useStore((s) => s.games)
  const updateReady = useStore((s) => s.updateReady)
  const Screen = SCREENS[page] ?? Home
  const staff = hasRole(me, 'owner', 'developer', 'editor')
  const playingName = playing && (catalog.games.find((g) => g.placeId === playing.placeId)?.name ?? Object.values(games).find((g: any) => g.root_place_id === playing.placeId)?.name)
  const user = me?.user
  return (
    <div className="app">
      <nav className="rail drag" aria-label="Main">
        <div className="brand"><img src={logo} alt="" /><b>Luger</b></div>
        <div className="nav">
          {NAV.map((n) => (
            <button key={n.id} aria-current={page === n.id ? 'page' : undefined} onClick={() => go(n.id)}><n.icon size={18} />{n.label}</button>
          ))}
          <div className="sep" />
          {staff && <button aria-current={page === 'owner' ? 'page' : undefined} onClick={() => go('owner')}><Crown size={18} />{hasRole(me, 'owner') ? 'Owner' : 'Staff'}</button>}
          <button aria-current={page === 'settings' ? 'page' : undefined} onClick={() => go('settings')}><Cog size={18} />Settings</button>
        </div>
        <div className="rail-foot">
          {updateReady && <button className="btn sm primary" onClick={() => window.luger.invoke('app:restartToUpdate')}>Restart to update</button>}
          {playing && <div className="now-playing"><span className="muted">In game</span><b className="ellipsis">{playingName ?? `Place ${playing.placeId}`}</b></div>}
          <button className="me-chip" onClick={() => go('profile')}>
            <Avatar src={user?.avatar_url ?? detected?.avatar} name={user?.username ?? detected?.name ?? undefined} size={32} frame={user?.frame} />
            <span className="grow" style={{ minWidth: 0 }}>
              <span className="row" style={{ gap: 5 }}><b className="ellipsis" style={{ fontSize: 13 }}>{user?.display_name ?? detected?.displayName ?? 'Not linked'}</b><Badges roles={me?.roles} size={12} /></span>
              <span className="muted small ellipsis" style={{ display: 'block' }}>{user ? `Level ${user.levelInfo?.level ?? user.level}` : detected?.name ? `@${detected.name}` : 'Open Roblox once'}</span>
            </span>
          </button>
        </div>
      </nav>
      <main className="main"><Screen /></main>
    </div>
  )
}
