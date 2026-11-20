import { ArrowRight, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import logo from '../assets/luger-logo.png'
import { Avatar } from '../components/identity'
import { invoke, on } from '../lib/bridge'
import { money } from '../lib/format'
import { fail, toast, useStore } from '../lib/state'

const PROVIDERS = [
  { id: 'lootlabs', name: 'LootLabs', note: 'Usually the quickest' },
  { id: 'linkvertise', name: 'Linkvertise', note: 'Short wait, familiar page' },
  { id: 'workink', name: 'Work.ink', note: 'Light ads' }
]

export default function KeyGate() {
  const detected = useStore((s) => s.detected)
  const info = useStore((s) => s.info)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [provider, setProvider] = useState('lootlabs')
  const [prices, setPrices] = useState<any>(null)
  const [cp, setCp] = useState<{ step: number; steps: number } | null>(null)
  const [live, setLive] = useState<string[] | null>(null)

  useEffect(() => {
    invoke('prices').then(setPrices).catch(() => setPrices(null))
    invoke('session:providers').then((r) => {
      setLive(r.providers)
      if (r.providers.length) setProvider((p) => (r.providers.includes(p) ? p : r.providers[0]))
    }).catch(() => setLive(null))
    return on('session:checkpoint', (c) => c && !c.key && setCp({ step: c.step, steps: c.steps }))
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

  async function free() {
    setBusy('free')
    setCp({ step: 0, steps: 2 })
    try {
      await invoke('session:freeKey', provider)
      toast('Your free key is active.', 'reward', 'Welcome to Luger')
    } catch (e) {
      fail(e)
    } finally {
      setBusy(null)
      setCp(null)
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

        <div className="spread"><h2 className="gate-h">Free key</h2><span className="muted small">A few short ad checkpoints</span></div>
        {cp ? (
          <div className="gate-progress">
            <div className="track">{Array.from({ length: cp.steps }, (_, i) => <span key={i} className={i < cp.step ? 'on' : ''} />)}</div>
            <p className="muted small">Finish the checkpoints in your browser. Luger picks up the key by itself. Checkpoint {Math.min(cp.step + 1, cp.steps)} of {cp.steps}.</p>
          </div>
        ) : (
          <div className="providers" role="radiogroup" aria-label="Ad provider">
            {PROVIDERS.filter((p) => !live || live.includes(p.id)).map((p) => (
              <button key={p.id} role="radio" aria-checked={provider === p.id} className="provider" onClick={() => setProvider(p.id)}>
                <b>{p.name}</b><span className="muted small">{p.note}</span>
              </button>
            ))}
          </div>
        )}
        <button className="btn lg" style={{ width: '100%' }} onClick={free} disabled={!!busy || live?.length === 0}>{busy === 'free' ? <><Loader2 size={16} className="spin" />Waiting for checkpoints</> : 'Get a free key'}</button>

        <div className="divider" />

        <div className="spread"><h2 className="gate-h">Skip the ads</h2><span className="muted small">{prices?.keys?.[0]?.local?.currency && prices.keys[0].local.currency !== 'GBP' ? 'Prices in your currency' : 'Charged in your currency'}</span></div>
        <div className="plans">
          {(prices?.keys ?? [
            { id: 'key.weekly', name: 'Weekly', gbp: 4.99 }, { id: 'key.monthly', name: 'Monthly', gbp: 9.99 }, { id: 'key.lifetime', name: 'Lifetime', gbp: 19.99 }
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
      </section>
    </div>
  )
}
