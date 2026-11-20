import { themeById } from './catalog'

function luminance(hex: string): number {
  const v = parseInt(hex.slice(1), 16)
  return (0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) / 255
}

export function applyTheme(id: string): void {
  const t = themeById.get(id) ?? themeById.get('theme.brass')!
  const root = document.documentElement
  for (const [k, v] of Object.entries(t.tokens)) root.style.setProperty(`--${k}`, v)
  if (luminance(t.tokens.bg) > 0.5) root.setAttribute('data-light', '')
  else root.removeAttribute('data-light')
}

export function applySettings(s: any): void {
  if (!s) return
  applyTheme(s.appTheme)
  const root = document.documentElement
  root.dataset.density = s.density
  if (s.reduceMotion) root.setAttribute('data-reduce-motion', '')
  else root.removeAttribute('data-reduce-motion')
}
