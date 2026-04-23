const REFRESH_MS = 30_000

// ── Helpers ────────────────────────────────────────────────────────────────

function fmt(n) {
  if (n === null || n === undefined) return '—'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

function fmtMoney(n, currency = 'USD') {
  if (n === null || n === undefined) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n)
}

function fmtDate(ts) {
  return new Date(ts * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

function setText(id, val) {
  const el = document.getElementById(id)
  if (el) el.textContent = val
}

function removeSkeleton(el) {
  if (el) el.classList.remove('skeleton')
}

function removeSkelArr(ids) {
  ids.forEach(id => removeSkeleton(document.getElementById(id)))
}

// ── Health ─────────────────────────────────────────────────────────────────

function renderHealth(data) {
  if (!data) return

  const globalEl = document.getElementById('global-status')
  const labelEl = globalEl.querySelector('.status-label')
  globalEl.className = 'global-status'

  if (data.overall === 'up') {
    globalEl.classList.add('all-up')
    labelEl.textContent = 'All systems operational'
  } else if (data.overall === 'degraded') {
    globalEl.classList.add('degraded')
    labelEl.textContent = 'Degraded performance'
  } else {
    globalEl.classList.add('down')
    labelEl.textContent = 'Outage detected'
  }

  for (const app of data.apps) {
    const pill = document.getElementById(`pill-${app.id}`)
    if (!pill) continue

    pill.className = `status-pill ${app.status}`
    pill.querySelector('.pill-label').textContent = app.status.toUpperCase()

    const latencyEl = document.getElementById(`latency-${app.id}`)
    if (latencyEl) {
      latencyEl.textContent = app.latency != null ? `${app.latency}ms` : '—'
      // colour-code by latency
      latencyEl.style.color =
        app.latency == null ? '' :
        app.latency < 400  ? 'var(--green)' :
        app.latency < 1000 ? 'var(--yellow)' : 'var(--red)'
    }

    setText(`code-${app.id}`, app.statusCode ?? '—')
    removeSkeleton(document.getElementById(`health-${app.id}`))
  }

  // timestamp
  const checked = data.apps[0]?.checkedAt
  if (checked) {
    document.getElementById('health-checked-at').textContent =
      'Checked at ' + new Date(checked).toLocaleTimeString()
  }
}

// ── Stripe ─────────────────────────────────────────────────────────────────

function renderStripe(data) {
  const unconfigured = document.getElementById('stripe-unconfigured')
  const content = document.getElementById('stripe-content')

  if (!data || !data.configured) {
    unconfigured.style.display = 'flex'
    content.style.display = 'none'
    return
  }

  if (data.error) {
    document.getElementById('stripe-note').textContent = 'Error loading Stripe data'
    return
  }

  setText('stripe-mrr', fmtMoney(data.mrr))
  setText('stripe-rev30', fmtMoney(data.revenue30d))
  setText('stripe-subs', fmt(data.activeSubscriptions))
  setText('stripe-newsubs', '+' + fmt(data.newSubscriptions30d))

  removeSkelArr(['stripe-mrr', 'stripe-rev30', 'stripe-subs', 'stripe-newsubs'].map(
    id => document.getElementById(id)?.closest('.metric-card')?.id
  ).filter(Boolean))
  document.querySelectorAll('.metric-card').forEach(el => el.classList.remove('skeleton'))

  const tbody = document.getElementById('charges-tbody')
  if (!tbody) return

  if (!data.recentCharges?.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="color:var(--text-faint);text-align:center;padding:20px">No recent charges</td></tr>'
    return
  }

  tbody.innerHTML = data.recentCharges.map(c => `
    <tr>
      <td>${escHtml(c.description)}</td>
      <td style="font-weight:600;color:var(--text)">${fmtMoney(c.amount / 100, c.currency)}</td>
      <td><span class="charge-status ${c.status}">${c.status}</span></td>
      <td>${fmtDate(c.created)}</td>
    </tr>
  `).join('')
}

// ── PostHog ────────────────────────────────────────────────────────────────

function renderPosthog(data) {
  const unconfigured = document.getElementById('posthog-unconfigured')

  if (!data || !data.configured) {
    unconfigured.style.display = 'flex'
    document.getElementById('analytics-grid').style.display = 'none'
    return
  }

  if (data.error) {
    document.getElementById('analytics-grid').innerHTML =
      `<div style="color:var(--text-faint);font-size:13px">Error loading PostHog data</div>`
    return
  }

  renderAppAnalytics('crevaxo', data.crevaxo)
  renderAppAnalytics('rostura', data.rostura)
}

function renderAppAnalytics(appId, d) {
  if (!d) {
    document.getElementById(`analytics-${appId}`).innerHTML +=
      `<div style="color:var(--text-faint);font-size:12px">Project ID not configured</div>`
    return
  }

  setText(`ph-${appId}-pv`, fmt(d.pageviews7d))
  setText(`ph-${appId}-sessions`, fmt(d.sessions7d))
  setText(`ph-${appId}-visitors`, fmt(d.uniqueVisitors7d))

  document.querySelectorAll(`#analytics-${appId} .astat`).forEach(el => el.classList.remove('skeleton'))

  // Top pages
  const list = document.getElementById(`tp-${appId}-list`)
  if (list) {
    if (!d.topPages?.length) {
      list.innerHTML = '<span style="color:var(--text-faint);font-size:12px">No data</span>'
    } else {
      const maxViews = Math.max(...d.topPages.map(p => p.views))
      list.classList.remove('skeleton-list')
      list.innerHTML = d.topPages.map(p => {
        const pct = maxViews > 0 ? Math.round((p.views / maxViews) * 100) : 0
        const label = p.url ? p.url.replace(/^https?:\/\/[^/]+/, '') || '/' : '/'
        return `
          <div class="top-page-row">
            <span class="tp-url" title="${escHtml(p.url || '/')}">${escHtml(label)}</span>
            <div class="tp-bar-wrap"><div class="tp-bar" style="width:${pct}%"></div></div>
            <span class="tp-views">${fmt(p.views)}</span>
          </div>
        `
      }).join('')
    }
  }

  // Sparkline
  drawSparkline(`spark-${appId}`, d.dailyTrend || [], appId)
  renderGeoMap(appId, d.countryValues || {}, d.countryList || [])
}

// ── Geo map ────────────────────────────────────────────────────────────────

const _maps = {}

function renderGeoMap(appId, countryValues, countryList) {
  const container = document.getElementById(`map-${appId}`)
  if (!container) return

  // Destroy previous instance on refresh
  if (_maps[appId]) {
    try { _maps[appId].destroy() } catch (_) {}
    container.innerHTML = ''
  }

  const isOrange = appId === 'crevaxo'
  const scaleHigh = isOrange ? '#f97316' : '#14b8a6'
  const scaleLow  = isOrange ? '#3d1500' : '#002b26'

  if (typeof jsVectorMap === 'undefined' || !Object.keys(countryValues).length) {
    container.innerHTML = '<span style="color:var(--text-faint);font-size:12px;padding:8px 0;display:block">No geographic data</span>'
    return
  }

  _maps[appId] = new jsVectorMap({
    selector: `#map-${appId}`,
    map: 'world',
    zoomOnScroll: false,
    zoomButtons: false,
    backgroundColor: 'transparent',
    regionStyle: {
      initial: { fill: '#1e1e1e', stroke: '#111', strokeWidth: 0.4 },
      hover:   { fill: isOrange ? '#f9731644' : '#14b8a644', cursor: 'default' },
    },
    series: {
      regions: [{
        values: countryValues,
        scale: [scaleLow, scaleHigh],
        normalizeFunction: 'polynomial',
      }],
    },
    onRegionTooltipShow(event, tooltip, code) {
      const val = countryValues[code]
      if (val) tooltip.text(`${tooltip.text()} — ${fmt(val)} views`)
    },
  })

  // Country table below map
  const listEl = document.getElementById(`country-${appId}`)
  if (!listEl || !countryList.length) return

  const max = countryList[0].pageviews
  listEl.innerHTML = countryList.slice(0, 8).map(c => {
    const flag = c.code.toUpperCase().replace(/./g, ch =>
      String.fromCodePoint(127397 + ch.charCodeAt(0))
    )
    const pct = max > 0 ? Math.round((c.pageviews / max) * 100) : 0
    return `
      <div class="country-row">
        <span class="country-flag">${flag}</span>
        <span class="country-name">${escHtml(c.name)}</span>
        <div class="tp-bar-wrap"><div class="tp-bar" style="width:${pct}%"></div></div>
        <span class="tp-views">${fmt(c.pageviews)}</span>
      </div>
    `
  }).join('')
}

function drawSparkline(canvasId, trend, appId) {
  const canvas = document.getElementById(canvasId)
  if (!canvas || !trend.length) return

  const ctx = canvas.getContext('2d')
  const dpr = window.devicePixelRatio || 1
  const w = canvas.offsetWidth || 300
  const h = canvas.offsetHeight || 48

  canvas.width = w * dpr
  canvas.height = h * dpr
  ctx.scale(dpr, dpr)

  const values = trend.map(t => t.pageviews)
  const max = Math.max(...values, 1)
  const pad = 4

  const color = appId === 'crevaxo' ? '#f97316' : '#14b8a6'

  // Gradient fill
  const grad = ctx.createLinearGradient(0, 0, 0, h)
  grad.addColorStop(0, color + '33')
  grad.addColorStop(1, color + '00')

  ctx.beginPath()
  values.forEach((v, i) => {
    const x = pad + (i / (values.length - 1)) * (w - pad * 2)
    const y = h - pad - ((v / max) * (h - pad * 2))
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
  })

  // Close path for fill
  const lastX = pad + ((values.length - 1) / (values.length - 1)) * (w - pad * 2)
  ctx.lineTo(lastX, h)
  ctx.lineTo(pad, h)
  ctx.closePath()
  ctx.fillStyle = grad
  ctx.fill()

  // Line
  ctx.beginPath()
  values.forEach((v, i) => {
    const x = pad + (i / (values.length - 1)) * (w - pad * 2)
    const y = h - pad - ((v / max) * (h - pad * 2))
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
  })
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5
  ctx.lineJoin = 'round'
  ctx.stroke()
}

// ── Refresh logic ──────────────────────────────────────────────────────────

let refreshTimer = null

async function loadAll() {
  const btn = document.getElementById('refresh-btn')
  btn.classList.add('spinning')

  const [health, stripe, posthog] = await Promise.allSettled([
    fetch('/api/health').then(r => r.json()),
    fetch('/api/stripe').then(r => r.json()),
    fetch('/api/posthog').then(r => r.json()),
  ])

  renderHealth(health.status === 'fulfilled' ? health.value : null)
  renderStripe(stripe.status === 'fulfilled' ? stripe.value : null)
  renderPosthog(posthog.status === 'fulfilled' ? posthog.value : null)

  const now = new Date()
  document.getElementById('last-updated').textContent =
    'Updated ' + now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  btn.classList.remove('spinning')

  clearTimeout(refreshTimer)
  refreshTimer = setTimeout(loadAll, REFRESH_MS)
}

document.getElementById('refresh-btn').addEventListener('click', () => {
  clearTimeout(refreshTimer)
  loadAll()
})

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

loadAll()
