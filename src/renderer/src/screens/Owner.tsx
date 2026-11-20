import { Ban, Check, Copy, Download, Eye, KeyRound, Plus, RefreshCw, Search, Trash2, Upload, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { GameIcon, Name, RoleBadge } from '../components/identity'
import { Confirm, Empty, Modal, Seg, Switch, useAsync } from '../components/ui'
import { api, invoke } from '../lib/bridge'
import { ago, duration, money } from '../lib/format'
import { fail, hasRole, toast, useStore } from '../lib/state'

type Tab = 'overview' | 'keys' | 'scripts' | 'staff' | 'moderation' | 'settings'

export default function Owner() {
  const me = useStore((s) => s.me)
  const owner = hasRole(me, 'owner')
  const tabs: { value: Tab; label: string }[] = owner
    ? [{ value: 'overview', label: 'Overview' }, { value: 'keys', label: 'Keys' }, { value: 'scripts', label: 'Public scripts' }, { value: 'staff', label: 'Staff' }, { value: 'moderation', label: 'Moderation' }, { value: 'settings', label: 'Free keys' }]
    : [{ value: 'scripts', label: 'Public scripts' }, { value: 'moderation', label: 'Moderation' }]
  const [tab, setTab] = useState<Tab>(tabs[0].value)
  if (!hasRole(me, 'owner', 'developer', 'editor')) return <div className="page"><Empty title="Staff only" /></div>
  return (
    <>
      <header className="topbar drag">
        <h1>{owner ? 'Owner' : 'Staff'}</h1>
        <div className="nodrag"><Seg label="Owner section" value={tab} onChange={setTab} options={tabs} /></div>
      </header>
      <div className="page">
        {tab === 'overview' && <Overview />}
        {tab === 'keys' && <Keys />}
        {tab === 'scripts' && <Scripts />}
        {tab === 'staff' && <Staff />}
        {tab === 'moderation' && <Moderation />}
        {tab === 'settings' && <CheckpointSettings />}
      </div>
    </>
  )
}

function Overview() {
  const st = useAsync(() => api('admin.stats'), [])
  if (!st.data) return <div className="skeleton" style={{ height: 160 }} />
  const d = st.data
  const cards = [
    ['Free keys today', d.adKeysDay], ['Key redemptions today', d.redeemsDay], ['Players', d.users], ['Keys made', d.keys],
    ['Explore macros', d.macros], ['Waiting for review', d.held], ['Open reports', d.reportsOpen], ['Sales this week', d.ordersWeek]
  ]
  return (
    <>
      <div className="statgrid">{cards.map(([label, n]) => <div key={label as string} className="stat card"><b className="num">{Number(n).toLocaleString()}</b><span className="muted small">{label}</span></div>)}</div>
      <h2 className="section">Revenue this week <span className="muted">before payment fees</span></h2>
      <div className="row" style={{ gap: 18, flexWrap: 'wrap' }}>
        {Object.keys(d.revenueWeek).length ? Object.entries(d.revenueWeek).map(([c, v]) => <b key={c} className="num" style={{ font: '700 26px var(--display)' }}>{money(v as number, c.toUpperCase())}</b>) : <span className="muted">No sales yet.</span>}
      </div>
    </>
  )
}

// ------------------------------------------------------------------ keys
const DURATIONS: { label: string; s: number | null }[] = [
  { label: '1 hour', s: 3600 }, { label: '1 day', s: 86400 }, { label: '3 days', s: 3 * 86400 }, { label: '7 days', s: 7 * 86400 },
  { label: '30 days', s: 30 * 86400 }, { label: '90 days', s: 90 * 86400 }, { label: '1 year', s: 365 * 86400 }, { label: 'Lifetime', s: null }
]

function Keys() {
  const [q, setQ] = useState('')
  const [kind, setKind] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(0)
  const [creating, setCreating] = useState(false)
  const [made, setMade] = useState<{ id: string; key: string }[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmDel, setConfirmDel] = useState(false)
  const list = useAsync(() => api('admin.keys.list', { q: q || undefined, kind: kind || undefined, status: status || undefined, page }), [q, kind, status, page])

  const update = async (body: any) => {
    try {
      await api('admin.keys.update', { ids: [...selected], ...body })
      toast('Keys updated.')
      list.reload()
    } catch (e) { fail(e) }
  }
  const status_of = (k: any) => k.revoked ? 'Revoked' : k.expires_at && Date.parse(k.expires_at) < Date.now() ? 'Expired' : k.expires_at ? `Ends ${new Date(k.expires_at).toLocaleDateString()}` : k.duration_s === null ? 'Lifetime' : `${duration(k.duration_s)} from first use`

  return (
    <>
      <div className="spread" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <div className="search" style={{ width: 240 }}><Search size={15} /><input className="input" placeholder="Label, note or last 4 characters" value={q} onChange={(e) => { setQ(e.target.value); setPage(0) }} /></div>
          <select className="select input" style={{ width: 150 }} value={kind} onChange={(e) => { setKind(e.target.value); setPage(0) }} aria-label="Type">
            <option value="">Every type</option>{['ad', 'weekly', 'monthly', 'lifetime', 'gift', 'staff'].map((k) => <option key={k} value={k}>{k === 'ad' ? 'Free (ads)' : k[0].toUpperCase() + k.slice(1)}</option>)}
          </select>
          <select className="select input" style={{ width: 140 }} value={status} onChange={(e) => { setStatus(e.target.value); setPage(0) }} aria-label="Status">
            <option value="">Any status</option><option value="active">Active</option><option value="expired">Expired</option><option value="revoked">Revoked</option>
          </select>
        </div>
        <button className="btn primary" onClick={() => setCreating(true)}><Plus size={15} />Make keys</button>
      </div>

      {selected.size > 0 && (
        <div className="bulkline">
          <b className="num">{selected.size} selected</b>
          <button className="btn sm" onClick={() => update({ extendSeconds: 7 * 86400 })}>+7 days</button>
          <button className="btn sm" onClick={() => update({ extendSeconds: 30 * 86400 })}>+30 days</button>
          <button className="btn sm" onClick={() => update({ lifetime: true })}>Make lifetime</button>
          <button className="btn sm" onClick={() => update({ resetDevices: true })}><RefreshCw size={12} />Reset devices</button>
          <button className="btn sm" onClick={() => update({ revoked: true })}><Ban size={12} />Revoke</button>
          <button className="btn sm" onClick={() => update({ revoked: false })}>Restore</button>
          <button className="btn sm danger" onClick={() => setConfirmDel(true)}><Trash2 size={12} />Delete</button>
          <button className="btn sm ghost" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      {!list.data ? <div className="skeleton" style={{ height: 240 }} /> : list.data.keys.length === 0 ? <Empty icon={<KeyRound size={26} />} title="No keys match" action={<button className="btn" onClick={() => setCreating(true)}>Make keys</button>} /> : (
        <div className="table card">
          <div className="trow thead">
            <input type="checkbox" aria-label="Select all" checked={list.data.keys.every((k: any) => selected.has(k.id))} onChange={(e) => setSelected(e.target.checked ? new Set(list.data.keys.map((k: any) => k.id)) : new Set())} />
            <span>Key</span><span>Type</span><span>Status</span><span>Uses</span><span>Devices</span><span>For</span><span />
          </div>
          {list.data.keys.map((k: any) => (
            <div key={k.id} className={`trow${k.revoked ? ' dim' : ''}`}>
              <input type="checkbox" aria-label={`Select key ending ${k.key_hint}`} checked={selected.has(k.id)} onChange={() => setSelected((s) => { const n = new Set(s); n.has(k.id) ? n.delete(k.id) : n.add(k.id); return n })} />
              <span className="ellipsis"><span className="mono">…{k.key_hint}</span> {k.label && <b>{k.label}</b>}<span className="muted small" style={{ display: 'block' }}>{k.note || ago(k.created_at)}</span></span>
              <span className="small">{k.kind === 'ad' ? 'Free (ads)' : k.kind}</span>
              <span className="small">{status_of(k)}</span>
              <span className="num small">{k.uses}{k.max_uses ? ` / ${k.max_uses}` : ''}</span>
              <span className="num small">{k.devices} / {k.max_devices}</span>
              <span className="small ellipsis">{k.bound ? `@${k.bound}` : 'Anyone'}</span>
              <span className="row" style={{ justifyContent: 'flex-end' }}>
                <button className="btn sm icon ghost" title="Reveal and copy" aria-label="Reveal and copy key" onClick={async () => { try { const r = await api('admin.keys.reveal', { id: k.id }); await navigator.clipboard.writeText(r.key); toast(`${r.key} copied.`) } catch (e) { fail(e) } }}><Eye size={14} /></button>
              </span>
            </div>
          ))}
        </div>
      )}
      <div className="spread" style={{ marginTop: 12 }}>
        <span className="muted small num">{list.data?.total ?? 0} keys in total</span>
        <div className="row">{page > 0 && <button className="btn sm" onClick={() => setPage(page - 1)}>Previous</button>}{list.data && (page + 1) * 50 < list.data.total && <button className="btn sm" onClick={() => setPage(page + 1)}>Next</button>}</div>
      </div>

      {creating && <CreateKeys onClose={() => setCreating(false)} onMade={(keys) => { setMade(keys); setCreating(false); list.reload() }} />}
      {made && <MadeKeys keys={made} onClose={() => setMade(null)} />}
      {confirmDel && <Confirm title={`Delete ${selected.size} key${selected.size === 1 ? '' : 's'}?`} danger confirm="Delete" onClose={() => setConfirmDel(false)} onConfirm={async () => { await api('admin.keys.delete', { ids: [...selected] }).catch(fail); setSelected(new Set()); list.reload() }}>Anyone using them is signed out at their next check. This cannot be undone. Revoking keeps a record instead.</Confirm>}
    </>
  )
}

function CreateKeys({ onClose, onMade }: { onClose: () => void; onMade: (k: any[]) => void }) {
  const [f, setF] = useState({ count: 1, label: '', kind: 'gift', dur: 30 * 86400 as number | null, custom: '', startsOnUse: true, maxUses: '', maxDevices: 1, boundUsername: '', note: '' })
  const [busy, setBusy] = useState(false)
  const set = (p: Partial<typeof f>) => setF({ ...f, ...p })
  async function make() {
    setBusy(true)
    try {
      const r = await api('admin.keys.create', {
        count: f.custom ? 1 : f.count, label: f.label, kind: f.kind, durationSeconds: f.dur, startsOnUse: f.startsOnUse,
        maxUses: f.maxUses ? Number(f.maxUses) : null, maxDevices: f.maxDevices, boundUsername: f.boundUsername.trim() || undefined,
        note: f.note, custom: f.custom.trim() || undefined
      })
      onMade(r.keys)
    } catch (e) { fail(e) } finally { setBusy(false) }
  }
  return (
    <Modal wide title="Make keys" onClose={onClose} foot={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={make}><KeyRound size={14} />Make {f.custom ? 1 : f.count} key{(f.custom ? 1 : f.count) === 1 ? '' : 's'}</button></>}>
      <div className="formgrid">
        <label className="field"><span>Label</span><input className="input" placeholder="Giveaway, YouTube, tester…" value={f.label} onChange={(e) => set({ label: e.target.value })} maxLength={80} /></label>
        <label className="field"><span>Type</span>
          <select className="select input" value={f.kind} onChange={(e) => set({ kind: e.target.value })}>
            <option value="gift">Gift</option><option value="staff">Staff</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="lifetime">Lifetime</option><option value="ad">Free (ads)</option>
          </select>
        </label>
        <label className="field"><span>How many</span><input className="input num" type="number" min={1} max={1000} disabled={!!f.custom} value={f.custom ? 1 : f.count} onChange={(e) => set({ count: Math.max(1, Math.min(1000, Number(e.target.value))) })} /></label>
        <label className="field"><span>Lasts</span>
          <select className="select input" value={String(f.dur)} onChange={(e) => set({ dur: e.target.value === 'null' ? null : Number(e.target.value) })}>
            {DURATIONS.map((d) => <option key={d.label} value={String(d.s)}>{d.label}</option>)}
          </select>
        </label>
        <label className="field"><span>Clock starts</span>
          <Seg label="Clock starts" value={f.startsOnUse ? 'use' : 'now'} onChange={(v) => set({ startsOnUse: v === 'use' })} options={[{ value: 'use', label: 'On first use' }, { value: 'now', label: 'Right now' }]} />
        </label>
        <label className="field"><span>Uses (blank = unlimited)</span><input className="input num" type="number" min={1} value={f.maxUses} onChange={(e) => set({ maxUses: e.target.value })} /></label>
        <label className="field"><span>Devices per key</span><input className="input num" type="number" min={1} max={100} value={f.maxDevices} onChange={(e) => set({ maxDevices: Math.max(1, Number(e.target.value)) })} /></label>
        <label className="field"><span>Only for Roblox user (optional)</span><input className="input" placeholder="username" value={f.boundUsername} onChange={(e) => set({ boundUsername: e.target.value })} /></label>
        <label className="field span2"><span>Custom key text (optional, single key)</span><input className="input mono" placeholder="Leave empty for a random key" value={f.custom} onChange={(e) => set({ custom: e.target.value })} maxLength={64} /></label>
        <label className="field span2"><span>Note (only you see it)</span><input className="input" value={f.note} onChange={(e) => set({ note: e.target.value })} maxLength={500} /></label>
      </div>
    </Modal>
  )
}

function MadeKeys({ keys, onClose }: { keys: { key: string }[]; onClose: () => void }) {
  const text = keys.map((k) => k.key).join('\n')
  return (
    <Modal title={`${keys.length} key${keys.length === 1 ? '' : 's'} ready`} onClose={onClose} foot={<>
      <button className="btn" onClick={() => {
        const blob = new Blob(['key\n' + text + '\n'], { type: 'text/csv' })
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `luger-keys-${Date.now()}.csv`
        a.click()
      }}><Download size={14} />Save as CSV</button>
      <button className="btn primary" onClick={() => { navigator.clipboard.writeText(text); toast('Copied.') }}><Copy size={14} />Copy all</button>
    </>}>
      <p className="muted small" style={{ marginTop: 0 }}>Keys are saved. You can reveal any of them later from the list.</p>
      <pre className="codeview" style={{ maxHeight: 320 }}>{text}</pre>
    </Modal>
  )
}

// ------------------------------------------------------------------ public scripts
function Scripts() {
  const games = useStore((s) => s.games)
  const list = useAsync(() => api('admin.official.list'), [])
  const mine = useAsync(() => invoke<any[]>('macros:list').then((l) => l.filter((m) => m.origin !== 'official')), [])
  const [pick, setPick] = useState('')
  const [allowRemove, setAllowRemove] = useState(false)
  const [listExplore, setListExplore] = useState(false)
  const [updating, setUpdating] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState<any>(null)

  async function publish() {
    setBusy(true)
    try {
      const m = mine.data!.find((x) => x.id === pick)!
      const { source } = await invoke('macros:get', pick)
      const r = await api('admin.official.publish', { id: updating ?? undefined, name: m.name, description: m.description, universeId: m.universeId, tags: m.tags, source, allowRemove, listInExplore: listExplore })
      if (r.status === 'rejected') fail(new Error('The scan found dangerous code, so it was not published.'))
      else { toast(updating ? 'Update pushed to everyone.' : 'Published to every Luger user.'); setPick(''); setUpdating(null); list.reload() }
    } catch (e) { fail(e) } finally { setBusy(false) }
  }

  return (
    <div className="pgrid">
      <section>
        <h2 className="section" style={{ marginTop: 0 }}>Live public scripts <span className="muted">Installed for every user automatically</span></h2>
        {!list.data ? <div className="skeleton" style={{ height: 160 }} /> : list.data.macros.length === 0 ? <p className="muted">None yet.</p> : (
          <div className="stack-sm">
            {list.data.macros.map((m: any) => (
              <div key={m.id} className="take">
                <GameIcon game={games[m.universe_id]} size={34} radius={8} />
                <div className="grow" style={{ minWidth: 0 }}><b className="ellipsis" style={{ display: 'block' }}>{m.name}</b><span className="muted small">v{m.version} · {ago(m.updated_at)}{m.public ? ' · in Explore' : ''}</span></div>
                <label className="row small muted" title="Let users remove this script"><Switch label="Users can remove" on={m.allow_remove} onChange={(v) => api('admin.official.setRemovable', { id: m.id, allowRemove: v }).then(list.reload).catch(fail)} />Removable</label>
                <button className="btn sm" onClick={() => { setUpdating(m.id); setAllowRemove(m.allow_remove); setListExplore(m.public) }}><Upload size={12} />Update</button>
                <button className="btn sm icon ghost" aria-label="Take down" onClick={() => setRemoving(m)}><Trash2 size={13} /></button>
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="panel pad stack">
        <b>{updating ? `Push a new version of “${list.data?.macros.find((m: any) => m.id === updating)?.name}”` : 'Publish a public script'}</b>
        <label className="field"><span>From your macros</span>
          <select className="select input" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Choose a macro</option>
            {(mine.data ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
        <label className="spread small"><span>Users can remove it</span><Switch label="Users can remove it" on={allowRemove} onChange={setAllowRemove} /></label>
        <label className="spread small"><span>Also list it in Explore</span><Switch label="List in Explore" on={listExplore} onChange={setListExplore} /></label>
        <div className="row">
          <button className="btn primary" disabled={!pick || busy} onClick={publish}><Upload size={14} />{updating ? 'Push update' : 'Publish to everyone'}</button>
          {updating && <button className="btn ghost" onClick={() => setUpdating(null)}>Cancel</button>}
        </div>
        <p className="muted small" style={{ margin: 0 }}>Every user’s Luger picks this up within 30 minutes, or on their next launch. It is scanned like everything else.</p>
      </section>
      {removing && <Confirm title={`Take down “${removing.name}”?`} danger confirm="Take down" onClose={() => setRemoving(null)} onConfirm={async () => { await api('admin.official.remove', { id: removing.id }).catch(fail); list.reload() }}>It is removed from every user’s library at their next sync.</Confirm>}
    </div>
  )
}

// ------------------------------------------------------------------ staff
const ROLES = [
  { id: 'developer', label: 'Developer', note: 'Publishes and updates public scripts, moderates, can ban' },
  { id: 'editor', label: 'Editor', note: 'Publishes public scripts and moderates Explore' },
  { id: 'plus', label: 'Plus', note: 'Plus badge' },
  { id: 'supporter', label: 'Supporter', note: 'Heart badge for donators' }
]

function Staff() {
  const list = useAsync(() => api('admin.staff.list'), [])
  const [username, setUsername] = useState('')
  const [role, setRole] = useState('editor')
  const [busy, setBusy] = useState(false)
  const setRoleFor = async (name: string, r: string, on: boolean) => {
    try { await api('admin.staff.set', { username: name, role: r, on }); list.reload() } catch (e) { fail(e) }
  }
  return (
    <div className="pgrid">
      <section>
        <h2 className="section" style={{ marginTop: 0 }}>People with roles</h2>
        {!list.data ? <div className="skeleton" style={{ height: 140 }} /> : (
          <div className="stack-sm">
            {list.data.staff.map((u: any) => (
              <div key={u.roblox_id} className="take">
                <div className="grow"><Name user={u} /></div>
                {u.roles.includes('owner') ? <span className="chip">Owner</span> : ROLES.map((r) => (
                  <button key={r.id} className="chip" aria-pressed={u.roles.includes(r.id)} title={r.note} onClick={() => setRoleFor(u.username, r.id, !u.roles.includes(r.id))}>
                    <RoleBadge role={r.id} size={12} />{r.label}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="panel pad stack">
        <b>Give someone a role</b>
        <label className="field"><span>Roblox username</span><input className="input" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="username" /></label>
        <div className="stack-sm" role="radiogroup" aria-label="Role">
          {ROLES.map((r) => (
            <button key={r.id} role="radio" aria-checked={role === r.id} className="provider" style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }} onClick={() => setRole(r.id)}>
              <RoleBadge role={r.id} size={16} /><span><b>{r.label}</b><span className="muted small" style={{ display: 'block' }}>{r.note}</span></span>
            </button>
          ))}
        </div>
        <button className="btn primary" disabled={!username.trim() || busy} onClick={async () => { setBusy(true); try { const r = await api('admin.staff.set', { username: username.trim(), role, on: true }); toast(`@${r.username} is now ${role}.`); setUsername(''); list.reload() } catch (e) { fail(e) } finally { setBusy(false) } }}><Plus size={14} />Add role</button>
      </section>
    </div>
  )
}

// ------------------------------------------------------------------ moderation
function Moderation() {
  const list = useAsync(() => api('admin.moderation.list'), [])
  const [view, setView] = useState<any>(null)
  const act = async (body: any) => {
    try { await api('admin.moderation.resolve', body); list.reload(); setView(null) } catch (e) { fail(e) }
  }
  if (!list.data) return <div className="skeleton" style={{ height: 200 }} />
  return (
    <div className="pgrid">
      <section>
        <h2 className="section" style={{ marginTop: 0 }}>Waiting for review <span className="muted num">{list.data.held.length}</span></h2>
        {list.data.held.length === 0 ? <p className="muted">Nothing waiting.</p> : list.data.held.map((m: any) => (
          <div key={m.id} className="take" style={{ marginBottom: 6 }}>
            <div className="grow" style={{ minWidth: 0 }}><b className="ellipsis" style={{ display: 'block' }}>{m.name}</b><span className="muted small">{m.scan?.findings?.filter((f: any) => f.severity !== 'low').length ?? 0} findings · <Name user={m.author} size={12} /></span></div>
            <button className="btn sm" onClick={() => setView(m)}>Review</button>
          </div>
        ))}
      </section>
      <section>
        <h2 className="section" style={{ marginTop: 0 }}>Reports <span className="muted num">{list.data.reports.length}</span></h2>
        {list.data.reports.length === 0 ? <p className="muted">No open reports.</p> : list.data.reports.map((r: any) => (
          <div key={r.id} className="take" style={{ marginBottom: 6, alignItems: 'flex-start' }}>
            <div className="grow" style={{ minWidth: 0 }}>
              <b>{r.target_kind} · <span className="mono">{String(r.target_id).slice(0, 12)}</span></b>
              <p className="small" style={{ margin: '2px 0' }}>{r.reason}</p>
              <span className="muted small">{ago(r.created_at)}{r.reporterUser ? ` · by @${r.reporterUser.username}` : ''}</span>
            </div>
            <button className="btn sm danger" onClick={() => act({ kind: 'report', id: r.id, action: 'remove' })}>Remove it</button>
            <button className="btn sm ghost" onClick={() => act({ kind: 'report', id: r.id, action: 'dismiss' })}><X size={13} /></button>
          </div>
        ))}
      </section>
      {view && (
        <Modal wide title={view.name} onClose={() => setView(null)} foot={<>
          <button className="btn danger" onClick={() => act({ kind: 'macro', id: view.id, action: 'remove' })}><Trash2 size={14} />Reject</button>
          <button className="btn primary" onClick={() => act({ kind: 'macro', id: view.id, action: 'approve' })}><Check size={14} />Approve</button>
        </>}>
          <ul className="scan-list" style={{ marginTop: 0 }}>{view.scan?.findings?.map((f: any, i: number) => <li key={i}><span className="mono muted">line {f.line}</span> [{f.severity}] {f.message}</li>)}</ul>
          <pre className="codeview" style={{ marginTop: 12 }}>{view.source}</pre>
        </Modal>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ free key settings
function CheckpointSettings() {
  const st = useAsync(() => api('admin.settings.get'), [])
  const [cfg, setCfg] = useState<any>(null)
  useEffect(() => { if (st.data) setCfg(st.data.settings.checkpoint) }, [st.data])
  if (!cfg) return <div className="skeleton" style={{ height: 200 }} />
  const toggle = (p: string) => setCfg({ ...cfg, providers: cfg.providers.includes(p) ? cfg.providers.filter((x: string) => x !== p) : [...cfg.providers, p] })
  return (
    <div className="panel pad stack" style={{ maxWidth: 620 }}>
      <b>Free keys from ad checkpoints</b>
      <div className="formgrid">
        <label className="field"><span>Checkpoints per key</span><input className="input num" type="number" min={1} max={5} value={cfg.steps} onChange={(e) => setCfg({ ...cfg, steps: Number(e.target.value) })} /></label>
        <label className="field"><span>Free key lasts (hours)</span><input className="input num" type="number" min={1} max={720} value={cfg.ad_key_hours} onChange={(e) => setCfg({ ...cfg, ad_key_hours: Number(e.target.value) })} /></label>
        <label className="field"><span>Devices per free key</span><input className="input num" type="number" min={1} max={10} value={cfg.ad_key_devices} onChange={(e) => setCfg({ ...cfg, ad_key_devices: Number(e.target.value) })} /></label>
        <label className="field"><span>Minimum seconds on each ad page</span><input className="input num" type="number" min={5} max={300} value={cfg.min_seconds} onChange={(e) => setCfg({ ...cfg, min_seconds: Number(e.target.value) })} /></label>
      </div>
      <div className="field"><span>Ad networks offered</span>
        <div className="row">{['lootlabs', 'linkvertise', 'workink'].map((p) => <button key={p} className="chip" aria-pressed={cfg.providers.includes(p)} onClick={() => toggle(p)}>{{ lootlabs: 'LootLabs', linkvertise: 'Linkvertise', workink: 'Work.ink' }[p]}</button>)}</div>
      </div>
      <div><button className="btn primary" onClick={() => api('admin.settings.set', { key: 'checkpoint', value: cfg }).then(() => toast('Saved. New checkpoints use these settings.')).catch(fail)}>Save</button></div>
    </div>
  )
}
