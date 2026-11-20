// Live state of running macros: their window (luger.ui), log and status.
import { useSyncExternalStore } from 'react'
import { on } from './bridge'

export interface Runtime {
  window: { title: string | null; description: string | null; status: string | null; controls: any[] } | null
  logs: { level: string; text: string; at: number }[]
  status: string | null
  paused: boolean
  suspended: boolean
  hotkeys: string[]
  exitCode: number | null
}

const runtimes = new Map<string, Runtime>()
const subs = new Set<() => void>()
let version = 0
const emit = () => {
  version++
  subs.forEach((f) => f())
}

function rt(id: string): Runtime {
  let r = runtimes.get(id)
  if (!r) {
    r = { window: null, logs: [], status: null, paused: false, suspended: false, hotkeys: [], exitCode: null }
    runtimes.set(id, r)
  }
  return r
}

let started = false
export function startRuntimeListener(): void {
  if (started) return
  started = true
  on('macro:event', ({ id, msg }) => {
    const r = { ...rt(id) }
    switch (msg.type) {
      case 'ui':
        r.window = msg.window
        break
      case 'ui_value':
        if (r.window) r.window = { ...r.window, controls: r.window.controls.map((c) => (c.id === msg.id ? { ...c, value: msg.value } : c)) }
        break
      case 'ui_status':
        r.status = msg.text
        break
      case 'log':
        r.logs = [...r.logs.slice(-199), { level: msg.level, text: msg.text, at: Date.now() }]
        break
      case 'state':
        if ('running' in msg && msg.running) { r.exitCode = null; r.logs = []; r.hotkeys = [] }
        if ('paused' in msg) r.paused = msg.paused
        if ('suspended' in msg) r.suspended = msg.suspended
        break
      case 'hotkey':
        r.hotkeys = [...new Set([...r.hotkeys, msg.combo])]
        break
      case 'exit':
        r.exitCode = msg.code
        r.paused = false
        break
    }
    runtimes.set(id, r)
    emit()
  })
}

export function useRuntime(id: string | null): Runtime | null {
  useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => version)
  return id ? runtimes.get(id) ?? null : null
}

export function setLocalValue(id: string, controlId: string, value: unknown): void {
  const r = runtimes.get(id)
  if (!r?.window) return
  runtimes.set(id, { ...r, window: { ...r.window, controls: r.window.controls.map((c) => (c.id === controlId ? { ...c, value } : c)) } })
  emit()
}
