import { Copy, ExternalLink, FolderOpen, Loader2, LogOut, RefreshCw, ShieldCheck } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Avatar } from '../components/identity'
import { Confirm, KeyInput, Seg, Switch, useAsync } from '../components/ui'
import { refreshMe, saveSettings } from '../lib/actions'
import { invoke } from '../lib/bridge'
import { themeById } from '../lib/catalog'
import { duration, money } from '../lib/format'
import { fail, go, setState, toast, useStore } from '../lib/state'

const SECTIONS = [
  { id: 'general', label: 'General' },
  { id: 'look', label: 'Look' },
  { id: 'roblox', label: 'Roblox' },
  { id: 'macros', label: 'Macros' },
  { id: 'account', label: 'Account' },
  { id: 'about', label: 'About' }
]

function Line({ children, control, hint }: { children: ReactNode; control: ReactNode; hint?: ReactNode }) {
  return (
    <div className="sline">
      <div className="grow"><div className="sline-text">{children}</div>{hint && <div className="muted small">{hint}</div>}</div>
      <div className="sline-ctl">{control}</div>
    </div>
  )
}

export default function Settings() {
  const s = useStore((st) => st.settings)
  const info = useStore((st) => st.info)
  const pageArg = useStore((st) => st.pageArg)
  const [active, setActive] = useState('general')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (pageArg?.section) setTimeout(() => document.getElementById(`s-${pageArg.section}`)?.scrollIntoView({ behavior: 'smooth' }), 50)
  }, [pageArg])
  useEffect(() => {
    const root = ref.current
    if (!root) return
    const obs = new IntersectionObserver((entries) => {
      const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
      if (top) setActive(top.target.id.slice(2))
    }, { root, rootMargin: '0px 0px -60% 0px' })
    root.querySelectorAll('section[id^="s-"]').forEach((el) => obs.observe(el))
    return () => obs.disconnect()
  }, [])
  if (!s) return null
  const set = (p: Record<string, unknown>) => saveSettings(p).catch(fail)

  return (
    <>
      <header className="topbar drag"><h1>Settings</h1></header>
      <div className="settings">
        <nav className="sindex" aria-label="Settings sections">
          {SECTIONS.map((x) => <button key={x.id} aria-current={active === x.id ? 'true' : undefined} onClick={() => document.getElementById(`s-${x.id}`)?.scrollIntoView({ behavior: 'smooth' })}>{x.label}</button>)}
        </nav>
        <div className="sbody" ref={ref}>
          <section id="s-general">
            <h2>General</h2>
            <Line control={<Switch label="Start with computer" on={s.launchAtLogin} onChange={(v) => set({ launchAtLogin: v })} />}>Open Luger when my computer starts</Line>
            <Line control={<Switch label="Keep in tray" on={s.closeToTray} onChange={(v) => set({ closeToTray: v })} />} hint="Macros and apps keep running with the window closed.">Keep running in the tray when I close the window</Line>
            <Line control={<Switch label="Notifications" on={s.notifications} onChange={(v) => set({ notifications: v })} />}>Let macros show desktop notifications</Line>
          </section>

          <section id="s-look">
            <h2>Look</h2>
            <Line control={<button className="btn sm" onClick={() => go('profile')}>{themeById.get(s.appTheme)?.name ?? 'Brass'} · change</button>} hint="Themes and background pictures live behind the round button in Edit profile.">The app uses the {themeById.get(s.appTheme)?.name ?? 'Brass'} theme</Line>
            <Line control={<Seg label="Density" value={s.density} onChange={(v) => set({ density: v })} options={[{ value: 'comfortable', label: 'Roomy' }, { value: 'compact', label: 'Compact' }]} />}>Space things out</Line>
            <Line control={<Switch label="Reduce motion" on={s.reduceMotion} onChange={(v) => set({ reduceMotion: v })} />}>Keep animations to a minimum</Line>
            {s.customBackground && <Line control={<input type="range" min={0.1} max={0.9} step={0.05} value={s.backgroundDim} onChange={(e) => set({ backgroundDim: Number(e.target.value) })} aria-label="Background dim" style={{ width: 160 }} />}>Dim my background picture</Line>}
          </section>

          <section id="s-roblox">
            <h2>Roblox</h2>
            <RobloxFolder s={s} set={set} />
            <Line control={<Switch label="Discord status" on={s.discordPresence} onChange={(v) => set({ discordPresence: v })} />}>Show what I’m playing on Discord</Line>
            {info?.platform === 'win32' && <Line control={<Switch label="Multiple Roblox windows" on={s.multiInstance} onChange={(v) => set({ multiInstance: v })} />}>Allow more than one Roblox window</Line>}
            <Line control={<button className="btn sm" onClick={() => go('home')}>Open tweaks</button>}>Frame rate, graphics and other Roblox tweaks</Line>
          </section>

          <section id="s-macros">
            <h2>Macros</h2>
            <Line control={<KeyInput label="Emergency stop" allowMouse={false} value={s.defaultStopKey} onChange={(k) => set({ defaultStopKey: k })} />} hint="Stops every running macro and app at once.">Stop everything when I press</Line>
            <Line control={<Seg label="Safety" value={s.safety} onChange={(v) => set({ safety: v })} options={[{ value: 'strict', label: 'Strict' }, { value: 'standard', label: 'Standard' }]} />}
              hint={s.safety === 'strict' ? 'Anything the scan finds suspicious asks you first.' : 'Only clearly dangerous code asks you first.'}>How careful to be with new macros</Line>
            <Line control={<span className={`chip ${info?.python ? 'live' : 'warn'}`}>{info?.python ? 'Ready' : 'Missing'}</span>} hint={info?.python ? 'Bundled with Luger, so nothing else to install.' : 'Reinstall Luger to restore it.'}>Python for macros</Line>
          </section>

          <section id="s-account"><h2>Account</h2><Account /></section>

          <section id="s-about">
            <h2>About</h2>
            <Line control={<span className="num" style={{ fontWeight: 700 }}>{info?.version}</span>}>Luger version</Line>
            <Line control={<Seg label="Updates" value={s.updateChannel} onChange={(v) => set({ updateChannel: v })} options={[{ value: 'stable', label: 'Stable' }, { value: 'beta', label: 'Early' }]} />} hint="Luger updates itself in the background and asks before restarting.">Which updates to get</Line>
            <Line control={<button className="btn sm ghost" onClick={() => invoke('app:open', 'https://lugerhub.fun')}><ExternalLink size={13} />lugerhub.fun</button>}>Website</Line>
            <p className="muted small sfoot">Luger only sends keyboard and mouse input, like you would, and never modifies Roblox. Use macros only in games whose rules allow them. Fonts: Bricolage Grotesque and Figtree (SIL Open Font License). Icons: Lucide (ISC).</p>
          </section>
        </div>
      </div>
    </>
  )
}

function RobloxFolder({ s, set }: { s: any; set: (p: any) => void }) {
  const dirs = useAsync(() => invoke<string[]>('roblox:logDirs'), [s.robloxLogDir])
  const found = dirs.data?.length
  return (
    <Line hint={found ? dirs.data![0] : 'Luger reads these files to find your account and playtime. Open Roblox once, or choose the folder.'}
      control={<span className="row">{s.robloxLogDir && <button className="btn sm ghost" onClick={() => set({ robloxLogDir: null })}>Use default</button>}<button className="btn sm" onClick={() => invoke('settings:pickLogDir').then(() => dirs.reload())}><FolderOpen size={13} />Choose</button></span>}>
      {found ? 'Roblox log files found' : 'Roblox log files not found yet'}
    </Line>
  )
}

function Account() {
  const me = useStore((s) => s.me)
  const session = useStore((s) => s.session)
  const detected = useStore((s) => s.detected)
  const info = useStore((s) => s.info)
  const [phrase, setPhrase] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [signOut, setSignOut] = useState(false)
  const prices = useAsync(() => invoke('prices'), [])
  const exp = session?.kx ?? null
  const left = exp ? exp * 1000 - Date.now() : null

  async function run(name: string, fn: () => Promise<unknown>) {
    setBusy(name)
    try { await fn() } catch (e) { fail(e) } finally { setBusy(null) }
  }

  return (
    <>
      <div className="sline">
        <div className="row grow" style={{ gap: 12 }}>
          <Avatar src={me?.user?.avatar_url ?? detected?.avatar} name={detected?.name ?? undefined} size={40} />
          <div>
            <div className="sline-text">{detected?.name ? <>Roblox account <b>@{detected.name}</b></> : 'No Roblox account found yet'}</div>
            <div className="muted small">{me?.verified ? <span className="row" style={{ gap: 4, color: 'var(--good)' }}><ShieldCheck size={13} />Proven on this computer</span> : 'Not proven yet. Achievements, ammo, publishing and your public profile need it.'}</div>
          </div>
        </div>
        <div className="sline-ctl">
          {!me?.verified && detected?.id && !phrase && <button className="btn sm primary" disabled={!!busy} onClick={() => run('start', async () => setPhrase((await invoke('identity:start')).phrase))}>Prove it’s mine</button>}
          <button className="btn sm ghost icon" title="Detect again" aria-label="Detect Roblox account again" onClick={() => invoke('identity:detect').then((d) => { setState({ detected: d }); toast(d?.name ? `Found @${d.name}.` : 'No Roblox account found. Open Roblox once and try again.') })}><RefreshCw size={13} /></button>
        </div>
      </div>
      {phrase && !me?.verified && (
        <div className="proof">
          <ol>
            <li>Copy this phrase:<div className="row" style={{ marginTop: 6 }}><code className="phrase">{phrase}</code><button className="btn sm" onClick={() => { navigator.clipboard.writeText(phrase); toast('Copied.') }}><Copy size={13} />Copy</button></div></li>
            <li>Paste it anywhere in the About section of your Roblox profile and save. <button className="linkish" onClick={() => invoke('app:open', `https://www.roblox.com/users/${detected?.id}/profile`)}>Open my profile</button></li>
            <li>Come back and check. You can remove the phrase afterwards.</li>
          </ol>
          <button className="btn primary" disabled={!!busy} onClick={() => run('check', async () => { await invoke('identity:check'); await refreshMe(); setPhrase(null); toast('Account proven. Welcome in.', 'reward') })}>{busy === 'check' ? <Loader2 size={14} className="spin" /> : <ShieldCheck size={14} />}Check now</button>
        </div>
      )}

      <Line control={<button className="btn sm danger" onClick={() => setSignOut(true)}><LogOut size={13} />Sign out</button>}
        hint={exp ? `Ends ${new Date(exp * 1000).toLocaleString()}${left !== null && left < 86400000 * 2 ? ' · extend below to keep going' : ''}` : 'Never ends.'}>
        Your key: {exp ? `${duration(Math.max(0, Math.round((left ?? 0) / 1000 / 3600)) * 3600)} left` : 'lifetime'}
      </Line>
      {me?.verified && <Line control={<button className="btn sm" disabled={!!busy} onClick={() => run('restore', async () => { await invoke('session:restorePurchases'); toast('Purchases restored.') })}>Restore</button>} hint="Moves a key you bought onto this computer.">Bought a key on another computer?</Line>}
      <div className="sline col">
        <div className="sline-text">Get or extend a key</div>
        <div className="plans" style={{ marginTop: 10 }}>
          {(prices.data?.keys ?? []).map((p: any) => (
            <button key={p.id} className="plan" disabled={!!busy} onClick={() => run(p.id, async () => { await invoke('session:buy', p.id); toast('Key active. Thanks for supporting Luger.', 'reward') })}>
              <span className="muted small">{p.name}</span><b className="num">{money(p.local.amount, p.local.currency, info?.locale)}</b><span className="small muted">{p.recurring ? `per ${p.recurring}` : 'once, forever'}</span>
              {busy === p.id && <Loader2 size={14} className="spin" />}
            </button>
          ))}
        </div>
      </div>
      {signOut && <Confirm title="Sign out of Luger?" confirm="Sign out" danger onClose={() => setSignOut(false)} onConfirm={() => invoke('session:signOut')}>You will need your key again to get back in. Lifetime and subscription keys can be restored after proving your Roblox account.</Confirm>}
    </>
  )
}
