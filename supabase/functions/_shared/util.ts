// Shared server helpers: database client, responses, session tokens, hashing, rate limits.
import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2.46.1'
import { importJWK, jwtVerify, SignJWT, type JWTPayload } from 'npm:jose@5.9.6'

export const db: SupabaseClient = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } }
)

const ALLOWED_ORIGINS = ['https://lugerhub.fun', 'https://www.lugerhub.fun']

export function cors(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? ''
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin'
  }
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...cors(req) }
  })
}

export async function handle(req: Request, fn: (body: any) => Promise<unknown>): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors(req) })
  if (req.method !== 'POST') return json(req, { error: 'Use POST' }, 405)
  try {
    const body = await req.json().catch(() => ({}))
    return json(req, await fn(body))
  } catch (e) {
    if (e instanceof HttpError) return json(req, { error: e.message }, e.status)
    console.error(e)
    return json(req, { error: 'Something went wrong on the server. Try again in a minute.' }, 500)
  }
}

// ---------------------------------------------------------------- hashing
const enc = new TextEncoder()

export async function hmac(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export const keyHash = (key: string) => hmac(Deno.env.get('LUGER_KEY_PEPPER')!, normalizeKey(key))

// Crockford base32 without look-alike characters; last character is a check symbol.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

export function normalizeKey(key: string): string {
  return key.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/^LUGER/, '').replace(/O/g, '0').replace(/[IL]/g, '1')
}

function checkChar(body: string): string {
  let sum = 0
  for (let i = 0; i < body.length; i++) sum = (sum * 31 + ALPHABET.indexOf(body[i])) % 32
  return ALPHABET[sum]
}

export function generateKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(15))
  let body = ''
  for (const b of bytes) body += ALPHABET[b & 31]
  const full = body + checkChar(body)
  return 'LUGER-' + full.match(/.{4}/g)!.join('-')
}

export function keyLooksValid(key: string): boolean {
  const n = normalizeKey(key)
  if (n.length !== 16 || [...n].some((c) => !ALPHABET.includes(c))) return false
  return checkChar(n.slice(0, 15)) === n[15]
}

export function randomToken(bytes = 24): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ---------------------------------------------------------------- session tokens (Ed25519)
let privateKey: CryptoKey | null = null
async function signingKey(): Promise<CryptoKey> {
  if (!privateKey) privateKey = (await importJWK(JSON.parse(Deno.env.get('LUGER_SIGNING_JWK')!), 'EdDSA')) as CryptoKey
  return privateKey
}
let publicKey: CryptoKey | null = null
async function verifyKey(): Promise<CryptoKey> {
  if (!publicKey) {
    const jwk = JSON.parse(Deno.env.get('LUGER_SIGNING_JWK')!)
    delete jwk.d
    publicKey = (await importJWK(jwk, 'EdDSA')) as CryptoKey
  }
  return publicKey
}

export interface Session extends JWTPayload {
  sub: string // device id
  kid: string // key id
  rid?: number // roblox user id
  ver?: boolean // ownership proven on this device
  roles?: string[]
  kx?: number | null // key expiry (unix seconds), null = lifetime
}

export const SESSION_HOURS = 12

export async function issueSession(s: Omit<Session, 'iat' | 'exp'>): Promise<{ token: string; expires: number }> {
  const expires = Math.floor(Date.now() / 1000) + SESSION_HOURS * 3600
  const capped = s.kx ? Math.min(expires, Number(s.kx)) : expires
  const token = await new SignJWT({ ...s })
    .setProtectedHeader({ alg: 'EdDSA' })
    .setIssuedAt()
    .setIssuer('luger')
    .setExpirationTime(capped)
    .sign(await signingKey())
  return { token, expires: capped }
}

export async function readSession(token: string | undefined, graceSeconds = 0): Promise<Session> {
  if (!token) throw new HttpError(401, 'Your session has ended. Enter your key again.')
  try {
    const { payload } = await jwtVerify(token, await verifyKey(), { issuer: 'luger', clockTolerance: graceSeconds })
    return payload as Session
  } catch {
    throw new HttpError(401, 'Your session has ended. Enter your key again.')
  }
}

export async function requireSession(req: Request): Promise<Session> {
  const s = await readSession(req.headers.get('authorization')?.replace(/^Bearer\s+/i, ''))
  const { data: key } = await db.from('keys').select('revoked').eq('id', s.kid).maybeSingle()
  if (!key || key.revoked) throw new HttpError(401, 'This key was revoked.')
  return s
}

export function requireVerified(s: Session): number {
  if (!s.rid || !s.ver) throw new HttpError(403, 'Prove this Roblox account is yours first (Settings → Account).')
  return s.rid
}

export const STAFF_ROLES = ['owner', 'developer', 'editor']

export function requireRole(s: Session, roles: string[]): void {
  requireVerified(s)
  if (!s.roles?.some((r) => roles.includes(r))) throw new HttpError(403, 'You do not have permission for this.')
}

// ---------------------------------------------------------------- rate limits
export async function limit(bucket: string, max: number, windowSeconds: number, message?: string): Promise<void> {
  const { data, error } = await db.rpc('hit_rate_limit', { p_bucket: bucket, p_max: max, p_window_s: windowSeconds })
  if (error) throw error
  if (!data) throw new HttpError(429, message ?? 'Too many attempts. Wait a few minutes and try again.')
}

export function clientIp(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? 'unknown'
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const { data } = await db.from('settings').select('value').eq('key', key).maybeSingle()
  return (data?.value as T) ?? fallback
}

export function str(v: unknown, max: number, field: string): string {
  if (typeof v !== 'string') throw new HttpError(400, `${field} is missing.`)
  const t = v.trim()
  if (!t) throw new HttpError(400, `${field} is empty.`)
  if (t.length > max) throw new HttpError(400, `${field} is too long (max ${max} characters).`)
  return t
}

export function int(v: unknown, field: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n) || Math.floor(n) !== n || n < min || n > max) throw new HttpError(400, `${field} must be a whole number between ${min} and ${max}.`)
  return n
}

// ---------------------------------------------------------------- sealing (owner can reveal keys)
let vaultKey: CryptoKey | null = null
async function vault(): Promise<CryptoKey> {
  if (!vaultKey) {
    const raw = await crypto.subtle.digest('SHA-256', enc.encode(Deno.env.get('LUGER_KEY_VAULT')!))
    vaultKey = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
  }
  return vaultKey
}

const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u))
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

export async function seal(text: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await vault(), enc.encode(text)))
  return `${b64(iv)}.${b64(ct)}`
}

export async function unseal(sealed: string): Promise<string> {
  const [iv, ct] = sealed.split('.').map(unb64)
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await vault(), ct))
}

/** Ad networks that have their keys set, in the order the owner chose. */
export function liveProviders(chosen: string[]): string[] {
  const ready: Record<string, boolean> = {
    lootlabs: !!Deno.env.get('LOOTLABS_LINK'),
    linkvertise: !!Deno.env.get('LINKVERTISE_USER_ID'),
    workink: !!Deno.env.get('WORKINK_LINK')
  }
  return chosen.filter((p) => ready[p])
}
