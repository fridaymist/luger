import { Play, Search, SlidersHorizontal, Users, Wand2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Avatar, GameIcon } from '../components/identity'
import { Drawer, Modal, Seg, Switch, useAsync } from '../components/ui'
import { saveSettings } from '../lib/actions'
import { api, invoke } from '../lib/bridge'
import { catalog } from '../lib/catalog'
import { compact, greeting, hours } from '../lib/format'
import { cacheGames, fail, toast, useStore } from '../lib/state'

export default function Home() {
  const me = useStore((s) => s.me)
  const detected = useStore((s) => s.detected)
  const settings = useStore((s) => s.settings)
  const games = useStore((s) => s.games)
  const playing = useStore((s) => s.playing)
  const [q, setQ] = useState('')
  const [results, setResults] = useState<any[] | null>(null)
  const [open, setOpen] = useState<any>(null)
  const [tweaks, setTweaks] = useState(false)

  const local = useAsync(() => invoke('roblox:playtime'), [playing?.placeId])
  const popular = useAsync(() => api('games.popular').then((r) => (cacheGames(r.games), r.games)), [])
  const friendly = useAsync(() => api('games.macroFriendly').then((r) => (cacheGames(r.games), r.games)), [])
  const macros = useAsync(() => invoke<any[]>('macros:list'), [])

  // Resolve every place Luger has seen in the logs to full game details.
  const localPlaces = useMemo(() => Object.keys(local.data?.games ?? {}).map(Number), [local.data])
  useEffect(() => {
    const missing = localPlaces.filter((p) => !Object.values(games).some((g: any) => g.root_place_id === p))
    if (missing.length) api('games.get', { placeIds: missing.slice(0, 50) }).then((r) => cacheGames(r.games)).catch(() => {})
    const universes = (me?.playtime ?? []).map((p) => p.universe_id).filter((u) => !games[u])
    if (universes.length) api('games.get', { universeIds: universes }).then((r) => cacheGames(r.games)).catch(() => {})
  }, [localPlaces, me?.playtime]) // eslint-disable-line react-hooks/exhaustive-deps

  const byPlace = useMemo(() => new Map(Object.values(games).map((g: any) => [g.root_place_id, g])), [games])

  // Playtime: the larger of what the server has and what this computer has seen.
  const ranked = useMemo(() => {
    const rows = new Map<number, { game: any; seconds: number; last: number }>()
    for (const [place, v] of Object.entries(local.data?.games ?? {}) as [string, any][]) {
      const g = byPlace.get(Number(place))
      if (g) rows.set(g.universe_id, { game: g, seconds: v.seconds, last: v.last })
    }
    for (const p of me?.playtime ?? []) {
      const g = games[p.universe_id]
      if (!g) continue
      const cur = rows.get(p.universe_id)
      rows.set(p.universe_id, { game: g, seconds: Math.max(cur?.seconds ?? 0, p.seconds), last: Math.max(cur?.last ?? 0, Date.parse(p.last_played ?? '') || 0) })
    }
    return [...rows.values()]
  }, [local.data, me?.playtime, games, byPlace])
  const top = [...ranked].sort((a, b) => b.seconds - a.seconds).slice(0, 8)
  const recent = [...ranked].sort((a, b) => b.last - a.last).slice(0, 6)
  const max = top[0]?.seconds || 1

  const name = settings?.greetingName === 'display' ? (me?.user?.display_name ?? detected?.displayName) : (me?.user?.username ?? detected?.name)

  async function search() {
    if (!q.trim()) return setResults(null)
    try {
      const r = await api('games.search', { q: q.trim() })
      cacheGames(r.games)
      setResults(r.games)
    } catch (e) {
      fail(e)
    }
  }

  return (
    <>
      <header className="topbar drag">
        <div className="search nodrag" style={{ width: 300, minWidth: 150, flexShrink: 1 }}>
          <Search size={15} />
          <input className="input" placeholder="Search Roblox games" value={q} onChange={(e) => { setQ(e.target.value); if (!e.target.value) setResults(null) }} onKeyDown={(e) => e.key === 'Enter' && search()} />
        </div>
        <button className="btn ghost nodrag" onClick={() => setTweaks(true)}><SlidersHorizontal size={15} />Tweaks</button>
        <div className="grow" />
        <div className="greet nodrag">
          <span><span className="hello">{greeting()}, </span><b>{name ? `@${name}` : 'player'}</b></span>
          <Avatar src={me?.user?.avatar_url ?? detected?.avatar} name={name ?? undefined} size={34} frame={me?.user?.frame} />
        </div>
      </header>

      <div className="page">
        {results ? (
          <>
            <h2 className="section">Results <span className="muted">for “{q}”</span><button className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={() => { setResults(null); setQ('') }}>Clear</button></h2>
            {results.length ? <div className="tiles">{results.map((g) => <Tile key={g.universe_id} g={g} onOpen={setOpen} />)}</div> : <p className="muted">No games found.</p>}
          </>
        ) : (
          <>
            {recent.length > 0 ? (
              <>
                <h2 className="section">Continue playing</h2>
                <div className="continue">
                  <Feature item={recent[0]} onOpen={setOpen} macroCount={(macros.data ?? []).filter((m) => m.universeId === recent[0].game.universe_id).length} />
                  <div className="continue-list">
                    {recent.slice(1).map((r) => (
                      <button key={r.game.universe_id} className="mini" onClick={() => setOpen(r.game)}>
                        <GameIcon game={r.game} size={40} radius={8} />
                        <span className="grow" style={{ minWidth: 0 }}><b className="ellipsis" style={{ display: 'block' }}>{r.game.name}</b><span className="muted small">{hours(r.seconds)} played</span></span>
                        <span className="btn icon sm" role="button" aria-label={`Play ${r.game.name}`} onClick={(e) => { e.stopPropagation(); launch(r.game.root_place_id) }}><Play size={14} /></span>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div className="first-run panel pad">
                <b>Your games will show up here.</b>
                <span className="muted">Luger reads Roblox’s own log files to track playtime. Play anything once and come back.</span>
              </div>
            )}

            {top.length > 0 && (
              <>
                <h2 className="section">Your top playtime</h2>
                <ol className="ranks panel">
                  {top.map((r, i) => (
                    <li key={r.game.universe_id}>
                      <button onClick={() => setOpen(r.game)}>
                        <span className="rank num">{i + 1}</span>
                        <GameIcon game={r.game} size={34} radius={8} />
                        <span className="ellipsis rank-name">{r.game.name}</span>
                        <span className="rounds" aria-hidden><span style={{ width: `${Math.max(4, (r.seconds / max) * 100)}%` }} /></span>
                        <span className="num rank-h">{hours(r.seconds)}</span>
                      </button>
                    </li>
                  ))}
                </ol>
              </>
            )}

            <h2 className="section">Popular now <span className="muted">Live from Roblox</span></h2>
            {popular.loading ? <SkeletonTiles /> : popular.error ? <p className="muted">{popular.error}</p> : <div className="tiles">{(popular.data ?? []).slice(0, 12).map((g: any) => <Tile key={g.universe_id} g={g} onOpen={setOpen} />)}</div>}

            <h2 className="section">Made for macros <span className="muted">Games Luger has control profiles and achievements for</span></h2>
            {friendly.loading ? <SkeletonTiles n={6} /> : <div className="tiles">{(friendly.data ?? []).map((g: any) => <Tile key={g.universe_id} g={g} onOpen={setOpen} badge={`${(macros.data ?? []).filter((m) => m.universeId === g.universe_id).length || ''}`} />)}</div>}
          </>
        )}
      </div>

      {open && <GameModal game={open} seconds={ranked.find((r) => r.game.universe_id === open.universe_id)?.seconds ?? 0} macros={(macros.data ?? []).filter((m) => m.universeId === open.universe_id)} onClose={() => setOpen(null)} />}
      {tweaks && <Tweaks onClose={() => setTweaks(false)} settings={settings} />}
    </>
  )
}

async function launch(placeId: number, macroId?: string) {
  try {
    await invoke('roblox:launch', placeId, macroId)
    toast(macroId ? 'Roblox is opening. Your macro starts when the game loads.' : 'Roblox is opening.')
  } catch (e) {
    fail(e)
  }
}

function Feature({ item, onOpen, macroCount }: { item: { game: any; seconds: number }; onOpen: (g: any) => void; macroCount: number }) {
  const g = item.game
  return (
    <div className="feature" style={{ backgroundImage: g.thumb_url ? `url("${g.thumb_url}")` : undefined }}>
      {!g.thumb_url && g.icon_url && <img className="feature-fallback" src={g.icon_url} alt="" />}
      <div className="feature-shade" />
      <div className="feature-body">
        <GameIcon game={g} size={56} radius={12} />
        <div className="grow" style={{ minWidth: 0 }}>
          <h3 className="ellipsis">{g.name}</h3>
          <span className="feature-meta"><span className="num">{hours(item.seconds)}</span> played{macroCount ? ` · ${macroCount} macro${macroCount === 1 ? '' : 's'}` : ''}</span>
        </div>
        <button className="btn ghost" onClick={() => onOpen(g)}>Details</button>
        <button className="btn primary lg" onClick={() => launch(g.root_place_id)}><Play size={16} fill="currentColor" />Play</button>
      </div>
    </div>
  )
}

function Tile({ g, onOpen, badge }: { g: any; onOpen: (g: any) => void; badge?: string }) {
  return (
    <button className="tile" onClick={() => onOpen(g)}>
      <GameIcon game={g} size={128} radius={12} />
      <b className="ellipsis">{g.name}</b>
      <span className="muted small row" style={{ gap: 4 }}><Users size={12} /><span className="num">{compact(g.playing ?? 0)}</span> playing{badge ? <span className="tile-badge num" title="Your macros for this game">{badge}</span> : null}</span>
    </button>
  )
}

function SkeletonTiles({ n = 8 }: { n?: number }) {
  return <div className="tiles">{Array.from({ length: n }, (_, i) => <div key={i} className="skeleton" style={{ height: 172 }} />)}</div>
}

function GameModal({ game, seconds, macros, onClose }: { game: any; seconds: number; macros: any[]; onClose: () => void }) {
  const settings = useStore((s) => s.settings)
  const [macro, setMacro] = useState<string>(settings?.autoApplyMacros?.[game.root_place_id] ?? macros[0]?.id ?? '')
  const auto = settings?.autoApplyMacros?.[game.root_place_id] === macro && !!macro
  const known = catalog.games.find((x) => x.placeId === game.root_place_id)
  return (
    <Modal wide title={game.name} onClose={onClose}>
      <div className="game-modal">
        {game.thumb_url ? <img className="game-thumb" src={game.thumb_url} alt="" /> : <div className="game-thumb skeleton" />}
        <div className="stack-sm">
          <div className="game-stats">
            <div><span className="muted small">Playing now</span><b className="num">{(game.playing ?? 0).toLocaleString()}</b></div>
            <div><span className="muted small">Visits</span><b className="num">{compact(game.visits ?? 0)}</b></div>
            <div><span className="muted small">Your time</span><b className="num">{hours(seconds)}</b></div>
          </div>
          <span className="muted small">By {game.creator || 'unknown'}{known ? ' · has Luger achievements' : ''}</span>
          <p className="game-desc">{game.description || 'No description.'}</p>
        </div>
      </div>
      <div className="divider" />
      <div className="spread" style={{ flexWrap: 'wrap' }}>
        {macros.length ? (
          <div className="row" style={{ flexWrap: 'wrap' }}>
            <Wand2 size={16} className="muted" />
            <select className="select input" style={{ width: 220 }} value={macro} onChange={(e) => setMacro(e.target.value)} aria-label="Macro to apply">
              {macros.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <label className="row small muted"><Switch label="Apply every time this game opens" on={auto} onChange={(v) => {
              const map = { ...(settings.autoApplyMacros ?? {}) }
              if (v) map[game.root_place_id] = macro
              else delete map[game.root_place_id]
              saveSettings({ autoApplyMacros: map })
            }} />Every launch</label>
          </div>
        ) : <span className="muted small">No macros for this game yet. Add one in Macros.</span>}
        <div className="row">
          {macros.length > 0 && <button className="btn" onClick={() => { launch(game.root_place_id, macro); onClose() }}><Wand2 size={15} />Apply and launch</button>}
          <button className="btn primary" onClick={() => { launch(game.root_place_id); onClose() }}><Play size={15} fill="currentColor" />Play</button>
        </div>
      </div>
    </Modal>
  )
}

function Tweaks({ onClose, settings }: { onClose: () => void; settings: any }) {
  const defs = useAsync(() => invoke<any[]>('roblox:flagDefs'), [])
  const values = settings?.fflags ?? {}
  const set = (id: string, v: unknown) => saveSettings({ fflags: { ...values, [id]: v } })
  const platform = window.luger.platform
  return (
    <Drawer title="Roblox tweaks" onClose={onClose} foot={<>
      <button className="btn ghost" onClick={() => saveSettings({ fflags: {} }).then(() => toast('Tweaks reset to Roblox defaults.'))}>Reset all</button>
      <button className="btn primary" onClick={async () => {
        const r = await invoke('roblox:applyFlags')
        if (r.failed.length) fail(new Error(platform === 'darwin' ? 'Luger could not write to the Roblox app. Move Roblox to your Applications folder and try again.' : 'Some Roblox folders could not be written.'))
        else toast(r.written ? 'Tweaks saved. They apply next time Roblox starts.' : 'Roblox is not installed on this computer yet.')
      }}>Save to Roblox</button>
    </>}>
      <p className="muted small" style={{ marginTop: 0 }}>Only settings Roblox allows are listed. Roblox reads them when it starts, and Luger reapplies them every time you launch from here.</p>
      <div className="stack">
        {(defs.data ?? []).filter((d) => !d.platform || d.platform === platform).map((d) => (
          <div key={d.id} className="tweak">
            <div className="grow"><b>{d.label}</b>{d.help && <div className="muted small">{d.help}</div>}</div>
            {d.type === 'toggle' && <Switch label={d.label} on={!!values[d.id]} onChange={(v) => set(d.id, v)} />}
            {d.type === 'number' && (
              <div className="row" style={{ width: 170 }}>
                <input type="range" min={d.min} max={d.max} step={1} value={Number(values[d.id] ?? d.default)} onChange={(e) => set(d.id, Number(e.target.value))} aria-label={d.label} />
                <span className="num small" style={{ width: 34, textAlign: 'right' }}>{values[d.id] ?? d.default}</span>
              </div>
            )}
            {d.type === 'select' && (
              <select className="select input" style={{ width: 140 }} value={JSON.stringify(values[d.id] ?? null)} onChange={(e) => set(d.id, JSON.parse(e.target.value))} aria-label={d.label}>
                {d.options.map(([label, v]: [string, unknown]) => <option key={label} value={JSON.stringify(v)}>{label}</option>)}
              </select>
            )}
          </div>
        ))}
        {defs.loading && <div className="skeleton" style={{ height: 160 }} />}
      </div>
      <div className="divider" />
      <div className="tweak">
        <div className="grow"><b>Open more than one Roblox</b><div className="muted small">{platform === 'win32' ? 'Keeps Roblox from closing the first window when you open a second.' : 'Windows only.'}</div></div>
        <Switch label="Multiple Roblox windows" on={!!settings?.multiInstance} onChange={(v) => saveSettings({ multiInstance: v })} />
      </div>
      <div className="tweak">
        <div className="grow"><b>Show the game on Discord</b><div className="muted small">“Playing Fisch with Luger” on your Discord profile.</div></div>
        <Switch label="Discord status" on={!!settings?.discordPresence} onChange={(v) => saveSettings({ discordPresence: v })} />
      </div>
      <div className="tweak">
        <div className="grow"><b>Greeting name</b></div>
        <Seg label="Greeting name" value={settings?.greetingName ?? 'username'} onChange={(v) => saveSettings({ greetingName: v })} options={[{ value: 'username', label: '@username' }, { value: 'display', label: 'Display name' }]} />
      </div>
    </Drawer>
  )
}
