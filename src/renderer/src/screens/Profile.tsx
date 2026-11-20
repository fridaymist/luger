import { Award, Check, ImagePlus, Lock, Palette, Pencil, Plus, Target, Trash2, Trophy } from 'lucide-react'
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Ammo, Avatar, Badges, BANNERS, bannerBackground, Crystals, Effect, GameIcon, itemName, Swatches, ThemePreview } from '../components/identity'
import { Empty, Modal, Seg, useAsync } from '../components/ui'
import { refreshMe, saveSettings } from '../lib/actions'
import { api, invoke } from '../lib/bridge'
import { achievementById, catalog, fmtMinutes, themeById, titlesFrom } from '../lib/catalog'
import { hours } from '../lib/format'
import { cacheGames, fail, go, toast, useStore } from '../lib/state'

export default function Profile() {
  const me = useStore((s) => s.me)
  const detected = useStore((s) => s.detected)
  const games = useStore((s) => s.games)
  const pageArg = useStore((s) => s.pageArg)
  const viewing = pageArg?.robloxId && pageArg.robloxId !== me?.robloxId ? Number(pageArg.robloxId) : null
  const rid = viewing ?? me?.robloxId
  const [edit, setEdit] = useState(false)
  const [tab, setTab] = useState<'overview' | 'achievements'>('overview')
  const [themes, setThemes] = useState(false)
  const [mastery, setMastery] = useState(false)
  const prof = useAsync(() => (rid && (viewing || me?.verified) ? api('profile.get', { robloxId: rid }) : Promise.resolve(null)), [rid, me?.user?.description, me?.user?.profile_theme, me?.user?.frame, me?.user?.effect, me?.user?.title, me?.user?.banner_url, me?.user?.avatar_url, me?.user?.showcase?.join()])
  useEffect(() => {
    const ids = (prof.data?.playtime ?? []).map((p: any) => p.universe_id).filter((u: number) => !games[u])
    if (ids.length) api('games.get', { universeIds: ids }).then((r) => cacheGames(r.games)).catch(() => {})
  }, [prof.data]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!viewing && !me?.verified) return <Unverified detected={detected} />
  const merged = viewing ? prof.data?.user : { ...(prof.data?.user ?? {}), ...(me?.user ?? {}) }
  const u = merged && !viewing && !merged.avatar_url ? { ...merged, avatar_url: detected?.avatar ?? null } : merged
  if (!u?.username) return <div className="page"><div className="skeleton" style={{ height: 320, marginTop: 20 }} /></div>

  const theme = themeById.get(u.profile_theme) ?? themeById.get('theme.brass')!
  const vars = Object.fromEntries(Object.entries(theme.tokens).map(([k, v]) => [`--${k}`, v])) as CSSProperties
  const earned = new Set<string>((viewing ? prof.data?.achievements : me?.achievements)?.map((a: any) => a.achievement as string) ?? [])
  const level = u.levelInfo ?? { level: u.level, into: 0, needed: 1 }

  return (
    <div className="profile" style={vars}>
      <header className="topbar drag">
        <h1>{viewing ? u.display_name ?? u.username : 'Profile'}</h1>
        <div className="grow" />
        {!viewing && <>
          <span className="row nodrag" style={{ gap: 14 }}><Ammo n={me?.user?.ammo ?? 0} /><Crystals n={me?.user?.crystals ?? 0} /></span>
          <button className="btn nodrag" onClick={() => setMastery(true)}><Target size={15} />Mastery</button>
          {edit ? <button className="btn primary nodrag" onClick={() => setEdit(false)}><Check size={15} />Done</button> : <button className="btn nodrag" onClick={() => setEdit(true)}><Pencil size={15} />Edit profile</button>}
        </>}
      </header>
      <div className="page">
        <section className="pcard">
          <div className="pbanner" style={{ background: bannerBackground(u.banner_url, u.profile_theme) }}><Effect id={u.effect} /></div>
          <div className="pbody">
            <div className="pavatar"><Avatar src={u.avatar_url} name={u.username} size={104} frame={u.frame} /></div>
            <div className="pname">
              <div className="row" style={{ gap: 10, flexWrap: 'wrap' }}>
                <h2>{u.display_name ?? u.username}</h2>
                <Badges roles={u.roles} verified={u.creatorVerified} size={18} />
              </div>
              <div className="row muted" style={{ gap: 10, flexWrap: 'wrap' }}>
                <span>@{u.username}</span>
                {u.title && <span className="ptitle">{u.title}</span>}
              </div>
            </div>
            <div className="plevel">
              <div className="spread small"><b>Level {level.level}</b><span className="muted num">{level.into.toLocaleString()} / {level.needed.toLocaleString()} XP</span></div>
              <div className="xpbar"><span style={{ width: `${Math.min(100, (level.into / level.needed) * 100)}%` }} /></div>
            </div>
          </div>
          {edit ? <EditPanel u={u} /> : u.description ? <p className="pdesc">{u.description}</p> : null}
          <div className="pstats">
            <div><b className="num">{prof.data?.macros?.length ?? 0}</b><span>Published macros</span></div>
            <div><b className="num">{prof.data?.reviews ?? 0}</b><span>Reviews received</span></div>
            <div><b className="num">{hours(u.luger_seconds ?? 0)}</b><span>With Luger</span></div>
            <div><b className="num">{earned.size}</b><span>Achievements</span></div>
          </div>
        </section>

        <div style={{ margin: '20px 0 4px' }}><Seg label="Profile section" value={tab} onChange={setTab} options={[{ value: 'overview', label: 'Overview' }, { value: 'achievements', label: <><Trophy size={13} />Achievements</> }]} /></div>

        {tab === 'overview' ? (
          <div className="pgrid">
            <section>
              <h2 className="section">Showcase</h2>
              {(u.showcase ?? []).length ? (
                <div className="showcase">{u.showcase.map((id: string) => { const a = achievementById.get(id); return a ? <div key={id} className="ach earned"><Award size={18} /><div><b>{a.name}</b><span className="muted small">{a.game ?? 'Luger'}</span></div></div> : null })}</div>
              ) : <p className="muted small">{viewing ? 'Nothing showcased yet.' : 'Pick achievements to show off in Edit profile.'}</p>}
            </section>
            <section>
              <h2 className="section">Most played</h2>
              <div className="stack-sm">
                {(prof.data?.playtime ?? []).slice(0, 5).map((p: any) => (
                  <div key={p.universe_id} className="row"><GameIcon game={games[p.universe_id]} size={30} radius={7} /><span className="grow ellipsis">{games[p.universe_id]?.name ?? '…'}</span><span className="num muted">{hours(p.seconds)}</span></div>
                ))}
                {!prof.data?.playtime?.length && <p className="muted small">No playtime yet.</p>}
              </div>
            </section>
          </div>
        ) : <Achievements earned={earned} canEquip={!viewing} current={u.title} inventory={me?.inventory ?? []} />}
      </div>

      {edit && !viewing && <button className="theme-fab" aria-label="Themes" title="Themes" onClick={() => setThemes(true)}><Palette size={22} /></button>}
      {themes && <ThemePicker onClose={() => setThemes(false)} />}
      {mastery && <Mastery onClose={() => setMastery(false)} />}
    </div>
  )
}

function Unverified({ detected }: { detected: any }) {
  return (
    <>
      <header className="topbar drag"><h1>Profile</h1></header>
      <div className="page page-narrow">
        <section className="pcard">
          <div className="pbanner" style={{ background: bannerBackground(null) }} />
          <div className="pbody">
            <div className="pavatar"><Avatar src={detected?.avatar} name={detected?.name} size={104} /></div>
            <div className="pname"><h2>{detected?.displayName ?? 'Your profile'}</h2>{detected?.name && <span className="muted">@{detected.name}</span>}</div>
          </div>
          <div className="pdesc stack-sm">
            <b>Prove this Roblox account is yours to unlock your profile.</b>
            <span className="muted">It switches on achievements, ammo, themes, publishing and reviews. One 20-second check, done once per computer.</span>
            <div><button className="btn primary" onClick={() => go('settings', { section: 'account' })}>Prove my account</button></div>
          </div>
        </section>
      </div>
    </>
  )
}

function EditPanel({ u }: { u: any }) {
  const me = useStore((s) => s.me)
  const inv = me?.inventory ?? []
  const [desc, setDesc] = useState(u.description ?? '')
  const [busy, setBusy] = useState(false)
  const owned = (kind: string) => catalog.items.filter((i) => i.kind === kind && inv.includes(i.id))
  const titles = titlesFrom(inv)
  const earned = (me?.achievements ?? []).map((a) => a.achievement).filter((a) => achievementById.has(a))

  async function patch(p: Record<string, unknown>) {
    try {
      await api('profile.update', p)
      await refreshMe()
    } catch (e) {
      fail(e)
    }
  }

  return (
    <div className="pedit">
      <div className="pedit-row">
        <span>Picture</span>
        <div className="row">
          <button className="btn sm" onClick={() => invoke('profile:pickImage', 'avatar').then((url) => url && refreshMe()).catch(fail)}><ImagePlus size={13} />Upload</button>
          {u.avatar_url && <button className="btn sm ghost" onClick={() => patch({ avatar_url: null })}>Use Roblox avatar</button>}
        </div>
      </div>
      <div className="pedit-row">
        <span>Banner</span>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button className="btn sm" onClick={() => invoke('profile:pickImage', 'banner').then((url) => url && refreshMe()).catch(fail)}><ImagePlus size={13} />Upload</button>
          {Object.keys(BANNERS).filter((b) => inv.includes(b)).map((b) => <button key={b} className={`banner-swatch${u.banner_url === b ? ' on' : ''}`} style={{ background: BANNERS[b] }} title={itemName(b)} aria-label={itemName(b)} onClick={() => patch({ banner_url: b })} />)}
          {u.banner_url && <button className="btn sm ghost" onClick={() => patch({ banner_url: null })}>Theme banner</button>}
        </div>
      </div>
      <div className="pedit-row top">
        <span>About</span>
        <div className="grow stack-sm">
          <textarea className="input" value={desc} maxLength={300} onChange={(e) => setDesc(e.target.value)} placeholder="A line or two about you and the games you play" />
          <div className="spread small"><span className="muted num">{desc.length}/300 · checked for banned words</span><button className="btn sm primary" disabled={busy || desc === (u.description ?? '')} onClick={async () => { setBusy(true); await patch({ description: desc }); setBusy(false); toast('Description saved.') }}>Save</button></div>
        </div>
      </div>
      <div className="pedit-row">
        <span>Frame</span>
        <select className="select input" style={{ width: 220 }} value={u.frame ?? ''} onChange={(e) => patch({ frame: e.target.value || null })}>
          <option value="">No frame</option>
          {owned('frame').map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </div>
      <div className="pedit-row">
        <span>Effect</span>
        <select className="select input" style={{ width: 220 }} value={u.effect ?? ''} onChange={(e) => patch({ effect: e.target.value || null })}>
          <option value="">No effect</option>
          {owned('effect').map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
      </div>
      <div className="pedit-row">
        <span>Title</span>
        <select className="select input" style={{ width: 220 }} value={u.title ?? ''} onChange={(e) => patch({ title: e.target.value || null })}>
          <option value="">No title</option>
          {titles.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </div>
      <div className="pedit-row top">
        <span>Showcase</span>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {earned.length === 0 && <span className="muted small">Earn achievements to show them here.</span>}
          {earned.map((id) => {
            const on = (u.showcase ?? []).includes(id)
            return <button key={id} className="chip" aria-pressed={on} onClick={() => patch({ showcase: on ? u.showcase.filter((x: string) => x !== id) : [...(u.showcase ?? []), id].slice(0, 6) })}>{achievementById.get(id)!.name}</button>
          })}
        </div>
      </div>
    </div>
  )
}

function Achievements({ earned, canEquip, current, inventory }: { earned: Set<string>; canEquip: boolean; current: string | null; inventory: string[] }) {
  const groups = [
    { name: 'Luger', list: catalog.generalAchievements.map((a) => achievementById.get(a.id)!) },
    ...catalog.games.map((g) => ({ name: g.name, list: g.achievements.map((a) => achievementById.get(a.id)!) }))
  ]
  const titles = new Set(titlesFrom(inventory))
  return (
    <div className="stack">
      {groups.map((g) => (
        <section key={g.name}>
          <h2 className="section">{g.name} <span className="muted num">{g.list.filter((a) => earned.has(a.id)).length} of {g.list.length}</span></h2>
          <div className="achs">
            {g.list.map((a) => {
              const got = earned.has(a.id)
              const title = a.reward?.title as string | undefined
              return (
                <div key={a.id} className={`ach${got ? ' earned' : ''}`}>
                  {got ? <Award size={18} /> : <Lock size={16} />}
                  <div className="grow" style={{ minWidth: 0 }}>
                    <b>{a.name}</b>
                    <span className="muted small" style={{ display: 'block' }}>{a.desc}</span>
                    <span className="small ach-reward">{[a.reward?.ammo && `${a.reward.ammo} ammo`, a.reward?.xp && `${a.reward.xp} XP`, title && `title “${title}”`, a.reward?.theme && `${itemName(a.reward.theme)} theme`, a.reward?.frame && `${itemName(a.reward.frame)} frame`].filter(Boolean).join(' · ')}</span>
                  </div>
                  {canEquip && got && title && titles.has(title) && (
                    current === title
                      ? <span className="chip">Equipped</span>
                      : <button className="btn sm" onClick={() => api('profile.update', { title }).then(refreshMe).then(() => toast(`Title set to “${title}”.`)).catch(fail)}>Equip</button>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------ themes
function ThemePicker({ onClose }: { onClose: () => void }) {
  const me = useStore((s) => s.me)
  const settings = useStore((s) => s.settings)
  const [tab, setTab] = useState<'profile' | 'app'>('profile')
  const bgs = useAsync(() => invoke<any[]>('backgrounds:list'), [])
  const inv = new Set(me?.inventory ?? [])
  const owns = (t: any) => t.free || inv.has(t.id)
  const sorted = useMemo(() => [...catalog.themes].sort((a: any, b: any) => Number(owns(b)) - Number(owns(a))), [me?.inventory]) // eslint-disable-line react-hooks/exhaustive-deps
  const current = tab === 'profile' ? me?.user?.profile_theme : settings?.appTheme

  async function choose(t: any) {
    if (!owns(t)) {
      if (t.price) go('market', { item: t.id })
      return
    }
    if (tab === 'profile') {
      await api('profile.update', { profile_theme: t.id }).then(refreshMe).catch(fail)
    } else await saveSettings({ appTheme: t.id })
  }

  return (
    <Modal wide title="Themes" onClose={onClose}>
      <Seg label="Apply to" value={tab} onChange={setTab} options={[{ value: 'profile', label: 'Your profile' }, { value: 'app', label: 'This app' }]} />
      <p className="muted small">{tab === 'profile' ? 'Everyone who views your profile sees this theme.' : 'Only you see the app theme and background.'}</p>
      <div className="themes">
        {sorted.map((t: any) => {
          const unlocked = owns(t)
          const how = t.unlock ? achievementById.get(t.unlock)?.name : null
          return (
            <button key={t.id} className={`theme-tile${current === t.id ? ' on' : ''}${unlocked ? '' : ' locked'}`} onClick={() => choose(t)} aria-label={`${t.name}${unlocked ? '' : ', locked'}`}>
              <ThemePreview id={t.id} width={180} />
              <div className="spread"><b>{t.name}</b><Swatches id={t.id} /></div>
              <span className="small muted">{current === t.id ? 'In use' : unlocked ? 'Owned' : [how && `Unlock: ${how}`, t.price && `${t.price} crystals in the shop`].filter(Boolean).join(' · ')}</span>
              {!unlocked && <Lock size={14} className="theme-lock" />}
            </button>
          )
        })}
      </div>
      {tab === 'app' && (
        <>
          <h2 className="section">Background picture <span className="muted">Only shown in your app</span></h2>
          <div className="bgs">
            <button className="bg-add" onClick={() => invoke('backgrounds:import').then((b) => { if (b) { bgs.reload(); saveSettings({ customBackground: b.id }) } }).catch(fail)}><Plus size={22} /><span className="small">Add picture</span></button>
            {(bgs.data ?? []).map((b) => (
              <div key={b.id} className={`bg-tile${settings?.customBackground === b.id ? ' on' : ''}`}>
                <button style={{ backgroundImage: `url("${b.url}")` }} aria-label="Use this background" onClick={() => saveSettings({ customBackground: b.id })} />
                <button className="btn icon sm bg-remove" aria-label="Remove background" onClick={() => invoke('backgrounds:remove', b.id).then(() => { bgs.reload(); invoke('settings:get').then((s) => saveSettings({ customBackground: s.customBackground })) })}><Trash2 size={12} /></button>
              </div>
            ))}
            {settings?.customBackground && <button className="btn ghost" onClick={() => saveSettings({ customBackground: null })}>No picture</button>}
          </div>
          {settings?.customBackground && (
            <label className="setting-line" style={{ maxWidth: 360 }}><span className="small">Dim the picture</span>
              <input type="range" min={0.1} max={0.9} step={0.05} value={settings.backgroundDim} onChange={(e) => saveSettings({ backgroundDim: Number(e.target.value) })} /></label>
          )}
        </>
      )}
    </Modal>
  )
}

// ------------------------------------------------------------------ mastery
function Mastery({ onClose }: { onClose: () => void }) {
  const me = useStore((s) => s.me)
  const games = useStore((s) => s.games)
  const local = useAsync(() => invoke('roblox:playtime'), [])
  const [open, setOpen] = useState<string | null>(null)
  const earned = new Set(me?.achievements.map((a) => a.achievement) ?? [])

  const minutesFor = (placeId: number) => {
    const server = me?.playtime.find((p) => games[p.universe_id]?.root_place_id === placeId)?.seconds ?? 0
    const here = local.data?.games?.[placeId]?.seconds ?? 0
    return Math.max(server, here) / 60
  }

  return (
    <Modal wide title="Mastery" onClose={onClose}>
      <p className="muted small" style={{ marginTop: 0 }}>Play to climb each game’s track. Some games have a final rank; games that never really end keep giving rewards.</p>
      <div className="mastery">
        {catalog.games.map((g) => {
          const mins = minutesFor(g.placeId)
          const steps = g.achievements
          const next = steps.find((a) => mins < a.minutes)
          const prev = [...steps].reverse().find((a) => mins >= a.minutes)
          const m = g.mastery as any
          const last = steps[steps.length - 1].minutes
          const endless = m.endless && mins >= last
          const target = endless ? last + (Math.floor((mins - last) / m.repeatEveryMinutes) + 1) * m.repeatEveryMinutes : next?.minutes ?? last
          const base = endless ? target - m.repeatEveryMinutes : prev?.minutes ?? 0
          const pct = target === base ? 100 : Math.min(100, ((mins - base) / (target - base)) * 100)
          const rank = steps.filter((a) => earned.has(a.id) || mins >= a.minutes).length + (endless ? Math.floor((mins - last) / m.repeatEveryMinutes) : 0)
          const universe = Object.values(games).find((x: any) => x.root_place_id === g.placeId)
          const done = !m.endless && mins >= last
          return (
            <div key={g.id} className={`mcard${open === g.id ? ' open' : ''}`}>
              <button className="mcard-head" onClick={() => setOpen(open === g.id ? null : g.id)}>
                <GameIcon game={universe ?? { name: g.name }} size={44} radius={10} />
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="spread"><b>{g.name}</b><span className="small muted num">Rank {rank}{m.endless ? '' : ` of ${steps.length}`}</span></div>
                  <div className="xpbar"><span style={{ width: `${done ? 100 : pct}%` }} /></div>
                  <span className="small muted">{done ? 'Track complete' : endless ? `Next mastery level at ${fmtMinutes(Math.round(target))}` : `Next: ${next!.name} at ${fmtMinutes(next!.minutes)}`} · {hours(mins * 60)} played</span>
                </div>
              </button>
              {open === g.id && (
                <ol className="track-list">
                  {steps.map((a) => {
                    const got = mins >= a.minutes || earned.has(a.id)
                    return (
                      <li key={a.id} className={got ? 'got' : ''}>
                        <span className="node" aria-hidden>{got ? <Check size={12} /> : null}</span>
                        <div className="grow"><b>{a.name}</b><span className="muted small" style={{ display: 'block' }}>{a.minutes ? fmtMinutes(a.minutes) : 'First join'}</span></div>
                        <span className="small ach-reward">{[a.reward.ammo && `${a.reward.ammo} ammo`, (a.reward as any).title && `“${(a.reward as any).title}”`, (a.reward as any).theme && `${itemName((a.reward as any).theme)} theme`, (a.reward as any).frame && `${itemName((a.reward as any).frame)} frame`].filter(Boolean).join(' · ')}</span>
                      </li>
                    )
                  })}
                  {m.endless && <li className="endless"><span className="node" aria-hidden>∞</span><div className="grow"><b>Keeps going</b><span className="muted small" style={{ display: 'block' }}>Every {fmtMinutes(m.repeatEveryMinutes)} after that: {m.repeatReward.ammo} ammo and {m.repeatReward.xp} XP</span></div></li>}
                </ol>
              )}
            </div>
          )
        })}
      </div>
      {!catalog.games.length && <Empty title="No games yet" />}
    </Modal>
  )
}
