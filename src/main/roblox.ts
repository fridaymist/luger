// Everything Luger does with the local Roblox install: find the signed-in user from the
// log files, measure playtime per game, launch games and write allowed FastFlags.
// Luger never reads Roblox's login cookie and never touches the running client.
import { powerMonitor, shell } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { play, settings, state } from './store'

const JOIN = /! Joining game '[0-9a-f-]+' place (\d+) at/
const LEAVE = /(Time to disconnect replication data|leaveUGCGameInternal|Client:Disconnect|NetworkClient:Remove|setStage: \(stage:None\))/
const USER = /(?:userid:|"UserId":|userId[ =:]+|\buserid=)\s*(\d{3,})/i
const TS = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)/

export function logDirs(): string[] {
  const custom = settings.get('robloxLogDir')
  const home = homedir()
  const dirs = custom ? [custom] : []
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local')
    dirs.push(join(local, 'Roblox', 'logs'))
  } else if (process.platform === 'darwin') {
    dirs.push(join(home, 'Library', 'Logs', 'Roblox'))
  } else {
    const sober = join(home, '.var', 'app', 'org.vinegarhq.Sober')
    dirs.push(join(sober, 'data', 'sober', 'appData', 'logs'), join(sober, 'data', 'sober', 'logs'), join(sober, 'cache', 'sober', 'logs'))
  }
  return dirs.filter((d) => existsSync(d))
}

function logFiles(): { path: string; mtime: number; size: number }[] {
  const out: { path: string; mtime: number; size: number }[] = []
  for (const dir of logDirs()) {
    for (const name of readdirSync(dir)) {
      if (!/\.log$/i.test(name) || /studio/i.test(name)) continue
      const p = join(dir, name)
      try {
        const st = statSync(p)
        if (st.isFile()) out.push({ path: p, mtime: st.mtimeMs, size: st.size })
      } catch { /* file vanished */ }
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime)
}

/** The most recent Roblox user id found in the logs. */
export function detectUserId(): number | null {
  for (const f of logFiles().slice(0, 15)) {
    try {
      const text = readFileSync(f.path, 'utf8')
      const matches = [...text.matchAll(new RegExp(USER, 'gi'))]
      const id = Number(matches.at(-1)?.[1])
      if (id > 0) return id
    } catch { /* unreadable */ }
  }
  return null
}

interface Parsed {
  totals: Record<string, number> // place id -> seconds in this file
  lastPlace: number | null
  inGame: boolean
}

function parse(text: string): Parsed {
  const totals: Record<string, number> = {}
  let place: number | null = null
  let start = 0
  let last = 0
  let lastPlace: number | null = null
  const close = (end: number) => {
    if (place && end > start) totals[place] = (totals[place] ?? 0) + Math.min((end - start) / 1000, 24 * 3600)
    place = null
  }
  for (const line of text.split('\n')) {
    const ts = line.match(TS)
    if (ts) last = Date.parse(ts[1])
    const j = line.match(JOIN)
    if (j && last) {
      close(last)
      place = Number(j[1])
      lastPlace = place
      start = last
      continue
    }
    if (place && LEAVE.test(line) && last) close(last)
  }
  const inGame = place !== null
  close(last)
  return { totals, lastPlace, inGame }
}

let idleInGame = 0
export let nowPlaying: { placeId: number; since: number } | null = null

/** Read new playtime from the logs. Returns seconds added per place since the last scan. */
export function scanPlaytime(): Record<string, number> {
  const scanned = play.get('scannedLogs')
  const games = play.get('games')
  const added: Record<string, number> = {}
  let active: { placeId: number; mtime: number } | null = null
  for (const f of logFiles().slice(0, 60)) {
    const prev = scanned[f.path]
    if (prev && prev.mtime === f.mtime) continue
    let parsed: Parsed
    try {
      parsed = parse(readFileSync(f.path, 'utf8'))
    } catch {
      continue
    }
    for (const [placeId, secs] of Object.entries(parsed.totals)) {
      const delta = Math.floor(secs - (prev?.totals[placeId] ?? 0))
      if (delta > 0) added[placeId] = (added[placeId] ?? 0) + delta
    }
    scanned[f.path] = { mtime: f.mtime, totals: Object.fromEntries(Object.entries(parsed.totals).map(([k, v]) => [k, Math.floor(v)])) }
    if (parsed.inGame && parsed.lastPlace && Date.now() - f.mtime < 120_000 && (!active || f.mtime > active.mtime)) {
      active = { placeId: parsed.lastPlace, mtime: f.mtime }
    }
  }
  // Forget files Roblox has deleted so the record does not grow forever.
  const existing = new Set(logFiles().map((f) => f.path))
  for (const k of Object.keys(scanned)) if (!existing.has(k)) delete scanned[k]

  if (active) {
    if (!nowPlaying || nowPlaying.placeId !== active.placeId) nowPlaying = { placeId: active.placeId, since: Date.now() }
  } else nowPlaying = null

  // Idle time while in a game does not count toward achievements.
  if (nowPlaying && added[nowPlaying.placeId] && idleInGame > 0) {
    const take = Math.min(idleInGame, added[nowPlaying.placeId])
    added[nowPlaying.placeId] -= take
    idleInGame -= take
  }
  const unsent = state.get('playUnsent')
  for (const [placeId, secs] of Object.entries(added)) {
    if (secs <= 0) continue
    const g = games[placeId] ?? { seconds: 0, last: 0 }
    g.seconds += secs
    g.last = Date.now()
    games[placeId] = g
    unsent[placeId] = (unsent[placeId] ?? 0) + secs
  }
  play.patch({ games, scannedLogs: scanned })
  state.set('playUnsent', unsent)
  return added
}

let watcher: NodeJS.Timeout | null = null

export function watch(onUpdate: (added: Record<string, number>) => void): void {
  if (watcher) clearInterval(watcher)
  const first = !Object.keys(play.get('scannedLogs')).length
  const added = scanPlaytime()
  if (!first && Object.keys(added).length) onUpdate(added)
  if (first) onUpdate(added)
  watcher = setInterval(() => {
    if (nowPlaying && powerMonitor.getSystemIdleTime() > 300) idleInGame += 20
    const a = scanPlaytime()
    onUpdate(a)
  }, 20_000)
}

// ---------------------------------------------------------------- launching
let instanceHolder: ChildProcess | null = null

function holdMultiInstance(): void {
  if (process.platform !== 'win32' || instanceHolder) return
  // Roblox checks a named mutex to allow one client. Holding it lets more clients open.
  instanceHolder = spawn('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command',
    "$m = New-Object System.Threading.Mutex($true, 'ROBLOX_singletonMutex'); while ($true) { Start-Sleep -Seconds 3600 }"], { windowsHide: true, stdio: 'ignore' })
  instanceHolder.on('exit', () => (instanceHolder = null))
}

export function releaseMultiInstance(): void {
  instanceHolder?.kill()
  instanceHolder = null
}

export async function launch(placeId: number): Promise<void> {
  if (!Number.isInteger(placeId) || placeId <= 0) throw new Error('That game id is not valid.')
  applyFastFlags()
  if (settings.get('multiInstance')) holdMultiInstance()
  else releaseMultiInstance()
  await shell.openExternal(`roblox://experiences/start?placeId=${placeId}`)
}

// ---------------------------------------------------------------- FastFlags
function flagFiles(): { path: string; kind: 'json' | 'sober' }[] {
  const out: { path: string; kind: 'json' | 'sober' }[] = []
  if (process.platform === 'win32') {
    const versions = join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Roblox', 'Versions')
    if (existsSync(versions)) {
      for (const v of readdirSync(versions)) {
        if (existsSync(join(versions, v, 'RobloxPlayerBeta.exe'))) out.push({ path: join(versions, v, 'ClientSettings', 'ClientAppSettings.json'), kind: 'json' })
      }
    }
  } else if (process.platform === 'darwin') {
    for (const appDir of ['/Applications/Roblox.app', join(homedir(), 'Applications', 'Roblox.app')]) {
      if (existsSync(appDir)) out.push({ path: join(appDir, 'Contents', 'MacOS', 'ClientSettings', 'ClientAppSettings.json'), kind: 'json' })
    }
  } else {
    const cfg = join(homedir(), '.var', 'app', 'org.vinegarhq.Sober', 'config', 'sober', 'config.json')
    if (existsSync(cfg)) out.push({ path: cfg, kind: 'sober' })
  }
  return out
}

export interface FlagDef {
  id: string
  flag: string
  type: 'number' | 'select' | 'toggle'
  enable?: string
  on?: unknown
  platform?: string
}

let flagDefs: FlagDef[] = []
export function setFlagDefs(defs: FlagDef[]): void {
  flagDefs = defs
}

export function flagValues(): Record<string, unknown> {
  const chosen = settings.get('fflags')
  const out: Record<string, unknown> = {}
  for (const def of flagDefs) {
    if (def.platform && def.platform !== process.platform) continue
    const v = chosen[def.id]
    if (v === undefined || v === null || v === false) continue
    if (def.type === 'toggle') out[def.flag] = def.on ?? true
    else out[def.flag] = def.type === 'number' ? Number(v) : v
    if (def.enable) out[def.enable] = true
  }
  return out
}

export function applyFastFlags(): { written: number; failed: string[] } {
  const values = flagValues()
  const managed = new Set(flagDefs.flatMap((d) => [d.flag, d.enable].filter(Boolean) as string[]))
  let written = 0
  const failed: string[] = []
  for (const f of flagFiles()) {
    try {
      let existing: Record<string, unknown> = {}
      if (existsSync(f.path)) existing = JSON.parse(readFileSync(f.path, 'utf8') || '{}')
      if (f.kind === 'sober') {
        const flags = { ...(existing.fflags as Record<string, unknown> ?? {}) }
        for (const k of managed) delete flags[k]
        writeFileSync(f.path, JSON.stringify({ ...existing, fflags: { ...flags, ...values } }, null, 2))
      } else {
        for (const k of managed) delete existing[k]
        mkdirSync(join(f.path, '..'), { recursive: true })
        writeFileSync(f.path, JSON.stringify({ ...existing, ...values }, null, 2))
      }
      written++
    } catch {
      failed.push(f.path)
    }
  }
  return { written, failed }
}

export function robloxInstalled(): boolean {
  return flagFiles().length > 0 || logDirs().length > 0
}
