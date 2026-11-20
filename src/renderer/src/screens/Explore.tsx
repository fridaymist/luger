import { Code2, Download, Flag, Search, ShieldCheck, Star, Upload } from 'lucide-react'
import { useEffect, useState } from 'react'
import GamePicker, { type PickedGame } from '../components/GamePicker'
import { GameIcon, Name } from '../components/identity'
import { Empty, Modal, Seg, Switch, useAsync } from '../components/ui'
import { api, invoke } from '../lib/bridge'
import { ago, compact } from '../lib/format'
import { cacheGames, fail, go, toast, useStore } from '../lib/state'

function Stars({ value, size = 13 }: { value: number | null; size?: number }) {
  const v = value ?? 0
  return (
    <span className="stars" aria-label={value ? `${v.toFixed(1)} out of 5` : 'No ratings yet'}>
      {[1, 2, 3, 4, 5].map((i) => <Star key={i} size={size} fill={i <= Math.round(v) ? 'var(--accent)' : 'none'} color={i <= Math.round(v) ? 'var(--accent)' : 'var(--line)'} />)}
    </span>
  )
}

export default function Explore() {
  const games = useStore((s) => s.games)
  const pageArg = useStore((s) => s.pageArg)
  const [q, setQ] = useState('')
  const [search, setSearch] = useState('')
  const [game, setGame] = useState<number | ''>('')
  const [since, setSince] = useState<'' | '1' | '7' | '30'>('')
  const [sort, setSort] = useState<'new' | 'rating' | 'installs'>('new')
  const [verifiedOnly, setVerifiedOnly] = useState(false)
  const [page, setPage] = useState(0)
  const [open, setOpen] = useState<string | null>(null)
  const [publish, setPublish] = useState<string | null | undefined>(undefined)
  useEffect(() => { if (pageArg?.publish) setPublish(pageArg.publish) }, [pageArg])

  const list = useAsync(() => api('explore.list', { q: search || undefined, universeId: game || undefined, since: since || undefined, sort, verifiedOnly, page }).then((r) => (cacheGames(r.games), r)), [search, game, since, sort, verifiedOnly, page])
  const friendly = useAsync(() => api('games.macroFriendly').then((r) => (cacheGames(r.games), r.games)), [])

  return (
    <>
      <header className="topbar drag">
        <h1>Explore</h1>
        <span className="sub">Python macros shared by players, scanned before they go live.</span>
        <div className="grow" />
        <div className="search nodrag" style={{ width: 240 }}><Search size={15} /><input className="input" placeholder="Search Explore" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (setSearch(q.trim()), setPage(0))} /></div>
        <button className="btn primary nodrag" onClick={() => setPublish(null)}><Upload size={15} />Publish</button>
      </header>
      <div className="filterbar">
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <select className="select input" style={{ width: 200, height: 30 }} value={String(game)} onChange={(e) => { setGame(e.target.value ? Number(e.target.value) : ''); setPage(0) }} aria-label="Game">
            <option value="">Every game</option>
            {(friendly.data ?? []).map((g: any) => <option key={g.universe_id} value={g.universe_id}>{g.name}</option>)}
          </select>
          <select className="select input" style={{ width: 150, height: 30 }} value={since} onChange={(e) => { setSince(e.target.value as any); setPage(0) }} aria-label="Posted">
            <option value="">Any time</option><option value="1">Today</option><option value="7">This week</option><option value="30">This month</option>
          </select>
          <label className="row small"><Switch label="Verified creators only" on={verifiedOnly} onChange={(v) => { setVerifiedOnly(v); setPage(0) }} />Verified creators</label>
        </div>
        <Seg label="Sort" value={sort} onChange={(v) => { setSort(v); setPage(0) }} options={[{ value: 'new', label: 'Newest' }, { value: 'rating', label: 'Top rated' }, { value: 'installs', label: 'Most used' }]} />
      </div>
      <div className="page">
        {list.loading && !list.data ? <div className="xgrid">{Array.from({ length: 6 }, (_, i) => <div key={i} className="skeleton" style={{ height: 150 }} />)}</div>
          : list.error ? <Empty title="Explore could not load">{list.error}</Empty>
          : !list.data?.macros.length ? <Empty title="Nothing here yet" action={<button className="btn" onClick={() => setPublish(null)}>Publish a macro</button>}>Be the first to share a macro{game ? ' for this game' : ''}.</Empty>
          : (
            <>
              <div className="xgrid">
                {list.data.macros.map((m: any) => (
                  <button key={m.id} className="xcard" onClick={() => setOpen(m.id)}>
                    <div className="row" style={{ gap: 12 }}>
                      <GameIcon game={games[m.universe_id]} size={48} radius={10} />
                      <div className="grow" style={{ minWidth: 0 }}>
                        <b className="ellipsis" style={{ display: 'block', fontSize: 15 }}>{m.name}</b>
                        <span className="muted small ellipsis" style={{ display: 'block' }}>{games[m.universe_id]?.name ?? 'Any game'}</span>
                      </div>
                    </div>
                    <p className="muted small xdesc">{m.description || 'No description.'}</p>
                    <div className="spread small">
                      <Name user={m.author} size={13} />
                      <span className="row muted" style={{ gap: 10 }}>
                        <span className="row" style={{ gap: 4 }}><Stars value={m.rating} size={11} /><span className="num">{m.reviews}</span></span>
                        <span className="row num" style={{ gap: 3 }}><Download size={12} />{compact(m.installs)}</span>
                      </span>
                    </div>
                  </button>
                ))}
              </div>
              <div className="row" style={{ justifyContent: 'center', marginTop: 20 }}>
                {page > 0 && <button className="btn" onClick={() => setPage(page - 1)}>Newer</button>}
                {list.data.more && <button className="btn" onClick={() => setPage(page + 1)}>More</button>}
              </div>
            </>
          )}
      </div>
      {open && <Detail id={open} onClose={() => setOpen(null)} />}
      {publish !== undefined && <Publish preset={publish} onClose={() => { setPublish(undefined); list.reload() }} />}
    </>
  )
}

function Detail({ id, onClose }: { id: string; onClose: () => void }) {
  const me = useStore((s) => s.me)
  const games = useStore((s) => s.games)
  const d = useAsync(() => api('explore.get', { id }), [id])
  const [code, setCode] = useState(false)
  const [stars, setStars] = useState(0)
  const [body, setBody] = useState('')
  const [reporting, setReporting] = useState(false)
  const [reason, setReason] = useState('')
  const m = d.data?.macro
  const mine = m && me?.robloxId === m.author_id

  async function install() {
    try {
      const r = await api('explore.install', { id })
      const g = games[r.macro.universe_id]
      const p = await invoke('macros:prepareSource', r.macro.source, r.macro.name, 'explore')
      if (p.scan.verdict === 'malicious') {
        fail(new Error('Luger’s own scan flagged this macro, so it was not added. It has been reported to staff.'))
        api('report', { kind: 'macro', id, reason: 'Flagged by the local scan on install' }).catch(() => {})
        return
      }
      await invoke('macros:commit', p.token, { action: p.scan.verdict === 'clean' ? 'keep' : 'clean', name: r.macro.name, description: r.macro.description, universeId: r.macro.universe_id, placeId: g?.root_place_id ?? null, gameName: g?.name ?? null, tags: r.macro.tags, remoteId: id, remoteVersion: r.macro.version, author: m.author?.username })
      toast(`${r.macro.name} added to your macros.`)
      onClose()
      go('macros')
    } catch (e) {
      fail(e)
    }
  }

  return (
    <Modal wide title={m?.name ?? 'Loading'} onClose={onClose} foot={m && <>
      <button className="btn ghost" onClick={() => setReporting(!reporting)}><Flag size={14} />Report</button>
      <button className="btn" onClick={() => setCode(!code)}><Code2 size={14} />{code ? 'Hide code' : 'View code'}</button>
      <button className="btn primary" onClick={install}><Download size={14} />Add to my macros</button>
    </>}>
      {!m ? <div className="skeleton" style={{ height: 180 }} /> : (
        <div className="stack">
          <div className="row" style={{ gap: 14 }}>
            <GameIcon game={games[m.universe_id]} size={56} radius={12} />
            <div className="grow">
              <Name user={m.author} />
              <div className="muted small">{games[m.universe_id]?.name ?? 'Any game'} · version {m.version} · updated {ago(m.updated_at ?? m.created_at ?? Date.now())} · {compact(m.installs)} installs</div>
            </div>
            <span className="chip" style={{ color: 'var(--good)' }}><ShieldCheck size={13} />Scanned</span>
          </div>
          <p style={{ margin: 0, whiteSpace: 'pre-line' }}>{m.description || 'No description.'}</p>
          {code && <pre className="codeview">{m.source}</pre>}
          {reporting && (
            <div className="row">
              <input className="input" placeholder="What is wrong with this macro?" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
              <button className="btn" disabled={!reason.trim()} onClick={() => api('report', { kind: 'macro', id, reason }).then(() => { toast('Thanks. Staff will take a look.'); setReporting(false) }).catch(fail)}>Send</button>
            </div>
          )}
          <div className="divider" style={{ margin: 0 }} />
          <h2 className="section" style={{ margin: 0 }}>Reviews <span className="muted">{d.data.reviews.length}</span></h2>
          {!mine && (
            <div className="review-form">
              <span className="row" role="radiogroup" aria-label="Your rating">
                {[1, 2, 3, 4, 5].map((i) => <button key={i} className="starbtn" role="radio" aria-checked={stars === i} aria-label={`${i} star${i === 1 ? '' : 's'}`} onClick={() => setStars(i)}><Star size={20} fill={i <= stars ? 'var(--accent)' : 'none'} color={i <= stars ? 'var(--accent)' : 'var(--muted)'} /></button>)}
              </span>
              <input className="input" placeholder="Say how it worked for you (optional)" value={body} onChange={(e) => setBody(e.target.value)} maxLength={1000} />
              <button className="btn" disabled={!stars} onClick={() => api('explore.review', { id, stars, body }).then(() => { toast('Review posted.'); setBody(''); d.reload() }).catch(fail)}>Post</button>
            </div>
          )}
          {d.data.reviews.length === 0 ? <p className="muted small" style={{ margin: 0 }}>No reviews yet.</p> : (
            <div className="stack-sm">
              {d.data.reviews.map((r: any, i: number) => (
                <div key={i} className="review">
                  <div className="spread"><Name user={r.author} size={13} /><span className="row small muted" style={{ gap: 8 }}><Stars value={r.stars} size={11} />{ago(r.created_at)}</span></div>
                  {r.body && <p className="small" style={{ margin: '4px 0 0' }}>{r.body}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}

function Publish({ preset, onClose }: { preset: string | null; onClose: () => void }) {
  const me = useStore((s) => s.me)
  const games = useStore((s) => s.games)
  const mine = useAsync(() => invoke<any[]>('macros:list').then((l) => l.filter((m) => ['local', 'converted', 'recording'].includes(m.origin))), [])
  const [pick, setPick] = useState<string>(preset ?? '')
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [tags, setTags] = useState('')
  const [game, setGame] = useState<PickedGame | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<any>(null)

  useEffect(() => {
    const m = mine.data?.find((x) => x.id === pick)
    if (!m) return
    setName(m.name)
    setDesc(m.description)
    setTags(m.tags.join(', '))
    setGame(m.universeId ? { universeId: m.universeId, placeId: m.placeId, name: games[m.universeId]?.name ?? m.gameName ?? 'Game' } : null)
  }, [pick, mine.data]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!me?.verified) {
    return (
      <Modal title="Prove your Roblox account first" onClose={onClose} foot={<><button className="btn ghost" onClick={onClose}>Later</button><button className="btn primary" onClick={() => { onClose(); go('settings', { section: 'account' }) }}>Go to Account</button></>}>
        <p className="muted" style={{ margin: 0 }}>Publishing, reviews and your public profile need a one-time check that this Roblox account is yours. It takes about 20 seconds.</p>
      </Modal>
    )
  }

  async function submit() {
    setBusy(true)
    try {
      const { source } = await invoke('macros:get', pick)
      const r = await api('explore.publish', { name, description: desc, tags: tags.split(',').map((t) => t.trim()).filter(Boolean), universeId: game?.universeId ?? null, source })
      setResult(r)
      if (r.status === 'live') toast(`${name} is live on Explore.`)
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal wide title="Publish to Explore" onClose={onClose} foot={result ? <button className="btn primary" onClick={onClose}>Done</button> : <>
      <button className="btn ghost" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={!pick || !name.trim() || busy} onClick={submit}><Upload size={14} />Publish</button>
    </>}>
      {result ? (
        <div className="stack-sm">
          <b>{{ live: 'Published. Anyone can find it in Explore now.', held: 'Sent for a staff check. Something in the code needs a human look before it goes live.', rejected: 'Not published: the scan found dangerous code.' }[result.status as string]}</b>
          {result.scan?.findings?.filter((f: any) => f.severity !== 'low').map((f: any, i: number) => <span key={i} className="small muted">line {f.line}: {f.message}</span>)}
        </div>
      ) : (
        <div className="add-grid">
          <div className="stack">
            <label className="field"><span>Macro</span>
              <select className="select input" value={pick} onChange={(e) => setPick(e.target.value)}>
                <option value="">Choose one of your macros</option>
                {(mine.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </label>
            <label className="field"><span>Name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} /></label>
            <label className="field"><span>Description</span><textarea className="input" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={2000} placeholder="What it does, which part of the game, and any setup" /></label>
          </div>
          <div className="stack">
            <div className="field"><span>Game</span><GamePicker value={game} onChange={setGame} /></div>
            <label className="field"><span>Tags, separated by commas</span><input className="input" value={tags} onChange={(e) => setTags(e.target.value)} /></label>
            <p className="muted small" style={{ margin: 0 }}>Explore only takes Python. Every upload is scanned for malware and hidden code; anything unusual waits for staff. Creators with 10 or more macros and a 4-star average over 10+ reviews get a verified tick.</p>
          </div>
        </div>
      )}
    </Modal>
  )
}
