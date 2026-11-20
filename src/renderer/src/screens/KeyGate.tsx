import { ArrowRight, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import logo from '../assets/luger-logo.png'
import { Avatar } from '../components/identity'
import { invoke } from '../lib/bridge'
import { money } from '../lib/format'
import { fail, toast, useStore } from '../lib/state'

export default function KeyGate() {
  const detected = useStore((s) => s.detected)
  const info = useStore((s) => s.info)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [prices, setPrices] = useState<any>(null)

  useEffect(() => {
    invoke('prices').then(setPrices).catch(() => setPrices(null))

  }, [])

  async function redeem() {
    if (!key.trim()) return
    setBusy('redeem')
    try {
      await invoke('session:redeem', key.trim())
    } catch (e) {
      fail(e)
    } finally {
      setBusy(null)
    }
  }

  async function buy(product: string) {
    setBusy(product)
    try {
      await invoke('session:buy', product)
      toast('Your key is active. Thank you for supporting Luger.', 'reward', 'Payment received')
    } catch (e) {
      fail(e)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="gate">
      <div className="gate-drag drag" />
      <section className="gate-hero">
        <img src={logo} alt="Luger" className="gate-logo" />
        <h1>Load up.</h1>
        <p>Macros, an auto clicker, a recorder and a launcher for Roblox games that allow macros. Enter a key to start.</p>
        {detected?.name
          ? <div className="row gate-who"><Avatar src={detected.avatar} name={detected.name} size={28} /><span>Signed in to Roblox as <b>@{detected.name}</b></span></div>
          : <div className="gate-who muted small">Open Roblox once and Luger will recognise your account.</div>}
      </section>

      <section className="gate-panel panel">
        <label className="field">
          <span>Your key</span>
          <div className="row">
            <input className="input mono" placeholder="LUGER-XXXX-XXXX-XXXX-XXXX" value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && redeem()} autoFocus spellCheck={false} />
            <button className="btn primary" onClick={redeem} disabled={!key.trim() || !!busy}>{busy === 'redeem' ? <Loader2 size={16} className="spin" /> : <ArrowRight size={16} />}Unlock</button>
          </div>
        </label>

        <div className="divider" />

        <div className="spread"><h2 className="gate-h">Get a key</h2><span className="muted small">Free keys, giveaways and help</span></div>
        <p className="muted small" style={{ margin: '8px 0 12px' }}>Keys are handed out in the Luger Discord. Join, grab one, and paste it above.</p>
        <button className="btn lg discord-btn" style={{ width: '100%' }} onClick={() => invoke('app:discord')}>
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden><path fill="currentColor" d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.6 1.3a18.3 18.3 0 0 0-5.6 0L8.6 3a19.7 19.7 0 0 0-4.9 1.4C.6 9 -.3 13.5.1 18a19.9 19.9 0 0 0 6 3l1.3-2.1a12.9 12.9 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4a12.8 12.8 0 0 1-2 1l1.3 2.1a19.8 19.8 0 0 0 6-3c.5-5.2-.8-9.7-3.6-13.6ZM8 15.3c-1.2 0-2.2-1.1-2.2-2.4S6.8 10.5 8 10.5s2.2 1.1 2.2 2.4S9.2 15.3 8 15.3Zm8 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z"/></svg>
          Get a key on Discord
        </button>

        <div className="divider" />

        <div className="spread"><h2 className="gate-h">Skip the ads</h2><span className="muted small">{prices?.keys?.[0]?.local?.currency && prices.keys[0].local.currency !== 'GBP' ? 'Prices in your currency' : 'Charged in your currency'}</span></div>
        <div className="plans">
          {(prices?.keys ?? [
            { id: 'key.weekly', name: 'Weekly', gbp: 5.99 }, { id: 'key.monthly', name: 'Monthly', gbp: 11.99 }, { id: 'key.lifetime', name: 'Lifetime', gbp: 23.99 }
          ]).map((p: any) => (
            <button key={p.id} className={`plan${p.id === 'key.lifetime' ? ' best' : ''}`} onClick={() => buy(p.id)} disabled={!!busy}>
              <span className="muted small">{p.name}</span>
              <b className="num">{money(p.local?.amount ?? p.gbp, p.local?.currency ?? 'GBP', info?.locale)}</b>
              <span className="small muted">{p.recurring ? `per ${p.recurring}` : 'once, forever'}</span>
              {busy === p.id && <Loader2 size={14} className="spin" />}
            </button>
          ))}
        </div>
        <p className="muted small" style={{ margin: '10px 0 0' }}>Paid keys arrive here as soon as checkout finishes. Subscriptions can be cancelled any time.</p>
        <p className="muted small" style={{ margin: '14px 0 0' }}>By using Luger you agree to the <button className="linkish" onClick={() => invoke('app:open', 'https://lugerhub.fun/terms/')}>Terms</button> and <button className="linkish" onClick={() => invoke('app:open', 'https://lugerhub.fun/privacy/')}>Privacy Policy</button>.</p>
      </section>
    </div>
  )
}
