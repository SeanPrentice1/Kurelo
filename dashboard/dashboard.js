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

function fmtDuration(secs) {
  if (!secs) return '0s'
  const m = Math.floor(secs / 60)
  const s = Math.round(secs % 60)
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

function fmtPct(n) {
  return (Number(n) || 0).toFixed(1) + '%'
}

function timeAgo(ts) {
  if (!ts) return '—'
  const secs = Math.floor((Date.now() - new Date(ts)) / 1000)
  if (secs < 60) return 'Just now'
  if (secs < 3600) return Math.floor(secs / 60) + 'm ago'
  if (secs < 86400) return Math.floor(secs / 3600) + 'h ago'
  if (secs < 86400 * 30) return Math.floor(secs / 86400) + 'd ago'
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function fmtJoined(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function setText(id, val) {
  const el = document.getElementById(id)
  if (el) el.textContent = val
}

function removeSkeleton(el) {
  if (el) el.classList.remove('skeleton')
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ── Breakdown list helper ──────────────────────────────────────────────────

function renderBreakdownList(elId, items, labelKey, valueKey, color = 'var(--kurelo)') {
  const el = document.getElementById(elId)
  if (!el) return
  if (!items?.length) {
    el.innerHTML = '<span style="color:var(--text-faint);font-size:11px">No data</span>'
    return
  }
  const max = Math.max(...items.map(i => Number(i[valueKey]) || 0), 1)
  el.innerHTML = items.map(item => {
    const val = Number(item[valueKey]) || 0
    const pct = Math.round((val / max) * 100)
    const raw = String(item[labelKey] ?? '—')
    const label = raw.replace(/^https?:\/\/[^/]+/, '') || '/'
    return `
      <div class="top-page-row">
        <span class="tp-url" title="${escHtml(raw)}">${escHtml(label)}</span>
        <div class="tp-bar-wrap"><div class="tp-bar" style="width:${pct}%;background:${color}"></div></div>
        <span class="tp-views">${fmt(val)}</span>
      </div>
    `
  }).join('')
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
      latencyEl.style.color =
        app.latency == null ? '' :
        app.latency < 400  ? 'var(--green)' :
        app.latency < 1000 ? 'var(--yellow)' : 'var(--red)'
    }

    setText(`code-${app.id}`, app.statusCode ?? '—')
    removeSkeleton(document.getElementById(`health-${app.id}`))
  }

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

  const color = appId === 'crevaxo' ? 'var(--crevaxo)' : 'var(--rostura)'

  // Core stats
  setText(`ph-${appId}-pv`, fmt(d.pageviews7d))
  setText(`ph-${appId}-sessions`, fmt(d.sessions7d))
  setText(`ph-${appId}-visitors`, fmt(d.uniqueVisitors7d))
  setText(`ph-${appId}-bounce`, fmtPct(d.bounceRate))
  setText(`ph-${appId}-duration`, fmtDuration(d.avgSessionDuration))

  document.querySelectorAll(`#analytics-${appId} .astat`).forEach(el => el.classList.remove('skeleton'))

  // New vs returning bar
  const total = (d.newUsers7d || 0) + (d.returningUsers7d || 0)
  const newPct = total > 0 ? Math.round((d.newUsers7d / total) * 100) : 50
  setText(`ph-${appId}-new`, fmt(d.newUsers7d))
  setText(`ph-${appId}-returning`, fmt(d.returningUsers7d))
  const bar = document.getElementById(`nr-${appId}-bar`)
  if (bar) bar.style.width = newPct + '%'

  // Breakdown lists
  renderBreakdownList(`tp-${appId}-list`, d.topPages, 'url', 'views', color)
  renderBreakdownList(`te-${appId}-list`, d.topEvents, 'event', 'count', color)
  renderBreakdownList(`src-${appId}-list`, d.referrers, 'source', 'pageviews', color)
  renderBreakdownList(`dev-${appId}-list`, d.devices, 'device', 'pageviews', color)
  renderBreakdownList(`br-${appId}-list`, d.browsers, 'browser', 'pageviews', color)
  renderBreakdownList(`os-${appId}-list`, d.os, 'os', 'pageviews', color)

  // Sparkline + geo
  drawSparkline(`spark-${appId}`, d.dailyTrend || [], appId)
  renderGeoMap(appId, d.countryValues || {}, d.countryList || [])
}

// ── Geo map ────────────────────────────────────────────────────────────────

const _maps = {}

function renderGeoMap(appId, countryValues, countryList) {
  const container = document.getElementById(`map-${appId}`)
  if (!container) return

  if (_maps[appId]) {
    try { _maps[appId].destroy() } catch (_) {}
    container.innerHTML = ''
  }

  const isOrange = appId === 'crevaxo'
  const scaleHigh = isOrange ? '#f97316' : '#14b8a6'
  const scaleLow  = isOrange ? '#150800' : '#001a17'

  if (typeof jsVectorMap === 'undefined' || !Object.keys(countryValues).length) {
    container.innerHTML = '<span style="color:var(--text-faint);font-size:12px;padding:8px 0;display:block">No geographic data</span>'
    return
  }

  requestAnimationFrame(() => {
    _maps[appId] = new jsVectorMap({
      selector: `#map-${appId}`,
      map: 'world',
      zoomOnScroll: false,
      zoomButtons: false,
      backgroundColor: 'transparent',
      regionStyle: {
        initial: { fill: '#1e1e1e', stroke: '#111', strokeWidth: 0.4 },
        hover:   { fill: isOrange ? 'rgba(249,115,22,0.3)' : 'rgba(20,184,166,0.3)', cursor: 'default' },
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
  })

  const listEl = document.getElementById(`country-${appId}`)
  if (!listEl || !countryList.length) return

  const barColor = isOrange ? 'var(--crevaxo)' : 'var(--rostura)'
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
        <div class="tp-bar-wrap"><div class="tp-bar" style="width:${pct}%;background:${barColor}"></div></div>
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

  const grad = ctx.createLinearGradient(0, 0, 0, h)
  grad.addColorStop(0, color + '33')
  grad.addColorStop(1, color + '00')

  ctx.beginPath()
  values.forEach((v, i) => {
    const x = pad + (i / (values.length - 1)) * (w - pad * 2)
    const y = h - pad - ((v / max) * (h - pad * 2))
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
  })

  const lastX = pad + ((values.length - 1) / (values.length - 1)) * (w - pad * 2)
  ctx.lineTo(lastX, h)
  ctx.lineTo(pad, h)
  ctx.closePath()
  ctx.fillStyle = grad
  ctx.fill()

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

// ── Crevaxo App Data ───────────────────────────────────────────────────────

function renderCrevaxo(data) {
  const unconfigured = document.getElementById('crevaxo-unconfigured')
  const content = document.getElementById('crevaxo-content')

  if (!data || !data.configured) {
    if (unconfigured) unconfigured.style.display = 'flex'
    if (content) content.style.display = 'none'
    return
  }

  if (data.error) {
    if (content) content.innerHTML =
      `<div style="color:var(--text-faint);font-size:13px">Error: ${escHtml(data.error)}</div>`
    return
  }

  // Platform stats
  const p = data.platform || {}
  setText('cx-total-users', fmt(p.totalUsers))
  setText('cx-new-users', fmt(p.newUsers30d))
  setText('cx-active-subs', fmt(p.activeSubscriptions))

  // Plan breakdown bars
  const plans = data.users?.planBreakdown || {}
  const totalU = p.totalUsers || 1
  ;['free', 'creator', 'studio'].forEach(plan => {
    const n = plans[plan] || 0
    const pct = Math.round((n / totalU) * 100)
    const barEl = document.getElementById(`pb-${plan}`)
    const labelEl = document.getElementById(`pb-${plan}-n`)
    if (barEl) barEl.style.width = pct + '%'
    if (labelEl) labelEl.textContent = n
  })
  document.querySelectorAll('#cx-plan-breakdown .plan-row').forEach(el => el.classList.remove('skeleton'))
  document.querySelectorAll('#crevaxo-content .metric-card').forEach(el => el.classList.remove('skeleton'))

  renderGuestMode(data.guestMode)
  renderAiUsage(data.aiUsage)
  renderUsers(data.users?.list || [])
}

function renderGuestMode(gm) {
  if (!gm) return

  setText('cx-guest-sessions', fmt(gm.totalSessions))
  setText('cx-converted', fmt(gm.converted))
  setText('cx-conv-rate', (gm.conversionRate || 0) + '%')
  setText('cx-avg-time', fmtDuration(gm.avgActiveSeconds))

  const total = gm.totalSessions || 1
  setText('fc-started', fmt(gm.totalSessions))
  setText('fc-stayed', fmt(gm.timerExpired))
  setText('fc-converted', fmt(gm.converted))

  const stayedPct  = Math.round(((gm.timerExpired || 0) / total) * 100)
  const convPct    = Math.round(((gm.converted    || 0) / total) * 100)
  const fbStayed   = document.getElementById('fb-stayed')
  const fbConverted = document.getElementById('fb-converted')
  if (fbStayed)    fbStayed.style.width    = stayedPct + '%'
  if (fbConverted) fbConverted.style.width = convPct   + '%'

  // Gate hits
  const gateHits = gm.gateHits || {}
  const gateEntries = Object.entries(gateHits).sort((a, b) => b[1] - a[1])
  const gateTitle = document.getElementById('cx-gate-title')
  const gateEl    = document.getElementById('cx-gate-hits')

  if (gateEntries.length && gateTitle && gateEl) {
    gateTitle.style.display = ''
    const max = gateEntries[0][1]
    gateEl.innerHTML = gateEntries.slice(0, 6).map(([feat, count]) => {
      const pct = max > 0 ? Math.round((count / max) * 100) : 0
      return `
        <div class="top-page-row">
          <span class="tp-url">${escHtml(feat)}</span>
          <div class="tp-bar-wrap"><div class="tp-bar" style="width:${pct}%;background:var(--crevaxo)"></div></div>
          <span class="tp-views">${fmt(count)}</span>
        </div>
      `
    }).join('')
  }
}

function renderAiUsage(ai) {
  if (!ai) return

  setText('cx-ai-calls-today',  fmt(ai.todayCalls))
  setText('cx-ai-tokens-today', fmt(ai.todayTokens))
  setText('cx-ai-cost-today',   ai.todayCost != null ? '$' + Number(ai.todayCost).toFixed(4) : '—')
  setText('cx-ai-calls-30d',    fmt(ai.total30dCalls))

  const featEl = document.getElementById('cx-ai-features')
  if (featEl) {
    if (ai.byFeature?.length) {
      const max = ai.byFeature[0].calls
      featEl.innerHTML = ai.byFeature.slice(0, 6).map(f => {
        const pct = max > 0 ? Math.round((f.calls / max) * 100) : 0
        return `
          <div class="top-page-row">
            <span class="tp-url">${escHtml(f.feature)}</span>
            <div class="tp-bar-wrap"><div class="tp-bar" style="width:${pct}%;background:var(--kurelo)"></div></div>
            <span class="tp-views">${fmt(f.calls)}</span>
          </div>
        `
      }).join('')
    } else {
      featEl.innerHTML = '<span style="color:var(--text-faint);font-size:11px">No data</span>'
    }
  }

  const topUsersEl = document.getElementById('cx-ai-top-users')
  if (topUsersEl) {
    if (ai.topUsers?.length) {
      const max = ai.topUsers[0].calls
      topUsersEl.innerHTML = ai.topUsers.map(u => {
        const pct = max > 0 ? Math.round((u.calls / max) * 100) : 0
        const shortId = u.userId ? u.userId.slice(0, 8) + '…' : '—'
        return `
          <div class="top-page-row">
            <span class="tp-url" title="${escHtml(u.userId)}">${escHtml(shortId)}</span>
            <div class="tp-bar-wrap"><div class="tp-bar" style="width:${pct}%;background:var(--kurelo)"></div></div>
            <span class="tp-views">${fmt(u.calls)}</span>
          </div>
        `
      }).join('')
    } else {
      topUsersEl.innerHTML = '<span style="color:var(--text-faint);font-size:11px">No data</span>'
    }
  }
}

function renderUsers(list) {
  const tbody = document.getElementById('cx-users-tbody')
  if (!tbody) return

  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="color:var(--text-faint);text-align:center;padding:20px">No users</td></tr>'
    return
  }

  tbody.innerHTML = list.map(u => {
    const planCls = u.plan || 'free'
    const roles   = (u.roles || []).map(r => `<span class="role-badge">${escHtml(r)}</span>`).join(' ')
    const disabled = u.disabled ? ' <span style="color:var(--red);font-size:10px">(disabled)</span>' : ''
    const nameRow  = u.name ? `<br><span style="font-size:11px;color:var(--text-faint)">${escHtml(u.name)}</span>` : ''
    return `
      <tr>
        <td>${escHtml(u.email)}${disabled}${nameRow}</td>
        <td><span class="plan-badge ${planCls}">${escHtml(u.plan || 'free')}</span></td>
        <td>${roles || '<span style="color:var(--text-faint)">—</span>'}</td>
        <td style="color:var(--text-muted)">${timeAgo(u.lastSeen)}</td>
        <td style="color:var(--text-muted)">${fmtJoined(u.joined)}</td>
      </tr>
    `
  }).join('')
}

// ── Refresh logic ──────────────────────────────────────────────────────────

let refreshTimer = null

async function loadAll() {
  const btn = document.getElementById('refresh-btn')
  btn.classList.add('spinning')

  const [health, stripe, posthog, crevaxo] = await Promise.allSettled([
    fetch('/api/health').then(r => r.json()),
    fetch('/api/stripe').then(r => r.json()),
    fetch('/api/posthog').then(r => r.json()),
    fetch('/api/crevaxo').then(r => r.json()),
  ])

  renderHealth(health.status === 'fulfilled' ? health.value : null)
  renderStripe(stripe.status === 'fulfilled' ? stripe.value : null)
  renderPosthog(posthog.status === 'fulfilled' ? posthog.value : null)
  renderCrevaxo(crevaxo.status === 'fulfilled' ? crevaxo.value : null)

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

loadAll()
