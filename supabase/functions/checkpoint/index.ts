// Ad checkpoints for free keys, called by the key website (lugerhub.fun/key).
//
// Flow: the app starts a session -> the site calls `status`, then `next` for each step,
// which hands out a single-use step token and the provider link -> the provider sends the
// visitor back to /key/return -> the site calls `complete` with the token (and the
// provider's anti-bypass value where it has one). After the last step a key is made.
// The site also uses `purchase` to show a key after a Stripe checkout.
import { createKeys } from '../_shared/keys.ts'
import { db, getSetting, handle, HttpError, limit, clientIp, liveProviders, randomToken, safeEqual } from '../_shared/util.ts'

const SITE = Deno.env.get('LUGER_SITE_URL') ?? 'https://lugerhub.fun'

type Cfg = { steps: number; ad_key_hours: number; ad_key_devices: number; min_seconds: number; providers: string[] }

/** The provider link for one step. Dynamic links carry the step token; static links rely on the site's stored token. */
function providerUrl(provider: string, session: string, token: string): string {
  const back = `${SITE}/key/return/?p=${provider}&s=${session}&t=${token}`
  if (provider === 'linkvertise') {
    const uid = Deno.env.get('LINKVERTISE_USER_ID')
    if (!uid) throw new HttpError(503, 'Linkvertise is not set up yet. Pick another option.')
    // Linkvertise dynamic link: destination is base64 in the r parameter.
    return `https://link-to.net/${uid}/${Math.floor(Math.random() * 1000)}/dynamic?r=${btoa(back)}`
  }
  if (provider === 'lootlabs') {
    const link = Deno.env.get('LOOTLABS_LINK')
    if (!link) throw new HttpError(503, 'LootLabs is not set up yet. Pick another option.')
    return link
  }
  if (provider === 'workink') {
    const link = Deno.env.get('WORKINK_LINK')
    if (!link) throw new HttpError(503, 'Work.ink is not set up yet. Pick another option.')
    return link
  }
  throw new HttpError(400, 'Unknown provider.')
}

/** Provider-side proof that the visitor really went through the ads. */
async function providerCheck(provider: string, body: any): Promise<boolean> {
  if (provider === 'linkvertise') {
    const token = Deno.env.get('LINKVERTISE_API_TOKEN')
    if (!token) return true // dynamic link + timing + single-use token still apply
    if (!body.hash || !/^[A-Za-z0-9]{32,128}$/.test(body.hash)) return false
    const res = await fetch(`https://publisher.linkvertise.com/api/v1/anti_bypassing?token=${token}&hash=${body.hash}`, { method: 'POST' })
    const data = await res.json().catch(() => ({}))
    return data?.status === true
  }
  if (provider === 'workink') {
    if (!body.workinkToken || !/^[\w-]{8,200}$/.test(body.workinkToken)) return false
    const res = await fetch(`https://work.ink/_api/v2/token/isValid/${body.workinkToken}`)
    const data = await res.json().catch(() => ({}))
    return data?.valid === true
  }
  return true // LootLabs: timing + single-use token (its link points at our return page)
}

Deno.serve((req) =>
  handle(req, async (body) => {
    const ip = clientIp(req)
    await limit(`site:${ip}`, 120, 600)
    const action = String(body.action ?? '')

    if (action === 'purchase') {
      const sid = String(body.sessionId ?? '')
      if (!/^cs_(test|live)_[A-Za-z0-9]{10,}$/.test(sid)) throw new HttpError(400, 'Invalid checkout reference.')
      const { data } = await db.from('orders').select('id, product, key_plain_once, status').eq('stripe_session', sid).maybeSingle()
      if (!data) return { pending: true }
      return { product: data.product, key: data.key_plain_once, delivered: !data.key_plain_once }
    }

    const sid = String(body.session ?? '')
    if (!/^[0-9a-f-]{36}$/.test(sid)) throw new HttpError(400, 'This key link is broken. Start again from Luger.')
    const { data: s } = await db.from('checkpoint_sessions').select('*').eq('id', sid).maybeSingle()
    if (!s) throw new HttpError(404, 'This key link has expired. Start again from Luger.')
    if (Date.now() - Date.parse(s.created_at) > 2 * 3600 * 1000) throw new HttpError(410, 'This key link has expired. Start again from Luger.')
    const cfg = await getSetting<Cfg>('checkpoint', { steps: 2, ad_key_hours: 24, ad_key_devices: 1, min_seconds: 12, providers: ['lootlabs'] })
    cfg.providers = liveProviders(cfg.providers)

    if (action === 'status') {
      return { step: s.step, steps: s.steps, done: s.done, provider: s.provider, providers: cfg.providers, key: s.done ? s.key_plain_once : null }
    }

    if (action === 'next') {
      if (s.done) throw new HttpError(400, 'All checkpoints are done.')
      await limit(`cp-next:${sid}`, 10, 600)
      const provider = cfg.providers.includes(body.provider) ? body.provider : s.provider
      const token = randomToken(16)
      await db.from('checkpoint_sessions').update({ step_token: token, step_started: new Date().toISOString(), provider }).eq('id', sid)
      return { url: providerUrl(provider, sid, token), token }
    }

    if (action === 'complete') {
      if (s.done) return { step: s.step, steps: s.steps, done: true, key: s.key_plain_once }
      await limit(`cp-done:${sid}`, 10, 600)
      if (!s.step_token || !safeEqual(String(body.token ?? ''), s.step_token)) {
        throw new HttpError(400, 'This checkpoint was not started from the key page. Press Continue again.')
      }
      const waited = (Date.now() - Date.parse(s.step_started)) / 1000
      if (waited < cfg.min_seconds) throw new HttpError(400, 'That was too quick. Finish the checkpoint page, then come back.')
      if (!(await providerCheck(s.provider, body))) throw new HttpError(400, 'The checkpoint was not completed. Try again.')
      const step = s.step + 1
      const update: Record<string, unknown> = { step, step_token: null, step_started: null }
      let key: string | null = null
      if (step >= s.steps) {
        const [made] = await createKeys(1, {
          kind: 'ad',
          label: 'Free key',
          durationSeconds: cfg.ad_key_hours * 3600,
          startsOnUse: true,
          maxUses: cfg.ad_key_devices,
          maxDevices: cfg.ad_key_devices,
          source: 'checkpoint',
          note: `${s.provider} · ${ip}`
        })
        key = made.key
        update.done = true
        update.key_plain_once = key
      }
      await db.from('checkpoint_sessions').update(update).eq('id', sid)
      return { step, steps: s.steps, done: step >= s.steps, key }
    }

    throw new HttpError(400, 'Unknown action.')
  })
)
