import { BadgeCheck, Heart, Plus, Shield } from 'lucide-react'
import type { CSSProperties } from 'react'
import logo from '../assets/luger-logo.png'
import { catalog, themeById } from '../lib/catalog'

const ROLE_ORDER = ['owner', 'developer', 'editor', 'plus', 'supporter']
const ROLE_LABEL: Record<string, string> = { owner: 'Owner', developer: 'Developer', editor: 'Editor', plus: 'Luger Plus', supporter: 'Supporter' }

function LogoMark({ color, size }: { color: string; size: number }) {
  return (
    <span aria-hidden style={{
      display: 'inline-block', width: size * 1.45, height: size, background: color,
      WebkitMask: `url(${logo}) center / contain no-repeat`, mask: `url(${logo}) center / contain no-repeat`
    }} />
  )
}

export function RoleBadge({ role, size = 15 }: { role: string; size?: number }) {
  const title = ROLE_LABEL[role]
  if (!title) return null
  const wrap: CSSProperties = { display: 'inline-flex', alignItems: 'center', position: 'relative', flexShrink: 0 }
  let inner
  if (role === 'owner') inner = <LogoMark color="var(--owner)" size={size} />
  else if (role === 'plus') inner = (
    <span style={{ position: 'relative', display: 'inline-flex' }}>
      <img src={logo} alt="" style={{ width: size * 1.45, height: size, objectFit: 'contain' }} />
      <Plus size={size * 0.62} strokeWidth={4} style={{ position: 'absolute', right: -size * 0.28, top: -size * 0.32, color: 'var(--accent)' }} />
    </span>
  )
  else if (role === 'supporter') inner = <Heart size={size} fill="var(--supporter)" color="var(--supporter)" />
  else if (role === 'editor') inner = <span style={{ display: 'inline-grid', placeItems: 'center', width: size, height: size, borderRadius: 4, background: 'var(--editor)' }}><Plus size={size * 0.8} strokeWidth={3.4} color="#08180f" /></span>
  else inner = <Shield size={size} fill="color-mix(in srgb, var(--dev) 35%, transparent)" color="var(--dev)" />
  return <span style={wrap} title={title} aria-label={title} role="img">{inner}</span>
}

export function Badges({ roles = [], verified, size = 15 }: { roles?: string[]; verified?: boolean; size?: number }) {
  const sorted = ROLE_ORDER.filter((r) => roles.includes(r))
  if (!sorted.length && !verified) return null
  return (
    <span className="row" style={{ gap: 5 }}>
      {sorted.map((r) => <RoleBadge key={r} role={r} size={size} />)}
      {verified && <span title="Verified creator" aria-label="Verified creator" role="img" style={{ display: 'inline-flex' }}><BadgeCheck size={size + 1} color="var(--accent)" /></span>}
    </span>
  )
}

export function Name({ user, size = 15, at = false }: { user: any; size?: number; at?: boolean }) {
  if (!user) return <span className="muted">Unknown</span>
  return (
    <span className="row" style={{ gap: 6, minWidth: 0 }}>
      <span className="ellipsis" style={{ fontWeight: 600 }}>{at ? '@' : ''}{user.username}</span>
      <Badges roles={user.roles} verified={user.verified || user.creatorVerified} size={size - 2} />
    </span>
  )
}

const FRAME_STYLE: Record<string, CSSProperties> = {
  'frame.brass': { boxShadow: '0 0 0 3px #d9a53a, 0 0 0 5px #6b4c12' },
  'frame.bandolier': { outline: '3px dashed #d9a53a', outlineOffset: 2 },
  'frame.laurel': { boxShadow: '0 0 0 3px #4fb36d, 0 0 0 6px color-mix(in srgb, #4fb36d 35%, transparent)' },
  'frame.hook': { boxShadow: '0 0 0 3px #3fc7c2, 0 0 0 6px #0d3b3d' },
  'frame.comb': { boxShadow: '0 0 0 3px #f5b821, 0 0 0 6px #2b2108', borderRadius: '30%' },
  'frame.vine': { outline: '3px dotted #8fd14f', outlineOffset: 2 },
  'frame.halo': { boxShadow: '0 0 0 2px #e9dcff, 0 0 16px 4px #b48cff' },
  'frame.paw': { boxShadow: '0 0 0 3px #f29bb5, 0 0 0 6px #4a2330' },
  'frame.compass': { boxShadow: '0 0 0 3px #c9d1da, 0 0 0 6px #3a4048' }
}

export function Avatar({ src, size = 36, frame, name }: { src?: string | null; size?: number; frame?: string | null; name?: string }) {
  const style: CSSProperties = {
    width: size, height: size, borderRadius: '50%', flexShrink: 0, objectFit: 'cover',
    background: 'linear-gradient(135deg, var(--surface2), var(--line))', ...(frame ? FRAME_STYLE[frame] : {})
  }
  if (frame && FRAME_STYLE[frame]?.borderRadius) style.borderRadius = FRAME_STYLE[frame].borderRadius
  return src
    ? <img src={src} alt={name ? `${name}'s avatar` : ''} style={style} />
    : <span aria-hidden style={{ ...style, display: 'grid', placeItems: 'center', fontWeight: 700, color: 'var(--muted)', fontSize: size * 0.4 }}>{name?.[0]?.toUpperCase() ?? '?'}</span>
}

export const BANNERS: Record<string, string> = {
  'banner.range': 'repeating-linear-gradient(90deg, #2a2f38 0 38px, #232730 38px 40px), linear-gradient(#2a2f38, #1a1d23)',
  'banner.dusk': 'linear-gradient(120deg, #2b1d3a, #a3532f 60%, #e8b53a)',
  'banner.tide': 'radial-gradient(120% 140% at 10% 120%, #3fc7c2 0%, #12343a 45%, #0b1618 80%)',
  'banner.meadow': 'linear-gradient(160deg, #213b1c, #5a8f2d 55%, #c9dc6b)',
  'banner.static': 'repeating-radial-gradient(circle at 30% 40%, #2b2f37 0 2px, #1d2027 2px 5px)'
}

export function bannerBackground(url: string | null | undefined, theme?: string): string {
  if (url && BANNERS[url]) return BANNERS[url]
  if (url) return `center / cover no-repeat url("${url}")`
  const t = themeById.get(theme ?? 'theme.brass') ?? themeById.get('theme.brass')!
  return `linear-gradient(115deg, ${t.tokens.surface2} 0%, ${t.tokens.bg} 55%, color-mix(in srgb, ${t.tokens.accent} 40%, ${t.tokens.bg}) 100%)`
}

/** Animated profile effect layered over the banner. */
export function Effect({ id }: { id?: string | null }) {
  if (!id) return null
  const n = 18
  const kind = id.split('.')[1]
  return (
    <div className={`fx fx-${kind}`} aria-hidden>
      {Array.from({ length: n }, (_, i) => <i key={i} style={{ left: `${(i * 53) % 100}%`, animationDelay: `${(i * 0.37) % 4}s`, animationDuration: `${3 + (i % 5) * 0.7}s` }} />)}
    </div>
  )
}

export function GameIcon({ game, size = 48, radius = 10 }: { game?: any; size?: number; radius?: number }) {
  const style: CSSProperties = { width: size, height: size, borderRadius: radius, flexShrink: 0, objectFit: 'cover', background: 'var(--surface2)' }
  return game?.icon_url
    ? <img src={game.icon_url} alt="" style={style} loading="lazy" />
    : <span aria-hidden style={{ ...style, display: 'grid', placeItems: 'center', font: `700 ${size * 0.38}px var(--display)`, color: 'var(--muted)' }}>{game?.name?.[0] ?? '?'}</span>
}

/** A miniature of the Luger interface in a theme's colours. */
export function ThemePreview({ id, width = 168 }: { id: string; width?: number }) {
  const t = themeById.get(id)
  if (!t) return null
  const c = t.tokens
  const h = width * 0.62
  return (
    <svg width={width} height={h} viewBox="0 0 168 104" role="img" aria-label={`${t.name} theme preview`} style={{ borderRadius: 8, display: 'block' }}>
      <rect width="168" height="104" fill={c.bg} />
      <rect width="40" height="104" fill={c.surface} />
      <rect x="40" width="0.8" height="104" fill={c.line} />
      <rect x="7" y="9" width="10" height="6" rx="1.5" fill={c.accent} />
      <rect x="20" y="10" width="13" height="4" rx="2" fill={c.text} opacity=".9" />
      {[26, 36, 46, 56, 66].map((y, i) => (
        <g key={y}>
          <rect x="6" y={y} width="28" height="7" rx="2" fill={i === 0 ? c.surface2 : 'transparent'} />
          <rect x="10" y={y + 2.4} width={i === 0 ? 16 : 13} height="2.4" rx="1.2" fill={i === 0 ? c.text : c.muted} />
        </g>
      ))}
      <rect x="4" y={27} width="1.5" height="5" rx=".75" fill={c.accent} />
      <rect x="50" y="10" width="46" height="6" rx="2" fill={c.text} />
      <rect x="140" y="9" width="20" height="8" rx="2.5" fill={c.accent} />
      <rect x="50" y="24" width="110" height="34" rx="5" fill={c.surface} stroke={c.line} strokeWidth=".8" />
      <rect x="56" y="30" width="22" height="22" rx="4" fill={c.surface2} />
      <rect x="84" y="32" width="40" height="4" rx="2" fill={c.text} />
      <rect x="84" y="40" width="58" height="3" rx="1.5" fill={c.muted} />
      <rect x="84" y="47" width="30" height="4" rx="2" fill={c.accent} />
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <rect x={50 + i * 38} y="66" width="34" height="30" rx="5" fill={c.surface} stroke={c.line} strokeWidth=".8" />
          <rect x={55 + i * 38} y="71" width="24" height="12" rx="3" fill={c.surface2} />
          <rect x={55 + i * 38} y="87" width="18" height="3" rx="1.5" fill={c.muted} />
        </g>
      ))}
    </svg>
  )
}

export function Swatches({ id }: { id: string }) {
  const t = themeById.get(id)
  if (!t) return null
  return (
    <span className="row" style={{ gap: 3 }} aria-hidden>
      {(['bg', 'surface', 'text', 'accent'] as const).map((k) => <span key={k} style={{ width: 12, height: 12, borderRadius: 3, background: t.tokens[k], border: '1px solid rgba(127,127,127,.35)' }} />)}
    </span>
  )
}

export function Ammo({ n, size = 14 }: { n: number; size?: number }) {
  return (
    <span className="row num" style={{ gap: 5, fontWeight: 600 }} title="Ammo">
      <svg width={size * 0.5} height={size} viewBox="0 0 7 14" aria-hidden><path d="M1 6 Q1 1 3.5 0 Q6 1 6 6 Z" fill="#c9a24a" /><rect x="1" y="6" width="5" height="7" rx=".6" fill="#e8b53a" /><rect x="1" y="12" width="5" height="1.6" fill="#a8740f" /></svg>
      {n.toLocaleString()}
    </span>
  )
}

export function Crystals({ n, size = 14 }: { n: number; size?: number }) {
  return (
    <span className="row num" style={{ gap: 5, fontWeight: 600 }} title="Crystals">
      <svg width={size} height={size} viewBox="0 0 14 14" aria-hidden><path d="M7 0.5 L12.5 5 L7 13.5 L1.5 5 Z" fill="#8fd0ff" /><path d="M7 0.5 L12.5 5 L7 5.5 Z" fill="#cdeaff" /><path d="M1.5 5 L7 5.5 L7 13.5 Z" fill="#5aa9e6" /></svg>
      {n.toLocaleString()}
    </span>
  )
}

export function itemName(id: string): string {
  const t = themeById.get(id)
  if (t) return t.name
  return catalog.items.find((i) => i.id === id)?.name ?? id
}
