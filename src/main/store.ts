// Small JSON stores in the user data folder. Secrets go through Electron safeStorage
// (Keychain / DPAPI / libsecret) so they are encrypted at rest.
import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const paths = {
  get root() { return app.getPath('userData') },
  get macros() { return join(app.getPath('userData'), 'macros') },
  get apps() { return join(app.getPath('userData'), 'apps') },
  get backgrounds() { return join(app.getPath('userData'), 'backgrounds') },
  get recordings() { return join(app.getPath('userData'), 'recordings') }
}

export class JsonStore<T extends object> {
  private data: T
  private timer: NodeJS.Timeout | null = null
  constructor(private file: string, defaults: T) {
    let loaded: Partial<T> = {}
    try {
      if (existsSync(this.path)) loaded = JSON.parse(readFileSync(this.path, 'utf8'))
    } catch {
      loaded = {} // corrupted file: start fresh rather than crash
    }
    this.data = { ...defaults, ...loaded }
  }
  private get path() { return join(paths.root, this.file) }
  get<K extends keyof T>(k: K): T[K] { return this.data[k] }
  all(): T { return this.data }
  set<K extends keyof T>(k: K, v: T[K]): void {
    this.data[k] = v
    this.save()
  }
  patch(p: Partial<T>): void {
    Object.assign(this.data, p)
    this.save()
  }
  private save(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), 150)
  }
  flush(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    mkdirSync(dirname(this.path), { recursive: true })
    const tmp = this.path + '.tmp'
    writeFileSync(tmp, JSON.stringify(this.data, null, 2))
    renameSync(tmp, this.path) // atomic replace so a crash never leaves half a file
  }
}

export function sealSecret(text: string): string {
  if (!safeStorage.isEncryptionAvailable()) return 'plain:' + Buffer.from(text).toString('base64')
  return 'sealed:' + safeStorage.encryptString(text).toString('base64')
}

export function openSecret(stored: string | null | undefined): string | null {
  if (!stored) return null
  try {
    if (stored.startsWith('sealed:')) return safeStorage.decryptString(Buffer.from(stored.slice(7), 'base64'))
    if (stored.startsWith('plain:')) return Buffer.from(stored.slice(6), 'base64').toString()
  } catch {
    return null
  }
  return null
}

export interface Settings {
  appTheme: string
  customBackground: string | null
  backgroundDim: number
  density: 'comfortable' | 'compact'
  reduceMotion: boolean
  launchAtLogin: boolean
  closeToTray: boolean
  notifications: boolean
  discordPresence: boolean
  multiInstance: boolean
  robloxLogDir: string | null
  fflags: Record<string, unknown>
  defaultStopKey: string
  safety: 'strict' | 'standard'
  updateChannel: 'stable' | 'beta'
  macroView: 'grid' | 'list'
  greetingName: 'username' | 'display'
  autoApplyMacros: Record<string, string> // universe id -> macro id applied on launch
}

export const settings = new JsonStore<Settings>('settings.json', {
  appTheme: 'theme.brass',
  customBackground: null,
  backgroundDim: 0.55,
  density: 'comfortable',
  reduceMotion: false,
  launchAtLogin: false,
  closeToTray: false,
  notifications: true,
  discordPresence: false,
  multiInstance: false,
  robloxLogDir: null,
  fflags: {},
  defaultStopKey: 'f8',
  safety: 'strict',
  updateChannel: 'stable',
  macroView: 'grid',
  greetingName: 'username',
  autoApplyMacros: {}
})

export interface SessionState {
  token: string | null // sealed
  robloxId: number | null
  pendingCheckpoint: string | null
  lastReport: number
  lugerSecondsUnsent: number
  playUnsent: Record<string, number> // place id -> seconds
  installedApps: string[]
  appConfig: Record<string, any>
}

export const state = new JsonStore<SessionState>('state.json', {
  token: null,
  robloxId: null,
  pendingCheckpoint: null,
  lastReport: 0,
  lugerSecondsUnsent: 0,
  playUnsent: {},
  installedApps: [],
  appConfig: {}
})

export interface LocalPlay {
  // Playtime Luger has seen locally, used for the home screen even before syncing.
  games: Record<string, { seconds: number; last: number; universeId?: number }>
  scannedLogs: Record<string, { mtime: number; totals: Record<string, number> }> // per log file: seconds per place already counted
}

export const play = new JsonStore<LocalPlay>('playtime.json', { games: {}, scannedLogs: {} })
