(() => {
  const cfg = window.LUGER || {}
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
  const $ = (s, r = document) => r.querySelector(s)
  const $$ = (s, r = document) => [...r.querySelectorAll(s)]

  // Links
  $$('[data-discord]').forEach((a) => { a.href = cfg.discord || 'https://discord.gg/zTnwbjHu4e'; a.target = '_blank'; a.rel = 'noopener' })
  $$('[data-download]').forEach((a) => { a.href = cfg.download || '#'; a.target = '_blank'; a.rel = 'noopener' })
  $('#year').textContent = new Date().getFullYear()

  // Reveal on scroll, staggered within each group
  const io = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return
      e.target.classList.add('in')
      io.unobserve(e.target)
    })
  }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' })
  $$('[data-reveal]').forEach((el) => {
    const sibs = $$(':scope > [data-reveal]', el.parentElement)
    el.style.setProperty('--d', `${Math.min(sibs.indexOf(el), 6) * 0.08}s`)
    io.observe(el)
  })
  // The mastery track animates when it arrives
  const mastery = $('.mastery')
  if (mastery) new IntersectionObserver(([e], o) => { if (e.isIntersecting) { mastery.classList.add('in'); o.disconnect() } }, { threshold: 0.5 }).observe(mastery)

  // Scroll: progress bar, solid nav, hero screenshot straightens out
  const nav = $('.nav')
  const frame = $('.shot-frame')
  const progress = $('.progress')
  let ticking = false
  function onScroll() {
    const y = scrollY
    const max = document.documentElement.scrollHeight - innerHeight
    progress.style.setProperty('--p', max > 0 ? (y / max).toFixed(4) : 0)
    nav.classList.toggle('solid', y > 20)
    if (frame && !reduce) {
      const t = Math.min(1, Math.max(0, y / (innerHeight * 0.7)))
      frame.style.setProperty('--rx', `${22 * (1 - t)}deg`)
      frame.style.setProperty('--sc', (0.92 + 0.08 * t).toFixed(3))
    }
    ticking = false
  }
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll) } }, { passive: true })
  onScroll()
  if (reduce && frame) { frame.style.setProperty('--rx', '0deg'); frame.style.setProperty('--sc', '1') }

  // Pointer: page spotlight and glowing card edges
  const spot = $('.spot')
  addEventListener('pointermove', (e) => {
    spot.style.setProperty('--sx', `${e.clientX}px`)
    spot.style.setProperty('--sy', `${e.clientY}px`)
  }, { passive: true })
  $$('[data-glow]').forEach((el) => el.addEventListener('pointermove', (e) => {
    const r = el.getBoundingClientRect()
    el.style.setProperty('--mx', `${e.clientX - r.left}px`)
    el.style.setProperty('--my', `${e.clientY - r.top}px`)
  }))

  // Screenshot tabs, auto-advancing while visible
  const tabs = $$('.tabs button')
  const img = $('#show')
  const bar = $('.tab-bar')
  let current = 0
  let timer = null
  tabs.forEach((t) => { const pre = new Image(); pre.src = `/assets/shots/${t.dataset.shot}.jpg` })
  function show(i, user) {
    current = (i + tabs.length) % tabs.length
    tabs.forEach((t, j) => t.setAttribute('aria-selected', j === current))
    img.classList.add('swap')
    setTimeout(() => { img.src = `/assets/shots/${tabs[current].dataset.shot}.jpg`; img.alt = `Luger ${tabs[current].textContent} screen`; img.classList.remove('swap') }, 220)
    restart(user)
  }
  function restart(stop) {
    clearTimeout(timer)
    bar.classList.remove('run'); void bar.offsetWidth
    if (stop || reduce) return
    bar.classList.add('run')
    timer = setTimeout(() => show(current + 1), 5000)
  }
  tabs.forEach((t, i) => t.addEventListener('click', () => show(i, true)))
  new IntersectionObserver(([e]) => (e.isIntersecting ? restart() : clearTimeout(timer)), { threshold: 0.3 }).observe($('.t-show'))

  // AutoHotkey → Python, typed out
  const snippets = [
    `<span class="c"># Converted from fisher.ahk</span>\n<span class="k">import</span> luger\n\n<span class="f">@luger.hotkey</span>(<span class="s">'f1'</span>)\n<span class="k">def</span> <span class="f">cast</span>():\n    luger.click(<span class="s">'mouse1'</span>, action=<span class="s">'down'</span>)\n    luger.wait_ms(<span class="s">600</span>)\n    luger.click(<span class="s">'mouse1'</span>, action=<span class="s">'up'</span>)\n\nluger.run()`,
    `<span class="c"># Converted from shake.ahk</span>\n<span class="k">import</span> luger\n\n<span class="k">def</span> <span class="f">check_shake</span>():\n    spot = luger.find_color(<span class="s">0xFFFFFF</span>, (<span class="s">100</span>, <span class="s">100</span>, <span class="s">400</span>, <span class="s">300</span>))\n    <span class="k">if</span> spot:\n        luger.click(<span class="s">'mouse1'</span>, *spot)\n\nluger.every(<span class="s">100</span>, check_shake)\nluger.run()`
  ]
  const pre = $('#code')
  let si = 0
  async function typeLoop() {
    for (;;) {
      const html = snippets[si % snippets.length]
      if (reduce) { pre.innerHTML = html; return }
      // Type visible characters while keeping the colour spans intact
      const tokens = html.split(/(<[^>]+>)/)
      let out = ''
      for (const tk of tokens) {
        if (tk.startsWith('<')) { out += tk; continue }
        for (const ch of tk) {
          out += ch
          pre.innerHTML = out + '<span class="caret"></span>'
          await new Promise((r) => setTimeout(r, ch === '\n' ? 70 : 16))
        }
      }
      await new Promise((r) => setTimeout(r, 2600))
      si++
    }
  }
  new IntersectionObserver(([e], o) => { if (e.isIntersecting) { typeLoop(); o.disconnect() } }, { threshold: 0.3 }).observe(pre)

  // Auto clicker counter wanders like a real one
  const cps = $('#cps')
  let n = 0
  setInterval(() => { n = n ? Math.max(8, Math.min(24, n + Math.round(Math.random() * 4 - 2))) : 16; cps.textContent = n }, 600)

  // Games marquee
  const games = [['fisch', 'Fisch', 'Endless mastery'], ['bss', 'Bee Swarm Simulator', '8 ranks'], ['gag', 'Grow a Garden', 'Endless mastery'], ['sols', "Sol's RNG", 'Endless mastery'], ['ps99', 'Pet Simulator 99', '5 ranks'], ['bloxfruits', 'Blox Fruits', '5 ranks']]
  const row = $('#games-row')
  const cards = games.map(([id, name, note]) => `<div class="game"><img src="/assets/games/${id}.png" alt="" loading="lazy"><div><b>${name}</b><span>${note}</span></div></div>`).join('')
  row.innerHTML = cards + cards.replace(/<div class="game">/g, '<div class="game" aria-hidden="true">')

  // Live numbers and local prices from the Luger server
  async function call(action, body = {}) {
    const r = await fetch(`${cfg.functions}/api`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, ...body }) })
    if (!r.ok) throw new Error(r.status)
    return r.json()
  }
  function countUp(el, to) {
    if (reduce || to < 5) { el.textContent = to.toLocaleString(); return }
    const start = performance.now()
    const dur = 1600
    const step = (now) => {
      const t = Math.min(1, (now - start) / dur)
      el.textContent = Math.round(to * (1 - Math.pow(1 - t, 3))).toLocaleString()
      if (t < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }
  const statsEl = $('.stats')
  new IntersectionObserver(([e], o) => {
    if (!e.isIntersecting) return
    o.disconnect()
    call('site.stats').then((s) => {
      // Numbers only appear once there is a real community to show.
      if ((s.players || 0) < 25) { statsEl.style.display = 'none'; return }
      $$('[data-count]').forEach((el) => countUp(el, Number(s[el.dataset.count]) || 0))
    })
      .catch(() => { statsEl.style.display = 'none' })
  }, { threshold: 0.4 }).observe(statsEl)

  // Buy on the website: Stripe checkout, then the thank-you page shows the key
  $$('[data-buy]').forEach((b) => b.addEventListener('click', async () => {
    const label = b.textContent
    b.setAttribute('aria-busy', 'true')
    b.textContent = 'Opening checkout…'
    $('#buy-err').textContent = ''
    try {
      const r = await call('checkout.web', { product: b.dataset.buy, locale: navigator.language })
      location.href = r.url
    } catch {
      $('#buy-err').textContent = 'Checkout could not open. Try again in a moment.'
      b.removeAttribute('aria-busy')
      b.textContent = label
    }
  }))

  const CUR = { GB: 'GBP', US: 'USD', CA: 'CAD', AU: 'AUD', NZ: 'NZD', IE: 'EUR', DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR', NL: 'EUR', BE: 'EUR', AT: 'EUR', PT: 'EUR', FI: 'EUR', GR: 'EUR', SE: 'SEK', NO: 'NOK', DK: 'DKK', PL: 'PLN', CZ: 'CZK', CH: 'CHF', JP: 'JPY', KR: 'KRW', IN: 'INR', BR: 'BRL', MX: 'MXN', ZA: 'ZAR', TR: 'TRY', SG: 'SGD', HK: 'HKD', PH: 'PHP', MY: 'MYR', ID: 'IDR', TH: 'THB' }
  const region = (navigator.language.split('-')[1] || '').toUpperCase()
  call('prices', { currency: CUR[region] || 'GBP' }).then((p) => {
    p.keys.forEach((k) => {
      const el = $(`[data-price="${k.id}"]`)
      if (el) el.textContent = new Intl.NumberFormat(navigator.language, { style: 'currency', currency: k.local.currency }).format(k.local.amount)
    })
  }).catch(() => {})
})()
