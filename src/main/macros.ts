// The macro library on disk: userData/macros/<id>/{macro.py, meta.json, data/}.
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { tool } from './python'
import { paths } from './store'

export interface ScanResult {
  verdict: 'clean' | 'suspicious' | 'malicious' | 'invalid'
  findings: { line: number; rule: string; severity: string; message: string }[]
}

export interface MacroMeta {
  id: string
  name: string
  description: string
  universeId: number | null
  placeId: number | null
  gameName: string | null
  tags: string[]
  origin: 'local' | 'converted' | 'recording' | 'explore' | 'official'
  remoteId: string | null
  remoteVersion: number | null
  allowRemove: boolean
  author: string | null
  values: Record<string, unknown>
  scan: ScanResult
  conversion: { unsupported: any[]; notes: string[] } | null
  cleaned: boolean
  createdAt: number
  updatedAt: number
}

export interface PendingImport {
  token: string
  name: string
  source: string
  origin: MacroMeta['origin']
  scan: ScanResult
  conversion: MacroMeta['conversion']
  fileName: string
}

const pending = new Map<string, PendingImport>()

function dir(id: string): string {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid macro id.')
  return join(paths.macros, id)
}

function readMeta(id: string): MacroMeta | null {
  try {
    return JSON.parse(readFileSync(join(dir(id), 'meta.json'), 'utf8'))
  } catch {
    return null
  }
}

function writeMeta(m: MacroMeta): void {
  writeFileSync(join(dir(m.id), 'meta.json'), JSON.stringify(m, null, 2))
}

export function list(): MacroMeta[] {
  mkdirSync(paths.macros, { recursive: true })
  return readdirSync(paths.macros)
    .map((id) => (/^[0-9a-f-]{36}$/.test(id) ? readMeta(id) : null))
    .filter((m): m is MacroMeta => !!m)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export function get(id: string): { meta: MacroMeta; source: string } {
  const meta = readMeta(id)
  if (!meta) throw new Error('This macro no longer exists.')
  return { meta, source: readFileSync(join(dir(id), 'macro.py'), 'utf8') }
}

export function macroFile(id: string): string {
  return join(dir(id), 'macro.py')
}

export function dataDir(id: string): string {
  const d = join(dir(id), 'data')
  mkdirSync(d, { recursive: true })
  return d
}

function cleanName(file: string): string {
  return basename(file, extname(file)).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Untitled macro'
}

/** Step 1 of adding: read, convert if needed, scan. Nothing is saved yet. */
export async function prepare(file: string): Promise<PendingImport> {
  const ext = extname(file).toLowerCase()
  const raw = readFileSync(file, 'utf8').replace(/^﻿/, '')
  if (raw.length > 500_000) throw new Error('That file is too large to be a macro (over 500 KB).')
  let source = raw
  let origin: MacroMeta['origin'] = 'local'
  let conversion: MacroMeta['conversion'] = null
  if (ext === '.ahk' || ext === '.ahk2' || ext === '.ah2') {
    const r = await tool('convert', { source: raw })
    if (!r.valid) throw new Error(`Conversion produced broken code (${r.error}). This script uses features Luger cannot convert yet.`)
    source = r.source
    origin = 'converted'
    conversion = { unsupported: r.unsupported, notes: r.notes }
  } else if (ext === '.lrec' || ext === '.json') {
    const events = JSON.parse(raw)
    source = recordingToPython(Array.isArray(events) ? events : events.events, cleanName(file))
    origin = 'recording'
  } else if (ext !== '.py' && ext !== '.pyw' && ext !== '.txt') {
    throw new Error('Luger can add .py, .ahk and recording files.')
  }
  const scan = await tool<ScanResult>('scan', { source })
  const p: PendingImport = { token: randomUUID(), name: cleanName(file), source, origin, scan, conversion, fileName: basename(file) }
  pending.set(p.token, p)
  return p
}

export async function prepareSource(source: string, name: string, origin: MacroMeta['origin']): Promise<PendingImport> {
  const scan = await tool<ScanResult>('scan', { source })
  const p: PendingImport = { token: randomUUID(), name, source, origin, scan, conversion: null, fileName: name }
  pending.set(p.token, p)
  return p
}

/** Step 2: the user picked a game and decided what to do about any scan findings. */
export async function commit(token: string, choice: {
  action: 'keep' | 'clean' | 'remove'
  name?: string
  description?: string
  universeId?: number | null
  placeId?: number | null
  gameName?: string | null
  tags?: string[]
  remoteId?: string | null
  remoteVersion?: number | null
  author?: string | null
}): Promise<MacroMeta | null> {
  const p = pending.get(token)
  if (!p) throw new Error('This import expired. Add the file again.')
  pending.delete(token)
  if (choice.action === 'remove') return null
  let source = p.source
  let scan = p.scan
  let cleaned = false
  if (scan.verdict !== 'clean' && choice.action === 'clean') {
    const r = await tool('clean', { source })
    source = r.source
    scan = { verdict: r.verdict, findings: r.findings }
    cleaned = true
  }
  if (scan.verdict === 'malicious' && choice.action === 'keep') {
    throw new Error('Luger will not keep a macro with dangerous code. Choose Clean or Remove.')
  }
  if (scan.verdict === 'invalid') throw new Error('This is not valid Python, so it cannot run.')
  const id = randomUUID()
  mkdirSync(join(dir(id), 'data'), { recursive: true })
  writeFileSync(join(dir(id), 'macro.py'), source)
  const meta: MacroMeta = {
    id,
    name: (choice.name ?? p.name).slice(0, 60),
    description: (choice.description ?? '').slice(0, 2000),
    universeId: choice.universeId ?? null,
    placeId: choice.placeId ?? null,
    gameName: choice.gameName ?? null,
    tags: (choice.tags ?? []).slice(0, 8),
    origin: p.origin,
    remoteId: choice.remoteId ?? null,
    remoteVersion: choice.remoteVersion ?? null,
    allowRemove: true,
    author: choice.author ?? null,
    values: {},
    scan,
    conversion: p.conversion,
    cleaned,
    createdAt: Date.now(),
    updatedAt: Date.now()
  }
  writeMeta(meta)
  return meta
}

export function update(id: string, patch: Partial<Pick<MacroMeta, 'name' | 'description' | 'universeId' | 'placeId' | 'gameName' | 'tags' | 'values'>>): MacroMeta {
  const m = get(id).meta
  const next = { ...m, ...patch, updatedAt: Date.now() }
  if (next.name !== undefined) next.name = String(next.name).slice(0, 60) || m.name
  writeMeta(next)
  return next
}

export async function binds(id: string, controls: Record<string, string>): Promise<any[]> {
  const { source } = get(id)
  return (await tool('binds', { source, controls })).binds
}

export async function rebind(id: string, changes: Record<string, string>, controls: Record<string, string>): Promise<any[]> {
  const { meta, source } = get(id)
  if (meta.origin === 'official') throw new Error('Public scripts are updated by Luger staff; their binds cannot be edited here. Duplicate it first.')
  const r = await tool('rebind', { source, changes, controls })
  writeFileSync(macroFile(id), r.source)
  update(id, {})
  return r.binds
}

export function duplicate(id: string): MacroMeta {
  const { meta, source } = get(id)
  const nid = randomUUID()
  mkdirSync(join(dir(nid), 'data'), { recursive: true })
  writeFileSync(join(dir(nid), 'macro.py'), source)
  const copy: MacroMeta = { ...meta, id: nid, name: `${meta.name} copy`.slice(0, 60), origin: 'local', remoteId: null, remoteVersion: null, allowRemove: true, createdAt: Date.now(), updatedAt: Date.now() }
  writeMeta(copy)
  return copy
}

export function remove(ids: string[]): { removed: string[]; kept: string[] } {
  const removed: string[] = []
  const kept: string[] = []
  for (const id of ids) {
    const m = readMeta(id)
    if (!m) continue
    if (m.origin === 'official' && !m.allowRemove) {
      kept.push(m.name)
      continue
    }
    rmSync(dir(id), { recursive: true, force: true })
    removed.push(id)
  }
  return { removed, kept }
}

export async function saveSource(id: string, source: string): Promise<ScanResult> {
  const { meta } = get(id)
  if (meta.origin === 'official') throw new Error('Public scripts cannot be edited. Duplicate it first.')
  const check = await tool('check', { source })
  if (!check.ok) throw new Error(`Not valid Python: ${check.error}`)
  const scan = await tool<ScanResult>('scan', { source })
  if (scan.verdict === 'malicious') throw new Error('That change adds dangerous code, so it was not saved.')
  writeFileSync(macroFile(id), source)
  writeMeta({ ...meta, scan, updatedAt: Date.now() })
  return scan
}

/** Keep staff-published scripts in step with the server. */
export async function syncOfficial(remote: any[]): Promise<number> {
  const local = list().filter((m) => m.origin === 'official')
  let changed = 0
  for (const r of remote) {
    const have = local.find((m) => m.remoteId === r.id)
    if (have && have.remoteVersion === r.version) {
      if (have.allowRemove !== r.allow_remove) writeMeta({ ...have, allowRemove: r.allow_remove })
      continue
    }
    const scan = await tool<ScanResult>('scan', { source: r.source })
    if (scan.verdict === 'malicious') continue // never install, even from staff
    const id = have?.id ?? randomUUID()
    mkdirSync(join(dir(id), 'data'), { recursive: true })
    writeFileSync(join(dir(id), 'macro.py'), r.source)
    writeMeta({
      ...(have ?? { values: {}, createdAt: Date.now(), conversion: null, cleaned: false, placeId: null, gameName: null }),
      id,
      name: r.name,
      description: r.description ?? '',
      universeId: r.universe_id ?? null,
      tags: r.tags ?? [],
      origin: 'official',
      remoteId: r.id,
      remoteVersion: r.version,
      allowRemove: !!r.allow_remove,
      author: r.author?.username ?? null,
      scan,
      updatedAt: Date.now()
    } as MacroMeta)
    changed++
  }
  for (const m of local) {
    if (!remote.some((r) => r.id === m.remoteId)) {
      rmSync(dir(m.id), { recursive: true, force: true })
      changed++
    }
  }
  return changed
}

export function exists(id: string): boolean {
  try {
    return existsSync(join(dir(id), 'macro.py'))
  } catch {
    return false
  }
}

/** Turn a recorder take into an editable Python macro. */
export function recordingToPython(events: any[], name: string): string {
  const lines = [
    `# Recorded with Luger: ${name.replace(/\n/g, ' ')}`,
    'import luger',
    'from luger import ui',
    '',
    `ui.window(${JSON.stringify(name)})`,
    "speed = ui.slider('speed', 'Playback speed', 0.25, 4, default=1, step=0.25, unit='x')",
    "loops = ui.number('loops', 'Repeat (0 = forever)', default=1, min=0)",
    '',
    'def take():',
    '    s = speed.value or 1'
  ]
  let t = 0
  const q = (v: string) => JSON.stringify(v)
  for (const ev of events) {
    if (!Array.isArray(ev) || typeof ev[0] !== 'number') continue
    const gap = ev[0] - t
    if (gap > 0.005) lines.push(`    luger.wait(${gap.toFixed(3)} / s)`)
    t = ev[0]
    const [, kind, a, b, c] = ev
    if (kind === 'kd') lines.push(`    luger.key_down(${q(String(a))})`)
    else if (kind === 'ku') lines.push(`    luger.key_up(${q(String(a))})`)
    else if (kind === 'mv') lines.push(`    luger.move(${Number(a)}, ${Number(b)})`)
    else if (kind === 'md') lines.push(`    luger.move(${Number(b)}, ${Number(c)})`, `    luger.mouse_down(${q(String(a))})`)
    else if (kind === 'mu') lines.push(`    luger.move(${Number(b)}, ${Number(c)})`, `    luger.mouse_up(${q(String(a))})`)
    else if (kind === 'sc') lines.push(`    luger.scroll(${Number(b)}, ${Number(a)})`)
  }
  if (lines.at(-1) === '    s = speed.value or 1') lines.push('    pass')
  lines.push(
    '',
    "@luger.hotkey('f10')",
    'def play():',
    '    n = 0',
    '    while not luger.stopping() and (int(loops.value) == 0 or n < int(loops.value)):',
    '        take()',
    '        n += 1',
    '',
    "ui.button('play', 'Play (F10)', on_click=play)",
    'luger.run()',
    ''
  )
  return lines.join('\n')
}
