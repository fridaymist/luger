export function hours(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  const h = seconds / 3600
  return h < 10 ? `${h.toFixed(1)}h` : `${Math.round(h).toLocaleString()}h`
}
export function money(amount: number, currency: string, locale?: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(amount)
  } catch {
    return `${amount.toFixed(2)} ${currency}`
  }
}
export function ago(iso: string | number): string {
  const t = typeof iso === 'number' ? iso : Date.parse(iso)
  const d = (Date.now() - t) / 1000
  if (d < 90) return 'just now'
  if (d < 3600) return `${Math.round(d / 60)} min ago`
  if (d < 86400) return `${Math.round(d / 3600)} h ago`
  if (d < 86400 * 30) return `${Math.round(d / 86400)} d ago`
  return new Date(t).toLocaleDateString()
}
export function compact(n: number): string {
  return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}
export function greeting(d = new Date()): string {
  const h = d.getHours()
  if (h < 5) return 'Good night'
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  if (h < 22) return 'Good evening'
  return 'Good night'
}
export function duration(seconds: number | null): string {
  if (seconds === null) return 'Lifetime'
  const d = seconds / 86400
  if (d >= 1 && Number.isInteger(d)) return `${d} day${d === 1 ? '' : 's'}`
  const h = seconds / 3600
  if (h >= 1 && Number.isInteger(h)) return `${h} hour${h === 1 ? '' : 's'}`
  return `${Math.round(seconds / 60)} min`
}
