// Cookie notice. lugerhub.fun only uses essential storage, so this is a notice, not a consent wall.
(() => {
  try { if (localStorage.getItem('luger.cookies') === 'ok') return } catch { return }
  const bar = document.createElement('div')
  bar.className = 'cookie'
  bar.setAttribute('role', 'region')
  bar.setAttribute('aria-label', 'Cookie notice')
  bar.innerHTML = '<p>Luger only uses essential storage to keep this site working and secure. No tracking or advertising cookies. <a href="/cookies/">Cookie policy</a></p><button class="btn sm primary" type="button">Got it</button>'
  document.body.appendChild(bar)
  requestAnimationFrame(() => setTimeout(() => bar.classList.add('show'), 600))
  bar.querySelector('button').addEventListener('click', () => {
    try { localStorage.setItem('luger.cookies', 'ok') } catch {}
    bar.classList.remove('show')
    setTimeout(() => bar.remove(), 600)
  })
})()
