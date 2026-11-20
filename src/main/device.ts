// A stable, hashed id for this computer. The raw machine id never leaves the device.
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { paths } from './store'

let cached: string | null = null

function machineId(): string | null {
  try {
    if (process.platform === 'darwin') {
      const out = execFileSync('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { encoding: 'utf8' })
      return out.match(/"IOPlatformUUID" = "([^"]+)"/)?.[1] ?? null
    }
    if (process.platform === 'win32') {
      const out = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { encoding: 'utf8', windowsHide: true })
      return out.match(/MachineGuid\s+REG_SZ\s+(\S+)/)?.[1] ?? null
    }
    for (const f of ['/etc/machine-id', '/var/lib/dbus/machine-id']) {
      if (existsSync(f)) return readFileSync(f, 'utf8').trim()
    }
  } catch {
    return null
  }
  return null
}

export function deviceId(): string {
  if (cached) return cached
  let raw = machineId()
  if (!raw) {
    // No system id available: keep a random one in the profile folder.
    const f = join(paths.root, '.device')
    raw = existsSync(f) ? readFileSync(f, 'utf8').trim() : randomUUID()
    if (!existsSync(f)) writeFileSync(f, raw)
  }
  cached = createHash('sha256').update(`luger:${raw}`).digest('hex')
  return cached
}
