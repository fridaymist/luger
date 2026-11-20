// Luger main process: window, IPC, background jobs (playtime, official scripts, updates).
import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, net, Notification, protocol, shell, Tray } from 'electron'
import { autoUpdater } from 'electron-updater'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'
import { pathToFileURL } from 'node:url'
import catalog from '../../supabase/functions/_shared/catalog.json'
import * as api from './api'
import { deviceId } from './device'
import { closePresence, setPresence } from './discord'
import * as macros from './macros'
import { pythonAvailable, Worker } from './python'
import * as roblox from './roblox'
import { paths, play, settings, state } from './store'

let win: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false

protocol.registerSchemesAsPrivileged([{ scheme: 'luger-bg', privileges: { standard: true, secure: true, supportFetchAPI: true } }])

if (!app.requestSingleInstanceLock()) app.quit()
app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
})

function send(channel: string, payload: unknown): void {
  win?.webContents.send(channel, payload)
}

function iconPath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(app.getAppPath(), 'build', 'icon.png')
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 980,
    minHeight: 640,
    show: false,
    backgroundColor: '#15171c',
    title: 'Luger',
    icon: existsSync(iconPath()) ? iconPath() : undefined,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    titleBarOverlay: process.platform === 'darwin' ? undefined : { color: '#00000000', symbolColor: '#9b968a', height: 40 },
    trafficLightPosition: { x: 16, y: 14 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false
    }
  })
  win.once('ready-to-show', () => win?.show())
  win.on('close', (e) => {
    if (!quitting && settings.get('closeToTray')) {
      e.preventDefault()
      win?.hide()
      ensureTray()
    }
  })
  // Never let the renderer open new windows or navigate away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openSafe(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(process.env.ELECTRON_RENDERER_URL ?? 'file://')) e.preventDefault()
  })
  if (!app.isPackaged && process.env.LUGER_SNAPSHOT) snapshots(win, process.env.LUGER_SNAPSHOT)
  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

// Development only: LUGER_SNAPSHOT=dir LUGER_PAGES=home,macros captures each screen to PNG files.
function snapshots(w: BrowserWindow, dir: string): void {
  w.webContents.once('did-finish-load', async () => {
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
    mkdirSync(dir, { recursive: true })
    await wait(2500)
    const testKey = process.env.LUGER_OFFLINE === '1' ? 'LUGER-OFFLINE' : process.env.LUGER_SNAPSHOT_KEY
    if (testKey) {
      await w.webContents.executeJavaScript(`window.luger.invoke('session:redeem', ${JSON.stringify(testKey)})`).catch(() => {})
      await wait(1500)
    }
    for (const step of (process.env.LUGER_PAGES ?? 'home').split(',')) {
      const [page, arg] = step.split(':')
      await w.webContents.executeJavaScript(`window.__go && window.__go(${JSON.stringify(page)}, ${JSON.stringify(arg ?? null)})`)
      await wait(1800)
      const img = await w.webContents.capturePage()
      writeFileSync(join(dir, `${step.replace(/[^\w-]/g, '_')}.png`), img.toPNG())
    }
    app.exit(0)
  })
}

function ensureTray(): void {
  if (tray) return
  const img = nativeImage.createFromPath(iconPath()).resize({ width: 18, height: 18 })
  tray = new Tray(img)
  tray.setToolTip('Luger')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Luger', click: () => win?.show() },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit() } }
  ]))
  tray.on('click', () => win?.show())
}

function openSafe(url: string): void {
  try {
    const u = new URL(url)
    if (u.protocol === 'https:' || u.protocol === 'roblox:') shell.openExternal(url)
  } catch { /* ignore malformed */ }
}

// ------------------------------------------------------------------ currency for prices
const CURRENCY: Record<string, string> = {
  GB: 'GBP', US: 'USD', CA: 'CAD', AU: 'AUD', NZ: 'NZD', IE: 'EUR', DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR',
  BE: 'EUR', AT: 'EUR', PT: 'EUR', FI: 'EUR', GR: 'EUR', SK: 'EUR', SI: 'EUR', LT: 'EUR', LV: 'EUR', EE: 'EUR', LU: 'EUR',
  MT: 'EUR', CY: 'EUR', HR: 'EUR', SE: 'SEK', NO: 'NOK', DK: 'DKK', PL: 'PLN', CZ: 'CZK', HU: 'HUF', RO: 'RON', BG: 'BGN',
  CH: 'CHF', JP: 'JPY', KR: 'KRW', CN: 'CNY', HK: 'HKD', SG: 'SGD', IN: 'INR', ID: 'IDR', MY: 'MYR', PH: 'PHP', TH: 'THB',
  BR: 'BRL', MX: 'MXN', ZA: 'ZAR', TR: 'TRY', IL: 'ILS', IS: 'ISK'
}
const currency = () => CURRENCY[app.getLocaleCountryCode()] ?? 'GBP'

// ------------------------------------------------------------------ macros and apps that are running
const running = new Map<string, Worker>()
const appWorkers = new Map<string, Worker>()
const APPS = ['autoclicker', 'recorder'] as const

function startMacro(id: string): void {
  if (running.get(id)?.alive) return
  const { meta } = macros.get(id)
  if (meta.scan.verdict === 'malicious') throw new Error('This macro was flagged as dangerous and cannot run.')
  const w = new Worker('run', [macros.macroFile(id), macros.dataDir(id)], (msg) => {
    if (msg.type === 'notify' && settings.get('notifications') && Notification.isSupported()) {
      new Notification({ title: msg.title || meta.name, body: String(msg.text).slice(0, 200) }).show()
    }
    send('macro:event', { id, msg })
  }, (code) => {
    running.delete(id)
    send('macro:running', [...running.keys()])
    send('macro:event', { id, msg: { type: 'exit', code } })
  }, { type: 'init', values: meta.values })
  running.set(id, w)
  send('macro:running', [...running.keys()])
}

function stopMacro(id: string): void {
  running.get(id)?.stop()
}

function startApp(name: string): void {
  if (!APPS.includes(name as any)) throw new Error('Unknown app.')
  if (!state.get('installedApps').includes(name)) throw new Error('Install this app first.')
  if (appWorkers.get(name)?.alive) return
  const w = new Worker('app', [name], (msg) => send('app:event', { name, msg }), () => {
    appWorkers.delete(name)
    send('app:event', { name, msg: { type: 'exit' } })
  })
  appWorkers.set(name, w)
  const cfg = state.get('appConfig')[name]
  if (cfg && name === 'autoclicker') w.send({ type: 'config', ...cfg })
  if (cfg?.hotkeys && name === 'recorder') w.send({ type: 'hotkeys', hotkeys: cfg.hotkeys })
}

// ------------------------------------------------------------------ emergency stop
function accelerator(combo: string): string | null {
  const map: Record<string, string> = { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', cmd: 'Super', space: 'Space', enter: 'Enter', esc: 'Escape', tab: 'Tab', backspace: 'Backspace', delete: 'Delete', insert: 'Insert', home: 'Home', end: 'End', page_up: 'PageUp', page_down: 'PageDown', up: 'Up', down: 'Down', left: 'Left', right: 'Right' }
  const parts = combo.split('+').map((p) => map[p] ?? (/^f\d{1,2}$/.test(p) ? p.toUpperCase() : /^numpad\d$/.test(p) ? `num${p.slice(6)}` : p.length === 1 ? p.toUpperCase() : null))
  return parts.every(Boolean) ? parts.join('+') : null
}

function bindStopKey(): void {
  globalShortcut.unregisterAll()
  const acc = accelerator(settings.get('defaultStopKey'))
  if (!acc) return
  try {
    globalShortcut.register(acc, () => {
      for (const id of running.keys()) stopMacro(id)
      for (const w of appWorkers.values()) w.stop()
      send('toast', { kind: 'info', text: 'Stopped every macro and app.' })
    })
  } catch { /* key taken by another app */ }
}

// ------------------------------------------------------------------ background jobs
let lastPlace: number | null = null
const gameNames = new Map<number, string>(catalog.games.map((g) => [g.placeId, g.name]))

async function onPlaytime(): Promise<void> {
  const now = roblox.nowPlaying
  send('roblox:playing', now)
  const place = now?.placeId ?? null
  if (place !== lastPlace) {
    lastPlace = place
    if (settings.get('discordPresence')) {
      setPresence(place ? { details: `Playing ${gameNames.get(place) ?? 'Roblox'}`, state: 'with Luger', start: now!.since } : null).catch(() => {})
    }
    if (place) {
      // "Apply and launch" and auto-apply: start the macro chosen for this game.
      const auto = settings.get('autoApplyMacros')
      const macroId = pendingLaunchMacro?.placeId === place ? pendingLaunchMacro.macroId : auto[String(place)]
      pendingLaunchMacro = null
      if (macroId && macros.exists(macroId)) {
        try {
          startMacro(macroId)
        } catch (e) {
          send('toast', { kind: 'error', text: (e as Error).message })
        }
      }
    }
  }
}

let pendingLaunchMacro: { placeId: number; macroId: string } | null = null

async function report(): Promise<void> {
  const s = api.session()
  if (!s?.ver) return
  const unsent = state.get('playUnsent')
  const sessions = Object.entries(unsent).map(([placeId, seconds]) => ({ placeId: Number(placeId), seconds }))
  const lugerSeconds = state.get('lugerSecondsUnsent')
  try {
    const r = await api.call('playtime.report', { sessions, lugerSeconds, macroCount: macros.list().filter((m) => m.origin !== 'official').length })
    state.patch({ playUnsent: {}, lugerSecondsUnsent: 0, lastReport: Date.now() })
    if (r.newly?.length) send('progress:newly', r.newly)
  } catch { /* try again next round */ }
}

async function syncOfficial(): Promise<void> {
  if (!api.session()) return
  try {
    const { macros: list } = await api.call('macros.official')
    if (await macros.syncOfficial(list)) send('macros:changed', null)
  } catch { /* offline */ }
}

async function loadFlagDefs(): Promise<void> {
  try {
    roblox.setFlagDefs((await api.call('fflags')).fflags)
  } catch {
    roblox.setFlagDefs(catalog.fflags as any)
  }
}

function startJobs(): void {
  roblox.watch(() => onPlaytime())
  setInterval(() => state.set('lugerSecondsUnsent', state.get('lugerSecondsUnsent') + 60), 60_000)
  setInterval(report, 5 * 60_000)
  setInterval(syncOfficial, 30 * 60_000)
  if (app.isPackaged) {
    autoUpdater.allowPrerelease = settings.get('updateChannel') === 'beta'
    autoUpdater.on('update-downloaded', () => send('update:ready', null))
    autoUpdater.checkForUpdates().catch(() => {})
    setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 6 * 3600_000)
  }
}

api.onSessionChange((c) => {
  send('session:changed', c)
  if (c) {
    syncOfficial()
    loadFlagDefs()
  }
})

// ------------------------------------------------------------------ polling helpers for key flows
function poll<T>(fn: () => Promise<T | null>, everyMs: number, timeoutMs: number): Promise<T | null> {
  const end = Date.now() + timeoutMs
  return new Promise((resolve) => {
    const tick = async () => {
      try {
        const v = await fn()
        if (v) return resolve(v)
      } catch { /* keep trying */ }
      if (Date.now() > end) return resolve(null)
      setTimeout(tick, everyMs)
    }
    tick()
  })
}

// ------------------------------------------------------------------ IPC
type Handler = (...args: any[]) => unknown
const handlers: Record<string, Handler> = {
  'app:info': async () => ({
    version: app.getVersion(),
    platform: process.platform,
    offline: api.OFFLINE,
    python: await pythonAvailable(),
    roblox: roblox.robloxInstalled(),
    currency: currency(),
    locale: app.getLocale()
  }),
  'app:open': (url: string) => openSafe(url),
  'app:restartToUpdate': () => {
    quitting = true
    autoUpdater.quitAndInstall()
  },

  // session and keys
  'session:get': () => api.session(),
  'session:restore': () => api.restore(),
  'session:redeem': async (key: string) => api.adopt(await api.call('redeem', { key, device: deviceId(), robloxId: state.get('robloxId') }, { auth: false })),
  'session:signOut': () => api.signOut(),
  'session:freeKey': async (provider: string) => {
    const r = await api.call('checkpoint.start', { device: deviceId(), provider }, { auth: false })
    state.set('pendingCheckpoint', r.session)
    openSafe(r.url)
    const got = await poll(async () => {
      const c = await api.call('checkpoint.claim', { device: deviceId(), session: r.session }, { auth: false })
      send('session:checkpoint', c)
      return c.key ? c.key : null
    }, 3000, 30 * 60_000)
    state.set('pendingCheckpoint', null)
    if (!got) throw new Error('The checkpoints were not finished in time. Start again when you are ready.')
    return api.adopt(await api.call('redeem', { key: got, device: deviceId(), robloxId: state.get('robloxId') }, { auth: false }))
  },
  'session:buy': async (product: string) => {
    const r = await api.call('checkout.key', { device: deviceId(), product, robloxId: state.get('robloxId'), locale: app.getLocale() }, { auth: false })
    openSafe(r.url)
    const key = await poll(async () => {
      const c = await api.call('checkout.claim', { device: deviceId() }, { auth: false })
      return c.keys?.[0]?.key ?? null
    }, 4000, 30 * 60_000)
    if (!key) throw new Error('No payment arrived yet. If you paid, restart Luger and it will collect your key.')
    return { ...(await api.adopt(await api.call('redeem', { key, device: deviceId(), robloxId: state.get('robloxId') }, { auth: false }))), key }
  },
  'session:collectPurchases': async () => {
    const c = await api.call('checkout.claim', { device: deviceId() }, { auth: false })
    return c.keys ?? []
  },
  'session:restorePurchases': async () => api.adopt(await api.call('restore')),
  'prices': () => api.call('prices', { currency: currency() }, { auth: false }),
  'session:providers': () => api.call('checkpoint.providers', {}, { auth: false }),

  // identity
  'identity:detect': async () => {
    const id = roblox.detectUserId()
    if (id) state.set('robloxId', id)
    const rid = id ?? state.get('robloxId')
    if (!rid) return null
    try {
      const [u, t] = await Promise.all([
        net.fetch(`https://users.roblox.com/v1/users/${rid}`).then((r) => r.json()),
        net.fetch(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${rid}&size=150x150&format=Png&isCircular=false`).then((r) => r.json())
      ])
      return { id: rid, name: u.name, displayName: u.displayName, avatar: t.data?.[0]?.imageUrl ?? null }
    } catch {
      return { id: rid, name: null, displayName: null, avatar: null }
    }
  },
  'identity:start': () => api.call('identity.start', { robloxId: state.get('robloxId') }),
  'identity:check': async () => api.adopt(await api.call('identity.check', { robloxId: state.get('robloxId') })),

  // generic server calls from the interface
  'api': (action: string, body: Record<string, unknown>) => {
    if (!/^[a-z][\w.]*$/i.test(action) || ['redeem', 'refresh', 'checkout.claim', 'checkout.key', 'checkpoint.start', 'checkpoint.claim', 'identity.check', 'restore'].includes(action)) {
      throw new Error('Not allowed from the interface.')
    }
    return api.call(action, { ...body, locale: app.getLocale() })
  },
  'api:checkoutCrystals': async (pack: string) => {
    const r = await api.call('checkout.crystals', { pack, locale: app.getLocale() })
    openSafe(r.url)
    return true
  },

  // roblox
  'roblox:launch': async (placeId: number, macroId?: string) => {
    if (macroId) pendingLaunchMacro = { placeId, macroId }
    await roblox.launch(placeId)
    return true
  },
  'roblox:playtime': () => ({ games: play.get('games'), nowPlaying: roblox.nowPlaying }),
  'roblox:applyFlags': () => roblox.applyFastFlags(),
  'roblox:flagDefs': async () => {
    await loadFlagDefs()
    return (await api.call('fflags').catch(() => ({ fflags: catalog.fflags }))).fflags
  },
  'roblox:logDirs': () => roblox.logDirs(),

  // settings
  'settings:get': () => settings.all(),
  'settings:set': (patch: Record<string, unknown>) => {
    const allowed = new Set(Object.keys(settings.all()))
    const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.has(k)))
    settings.patch(clean as any)
    if ('launchAtLogin' in clean) app.setLoginItemSettings({ openAtLogin: !!clean.launchAtLogin })
    if ('discordPresence' in clean && !clean.discordPresence) closePresence()
    if ('fflags' in clean) roblox.applyFastFlags()
    if ('defaultStopKey' in clean) bindStopKey()
    return settings.all()
  },
  'settings:pickLogDir': async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory'] })
    if (r.canceled || !r.filePaths[0]) return null
    settings.set('robloxLogDir', r.filePaths[0])
    return r.filePaths[0]
  },

  // custom backgrounds (app only, never sent to the server)
  'backgrounds:list': () => {
    mkdirSync(paths.backgrounds, { recursive: true })
    return readdirSync(paths.backgrounds).filter((f) => /\.(png|jpe?g|webp|gif)$/i.test(f)).map((f) => ({ id: f, url: `luger-bg://img/${encodeURIComponent(f)}` }))
  },
  'backgrounds:import': async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openFile'], filters: [{ name: 'Pictures', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }] })
    if (r.canceled || !r.filePaths[0]) return null
    const src = r.filePaths[0]
    if (statSync(src).size > 15 * 1024 * 1024) throw new Error('Pick a picture under 15 MB.')
    mkdirSync(paths.backgrounds, { recursive: true })
    const name = `${Date.now()}${extname(src).toLowerCase()}`
    copyFileSync(src, join(paths.backgrounds, name))
    return { id: name, url: `luger-bg://img/${encodeURIComponent(name)}` }
  },
  'backgrounds:remove': (id: string) => {
    if (!/^\d+\.(png|jpe?g|webp|gif)$/i.test(id)) return false
    rmSync(join(paths.backgrounds, id), { force: true })
    if (settings.get('customBackground') === id) settings.set('customBackground', null)
    return true
  },

  // profile pictures go straight to storage through a signed upload url
  'profile:pickImage': async (kind: 'avatar' | 'banner') => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openFile'], filters: [{ name: 'Pictures', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] })
    if (r.canceled || !r.filePaths[0]) return null
    const file = r.filePaths[0]
    if (statSync(file).size > 4 * 1024 * 1024) throw new Error('Pick a picture under 4 MB.')
    const ext = extname(file).toLowerCase()
    const type = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
    const up = await api.call('profile.uploadUrl', { kind, contentType: type })
    const res = await net.fetch(up.uploadUrl, { method: 'PUT', headers: { 'content-type': type }, body: readFileSync(file) })
    if (!res.ok) throw new Error('Upload failed. Try again.')
    await api.call('profile.update', { [kind === 'avatar' ? 'avatar_url' : 'banner_url']: up.publicUrl })
    return up.publicUrl
  },

  // macros
  'macros:list': () => macros.list(),
  'macros:get': (id: string) => macros.get(id),
  'macros:pick': async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openFile', 'multiSelections'], filters: [{ name: 'Macros', extensions: ['py', 'ahk', 'ahk2', 'ah2', 'lrec', 'txt'] }] })
    return r.canceled ? [] : r.filePaths
  },
  'macros:prepare': (file: string) => macros.prepare(normalize(file)),
  'macros:prepareSource': (source: string, name: string, origin: 'explore' | 'recording') => macros.prepareSource(source, name, origin),
  'macros:commit': (token: string, choice: any) => macros.commit(token, choice),
  'macros:update': (id: string, patch: any) => macros.update(id, patch),
  'macros:remove': (ids: string[]) => {
    ids.forEach(stopMacro)
    return macros.remove(ids)
  },
  'macros:duplicate': (id: string) => macros.duplicate(id),
  'macros:binds': (id: string, controls: Record<string, string>) => macros.binds(id, controls),
  'macros:rebind': (id: string, changes: Record<string, string>, controls: Record<string, string>) => macros.rebind(id, changes, controls),
  'macros:saveSource': (id: string, source: string) => macros.saveSource(id, source),
  'macros:export': async (id: string) => {
    const { meta, source } = macros.get(id)
    const r = await dialog.showSaveDialog(win!, { defaultPath: `${meta.name.replace(/[^\w -]/g, '')}.py` })
    if (r.canceled || !r.filePath) return false
    writeFileSync(r.filePath, source)
    return true
  },
  'macros:run': (id: string) => startMacro(id),
  'macros:stop': (id: string) => stopMacro(id),
  'macros:running': () => [...running.keys()],
  'macros:uiEvent': (id: string, controlId: string, value: unknown) => {
    running.get(id)?.send({ type: 'ui_event', id: controlId, value })
    if (macros.exists(id)) {
      const { meta } = macros.get(id)
      macros.update(id, { values: { ...meta.values, [controlId]: value } })
    }
  },
  'macros:pause': (id: string) => running.get(id)?.send({ type: 'pause' }),

  // apps
  'apps:list': () => ({ installed: state.get('installedApps'), running: [...appWorkers.keys()], config: state.get('appConfig') }),
  'apps:install': (name: string) => {
    if (!APPS.includes(name as any)) throw new Error('Unknown app.')
    state.set('installedApps', [...new Set([...state.get('installedApps'), name])])
    return state.get('installedApps')
  },
  'apps:uninstall': (name: string) => {
    appWorkers.get(name)?.stop()
    state.set('installedApps', state.get('installedApps').filter((a) => a !== name))
    return state.get('installedApps')
  },
  'apps:start': (name: string) => startApp(name),
  'apps:stop': (name: string) => appWorkers.get(name)?.stop(),
  'apps:send': (name: string, msg: any) => {
    if (msg?.type === 'config' || msg?.type === 'hotkeys') {
      const all = state.get('appConfig')
      state.set('appConfig', { ...all, [name]: { ...(all[name] ?? {}), ...(msg.type === 'config' ? msg : { hotkeys: msg.hotkeys }) } })
    }
    appWorkers.get(name)?.send(msg)
  },

  // recordings
  'recordings:list': () => {
    mkdirSync(paths.recordings, { recursive: true })
    return readdirSync(paths.recordings).filter((f) => f.endsWith('.lrec')).map((f) => {
      const data = JSON.parse(readFileSync(join(paths.recordings, f), 'utf8'))
      return { id: f, name: data.name, created: data.created, events: data.events.length, duration: data.events.at(-1)?.[0] ?? 0 }
    }).sort((a, b) => b.created - a.created)
  },
  'recordings:save': (name: string, events: unknown[]) => {
    mkdirSync(paths.recordings, { recursive: true })
    const id = `${Date.now()}.lrec`
    writeFileSync(join(paths.recordings, id), JSON.stringify({ name: String(name).slice(0, 60) || 'Recording', created: Date.now(), events }))
    return id
  },
  'recordings:load': (id: string) => {
    if (!/^\d+\.lrec$/.test(id)) throw new Error('Invalid recording.')
    return JSON.parse(readFileSync(join(paths.recordings, id), 'utf8'))
  },
  'recordings:remove': (id: string) => {
    if (/^\d+\.lrec$/.test(id)) rmSync(join(paths.recordings, id), { force: true })
  },
  'recordings:toMacro': async (id: string) => {
    if (!/^\d+\.lrec$/.test(id)) throw new Error('Invalid recording.')
    const data = JSON.parse(readFileSync(join(paths.recordings, id), 'utf8'))
    const p = await macros.prepareSource(macros.recordingToPython(data.events, data.name), data.name, 'recording')
    return macros.commit(p.token, { action: 'keep', name: data.name })
  }
}

for (const [channel, fn] of Object.entries(handlers)) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, value: await fn(...args) }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
}

// ------------------------------------------------------------------ lifecycle
app.whenReady().then(async () => {
  protocol.handle('luger-bg', (req) => {
    const name = decodeURIComponent(new URL(req.url).pathname.slice(1))
    if (!/^\d+\.(png|jpe?g|webp|gif)$/i.test(name)) return new Response('not found', { status: 404 })
    return net.fetch(pathToFileURL(join(paths.backgrounds, name)).toString())
  })
  if (process.platform === 'darwin' && existsSync(iconPath())) app.dock?.setIcon(iconPath())
  createWindow()
  startJobs()
  bindStopKey()
  await api.restore().catch(() => null)
  onPlaytime()
  app.on('activate', () => (BrowserWindow.getAllWindows().length ? win?.show() : createWindow()))
})

app.on('will-quit', () => globalShortcut.unregisterAll())

app.on('before-quit', () => {
  quitting = true
  for (const w of running.values()) w.stop()
  for (const w of appWorkers.values()) w.stop()
  roblox.releaseMultiInstance()
  closePresence()
  report()
  settings.flush()
  state.flush()
  play.flush()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
