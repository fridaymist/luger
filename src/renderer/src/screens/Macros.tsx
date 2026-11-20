import { AlertTriangle, CheckSquare, Code2, Copy, Download, FileUp, Gamepad2, Keyboard, LayoutGrid, List, Loader2, MoreHorizontal, Pencil, Play, Plus, Search, ShieldAlert, ShieldCheck, Square, Trash2, Upload, Wand2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import GamePicker, { type PickedGame } from '../components/GamePicker'
import { GameIcon } from '../components/identity'
import MacroWindow from '../components/MacroWindow'
import { Confirm, Drawer, Empty, KeyInput, Menu, Modal, prettyKey, Seg } from '../components/ui'
import { saveSettings } from '../lib/actions'
import { api, invoke, on } from '../lib/bridge'
import { catalog } from '../lib/catalog'
import { ago } from '../lib/format'
import { startRuntimeListener } from '../lib/runtime'
import { cacheGames, fail, go, hasRole, toast, useStore } from '../lib/state'

const ORIGIN_LABEL: Record<string, string> = { local: 'Python', converted: 'From AHK', recording: 'Recording', explore: 'Explore', official: 'Public script' }

export default function Macros() {
  const settings = useStore((s) => s.settings)
  const games = useStore((s) => s.games)
  const running = useStore((s) => s.running)
  const pageArg = useStore((s) => s.pageArg)
  const [list, setList] = useState<any[]>([])
  const [loaded, setLoaded] = useState(false)
  const [q, setQ] = useState('')
  const [game, setGame] = useState<number | 'all'>('all')
  const [source, setSource] = useState<'all' | 'mine' | 'official' | 'explore'>('all')
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState<string[] | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [focus, setFocus] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState<string[] | null>(null)
  const [bulkGame, setBulkGame] = useState(false)
  const view = settings?.macroView ?? 'grid'

  const reload = useCallback(() => invoke<any[]>('macros:list').then((l) => { setList(l); setLoaded(true) }), [])
  useEffect(() => {
    startRuntimeListener()
    reload()
    return on('macros:changed', reload)
  }, [reload])
  useEffect(() => {
    if (pageArg?.edit) setEditing(pageArg.edit)
    if (pageArg?.add) setAdding([])
  }, [pageArg])
  useEffect(() => {
    const ids = [...new Set(list.map((m) => m.universeId).filter((u) => u && !games[u]))]
    if (ids.length) api('games.get', { universeIds: ids }).then((r) => cacheGames(r.games)).catch(() => {})
  }, [list]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!focus && running.length) setFocus(running[0])
  }, [running, focus])

  const gameOptions = useMemo(() => {
    const ids = [...new Set(list.map((m) => m.universeId).filter(Boolean))] as number[]
    return ids.map((id) => ({ id, name: games[id]?.name ?? list.find((m) => m.universeId === id)?.gameName ?? 'Game' }))
  }, [list, games])

  const shown = list.filter((m) => {
    if (game !== 'all' && m.universeId !== game) return false
    if (source === 'mine' && !['local', 'converted', 'recording'].includes(m.origin)) return false
    if (source === 'official' && m.origin !== 'official') return false
    if (source === 'explore' && m.origin !== 'explore') return false
    if (q) {
      const t = q.toLowerCase()
      const hay = `${m.name} ${m.description} ${m.tags.join(' ')} ${m.author ?? ''} ${games[m.universeId]?.name ?? m.gameName ?? ''}`.toLowerCase()
      if (!hay.includes(t)) return false
    }
    return true
  })

  function toggleSel(id: string) {
    setSelected((s) => {
      const n = new Set(s)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  async function remove(ids: string[]) {
    const r = await invoke('macros:remove', ids)
    if (r.kept.length) toast(`${r.kept.join(', ')} ${r.kept.length === 1 ? 'is a public script and stays' : 'are public scripts and stay'} unless staff allow removing.`, 'error')
    if (r.removed.length) toast(`Removed ${r.removed.length} macro${r.removed.length === 1 ? '' : 's'}.`)
    setSelected(new Set())
    reload()
  }

  async function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const files = [...e.dataTransfer.files].map((f) => window.luger.pathForFile(f)).filter(Boolean)
    if (files.length) setAdding(files)
  }

  const focusMacro = list.find((m) => m.id === focus)

  return (
    <div className="macros" onDragOver={(e) => { e.preventDefault(); setDragging(true) }} onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)} onDrop={onDrop}>
      <header className="topbar drag">
        <h1>Macros</h1>
        <span className="sub num">{list.length}</span>
        <div className="grow" />
        <div className="search nodrag" style={{ width: 240 }}><Search size={15} /><input className="input" placeholder="Search macros" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <button className={`btn nodrag ${selecting ? '' : 'ghost'}`} onClick={() => { setSelecting(!selecting); setSelected(new Set()) }}><CheckSquare size={15} />{selecting ? 'Done' : 'Select'}</button>
        <button className="btn primary nodrag" onClick={async () => { const files = await invoke<string[]>('macros:pick'); if (files.length) setAdding(files) }}><Plus size={16} />Add macro</button>
      </header>

      <div className="filterbar">
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {(['all', 'mine', 'official', 'explore'] as const).map((s) => (
            <button key={s} className="chip" aria-pressed={source === s} onClick={() => setSource(s)}>{{ all: 'All', mine: 'Mine', official: 'Public scripts', explore: 'From Explore' }[s]}</button>
          ))}
          {gameOptions.length > 0 && (
            <select className="select input" style={{ width: 190, height: 28 }} value={String(game)} onChange={(e) => setGame(e.target.value === 'all' ? 'all' : Number(e.target.value))} aria-label="Filter by game">
              <option value="all">Every game</option>
              {gameOptions.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          )}
        </div>
        <Seg label="Layout" value={view} onChange={(v) => saveSettings({ macroView: v })} options={[{ value: 'grid', label: <LayoutGrid size={14} />, title: 'Grid' }, { value: 'list', label: <List size={14} />, title: 'List' }]} />
      </div>

      <div className={`macros-body${focusMacro ? ' with-window' : ''}`}>
        <div className="page">
          {!loaded ? <div className="skeleton" style={{ height: 200 }} /> : list.length === 0 ? (
            <Empty icon={<FileUp size={28} />} title="Add your first macro" action={<button className="btn primary" onClick={async () => { const f = await invoke<string[]>('macros:pick'); if (f.length) setAdding(f) }}>Choose files</button>}>
              Drag a Python (.py) or AutoHotkey (.ahk) file anywhere on this page. AutoHotkey scripts are rewritten into Python automatically, and every file is checked for malware.
            </Empty>
          ) : shown.length === 0 ? <Empty title="Nothing matches">Try another search or filter.</Empty> : (
            <div className={view === 'grid' ? 'mgrid' : 'mlist'}>
              {shown.map((m) => (
                <MacroItem key={m.id} m={m} game={games[m.universeId]} view={view} running={running.includes(m.id)} focused={focus === m.id}
                  selecting={selecting} selected={selected.has(m.id)} onSelect={() => toggleSel(m.id)}
                  onFocus={() => setFocus(m.id)} onEdit={() => setEditing(m.id)} onRemove={() => setConfirmRemove([m.id])} reload={reload} />
              ))}
            </div>
          )}
        </div>
        {focusMacro && (
          <aside className="macros-side">
            <div className="spread" style={{ padding: '0 2px 8px' }}><span className="muted small">Macro window</span><button className="btn ghost icon sm" aria-label="Close macro window" onClick={() => setFocus(null)}><X size={14} /></button></div>
            <MacroWindow id={focusMacro.id} name={focusMacro.name} />
          </aside>
        )}
      </div>

      {selecting && selected.size > 0 && (
        <div className="bulkbar panel" role="toolbar" aria-label="Selected macros">
          <b className="num">{selected.size} selected</b>
          <button className="btn ghost sm" onClick={() => setSelected(new Set(shown.map((m) => m.id)))}>Select all {shown.length}</button>
          <div className="grow" />
          <button className="btn sm" onClick={() => [...selected].forEach((id) => invoke('macros:run', id).catch(fail))}><Play size={13} />Run</button>
          <button className="btn sm" onClick={() => [...selected].forEach((id) => invoke('macros:stop', id))}><Square size={12} />Stop</button>
          <button className="btn sm" onClick={() => setBulkGame(true)}><Gamepad2 size={13} />Set game</button>
          <button className="btn sm danger" onClick={() => setConfirmRemove([...selected])}><Trash2 size={13} />Remove</button>
        </div>
      )}

      {dragging && <div className="dropzone" aria-hidden><Upload size={36} /><b>Drop to add</b><span>Python and AutoHotkey files</span></div>}
      {adding && <AddFlow files={adding} onClose={() => setAdding(null)} onDone={(id) => { reload(); if (id) setEditing(id) }} />}
      {editing && <EditDrawer id={editing} onClose={() => { setEditing(null); reload() }} />}
      {confirmRemove && (
        <Confirm title={confirmRemove.length === 1 ? 'Remove this macro?' : `Remove ${confirmRemove.length} macros?`} confirm="Remove" danger onClose={() => setConfirmRemove(null)} onConfirm={() => remove(confirmRemove)}>
          The files are deleted from this computer. Public scripts stay unless staff allow removing them.
        </Confirm>
      )}
      {bulkGame && <BulkGame ids={[...selected]} onClose={() => { setBulkGame(false); reload() }} />}
    </div>
  )
}

function MacroItem({ m, game, view, running, focused, selecting, selected, onSelect, onFocus, onEdit, onRemove, reload }: any) {
  const [menu, setMenu] = useState(false)
  const run = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (running) invoke('macros:stop', m.id)
    else invoke('macros:run', m.id).then(onFocus).catch(fail)
  }
  const flagged = m.scan?.verdict && m.scan.verdict !== 'clean'
  const gameName = game?.name ?? m.gameName
  return (
    <article className={`mitem ${view}${focused ? ' focused' : ''}${selected ? ' selected' : ''}`} onClick={selecting ? onSelect : onFocus}>
      {selecting && <input type="checkbox" className="mcheck" checked={selected} onChange={onSelect} onClick={(e) => e.stopPropagation()} aria-label={`Select ${m.name}`} />}
      <GameIcon game={game ?? { name: gameName ?? m.name }} size={view === 'grid' ? 44 : 34} radius={9} />
      <div className="mitem-text">
        <b className="ellipsis">{m.name}</b>
        <span className="muted small ellipsis">{gameName ?? 'Any game'}{view === 'list' ? ` · edited ${ago(m.updatedAt)}` : ''}</span>
      </div>
      {view === 'grid' && m.description && <p className="mitem-desc muted small">{m.description}</p>}
      <div className="mitem-meta">
        <span className={`chip origin-${m.origin}`}>{ORIGIN_LABEL[m.origin]}</span>
        {m.cleaned && <span className="chip" title="Risky lines were removed"><ShieldAlert size={12} />Cleaned</span>}
        {flagged && !m.cleaned && <span className="chip warn" title="The scan found things to check"><AlertTriangle size={12} />Check</span>}
        {running && <span className="chip live">Running</span>}
      </div>
      {!selecting && (
        <div className="mitem-actions" onClick={(e) => e.stopPropagation()}>
          <button className={`btn sm ${running ? 'danger' : 'primary'}`} onClick={run}>{running ? <><Square size={11} fill="currentColor" />Stop</> : <><Play size={11} fill="currentColor" />Run</>}</button>
          {m.placeId && <button className="btn sm icon" title="Apply and launch game" aria-label="Apply and launch game" onClick={() => invoke('roblox:launch', m.placeId, m.id).then(() => toast('Roblox is opening. The macro starts when the game loads.')).catch(fail)}><Wand2 size={13} /></button>}
          <button className="btn sm icon" aria-label="Edit" title="Edit" onClick={onEdit}><Pencil size={13} /></button>
          <div style={{ position: 'relative' }}>
            <button className="btn sm icon ghost" aria-label="More" onClick={() => setMenu(!menu)}><MoreHorizontal size={15} /></button>
            {menu && <Menu style={{ right: 0, top: 32 }} onClose={() => setMenu(false)} items={[
              { label: 'Duplicate', icon: <Copy size={14} />, onClick: () => invoke('macros:duplicate', m.id).then(reload) },
              { label: 'Export .py', icon: <Download size={14} />, onClick: () => invoke('macros:export', m.id) },
              { label: 'Publish to Explore', icon: <Upload size={14} />, onClick: () => go('explore', { publish: m.id }) },
              ...(m.origin !== 'official' || m.allowRemove ? [{ label: 'Remove', icon: <Trash2 size={14} />, danger: true, onClick: onRemove }] : [])
            ]} />}
          </div>
        </div>
      )}
    </article>
  )
}

// ------------------------------------------------------------------ adding: scan, game, decide
function AddFlow({ files, onClose, onDone }: { files: string[]; onClose: () => void; onDone: (id: string | null) => void }) {
  const [index, setIndex] = useState(0)
  const [pending, setPending] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [game, setGame] = useState<PickedGame | null>(null)
  const [busy, setBusy] = useState(false)
  const [lastId, setLastId] = useState<string | null>(null)

  useEffect(() => {
    if (!files.length) { onClose(); return }
    if (index >= files.length) { onDone(files.length === 1 ? lastId : null); onClose(); return }
    setPending(null)
    setError(null)
    setGame(null)
    invoke('macros:prepare', files[index]).then((p) => { setPending(p); setName(p.name) }).catch((e) => setError(e.message))
  }, [index]) // eslint-disable-line react-hooks/exhaustive-deps

  async function commit(action: 'keep' | 'clean' | 'remove') {
    setBusy(true)
    try {
      const meta = await invoke('macros:commit', pending.token, { action, name, universeId: game?.universeId ?? null, placeId: game?.placeId ?? null, gameName: game?.name ?? null })
      if (meta) {
        setLastId(meta.id)
        toast(`${meta.name} added.`)
      } else toast('The macro was removed from this computer.')
      setIndex((i) => i + 1)
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  const safety = useStore((s) => s.settings?.safety)
  // Standard safety only stops on clearly dangerous code.
  const verdict = pending?.scan?.verdict === 'suspicious' && safety === 'standard' ? 'clean' : pending?.scan?.verdict
  const counter = files.length > 1 ? ` (${index + 1} of ${files.length})` : ''
  return (
    <Modal title={`Add macro${counter}`} onClose={onClose} wide foot={pending && (
      verdict === 'clean' ? <>
        <button className="btn ghost" onClick={() => setIndex((i) => i + 1)}>Skip</button>
        <button className="btn primary" disabled={busy || !name.trim()} onClick={() => commit('keep')}>Add macro</button>
      </> : <>
        <button className="btn danger" disabled={busy} onClick={() => commit('remove')}><Trash2 size={14} />Wipe and remove</button>
        {verdict === 'suspicious' && <button className="btn" disabled={busy} onClick={() => commit('keep')}>Keep as it is</button>}
        <button className="btn primary" disabled={busy || !name.trim()} onClick={() => commit('clean')}><ShieldCheck size={14} />Keep and clean</button>
      </>
    )}>
      {error ? (
        <div className="stack-sm"><p style={{ margin: 0 }}>{error}</p><div><button className="btn" onClick={() => setIndex((i) => i + 1)}>Next file</button></div></div>
      ) : !pending ? (
        <div className="row muted" style={{ padding: '24px 0' }}><Loader2 size={18} className="spin" />Reading, converting and scanning {files[index]?.split(/[\\/]/).pop()}…</div>
      ) : (
        <div className="add-grid">
          <div className="stack">
            <label className="field"><span>Name</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} /></label>
            <div className="field"><span>Game it is for</span><GamePicker value={game} onChange={setGame} /></div>
            <p className="muted small" style={{ margin: 0 }}>Picking the game lets Luger tell the game’s own controls apart from the macro’s hotkeys when you change binds.</p>
          </div>
          <div className="stack">
            <ScanReport scan={pending.scan} />
            {pending.conversion && <ConversionReport c={pending.conversion} />}
          </div>
        </div>
      )}
    </Modal>
  )
}

function ScanReport({ scan }: { scan: any }) {
  const v = scan.verdict
  const serious = scan.findings.filter((f: any) => f.severity !== 'low')
  return (
    <div className={`scan scan-${v}`}>
      <div className="row">{v === 'clean' ? <ShieldCheck size={18} /> : <ShieldAlert size={18} />}<b>{{ clean: 'No malware found', suspicious: 'Some things need a look', malicious: 'Dangerous code found', invalid: 'Not valid Python' }[v as string]}</b></div>
      {v === 'malicious' && <p className="small" style={{ margin: '6px 0 0' }}>Keep and clean removes every risky line. The macro may stop working afterwards. Wipe and remove deletes it.</p>}
      {v === 'suspicious' && <p className="small" style={{ margin: '6px 0 0' }}>Nothing clearly harmful, but these lines do more than a macro usually needs.</p>}
      {serious.length > 0 && <ul className="scan-list">{serious.slice(0, 8).map((f: any, i: number) => <li key={i}><span className="mono muted">line {f.line}</span> {f.message}</li>)}</ul>}
    </div>
  )
}

function ConversionReport({ c }: { c: any }) {
  return (
    <div className="scan">
      <div className="row"><Code2 size={18} /><b>Converted from AutoHotkey</b></div>
      {c.unsupported.length === 0 && !c.notes.length ? <p className="small muted" style={{ margin: '6px 0 0' }}>Every line was converted.</p> : (
        <ul className="scan-list">
          {c.unsupported.slice(0, 8).map((u: any, i: number) => <li key={i}><span className="mono muted">line {u.line}</span> {u.reason}: <code>{u.text}</code></li>)}
          {c.notes.slice(0, 6).map((n: string, i: number) => <li key={`n${i}`} className="muted">{n}</li>)}
        </ul>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ editing
function EditDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const me = useStore((s) => s.me)
  const games = useStore((s) => s.games)
  const [m, setM] = useState<any>(null)
  const [source, setSource] = useState('')
  const [tab, setTab] = useState<'details' | 'binds' | 'code'>('details')
  const [binds, setBinds] = useState<any[] | null>(null)
  const [draft, setDraft] = useState<any>({})
  const [code, setCode] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    invoke('macros:get', id).then((r) => { setM(r.meta); setSource(r.source); setCode(r.source); setDraft({ name: r.meta.name, description: r.meta.description, tags: r.meta.tags.join(', ') }) }).catch(fail)
  }, [id])

  const game = m?.universeId ? games[m.universeId] : null
  const known = catalog.games.find((g) => g.placeId === (game?.root_place_id ?? m?.placeId))
  const controls: Record<string, string> = game?.controls ?? (known ? { ...catalog.robloxDefaults, ...known.controls } : {})
  useEffect(() => {
    if (tab === 'binds' && m) invoke('macros:binds', id, controls).then(setBinds).catch((e) => { fail(e); setBinds([]) })
  }, [tab, m?.universeId, source]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!m) return null
  const official = m.origin === 'official'
  const isStaff = hasRole(me, 'owner', 'developer', 'editor')

  async function saveDetails() {
    setSaving(true)
    try {
      const next = await invoke('macros:update', id, { name: draft.name, description: draft.description, tags: String(draft.tags).split(',').map((t: string) => t.trim()).filter(Boolean).slice(0, 8) })
      setM(next)
      toast('Saved.')
    } catch (e) { fail(e) } finally { setSaving(false) }
  }

  // Group binds by key so one change updates every use of that key.
  const grouped = new Map<string, any[]>()
  for (const b of binds ?? []) grouped.set(`${b.kind}:${b.key}`, [...(grouped.get(`${b.kind}:${b.key}`) ?? []), b])

  async function rebind(key: string, next: string, kind: string) {
    if (next === key) return
    try {
      const ids = grouped.get(`${kind}:${key}`)!.map((b) => b.id)
      const changes = Object.fromEntries(ids.map((i) => [i, next]))
      const nb = await invoke('macros:rebind', id, changes, controls)
      setBinds(nb)
      const r = await invoke('macros:get', id)
      setSource(r.source)
      setCode(r.source)
      toast(`${prettyKey(key)} is now ${prettyKey(next)}.`)
    } catch (e) { fail(e) }
  }

  return (
    <Drawer title={m.name} onClose={onClose} foot={tab === 'details' && !official ? <button className="btn primary" disabled={saving} onClick={saveDetails}>Save changes</button> : tab === 'code' && !official ? <button className="btn primary" disabled={saving || code === source} onClick={async () => {
      setSaving(true)
      try { await invoke('macros:saveSource', id, code); setSource(code); toast('Code saved and rescanned.') } catch (e) { fail(e) } finally { setSaving(false) }
    }}>Save code</button> : undefined}>
      <Seg label="Section" value={tab} onChange={setTab} options={[{ value: 'details', label: 'Details' }, { value: 'binds', label: <><Keyboard size={13} />Binds</> }, { value: 'code', label: <><Code2 size={13} />Code</> }]} />
      {official && <p className="notice small">This is a public script from Luger staff{m.author ? ` (@${m.author})` : ''}. It updates by itself, so it cannot be edited here. Duplicate it to make your own version.{isStaff && ` ${m.allowRemove ? 'Users can remove it.' : 'Users cannot remove it; change this in the Owner panel.'}`}</p>}

      {tab === 'details' && (
        <div className="stack" style={{ marginTop: 16 }}>
          <label className="field"><span>Name</span><input className="input" disabled={official} value={draft.name ?? ''} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={60} /></label>
          <label className="field"><span>What it does</span><textarea className="input" disabled={official} value={draft.description ?? ''} onChange={(e) => setDraft({ ...draft, description: e.target.value })} maxLength={2000} /></label>
          <label className="field"><span>Tags, separated by commas</span><input className="input" disabled={official} value={draft.tags ?? ''} onChange={(e) => setDraft({ ...draft, tags: e.target.value })} /></label>
          <div className="field"><span>Game</span>
            <GamePicker value={m.universeId ? { universeId: m.universeId, placeId: m.placeId, name: game?.name ?? m.gameName ?? 'Game' } : null}
              onChange={async (g) => setM(await invoke('macros:update', id, { universeId: g?.universeId ?? null, placeId: g?.placeId ?? null, gameName: g?.name ?? null }))} />
          </div>
          <div className="kv small">
            <span className="muted">Source</span><span>{ORIGIN_LABEL[m.origin]}</span>
            <span className="muted">Scan</span><span>{m.scan.verdict === 'clean' ? 'No malware found' : m.cleaned ? 'Cleaned' : 'Needs a look'}</span>
            <span className="muted">Added</span><span>{new Date(m.createdAt).toLocaleDateString()}</span>
          </div>
          {m.conversion && <ConversionReport c={m.conversion} />}
        </div>
      )}

      {tab === 'binds' && (
        <div className="stack" style={{ marginTop: 16 }}>
          <p className="muted small" style={{ margin: 0 }}>
            {known || game ? `Keys that match ${game?.name ?? known?.name}’s own controls are labelled, so you can move them together when you change the game’s settings.` : 'Pick the game in Details to label which keys belong to the game.'} Click a key, then press the new one.
          </p>
          {binds === null ? <div className="skeleton" style={{ height: 120 }} /> : grouped.size === 0 ? <Empty title="No binds found">This macro does not press keys or register hotkeys in a way Luger can change.</Empty> : (
            <div className="binds">
              {[...grouped.entries()].map(([k, uses]) => {
                const b = uses[0]
                return (
                  <div key={k} className="bind">
                    <div className="grow">
                      <b>{b.kind === 'hotkey' ? 'Macro hotkey' : b.controls?.length ? b.controls.map((c: string) => c.replace(/_/g, ' ')).join(' / ') : 'Key the macro presses'}</b>
                      <div className="muted small">{uses.length} use{uses.length === 1 ? '' : 's'}{b.context ? ` · in ${b.context}()` : ''}{b.kind === 'send' && b.controls?.length ? ' · game control' : ''}</div>
                    </div>
                    {official ? <span className="keycap">{prettyKey(b.key)}</span> : <KeyInput label={b.kind === 'hotkey' ? 'Hotkey' : 'Key'} value={b.key} onChange={(n) => rebind(b.key, n, b.kind)} />}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'code' && (
        <div className="stack" style={{ marginTop: 16 }}>
          <textarea className="input code" spellCheck={false} value={code} readOnly={official} onChange={(e) => setCode(e.target.value)} aria-label="Macro code" />
          <p className="muted small" style={{ margin: 0 }}>Saving checks the code is valid Python and scans it again. Use the <code>luger</code> library: press, click, wait, hotkey, pixel, ui.</p>
        </div>
      )}
    </Drawer>
  )
}

function BulkGame({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const [game, setGame] = useState<PickedGame | null>(null)
  return (
    <Modal title={`Set the game for ${ids.length} macro${ids.length === 1 ? '' : 's'}`} onClose={onClose} foot={<>
      <button className="btn ghost" onClick={onClose}>Cancel</button>
      <button className="btn primary" disabled={!game} onClick={async () => {
        for (const id of ids) await invoke('macros:update', id, { universeId: game!.universeId, placeId: game!.placeId, gameName: game!.name }).catch(() => {})
        toast('Game updated.')
        onClose()
      }}>Apply</button>
    </>}>
      <GamePicker value={game} onChange={setGame} />
    </Modal>
  )
}
