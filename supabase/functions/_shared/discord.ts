// Discord OAuth2 and member management for verification.
import { db, HttpError, seal, unseal } from './util.ts'

const API = 'https://discord.com/api/v10'
export const CONSENT_VERSION = '2026-11-20'
export const SCOPES = 'identify guilds.join'
const env = (k: string) => {
  const v = Deno.env.get(k)
  if (!v) throw new HttpError(503, 'Discord verification is not set up yet.')
  return v
}
const redirectUri = () => `${Deno.env.get('LUGER_SITE_URL') ?? 'https://lugerhub.fun'}/verify/callback/`

export function authorizeUrl(state: string): string {
  const q = new URLSearchParams({ client_id: env('DISCORD_CLIENT_ID'), response_type: 'code', redirect_uri: redirectUri(), scope: SCOPES, state, prompt: 'consent' })
  return `https://discord.com/oauth2/authorize?${q}`
}

async function token(body: Record<string, string>): Promise<any> {
  const res = await fetch(`${API}/oauth2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${btoa(`${env('DISCORD_CLIENT_ID')}:${env('DISCORD_CLIENT_SECRET')}`)}` },
    body: new URLSearchParams(body)
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new HttpError(400, data.error === 'invalid_grant' ? 'That Discord approval expired. Start again.' : 'Discord refused the sign-in. Start again.')
  return data
}

export const exchangeCode = (code: string) => token({ grant_type: 'authorization_code', code, redirect_uri: redirectUri() })

export async function me(accessToken: string): Promise<{ id: string; username: string; global_name: string | null; avatar: string | null }> {
  const res = await fetch(`${API}/users/@me`, { headers: { authorization: `Bearer ${accessToken}` } })
  if (!res.ok) throw new HttpError(502, 'Could not read your Discord account.')
  return res.json()
}

const bot = () => ({ authorization: `Bot ${env('DISCORD_BOT_TOKEN')}`, 'content-type': 'application/json' })

/** Wait out Discord rate limits instead of failing. */
async function discordFetch(url: string, init: RequestInit, tries = 3): Promise<Response> {
  for (let i = 0; ; i++) {
    const res = await fetch(url, init)
    if (res.status !== 429 || i >= tries) return res
    const wait = Number((await res.json().catch(() => ({}))).retry_after ?? 1)
    await new Promise((r) => setTimeout(r, Math.min(10, wait) * 1000 + 100))
  }
}

/** Add a member to a guild (with roles); if already there, just add the roles. */
export async function joinGuild(guildId: string, userId: string, accessToken: string, roles: string[]): Promise<'added' | 'already' | 'failed'> {
  const res = await discordFetch(`${API}/guilds/${guildId}/members/${userId}`, { method: 'PUT', headers: bot(), body: JSON.stringify({ access_token: accessToken, roles }) })
  if (res.status === 201) return 'added'
  if (res.status === 204) {
    for (const r of roles) await discordFetch(`${API}/guilds/${guildId}/members/${userId}/roles/${r}`, { method: 'PUT', headers: bot() })
    return 'already'
  }
  console.error('join failed', res.status, await res.text().catch(() => ''))
  return 'failed'
}

/** A usable access token for a stored link, refreshing it when needed. */
export async function accessFor(link: any): Promise<string | null> {
  if (link.revoked) return null
  if (Date.parse(link.expires_at) - Date.now() > 60_000) return unseal(link.access_token)
  try {
    const t = await token({ grant_type: 'refresh_token', refresh_token: await unseal(link.refresh_token) })
    await db.from('discord_links').update({
      access_token: await seal(t.access_token), refresh_token: await seal(t.refresh_token),
      expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(), updated_at: new Date().toISOString()
    }).eq('discord_id', link.discord_id)
    return t.access_token
  } catch {
    // The member removed Luger from their Discord authorised apps.
    await db.from('discord_links').update({ revoked: true }).eq('discord_id', link.discord_id)
    return null
  }
}

export async function saveLink(t: any, user: Awaited<ReturnType<typeof me>>, robloxId: number | null): Promise<void> {
  if (!String(t.scope ?? '').includes('guilds.join')) throw new HttpError(400, 'Luger needs the “Join servers for you” permission to verify you.')
  const { error } = await db.from('discord_links').upsert({
    discord_id: user.id, username: user.username, global_name: user.global_name, avatar: user.avatar,
    ...(robloxId ? { roblox_id: robloxId } : {}),
    access_token: await seal(t.access_token), refresh_token: await seal(t.refresh_token),
    expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(), scopes: t.scope,
    consent_version: CONSENT_VERSION, consented_at: new Date().toISOString(), revoked: false, updated_at: new Date().toISOString()
  })
  if (error) throw error
}
