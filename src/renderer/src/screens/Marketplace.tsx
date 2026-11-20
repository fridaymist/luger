import { Check, Clock, Loader2, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Ammo, Avatar, BANNERS, Crystals, Effect, itemName, ThemePreview } from '../components/identity'
import { Empty, Modal, useAsync } from '../components/ui'
import { refreshMe } from '../lib/actions'
import { api, invoke } from '../lib/bridge'
import { catalog, itemById } from '../lib/catalog'
import { money } from '../lib/format'
import { fail, go, toast, useStore } from '../lib/state'

function useCountdown(iso?: string) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  if (!iso) return ''
  const left = Math.max(0, Date.parse(iso) - now) / 1000
  const h = Math.floor(left / 3600)
  const m = Math.floor((left % 3600) / 60)
  const s = Math.floor(left % 60)
  return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`
}

export default function Marketplace() {
  const me = useStore((s) => s.me)
  const pageArg = useStore((s) => s.pageArg)
  const shop = useAsync(() => api('shop.today'), [])
  const [crystals, setCrystals] = useState(false)
  const [buying, setBuying] = useState<any>(null)
  const left = useCountdown(shop.data?.resetsAt)
  const inv = new Set(me?.inventory ?? [])
  const unlockables = [...catalog.themes, ...catalog.items].filter((x: any) => x.unlock && x.price)

  useEffect(() => {
    if (pageArg?.item) {
      const it = itemById.get(pageArg.item)
      if (it?.price) setBuying({ id: it.id, crystals: it.price, ammo: it.price * catalog.ammoPerCrystal })
    }
    if (pageArg?.crystals) setCrystals(true)
  }, [pageArg])
  // Shop refreshes itself at the daily reset.
  useEffect(() => {
    if (left === '0h 00m 00s') shop.reload()
  }, [left]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!me?.verified) {
    return (
      <>
        <header className="topbar drag"><h1>Marketplace</h1></header>
        <div className="page"><Empty title="Prove your Roblox account to shop" action={<button className="btn primary" onClick={() => go('settings', { section: 'account' })}>Prove my account</button>}>Items belong to your Roblox account, so Luger needs a one-time check that it is yours.</Empty></div>
      </>
    )
  }

  return (
    <>
      <header className="topbar drag">
        <h1>Marketplace</h1>
        <span className="sub row" style={{ gap: 6 }}><Clock size={14} />New items in <span className="num">{left}</span></span>
        <div className="grow" />
        <div className="balances nodrag">
          <Ammo n={me.user?.ammo ?? 0} size={16} />
          <span className="bal-sep" />
          <Crystals n={me.user?.crystals ?? 0} size={16} />
          <button className="btn icon sm primary" aria-label="Buy crystals" title="Buy crystals" onClick={() => setCrystals(true)}><Plus size={15} /></button>
        </div>
      </header>
      <div className="page">
        {shop.loading ? <div className="skeleton" style={{ height: 300 }} /> : shop.error ? <Empty title="The shop could not load">{shop.error}</Empty> : (
          <>
            <div className="featured">
              {shop.data.featured.map((p: any) => <ShopItem key={p.id} p={p} owned={inv.has(p.id)} big onBuy={() => setBuying(p)} />)}
            </div>
            <h2 className="section">Today’s shop</h2>
            <div className="shopgrid">
              {shop.data.regular.map((p: any) => <ShopItem key={p.id} p={p} owned={inv.has(p.id)} onBuy={() => setBuying(p)} />)}
            </div>
            <h2 className="section">Achievement rewards <span className="muted">Earn them by playing, or buy them any day</span></h2>
            <div className="shopgrid">
              {unlockables.map((x: any) => <ShopItem key={x.id} p={{ id: x.id, crystals: x.price, ammo: x.price * catalog.ammoPerCrystal }} owned={inv.has(x.id)} onBuy={() => setBuying({ id: x.id, crystals: x.price, ammo: x.price * catalog.ammoPerCrystal })} />)}
            </div>
          </>
        )}
      </div>
      {buying && <Buy p={buying} onClose={() => setBuying(null)} onNeedCrystals={() => { setBuying(null); setCrystals(true) }} />}
      {crystals && <CrystalShop onClose={() => setCrystals(false)} />}
    </>
  )
}

export function ItemPreview({ id, big }: { id: string; big?: boolean }) {
  const it = itemById.get(id)
  const me = useStore((s) => s.me)
  const kind = it?.kind ?? (id.startsWith('theme.') ? 'theme' : '')
  if (kind === 'theme') return <ThemePreview id={id} width={big ? 280 : 200} />
  if (kind === 'frame') return <div className="prev prev-frame"><Avatar src={me?.user?.avatar_url} name={me?.user?.username} size={big ? 92 : 68} frame={id} /></div>
  if (kind === 'effect') return <div className="prev" style={{ background: 'linear-gradient(140deg, var(--surface2), var(--bg))' }}><Effect id={id} /></div>
  if (kind === 'banner') return <div className="prev" style={{ background: BANNERS[id] }} />
  if (kind === 'title') return <div className="prev prev-title"><span className="ptitle" style={{ fontSize: big ? 18 : 14 }}>{it.name}</span></div>
  return <div className="prev" />
}

function ShopItem({ p, owned, big, onBuy }: { p: any; owned: boolean; big?: boolean; onBuy: () => void }) {
  const it = itemById.get(p.id)
  const kind = it?.kind ?? 'theme'
  return (
    <button className={`shop-item${big ? ' big' : ''}${owned ? ' owned' : ''}`} onClick={owned ? undefined : onBuy} disabled={owned}>
      <ItemPreview id={p.id} big={big} />
      <div className="spread" style={{ alignItems: 'flex-end' }}>
        <div>
          <b>{itemName(p.id)}</b>
          <span className="muted small" style={{ display: 'block' }}>{({ theme: 'Theme', effect: 'Profile effect', frame: 'Avatar frame', banner: 'Banner', title: 'Title' } as Record<string, string>)[kind] ?? 'Item'}</span>
        </div>
        {owned ? <span className="chip"><Check size={12} />Owned</span> : (
          <span className="prices"><span className="price-pill"><Crystals n={p.crystals} size={13} /></span><span className="price-pill"><Ammo n={p.ammo} size={13} /></span></span>
        )}
      </div>
    </button>
  )
}

function Buy({ p, onClose, onNeedCrystals }: { p: any; onClose: () => void; onNeedCrystals: () => void }) {
  const me = useStore((s) => s.me)
  const [busy, setBusy] = useState<string | null>(null)
  const ammo = me?.user?.ammo ?? 0
  const cr = me?.user?.crystals ?? 0
  async function buy(currency: 'ammo' | 'crystals') {
    setBusy(currency)
    try {
      await api('shop.buy', { item: p.id, currency })
      await refreshMe()
      toast(`${itemName(p.id)} is yours. Find it in Edit profile${p.id.startsWith('theme.') ? ' or Themes' : ''}.`, 'reward', 'Bought')
      onClose()
    } catch (e) {
      fail(e)
    } finally {
      setBusy(null)
    }
  }
  return (
    <Modal title={itemName(p.id)} onClose={onClose}>
      <div className="buy-prev"><ItemPreview id={p.id} big /></div>
      <div className="buy-opts">
        <button className="buy-opt" disabled={!!busy || cr < p.crystals} onClick={() => buy('crystals')}>
          <Crystals n={p.crystals} size={18} />
          <span className="muted small">{cr < p.crystals ? `You have ${cr}` : `${cr - p.crystals} left after`}</span>
          {busy === 'crystals' && <Loader2 size={14} className="spin" />}
        </button>
        <button className="buy-opt" disabled={!!busy || ammo < p.ammo} onClick={() => buy('ammo')}>
          <Ammo n={p.ammo} size={18} />
          <span className="muted small">{ammo < p.ammo ? `You have ${ammo.toLocaleString()}` : `${(ammo - p.ammo).toLocaleString()} left after`}</span>
          {busy === 'ammo' && <Loader2 size={14} className="spin" />}
        </button>
      </div>
      {cr < p.crystals && ammo < p.ammo && <p className="muted small" style={{ marginBottom: 0 }}>Not enough of either yet. Ammo comes from achievements and playtime. <button className="linkish" onClick={onNeedCrystals}>Get crystals</button></p>}
    </Modal>
  )
}

function CrystalShop({ onClose }: { onClose: () => void }) {
  const info = useStore((s) => s.info)
  const prices = useAsync(() => invoke('prices'), [])
  const [busy, setBusy] = useState<string | null>(null)
  const base = catalog.crystalPacks[0].crystals / catalog.crystalPacks[0].gbp
  return (
    <Modal wide title="Crystals" onClose={onClose}>
      <p className="muted small" style={{ marginTop: 0 }}>Crystals buy anything in the shop straight away. Checkout charges in your own currency{prices.data?.keys?.[0]?.local?.currency !== 'GBP' ? '; prices shown are close estimates' : ''}. Crystals arrive in your balance as soon as payment goes through.</p>
      <div className="packs">
        {(prices.data?.crystals ?? catalog.crystalPacks).map((p: any) => {
          const bonus = Math.round(((p.crystals / p.gbp) / base - 1) * 100)
          return (
            <button key={p.id} className="pack" disabled={!!busy} onClick={async () => {
              setBusy(p.id)
              try {
                await invoke('api:checkoutCrystals', p.id)
                toast('Checkout opened in your browser. Your balance updates when payment finishes.')
                setTimeout(refreshMe, 15000)
              } catch (e) { fail(e) } finally { setBusy(null) }
            }}>
              <Crystals n={p.crystals} size={22} />
              {bonus >= 5 && <span className="chip pack-bonus">+{bonus}% extra</span>}
              <b className="num">{money(p.local?.amount ?? p.gbp, p.local?.currency ?? 'GBP', info?.locale)}</b>
              {busy === p.id && <Loader2 size={14} className="spin" />}
            </button>
          )
        })}
      </div>
    </Modal>
  )
}
