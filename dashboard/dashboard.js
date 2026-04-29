const REFRESH_MS = 30_000

// ── Supabase (Rostura project) ────────────────────────────────────────────
const _sb = (() => {
  if (typeof window.supabase === 'undefined') return null
  return window.supabase.createClient(
    'https://ovmlohgptdiryvlwztxz.supabase.co',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im92bWxvaGdwdGRpcnl2bHd6dHh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5ODQwNjYsImV4cCI6MjA5MTU2MDA2Nn0.oItHZhkUTmCPP9CO1-RacGyl8tD14pxdv71nxz6N3F4'
  )
})()

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

// ── Email groups ────────────────────────────────────────────────────────────

let _crevaxoEmailList = [] // full list cached from api/crevaxo

function getRecipients(group) {
  if (group === 'all') return _crevaxoEmailList.map(u => u.email).filter(Boolean)
  return _crevaxoEmailList.filter(u => u.plan === group).map(u => u.email).filter(Boolean)
}

function renderEmailGroups() {
  ;['all', 'creator', 'studio', 'free'].forEach(group => {
    const count = getRecipients(group).length
    const el = document.getElementById(`eg-count-${group}`)
    if (el) el.textContent = count
  })
  // Update modal recipient count if open
  updateModalRecipientCount()
}

function updateModalRecipientCount() {
  const group = document.getElementById('em-group')?.value || 'all'
  const count = getRecipients(group).length
  const recipientEl = document.getElementById('em-recipient-count')
  const sendCountEl = document.getElementById('em-send-count')
  if (recipientEl) recipientEl.textContent = `${count} recipient${count !== 1 ? 's' : ''}`
  if (sendCountEl) sendCountEl.textContent  = count
}

// ── Email composer modal ───────────────────────────────────────────────────

let _quill = null
let _htmlMode = false
let _templates = []  // local cache keyed by id

async function fetchTemplates() {
  if (!_sb) return
  const { data, error } = await _sb.from('cp_email_templates').select('*').order('name')
  if (!error) _templates = data ?? []
}

async function refreshTemplateSelect() {
  await fetchTemplates()
  const sel = document.getElementById('em-tpl-select')
  if (!sel) return
  sel.innerHTML = '<option value="">Load template…</option>' +
    _templates.map(t => `<option value="${t.id}">${escHtml(t.name)}</option>`).join('')
}

function getEditorHtml() {
  if (_htmlMode) {
    return document.getElementById('em-raw-html')?.value || ''
  }
  return _quill?.root?.innerHTML || ''
}

function setEditorHtml(html) {
  if (_htmlMode) {
    const raw = document.getElementById('em-raw-html')
    if (raw) raw.value = html
  } else if (_quill) {
    _quill.root.innerHTML = html
  }
}

async function openComposer(group = 'all') {
  const overlay = document.getElementById('em-overlay')
  if (!overlay) return

  // Init Quill once
  if (!_quill && typeof Quill !== 'undefined') {
    _quill = new Quill('#em-quill', {
      theme: 'snow',
      placeholder: 'Write your email…',
      modules: {
        toolbar: [
          ['bold', 'italic', 'underline'],
          [{ list: 'ordered' }, { list: 'bullet' }],
          ['link'],
          ['clean'],
        ],
      },
    })
  }

  // Pre-select group
  const groupSel = document.getElementById('em-group')
  if (groupSel) groupSel.value = group

  updateModalRecipientCount()
  await refreshTemplateSelect()

  // Reset status
  const status = document.getElementById('em-status')
  if (status) { status.textContent = ''; status.className = 'em-status' }

  overlay.style.display = 'flex'
  document.body.style.overflow = 'hidden'
}

function closeComposer() {
  const overlay = document.getElementById('em-overlay')
  if (overlay) overlay.style.display = 'none'
  document.body.style.overflow = ''
}

function initEmailComposer() {
  // Open via header compose button
  document.getElementById('compose-btn')?.addEventListener('click', () => openComposer('all'))

  // Open via group cards
  document.querySelectorAll('.eg-compose-btn').forEach(btn => {
    btn.addEventListener('click', () => openComposer(btn.dataset.group || 'all'))
  })

  // Close
  document.getElementById('em-close-btn')?.addEventListener('click', closeComposer)
  document.getElementById('em-cancel-btn')?.addEventListener('click', closeComposer)
  document.getElementById('em-overlay')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) closeComposer()
  })

  // Group change → update count
  document.getElementById('em-group')?.addEventListener('change', updateModalRecipientCount)

  // HTML toggle
  document.getElementById('em-html-toggle')?.addEventListener('click', () => {
    const toggleBtn = document.getElementById('em-html-toggle')
    const quillWrap = document.getElementById('em-quill')
    const rawArea   = document.getElementById('em-raw-html')
    if (!quillWrap || !rawArea) return

    _htmlMode = !_htmlMode

    if (_htmlMode) {
      // Visual → HTML: sync content
      rawArea.value = _quill ? _quill.root.innerHTML : ''
      quillWrap.style.display = 'none'
      rawArea.style.display   = 'block'
      toggleBtn.classList.add('active')
    } else {
      // HTML → Visual: sync content
      if (_quill) _quill.root.innerHTML = rawArea.value
      rawArea.style.display   = 'none'
      quillWrap.style.display = 'block'
      toggleBtn.classList.remove('active')
    }
  })

  // Load template
  document.getElementById('em-tpl-select')?.addEventListener('change', e => {
    const id = e.target.value
    if (!id) return
    const tpl = _templates.find(t => t.id === id)
    if (!tpl) return
    const subjectEl = document.getElementById('em-subject')
    if (subjectEl) subjectEl.value = tpl.subject || ''
    setEditorHtml(tpl.html || '')
  })

  // Save template
  document.getElementById('em-tpl-save')?.addEventListener('click', async () => {
    if (!_sb) return
    const name = prompt('Template name:')
    if (!name?.trim()) return
    const subject = document.getElementById('em-subject')?.value || ''
    const html    = getEditorHtml()
    const saveBtn = document.getElementById('em-tpl-save')
    saveBtn.textContent = '…'; saveBtn.disabled = true
    const { error } = await _sb.from('cp_email_templates')
      .upsert({ name: name.trim(), subject, html, updated_at: new Date().toISOString() },
               { onConflict: 'name' })
    saveBtn.textContent = 'Save'; saveBtn.disabled = false
    if (error) { alert('Error saving template'); return }
    await refreshTemplateSelect()
    const sel = document.getElementById('em-tpl-select')
    const saved = _templates.find(t => t.name === name.trim())
    if (sel && saved) sel.value = saved.id
  })

  // Delete template
  document.getElementById('em-tpl-delete')?.addEventListener('click', async () => {
    if (!_sb) return
    const sel = document.getElementById('em-tpl-select')
    const id  = sel?.value
    if (!id) return
    const tpl = _templates.find(t => t.id === id)
    if (!tpl || !confirm(`Delete template "${tpl.name}"?`)) return
    const { error } = await _sb.from('cp_email_templates').delete().eq('id', id)
    if (error) { alert('Error deleting template'); return }
    await refreshTemplateSelect()
  })

  // Preview
  document.getElementById('em-preview-btn')?.addEventListener('click', () => {
    const html    = getEditorHtml()
    const subject = document.getElementById('em-subject')?.value || ''
    const frame   = document.getElementById('em-preview-frame')
    const overlay = document.getElementById('em-preview-overlay')
    if (!frame || !overlay) return
    frame.srcdoc = `<!DOCTYPE html><html><head>
      <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <style>
        body { margin: 0; padding: 24px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
               font-size: 15px; line-height: 1.6; color: #111; background: #fff; }
        img  { max-width: 100%; height: auto; }
        a    { color: #6d28d9; }
      </style></head><body>${html}</body></html>`
    overlay.style.display = 'flex'
  })

  document.getElementById('em-preview-close')?.addEventListener('click', () => {
    document.getElementById('em-preview-overlay').style.display = 'none'
  })

  document.getElementById('em-preview-overlay')?.addEventListener('click', e => {
    if (e.target === e.currentTarget)
      document.getElementById('em-preview-overlay').style.display = 'none'
  })

  // Desktop / mobile size toggle in preview
  document.querySelectorAll('.em-size-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.em-size-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      const frame = document.getElementById('em-preview-frame')
      if (frame) frame.style.width = btn.dataset.width
    })
  })

  // Send
  document.getElementById('em-send-btn')?.addEventListener('click', async () => {
    const group   = document.getElementById('em-group')?.value || 'all'
    const from    = document.querySelector('input[name="em-from"]:checked')?.value
    const subject = document.getElementById('em-subject')?.value?.trim()
    const html    = getEditorHtml()?.trim()
    const to      = getRecipients(group)
    const status  = document.getElementById('em-status')
    const sendBtn = document.getElementById('em-send-btn')

    status.className = 'em-status'

    if (!to.length) { status.textContent = 'No recipients in this group.'; return }
    if (!subject)   { status.textContent = 'Subject is required.'; return }
    if (!html || html === '<p><br></p>') { status.textContent = 'Email body is required.'; return }

    const confirmed = confirm(`Send to ${to.length} recipient${to.length !== 1 ? 's' : ''}?`)
    if (!confirmed) return

    sendBtn.disabled = true
    status.textContent = `Sending to ${to.length} recipient${to.length !== 1 ? 's' : ''}…`

    try {
      const r = await fetch('/api/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, from, subject, html }),
      })
      const data = await r.json()
      if (!r.ok || data.error) throw new Error(data.error || 'Unknown error')
      status.className  = 'em-status success'
      status.textContent = `✓ Sent to ${data.sent} recipient${data.sent !== 1 ? 's' : ''}`
    } catch (err) {
      status.className  = 'em-status error'
      status.textContent = `Error: ${err.message}`
    } finally {
      sendBtn.disabled = false
    }
  })
}

// CSV export for Rostura waitlist
function initExportBtn() {
  document.getElementById('rostura-export-btn')?.addEventListener('click', () => {
    if (!_rosturaWaitlist.length) return
    const rows = [['email', 'signed_up'], ..._rosturaWaitlist.map(r => [r.email, r.created_at])]
    const csv  = rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url  = URL.createObjectURL(blob)
    const a    = Object.assign(document.createElement('a'), { href: url, download: 'rostura-waitlist.csv' })
    a.click()
    URL.revokeObjectURL(url)
  })
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

function drawSparkline(canvasId, trend, colorOrAppId, valueKey = 'pageviews') {
  const canvas = document.getElementById(canvasId)
  if (!canvas || !trend.length) return

  const ctx = canvas.getContext('2d')
  const dpr = window.devicePixelRatio || 1
  const w = canvas.offsetWidth || 300
  const h = canvas.offsetHeight || 48

  canvas.width = w * dpr
  canvas.height = h * dpr
  ctx.scale(dpr, dpr)

  const values = trend.map(t => t[valueKey])
  const max = Math.max(...values, 1)
  const pad = 4

  const color = colorOrAppId === 'crevaxo' ? '#f97316'
              : colorOrAppId === 'rostura'  ? '#14b8a6'
              : colorOrAppId // treat as literal color string

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

// ── Rostura Waitlist ───────────────────────────────────────────────────────

let _rosturaWaitlist = [] // cached for CSV export

function renderRostura(data) {
  const unconfigured = document.getElementById('rostura-unconfigured')
  const content      = document.getElementById('rostura-content')
  const exportBtn    = document.getElementById('rostura-export-btn')

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

  const wl = data.waitlist || {}
  _rosturaWaitlist = wl.list || []

  setText('ros-total', fmt(wl.total))
  setText('ros-new30', fmt(wl.new30d))
  setText('ros-new7',  fmt(wl.new7d))

  document.querySelectorAll('#rostura-content .metric-card').forEach(el => el.classList.remove('skeleton'))

  if (exportBtn) exportBtn.style.display = 'flex'

  // Sparkline — reuse drawSparkline with teal color and 'signups' key
  drawSparkline('spark-ros-waitlist', wl.dailyBuckets || [], '#14b8a6', 'signups')

  // Subscriber table
  const tbody = document.getElementById('ros-waitlist-tbody')
  if (tbody) {
    if (!_rosturaWaitlist.length) {
      tbody.innerHTML = '<tr><td colspan="2" style="color:var(--text-faint);text-align:center;padding:20px">No subscribers</td></tr>'
    } else {
      tbody.innerHTML = _rosturaWaitlist.map(r => `
        <tr>
          <td>${escHtml(r.email)}</td>
          <td style="color:var(--text-muted)">${fmtJoined(r.created_at)}</td>
        </tr>
      `).join('')
    }
  }
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

  // Cache email list for broadcast sending
  _crevaxoEmailList = data.users?.emailList || []
  renderEmailGroups()

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

  const [health, stripe, posthog, crevaxo, rostura] = await Promise.allSettled([
    fetch('/api/health').then(r => r.json()),
    fetch('/api/stripe').then(r => r.json()),
    fetch('/api/posthog').then(r => r.json()),
    fetch('/api/crevaxo').then(r => r.json()),
    fetch('/api/rostura').then(r => r.json()),
  ])

  renderHealth(health.status === 'fulfilled' ? health.value : null)
  renderStripe(stripe.status === 'fulfilled' ? stripe.value : null)
  renderPosthog(posthog.status === 'fulfilled' ? posthog.value : null)
  renderCrevaxo(crevaxo.status === 'fulfilled' ? crevaxo.value : null)
  renderRostura(rostura.status === 'fulfilled' ? rostura.value : null)

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

initEmailComposer()
initExportBtn()
loadAll()
