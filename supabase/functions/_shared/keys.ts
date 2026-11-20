// Key creation and redemption, shared by the API, the ad checkpoints and the payment webhook.
import { db, generateKey, HttpError, issueSession, keyHash, keyLooksValid, normalizeKey, seal } from './util.ts'

export type KeyKind = 'ad' | 'weekly' | 'monthly' | 'lifetime' | 'gift' | 'staff'

export interface KeyOptions {
  kind: KeyKind
  label?: string
  durationSeconds?: number | null // null = lifetime
  startsOnUse?: boolean
  expiresAt?: string | null
  maxUses?: number | null
  maxDevices?: number
  boundRobloxId?: number | null
  note?: string
  createdBy?: number | null
  source?: 'owner' | 'checkpoint' | 'stripe'
  stripeRef?: string | null
  custom?: string // owner-chosen key text
}

export async function createKeys(count: number, o: KeyOptions): Promise<{ id: string; key: string }[]> {
  const out: { id: string; key: string }[] = []
  for (let i = 0; i < count; i++) {
    const key = o.custom && count === 1 ? o.custom.trim() : generateKey()
    const hash = await keyHash(key)
    const { data, error } = await db.from('keys').insert({
      key_hash: hash,
      key_hint: normalizeKey(key).slice(-4),
      key_sealed: await seal(key),
      label: o.label ?? '',
      kind: o.kind,
      duration_s: o.durationSeconds ?? null,
      starts_on_use: o.startsOnUse ?? true,
      expires_at: o.expiresAt ?? null,
      max_uses: o.maxUses ?? null,
      max_devices: o.maxDevices ?? 1,
      bound_roblox_id: o.boundRobloxId ?? null,
      note: o.note ?? '',
      created_by: o.createdBy ?? null,
      source: o.source ?? 'owner',
      stripe_ref: o.stripeRef ?? null
    }).select('id').single()
    if (error) {
      if (error.code === '23505') throw new HttpError(409, 'That key text is already in use.')
      throw error
    }
    out.push({ id: data.id, key })
  }
  return out
}

async function rolesFor(robloxId: number | undefined, verified: boolean): Promise<string[]> {
  if (!robloxId || !verified) return []
  const { data } = await db.from('users').select('roles, banned').eq('roblox_id', robloxId).maybeSingle()
  if (data?.banned) throw new HttpError(403, 'This account is banned from Luger.')
  return data?.roles ?? []
}

export async function touchDevice(device: string, robloxId?: number): Promise<{ verified: boolean }> {
  if (!/^[a-f0-9]{64}$/.test(device)) throw new HttpError(400, 'Device id is invalid.')
  const { data } = await db.from('devices').select('verified_for').eq('id', device).maybeSingle()
  await db.from('devices').upsert({ id: device, roblox_id: robloxId && data?.verified_for === robloxId ? robloxId : null, last_seen: new Date().toISOString() })
  return { verified: !!robloxId && data?.verified_for === robloxId }
}

export async function sessionFor(keyId: string, device: string, robloxId?: number) {
  const { data: k } = await db.from('keys').select('*').eq('id', keyId).single()
  if (!k || k.revoked) throw new HttpError(401, 'This key was revoked.')
  const exp = k.expires_at ? Math.floor(Date.parse(k.expires_at) / 1000) : null
  if (exp !== null && exp <= Date.now() / 1000) throw new HttpError(401, 'This key has expired. Get a new one to keep using Luger.')
  const { verified } = await touchDevice(device, robloxId)
  const roles = await rolesFor(robloxId, verified)
  const s = await issueSession({ sub: device, kid: k.id, rid: robloxId, ver: verified, roles, kx: exp })
  return { ...s, key: { kind: k.kind, label: k.label, expires: exp } }
}

export async function redeem(rawKey: string, device: string, robloxId?: number) {
  if (!keyLooksValid(rawKey)) {
    // Owner-chosen custom keys skip the check digit; look them up directly.
    if (rawKey.trim().length < 6 || rawKey.trim().length > 64) throw new HttpError(400, 'That does not look like a Luger key.')
  }
  const hash = await keyHash(rawKey)
  const { data: k } = await db.from('keys').select('*').eq('key_hash', hash).maybeSingle()
  if (!k) throw new HttpError(404, 'That key does not exist. Check for typos.')
  if (k.revoked) throw new HttpError(403, 'This key was revoked.')
  if (k.expires_at && Date.parse(k.expires_at) <= Date.now()) throw new HttpError(403, 'This key has expired.')
  if (k.bound_roblox_id && robloxId && k.bound_roblox_id !== robloxId) {
    throw new HttpError(403, 'This key belongs to a different Roblox account.')
  }
  await touchDevice(device, robloxId)
  const { data: existing } = await db.from('key_redemptions').select('device_id').eq('key_id', k.id)
  const devices = (existing ?? []).map((r) => r.device_id)
  if (!devices.includes(device)) {
    if (devices.length >= k.max_devices) {
      throw new HttpError(403, `This key is already used on ${k.max_devices} device${k.max_devices === 1 ? '' : 's'}.`)
    }
    const { data: ok } = await db.rpc('claim_key_use', { p_key: k.id })
    if (!ok) throw new HttpError(403, 'This key has no uses left.')
    await db.from('key_redemptions').insert({ key_id: k.id, device_id: device, roblox_id: robloxId ?? null })
  }
  return sessionFor(k.id, device, robloxId)
}
