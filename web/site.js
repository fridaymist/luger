// Small helper shared by the key pages.
async function call(fn, body) {
  const res = await fetch(`${window.LUGER.functions}/${fn}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  })
  const data = await res.json().catch(() => ({ error: 'The server sent an unexpected reply.' }))
  if (!res.ok || data.error) throw new Error(data.error || `Request failed (${res.status})`)
  return data
}
function $(sel) { return document.querySelector(sel) }
function show(el, on) { el.hidden = !on }
async function copy(text, btn) {
  try { await navigator.clipboard.writeText(text); btn.textContent = 'Copied'; setTimeout(() => (btn.textContent = 'Copy key'), 1500) } catch { /* clipboard blocked */ }
}
