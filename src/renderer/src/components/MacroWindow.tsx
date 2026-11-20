// Draws a macro's own window (declared with luger.ui) using Luger's components and theme.
import { Pause, Play, Square } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { invoke } from '../lib/bridge'
import { setLocalValue, useRuntime } from '../lib/runtime'
import { fail, useStore } from '../lib/state'
import { KeyInput, prettyKey, Switch } from './ui'

export default function MacroWindow({ id, name }: { id: string; name: string }) {
  const rt = useRuntime(id)
  const running = useStore((s) => s.running.includes(id))
  const logRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [rt?.logs.length])

  const send = (controlId: string, value: unknown) => {
    setLocalValue(id, controlId, value)
    invoke('macros:uiEvent', id, controlId, value).catch(fail)
  }
  const win = rt?.window
  return (
    <section className="mwin panel" aria-label={`${name} window`}>
      <header className="mwin-head">
        <span className={`dot ${running ? (rt?.paused ? 'paused' : 'on') : ''}`} aria-hidden />
        <div className="grow" style={{ minWidth: 0 }}>
          <b className="ellipsis" style={{ display: 'block' }}>{win?.title ?? name}</b>
          <span className="muted small">{running ? (rt?.paused ? 'Paused' : rt?.suspended ? 'Hotkeys off' : 'Running') : rt?.exitCode ? 'Stopped with an error' : 'Stopped'}</span>
        </div>
        {running && <button className="btn icon sm" aria-label={rt?.paused ? 'Resume' : 'Pause'} onClick={() => invoke('macros:pause', id)}>{rt?.paused ? <Play size={14} /> : <Pause size={14} />}</button>}
        {running
          ? <button className="btn sm danger" onClick={() => invoke('macros:stop', id)}><Square size={12} fill="currentColor" />Stop</button>
          : <button className="btn sm primary" onClick={() => invoke('macros:run', id).catch(fail)}><Play size={12} fill="currentColor" />Run</button>}
      </header>
      {win?.description && <p className="muted small mwin-desc">{win.description}</p>}
      {(rt?.status || win?.status) && <div className="mwin-status">{rt?.status ?? win?.status}</div>}
      {!!win?.controls.length && (
        <div className="mwin-controls">
          {win.controls.map((c) => <Control key={c.id} c={c} send={send} disabled={!running} />)}
        </div>
      )}
      {!!rt?.hotkeys.length && <div className="row small muted" style={{ flexWrap: 'wrap', padding: '0 14px 10px' }}>Hotkeys {rt.hotkeys.map((h) => <span key={h} className="keycap">{prettyKey(h)}</span>)}</div>}
      <div className="mwin-log" ref={logRef} role="log" aria-label="Macro output">
        {rt?.logs.length ? rt.logs.map((l, i) => <div key={i} className={l.level === 'error' ? 'err' : ''}>{l.text}</div>) : <div className="muted">{running ? 'No output yet.' : 'Run the macro to see its output here.'}</div>}
      </div>
    </section>
  )
}

function Control({ c, send, disabled }: { c: any; send: (id: string, v: unknown) => void; disabled: boolean }) {
  switch (c.kind) {
    case 'label':
      return <p className="mwin-label">{c.label}</p>
    case 'button':
      return <button className={`btn ${c.style === 'primary' ? 'primary' : ''}`} disabled={disabled} onClick={() => send(c.id, true)}>{c.label}</button>
    case 'toggle':
      return <label className="mwin-row"><span>{c.label}</span><Switch label={c.label} on={!!c.value} onChange={(v) => send(c.id, v)} /></label>
    case 'slider':
      return (
        <label className="mwin-row col">
          <span className="spread"><span>{c.label}</span><span className="num muted">{c.value}{c.unit}</span></span>
          <input type="range" min={c.min} max={c.max} step={c.step} value={c.value} onChange={(e) => send(c.id, Number(e.target.value))} />
        </label>
      )
    case 'number':
      return (
        <label className="mwin-row"><span>{c.label}</span>
          <span className="row"><input className="input num" style={{ width: 90 }} type="number" min={c.min ?? undefined} max={c.max ?? undefined} step={c.step} value={c.value} onChange={(e) => send(c.id, Number(e.target.value))} />{c.unit && <span className="muted small">{c.unit}</span>}</span>
        </label>
      )
    case 'keybind':
      return <label className="mwin-row"><span>{c.label}</span><KeyInput label={c.label} value={c.value} onChange={(k) => send(c.id, k)} /></label>
    case 'select':
      return (
        <label className="mwin-row"><span>{c.label}</span>
          <select className="select input" style={{ width: 160 }} value={String(c.value)} onChange={(e) => send(c.id, c.options.find((o: any) => String(o[1]) === e.target.value)?.[1])}>
            {c.options.map((o: any) => <option key={String(o[1])} value={String(o[1])}>{o[0]}</option>)}
          </select>
        </label>
      )
    case 'text':
      return <label className="mwin-row col"><span>{c.label}</span><input className="input" value={c.value ?? ''} onChange={(e) => send(c.id, e.target.value)} /></label>
    default:
      return null
  }
}
