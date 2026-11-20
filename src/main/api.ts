// Talks to the Luger server. Holds the session token, checks its signature locally,
// and refreshes it before it expires.
import { app } from 'electron'
import { importJWK, jwtVerify, type JWTPayload } from 'jose'
import config from '../../luger.config.json'
import { deviceId } from './device'
import { mockCall } from './mock'
import { openSecret, sealSecret, state } from './store'

export const OFFLINE = !app.isPackaged && process.env.LUGER_OFFLINE === '1'

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export interface SessionClaims extends JWTPayload {
  sub: string
  kid: string
  rid?: number
  ver?: boolean
  roles?: string[]
  kx?: number | null
}

let claims: SessionClaims | null = null
let refreshTimer: NodeJS.Timeout | null = null
let onChange: (c: SessionClaims | null) => void = () => {}

export function onSessionChange(fn: (c: SessionClaims | null) => void): void {
  onChange = fn
}

async function verify(token: string, grace = 0): Promise<SessionClaims> {
  if (OFFLINE) return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
  if (!config.publicKey) throw new ApiError(500, 'Luger is not configured yet (missing public key).')
  const key = await importJWK(config.publicKey as any, 'EdDSA')
  const { payload } = await jwtVerify(token, key, { issuer: 'luger', clockTolerance: grace })
  if (payload.sub !== deviceId()) throw new ApiError(401, 'This session belongs to another device.')
  return payload as SessionClaims
}

export async function call<T = any>(action: string, body: Record<string, unknown> = {}, opts: { auth?: boolean } = {}): Promise<T> {
  if (OFFLINE) return mockCall(action, body, token()) as Promise<T>
  if (!config.functions) throw new ApiError(500, 'Luger is not configured yet (missing server address).')
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  const t = token()
  if (opts.auth !== false && t) headers.authorization = `Bearer ${t}`
  let res: Response
  try {
    res = await fetch(`${config.functions}/api`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ action, ...body }),
      signal: AbortSignal.timeout(20000)
    })
  } catch {
    throw new ApiError(0, 'Could not reach the Luger server. Check your internet connection.')
  }
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data.error) {
    if (res.status === 401 && opts.auth !== false) await signOut()
    throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`)
  }
  return data as T
}

function token(): string | null {
  return openSecret(state.get('token'))
}

export function session(): SessionClaims | null {
  return claims
}

export async function adopt(result: { token: string }): Promise<SessionClaims> {
  const c = await verify(result.token)
  state.set('token', sealSecret(result.token))
  claims = c
  schedule()
  onChange(c)
  return c
}

export async function signOut(): Promise<void> {
  state.set('token', null)
  claims = null
  if (refreshTimer) clearTimeout(refreshTimer)
  onChange(null)
}

function schedule(): void {
  if (refreshTimer) clearTimeout(refreshTimer)
  if (!claims?.exp) return
  if (claims.kx && claims.kx <= (claims.exp ?? 0)) {
    // The key itself ends at this time; nothing to refresh to.
    refreshTimer = setTimeout(() => signOut(), Math.max(1000, claims.exp * 1000 - Date.now()))
    return
  }
  const wait = Math.max(30_000, claims.exp * 1000 - Date.now() - 30 * 60 * 1000)
  refreshTimer = setTimeout(() => refresh().catch(() => schedule()), Math.min(wait, 2 ** 31 - 1))
}

export async function refresh(): Promise<SessionClaims | null> {
  const t = token()
  if (!t) return null
  try {
    const result = await call<{ token: string }>('refresh', { token: t, device: deviceId(), robloxId: state.get('robloxId') }, { auth: false })
    return adopt(result)
  } catch (e) {
    if (e instanceof ApiError && e.status === 0) {
      // Offline: keep using the current token while it is valid.
      try {
        claims = await verify(t)
        schedule()
        return claims
      } catch {
        return null
      }
    }
    await signOut()
    return null
  }
}

/** On launch: restore the saved session if it is still good. */
export async function restore(): Promise<SessionClaims | null> {
  const t = token()
  if (!t) return null
  try {
    claims = await verify(t)
    schedule()
    if ((claims.exp ?? 0) * 1000 - Date.now() < 6 * 3600 * 1000) return refresh()
    return claims
  } catch {
    return refresh()
  }
}
