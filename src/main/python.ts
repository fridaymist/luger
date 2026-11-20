// Runs Luger's Python: one-shot tools (convert, scan, binds) and long-lived macro and
// app processes that talk JSON lines over stdin/stdout.
import { app } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

function pythonDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'python') : join(app.getAppPath(), 'python')
}

export function interpreter(): { cmd: string; args: string[] } {
  if (app.isPackaged) {
    const rt = join(process.resourcesPath, 'runtime')
    const cmd = process.platform === 'win32' ? join(rt, 'python', 'python.exe') : join(rt, 'python', 'bin', 'python3')
    if (existsSync(cmd)) return { cmd, args: ['-I'] }
  }
  // Development: use the system interpreter (with the user's site-packages for pynput/mss).
  return { cmd: process.platform === 'win32' ? 'python' : 'python3', args: [] }
}

function env(): NodeJS.ProcessEnv {
  const keep = ['PATH', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'DISPLAY',
    'WAYLAND_DISPLAY', 'XAUTHORITY', 'XDG_RUNTIME_DIR', 'XDG_SESSION_TYPE', 'LANG', 'LC_ALL']
  const out: NodeJS.ProcessEnv = { PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1', PYTHONDONTWRITEBYTECODE: '1' }
  for (const k of keep) if (process.env[k]) out[k] = process.env[k]
  return out
}

function spawnEntry(mode: string, extra: string[]): ChildProcessWithoutNullStreams {
  const { cmd, args } = interpreter()
  return spawn(cmd, [...args, join(pythonDir(), 'luger_entry.py'), mode, ...extra], {
    cwd: pythonDir(),
    env: env(),
    windowsHide: true
  })
}

export function pythonAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const { cmd } = interpreter()
    const p = spawn(cmd, ['--version'], { windowsHide: true })
    p.on('error', () => resolve(false))
    p.on('exit', (code) => resolve(code === 0))
  })
}

export function tool<T = any>(command: string, payload: Record<string, unknown>, timeoutMs = 30_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const p = spawnEntry('tool', [command])
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      p.kill()
      reject(new Error('The Python tool took too long.'))
    }, timeoutMs)
    p.stdout.on('data', (d) => (out += d))
    p.stderr.on('data', (d) => (err += d))
    p.on('error', () => {
      clearTimeout(timer)
      reject(new Error('Python could not start. Reinstall Luger, or install Python 3 when running from source.'))
    })
    p.on('exit', () => {
      clearTimeout(timer)
      try {
        const data = JSON.parse(out)
        if (data.error) reject(new Error(data.error))
        else resolve(data)
      } catch {
        reject(new Error(err.trim().split('\n').pop() || 'The Python tool failed.'))
      }
    })
    p.stdin.end(JSON.stringify(payload))
  })
}

export type Listener = (msg: any) => void

export class Worker {
  private proc: ChildProcessWithoutNullStreams
  private buf = ''
  alive = true

  constructor(mode: 'run' | 'app', args: string[], private onMessage: Listener, private onExit: (code: number | null) => void, first?: object) {
    this.proc = spawnEntry(mode, args)
    this.proc.stdout.on('data', (d) => this.read(String(d)))
    this.proc.stderr.on('data', (d) => this.onMessage({ type: 'log', level: 'error', text: String(d).trim() }))
    this.proc.on('error', () => {
      this.onMessage({ type: 'log', level: 'error', text: 'Python could not start.' })
    })
    this.proc.on('exit', (code) => {
      this.alive = false
      this.onExit(code)
    })
    if (first) this.send(first)
  }

  private read(chunk: string): void {
    this.buf += chunk
    let i: number
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim()
      this.buf = this.buf.slice(i + 1)
      if (!line) continue
      try {
        this.onMessage(JSON.parse(line))
      } catch {
        this.onMessage({ type: 'log', level: 'info', text: line })
      }
    }
  }

  send(msg: object): void {
    if (this.alive) this.proc.stdin.write(JSON.stringify(msg) + '\n')
  }

  stop(): void {
    if (!this.alive) return
    this.send({ type: 'stop' })
    this.proc.stdin.end()
    setTimeout(() => this.alive && this.proc.kill(), 1500)
  }
}
