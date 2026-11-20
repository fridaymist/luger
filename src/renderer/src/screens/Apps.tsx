import { ArrowLeft, Circle, Download, FileCode2, MousePointerClick, Play, Square, Trash2, Video } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Confirm, KeyInput, prettyKey, Seg, Switch } from '../components/ui'
import { invoke, on } from '../lib/bridge'
import { ago } from '../lib/format'
import { fail, go, toast } from '../lib/state'

const APPS = [
  { id: 'autoclicker', name: 'Auto Clicker', icon: MousePointerClick, blurb: 'Clicks for you at a set speed, at the cursor or a fixed spot. Start and stop with one key.' },
  { id: 'recorder', name: 'Recorder', icon: Video, blurb: 'Records your mouse and keyboard and plays it back, looped and at any speed. Turn takes into macros.' }
]

export default function Apps() {
  const [state, setState] = useState<{ installed: string[]; running: string[]; config: any } | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [remove, setRemove] = useState<string | null>(null)
  const reload = useCallback(() => invoke('apps:list').then(setState), [])
  useEffect(() => {
    reload()
    return on('app:event', (e) => e.msg.type === 'exit' && reload())
  }, [reload])

  if (open) {
    const a = APPS.find((x) => x.id === open)!
    return (
      <>
        <header className="topbar drag">
          <button className="btn ghost icon nodrag" aria-label="Back to apps" onClick={() => { invoke('apps:stop', open); setOpen(null); reload() }}><ArrowLeft size={17} /></button>
          <h1>{a.name}</h1>
        </header>
        <div className="page">
          {open === 'autoclicker' ? <AutoClicker config={state?.config?.autoclicker} /> : <Recorder config={state?.config?.recorder} />}
        </div>
      </>
    )
  }

  return (
    <>
      <header className="topbar drag"><h1>Apps</h1><span className="sub">Luger’s own tools. Each runs on its own, with its own hotkeys.</span></header>
      <div className="page page-narrow">
        <div className="apps">
          {APPS.map((a) => {
            const installed = state?.installed.includes(a.id)
            return (
              <article key={a.id} className="app-card panel">
                <div className={`app-glyph ${a.id}`}><a.icon size={30} strokeWidth={1.6} /></div>
                <div className="grow">
                  <h3>{a.name}</h3>
                  <p className="muted">{a.blurb}</p>
                </div>
                <div className="app-actions">
                  {installed ? (
                    <>
                      <button className="btn primary" onClick={async () => { try { await invoke('apps:start', a.id); setOpen(a.id) } catch (e) { fail(e) } }}><Play size={14} fill="currentColor" />Run</button>
                      <button className="btn ghost sm" onClick={() => setRemove(a.id)}>Uninstall</button>
                    </>
                  ) : (
                    <button className="btn" onClick={async () => { await invoke('apps:install', a.id); toast(`${a.name} installed.`); reload() }}><Download size={14} />Install</button>
                  )}
                </div>
              </article>
            )
          })}
        </div>
        <p className="muted small" style={{ marginTop: 18 }}>Apps send real keyboard and mouse input. On macOS, allow Luger under System Settings → Privacy & Security → Accessibility the first time.</p>
      </div>
      {remove && <Confirm title="Uninstall this app?" confirm="Uninstall" onClose={() => setRemove(null)} onConfirm={async () => { await invoke('apps:uninstall', remove); reload() }}>Your settings for it are kept, so reinstalling picks up where you left off.</Confirm>}
    </>
  )
}

function useApp(name: string) {
  const [msg, setMsg] = useState<any>({})
  useEffect(() => on('app:event', (e) => e.name === name && setMsg((m: any) => ({ ...m, [e.msg.type]: e.msg }))), [name])
  return msg
}

// ------------------------------------------------------------------ auto clicker
const CLICKER_DEFAULTS = { mode: 'cps', interval_ms: 100, cps: 10, button: 'mouse1', double: false, position: 'cursor', x: 0, y: 0, limit: 0, jitter_ms: 0, hotkey: 'f6' }

function AutoClicker({ config }: { config?: any }) {
  const [cfg, setCfg] = useState({ ...CLICKER_DEFAULTS, ...(config ?? {}) })
  const live = useApp('autoclicker').clicker
  const set = (patch: Partial<typeof cfg>) => {
    const next = { ...cfg, ...patch }
    setCfg(next)
    invoke('apps:send', 'autoclicker', { type: 'config', ...next })
  }
  useEffect(() => {
    invoke('apps:send', 'autoclicker', { type: 'config', ...cfg })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const running = !!live?.running
  const rate = cfg.mode === 'cps' ? cfg.cps : 1000 / Math.max(1, cfg.interval_ms)

  return (
    <div className="tool">
      <section className="tool-main panel">
        <div className="clicker-dial">
          <span className={`dial-ring${running ? ' on' : ''}`} aria-hidden />
          <div>
            <div className="dial-num num">{cfg.mode === 'cps' ? cfg.cps : cfg.interval_ms}</div>
            <div className="muted small">{cfg.mode === 'cps' ? 'clicks a second' : 'ms between clicks'}</div>
          </div>
        </div>
        <Seg label="Speed by" value={cfg.mode} onChange={(v) => set({ mode: v })} options={[{ value: 'cps', label: 'Clicks per second' }, { value: 'interval', label: 'Interval' }]} />
        {cfg.mode === 'cps'
          ? <input type="range" min={1} max={50} value={cfg.cps} onChange={(e) => set({ cps: Number(e.target.value) })} aria-label="Clicks per second" />
          : <input type="range" min={10} max={5000} step={10} value={cfg.interval_ms} onChange={(e) => set({ interval_ms: Number(e.target.value) })} aria-label="Interval" />}
        <button className={`btn lg ${running ? 'danger solid' : 'primary'}`} style={{ width: '100%' }} onClick={() => invoke('apps:send', 'autoclicker', { type: 'toggle' })}>
          {running ? <><Square size={15} fill="currentColor" />Stop</> : <><Play size={15} fill="currentColor" />Start</>}
          <span className="keycap" style={{ marginLeft: 6 }}>{prettyKey(cfg.hotkey)}</span>
        </button>
        <div className="spread small"><span className="muted">{running ? 'Clicking' : 'Idle'}</span><span className="num">{(live?.clicks ?? 0).toLocaleString()} clicks · ~{rate.toFixed(rate < 10 ? 1 : 0)}/s</span></div>
      </section>

      <section className="tool-side stack">
        <div className="setting-line"><span>Start and stop with</span><KeyInput label="Toggle key" value={cfg.hotkey} allowMouse={false} onChange={(k) => set({ hotkey: k })} /></div>
        <div className="setting-line"><span>Button</span><Seg label="Mouse button" value={cfg.button} onChange={(v) => set({ button: v })} options={[{ value: 'mouse1', label: 'Left' }, { value: 'mouse2', label: 'Right' }, { value: 'mouse3', label: 'Middle' }]} /></div>
        <div className="setting-line"><span>Double click</span><Switch label="Double click" on={cfg.double} onChange={(v) => set({ double: v })} /></div>
        <div className="setting-line"><span>Click at</span><Seg label="Position" value={cfg.position} onChange={(v) => set({ position: v })} options={[{ value: 'cursor', label: 'Cursor' }, { value: 'fixed', label: 'Fixed spot' }]} /></div>
        {cfg.position === 'fixed' && (
          <div className="setting-line"><span>Spot</span>
            <span className="row"><label className="row small">X<input className="input num" style={{ width: 80 }} type="number" value={cfg.x} onChange={(e) => set({ x: Number(e.target.value) })} /></label>
              <label className="row small">Y<input className="input num" style={{ width: 80 }} type="number" value={cfg.y} onChange={(e) => set({ y: Number(e.target.value) })} /></label></span>
          </div>
        )}
        <div className="setting-line"><span>Stop after</span><span className="row"><input className="input num" style={{ width: 90 }} type="number" min={0} value={cfg.limit} onChange={(e) => set({ limit: Math.max(0, Number(e.target.value)) })} /><span className="muted small">clicks (0 = never)</span></span></div>
        <div className="setting-line"><span>Random timing</span><span className="row"><input className="input num" style={{ width: 90 }} type="number" min={0} max={500} value={cfg.jitter_ms} onChange={(e) => set({ jitter_ms: Math.max(0, Number(e.target.value)) })} /><span className="muted small">± ms</span></span></div>
      </section>
    </div>
  )
}

// ------------------------------------------------------------------ recorder
function Recorder({ config }: { config?: any }) {
  const ev = useApp('recorder')
  const [hotkeys, setHotkeys] = useState({ record: 'f9', play: 'f10', ...(config?.hotkeys ?? {}) })
  const [speed, setSpeed] = useState(1)
  const [loops, setLoops] = useState(1)
  const [takes, setTakes] = useState<any[]>([])
  const [current, setCurrent] = useState<{ events: any[]; name: string } | null>(null)
  const [del, setDel] = useState<string | null>(null)
  const mode = ev.recorder?.state ?? 'idle'
  const reload = () => invoke('recordings:list').then(setTakes)
  useEffect(() => { reload() }, [])
  useEffect(() => {
    if (ev.recording?.events?.length) setCurrent({ events: ev.recording.events, name: `Take ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` })
  }, [ev.recording])
  const setKeys = (next: typeof hotkeys) => {
    setHotkeys(next)
    invoke('apps:send', 'recorder', { type: 'hotkeys', hotkeys: next })
  }
  const duration = current?.events.at(-1)?.[0] ?? 0

  return (
    <div className="tool">
      <section className="tool-main panel">
        <div className={`rec-state ${mode}`}>
          <span className="rec-dot" aria-hidden />
          <b>{{ idle: current ? 'Take ready' : 'Ready to record', recording: 'Recording', playing: `Playing${ev.recorder?.loop ? `, loop ${ev.recorder.loop}` : ''}` }[mode as string]}</b>
          <span className="muted small num">{mode === 'recording' ? `${ev.recorder?.count ?? 0} inputs` : current ? `${current.events.length} inputs · ${duration.toFixed(1)}s` : ''}</span>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {mode === 'recording'
            ? <button className="btn lg danger solid grow" onClick={() => invoke('apps:send', 'recorder', { type: 'stop' })}><Square size={15} fill="currentColor" />Stop recording</button>
            : <button className="btn lg grow" disabled={mode === 'playing'} onClick={() => invoke('apps:send', 'recorder', { type: 'record' })}><Circle size={14} fill="var(--bad)" color="var(--bad)" />Record<span className="keycap">{prettyKey(hotkeys.record)}</span></button>}
          {mode === 'playing'
            ? <button className="btn lg danger grow" onClick={() => invoke('apps:send', 'recorder', { type: 'stop' })}><Square size={15} />Stop</button>
            : <button className="btn lg primary grow" disabled={!current || mode === 'recording'} onClick={() => invoke('apps:send', 'recorder', { type: 'play', events: current!.events, speed, loops })}><Play size={15} fill="currentColor" />Play<span className="keycap">{prettyKey(hotkeys.play)}</span></button>}
        </div>
        <div className="setting-line"><span>Speed</span><span className="row" style={{ width: 220 }}><input type="range" min={0.25} max={4} step={0.25} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Playback speed" /><span className="num small" style={{ width: 40 }}>{speed}x</span></span></div>
        <div className="setting-line"><span>Repeat</span><span className="row"><input className="input num" type="number" min={0} style={{ width: 80 }} value={loops} onChange={(e) => setLoops(Math.max(0, Number(e.target.value)))} /><span className="muted small">times (0 = until stopped)</span></span></div>
        {current && mode === 'idle' && (
          <div className="row">
            <input className="input" value={current.name} onChange={(e) => setCurrent({ ...current, name: e.target.value })} aria-label="Take name" />
            <button className="btn" onClick={async () => { await invoke('recordings:save', current.name, current.events); toast('Take saved.'); reload() }}>Save take</button>
          </div>
        )}
        <div className="setting-line small muted"><span>Record key</span><KeyInput label="Record key" allowMouse={false} value={hotkeys.record} onChange={(k) => setKeys({ ...hotkeys, record: k })} /></div>
        <div className="setting-line small muted"><span>Play key</span><KeyInput label="Play key" allowMouse={false} value={hotkeys.play} onChange={(k) => setKeys({ ...hotkeys, play: k })} /></div>
      </section>

      <section className="tool-side">
        <h2 className="section" style={{ marginTop: 0 }}>Saved takes</h2>
        {takes.length === 0 ? <p className="muted small">Takes you save appear here. Turn one into a macro to edit its timing, rebind keys or launch it with a game.</p> : (
          <div className="stack-sm">
            {takes.map((t) => (
              <div key={t.id} className="take">
                <div className="grow" style={{ minWidth: 0 }}><b className="ellipsis" style={{ display: 'block' }}>{t.name}</b><span className="muted small num">{t.events} inputs · {t.duration.toFixed(1)}s · {ago(t.created)}</span></div>
                <button className="btn sm icon" aria-label="Load take" title="Load" onClick={async () => { const r = await invoke('recordings:load', t.id); setCurrent({ events: r.events, name: r.name }) }}><Play size={13} /></button>
                <button className="btn sm icon" aria-label="Make a macro" title="Make a macro" onClick={async () => { try { await invoke('recordings:toMacro', t.id); toast(`${t.name} is now a macro.`); go('macros') } catch (e) { fail(e) } }}><FileCode2 size={13} /></button>
                <button className="btn sm icon ghost" aria-label="Delete take" onClick={() => setDel(t.id)}><Trash2 size={13} /></button>
              </div>
            ))}
          </div>
        )}
      </section>
      {del && <Confirm title="Delete this take?" confirm="Delete" danger onClose={() => setDel(null)} onConfirm={async () => { await invoke('recordings:remove', del); reload() }}>This cannot be undone.</Confirm>}
    </div>
  )
}
