// Discord Rich Presence over Discord's local IPC socket ("Playing Fisch with Luger").
// Needs a Discord application id in luger.config.json (discordAppId); off when missing.
import { connect, type Socket } from 'node:net'
import { join } from 'node:path'
import config from '../../luger.config.json'

let sock: Socket | null = null
let ready = false

function pipePath(i: number): string {
  if (process.platform === 'win32') return `\\\\?\\pipe\\discord-ipc-${i}`
  const base = process.env.XDG_RUNTIME_DIR ?? process.env.TMPDIR ?? process.env.TMP ?? '/tmp'
  return join(base, `discord-ipc-${i}`)
}

function frame(op: number, data: object): Buffer {
  const json = Buffer.from(JSON.stringify(data))
  const head = Buffer.alloc(8)
  head.writeInt32LE(op, 0)
  head.writeInt32LE(json.length, 4)
  return Buffer.concat([head, json])
}

function open(i = 0): Promise<void> {
  const appId = (config as any).discordAppId
  if (!appId) return Promise.resolve()
  return new Promise((resolve) => {
    if (i > 9) return resolve()
    const s = connect(pipePath(i))
    s.once('error', () => open(i + 1).then(resolve))
    s.once('connect', () => {
      sock = s
      s.write(frame(0, { v: 1, client_id: appId }))
      s.on('data', () => (ready = true))
      s.on('close', () => {
        sock = null
        ready = false
      })
      resolve()
    })
  })
}

export async function setPresence(activity: { details: string; state?: string; start?: number } | null): Promise<void> {
  if (!sock) await open()
  if (!sock) return
  if (!ready) await new Promise((r) => setTimeout(r, 400))
  sock.write(frame(1, {
    cmd: 'SET_ACTIVITY',
    nonce: String(Date.now()),
    args: {
      pid: process.pid,
      activity: activity && {
        details: activity.details,
        state: activity.state,
        timestamps: activity.start ? { start: Math.floor(activity.start / 1000) } : undefined,
        assets: { large_image: 'luger', large_text: 'Luger' }
      }
    }
  }))
}

export function closePresence(): void {
  sock?.destroy()
  sock = null
}
