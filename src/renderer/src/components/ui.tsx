import { X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useStore } from '../lib/state'

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button className="switch" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: ReactNode; title?: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} aria-pressed={value === o.value} title={o.title} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  )
}

export function Modal({ title, onClose, children, foot, wide, icon }: { title: ReactNode; onClose: () => void; children: ReactNode; foot?: ReactNode; wide?: boolean; icon?: ReactNode }) {
  useEscape(onClose)
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <div className="modal-head">{icon}<h3>{title}</h3><button className="btn ghost icon sm" onClick={onClose} aria-label="Close"><X size={16} /></button></div>
        <div className="modal-body">{children}</div>
        {foot && <div className="modal-foot">{foot}</div>}
      </div>
    </div>
  )
}

export function Drawer({ title, onClose, children, foot }: { title: ReactNode; onClose: () => void; children: ReactNode; foot?: ReactNode }) {
  useEscape(onClose)
  return (
    <>
      <div className="scrim" style={{ background: 'rgba(6,7,9,.35)' }} onMouseDown={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true">
        <div className="modal-head" style={{ paddingTop: 44 }}><h3>{title}</h3><button className="btn ghost icon sm" onClick={onClose} aria-label="Close"><X size={16} /></button></div>
        <div className="modal-body">{children}</div>
        {foot && <div className="modal-foot" style={{ paddingTop: 14, borderTop: '1px solid var(--line)' }}>{foot}</div>}
      </aside>
    </>
  )
}

export function useEscape(fn: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && fn()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [fn])
}

export function Empty({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="empty">{icon}<h3>{title}</h3>{children && <p>{children}</p>}{action}</div>
}

const KEY_NAMES: Record<string, string> = {
  ' ': 'space', Enter: 'enter', Escape: 'esc', Tab: 'tab', Backspace: 'backspace', Delete: 'delete', Insert: 'insert',
  Home: 'home', End: 'end', PageUp: 'page_up', PageDown: 'page_down', ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left',
  ArrowRight: 'right', CapsLock: 'caps_lock', Shift: 'shift', Control: 'ctrl', Alt: 'alt', Meta: 'cmd'
}

export function keyFromEvent(e: KeyboardEvent): string | null {
  let k = KEY_NAMES[e.key] ?? e.key
  if (/^F\d{1,2}$/.test(e.key)) k = e.key.toLowerCase()
  if (e.code.startsWith('Numpad') && /^\d$/.test(e.key)) k = `numpad${e.key}`
  if (k.length === 1) k = k.toLowerCase()
  if (['shift', 'ctrl', 'alt', 'cmd'].includes(k)) return null
  const mods = [e.ctrlKey && 'ctrl', e.altKey && 'alt', e.shiftKey && k.length > 1 && 'shift', e.metaKey && 'cmd'].filter(Boolean)
  return [...mods, k].join('+')
}

export function prettyKey(k: string): string {
  return k.split('+').map((p) => ({ mouse1: 'Left click', mouse2: 'Right click', mouse3: 'Middle click', mouse4: 'Mouse 4', mouse5: 'Mouse 5', space: 'Space', page_up: 'PgUp', page_down: 'PgDn', caps_lock: 'Caps', cmd: process_cmd() } as Record<string, string>)[p] ?? (p.length === 1 ? p.toUpperCase() : p.charAt(0).toUpperCase() + p.slice(1))).join(' + ')
}
function process_cmd() {
  return window.luger.platform === 'darwin' ? '⌘' : 'Win'
}

/** Click, then press a key (or click a mouse button) to set a bind. */
export function KeyInput({ value, onChange, allowMouse = true, label }: { value: string; onChange: (k: string) => void; allowMouse?: boolean; label: string }) {
  const [listening, setListening] = useState(false)
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!listening) return
    const key = (e: KeyboardEvent) => {
      e.preventDefault()
      if (e.key === 'Escape') return setListening(false)
      const k = keyFromEvent(e)
      if (k) {
        onChange(k)
        setListening(false)
      }
    }
    const mouse = (e: MouseEvent) => {
      if (!allowMouse || e.target === ref.current) return
      e.preventDefault()
      onChange(['mouse1', 'mouse3', 'mouse2', 'mouse4', 'mouse5'][e.button] ?? 'mouse1')
      setListening(false)
    }
    window.addEventListener('keydown', key, true)
    const t = setTimeout(() => window.addEventListener('mousedown', mouse, true), 50)
    return () => {
      clearTimeout(t)
      window.removeEventListener('keydown', key, true)
      window.removeEventListener('mousedown', mouse, true)
    }
  }, [listening, allowMouse, onChange])
  return (
    <button ref={ref} className={`keycap${listening ? ' listening' : ''}`} aria-label={`${label}: ${prettyKey(value)}. Click to change.`} onClick={() => setListening((l) => !l)}>
      {listening ? 'Press a key' : prettyKey(value)}
    </button>
  )
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts)
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <div>{t.title && <b>{t.title}</b>}<span className={t.title ? 'muted' : ''}>{t.text}</span></div>
        </div>
      ))}
    </div>
  )
}

export function Confirm({ title, children, confirm, danger, onConfirm, onClose }: { title: string; children: ReactNode; confirm: string; danger?: boolean; onConfirm: () => void | Promise<void>; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  return (
    <Modal title={title} onClose={onClose} foot={<>
      <button className="btn ghost" onClick={onClose}>Cancel</button>
      <button className={`btn ${danger ? 'danger solid' : 'primary'}`} disabled={busy} onClick={async () => { setBusy(true); try { await onConfirm(); onClose() } finally { setBusy(false) } }}>{confirm}</button>
    </>}>
      <div className="muted">{children}</div>
    </Modal>
  )
}

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | null; loading: boolean; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [n, setN] = useState(0)
  useEffect(() => {
    let live = true
    setLoading(true)
    fn().then((d) => live && (setData(d), setError(null))).catch((e) => live && setError(e.message)).finally(() => live && setLoading(false))
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, n])
  return { data, loading, error, reload: () => setN((x) => x + 1) }
}

export function Menu({ items, onClose, style }: { items: { label: string; icon?: ReactNode; danger?: boolean; onClick: () => void }[]; onClose: () => void; style?: React.CSSProperties }) {
  useEscape(onClose)
  useEffect(() => {
    const h = () => onClose()
    const t = setTimeout(() => window.addEventListener('mousedown', h), 0)
    return () => { clearTimeout(t); window.removeEventListener('mousedown', h) }
  }, [onClose])
  return (
    <div className="menu" role="menu" style={style} onMouseDown={(e) => e.stopPropagation()}>
      {items.map((i) => <button key={i.label} role="menuitem" className={i.danger ? 'danger' : ''} onClick={() => { onClose(); i.onClick() }}>{i.icon}{i.label}</button>)}
    </div>
  )
}
