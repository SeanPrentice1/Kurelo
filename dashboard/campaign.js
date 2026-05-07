// ── State ─────────────────────────────────────────────────────
let allCampaigns = []
const filters = { product: 'all' }

const STATUS_COLOR = {
  planning:  '#a78bfa',
  active:    '#22c55e',
  paused:    '#f59e0b',
  completed: '#6b7280',
  failed:    '#ef4444',
}

const CONTENT_STATUS_LABEL = {
  pending:   { label: 'Pending',   color: '#f59e0b' },
  approved:  { label: 'Approved',  color: '#22c55e' },
  rejected:  { label: 'Rejected',  color: '#ef4444' },
  scheduled: { label: 'Scheduled', color: '#06b6d4' },
  posted:    { label: 'Posted',    color: '#8b5cf6' },
  failed:    { label: 'Failed',    color: '#ef4444' },
}

const AGENT_EMOJI = { content: '✍️', ads: '📣', research: '🔍', analytics: '📊' }

// ── Fetch ─────────────────────────────────────────────────────
async function fetchCampaigns() {
  try {
    const res  = await fetch('/api/agents/campaigns')
    const data = await res.json()
    if (!res.ok) throw new Error(data.error ?? 'Failed to load campaigns')
    allCampaigns = data.campaigns ?? []
    render()
  } catch (err) {
    showToast('Error: ' + err.message, 'error')
  }
}

// ── Render ────────────────────────────────────────────────────
function filtered() {
  if (filters.product === 'all') return allCampaigns
  return allCampaigns.filter(c => c.product === filters.product)
}

function render() {
  const campaigns = filtered()
  const loading   = document.getElementById('camp-loading')
  const empty     = document.getElementById('camp-empty')
  const list      = document.getElementById('camp-list')

  loading.style.display = 'none'
  document.getElementById('campaign-updated').textContent = `Updated ${timeAgo(new Date().toISOString())}`

  // Summary stats across all (unfiltered) campaigns
  const allItems    = allCampaigns.flatMap(c => c.items)
  document.getElementById('stat-total').textContent     = allCampaigns.length
  document.getElementById('stat-pending').textContent   = allItems.filter(i => i.status === 'pending').length
  document.getElementById('stat-scheduled').textContent = allItems.filter(i => i.status === 'scheduled').length
  document.getElementById('stat-posted').textContent    = allItems.filter(i => i.status === 'posted').length

  document.querySelectorAll('.camp-stat').forEach(el => el.classList.remove('skeleton'))

  if (!campaigns.length) {
    list.style.display  = 'none'
    empty.style.display = 'flex'
    return
  }

  empty.style.display  = 'none'
  list.style.display   = 'flex'
  list.innerHTML = campaigns.map(campaignCardHTML).join('')

  // Wire up approve/reject buttons inside campaign cards
  list.querySelectorAll('.inbox-approve').forEach(btn => {
    btn.addEventListener('click', () => handleDecision(btn.dataset.id, 'approve'))
  })
  list.querySelectorAll('.inbox-reject').forEach(btn => {
    btn.addEventListener('click', () => handleDecision(btn.dataset.id, 'reject'))
  })

  // Toggle content sections
  list.querySelectorAll('.camp-section-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = document.getElementById(btn.dataset.target)
      if (!target) return
      const open = target.style.display !== 'none'
      target.style.display = open ? 'none' : 'flex'
      btn.textContent = open ? 'Show ▼' : 'Hide ▲'
    })
  })
}

function campaignCardHTML(c) {
  const statusColor = STATUS_COLOR[c.status] ?? '#6b7280'
  const spend       = c.spend_cents  != null ? `$${(c.spend_cents  / 100).toFixed(2)}` : '—'
  const budget      = c.budget_cents != null ? `$${(c.budget_cents / 100).toFixed(2)}` : '—'
  const age         = timeAgo(c.created_at)

  const counts = {
    pending:   c.items.filter(i => i.status === 'pending').length,
    approved:  c.items.filter(i => i.status === 'approved').length,
    scheduled: c.items.filter(i => i.status === 'scheduled').length,
    posted:    c.items.filter(i => i.status === 'posted').length,
    rejected:  c.items.filter(i => i.status === 'rejected').length,
  }

  const pendingItems    = c.items.filter(i => i.status === 'pending')
  const queuedItems     = c.items.filter(i => i.status === 'scheduled')
  const postedItems     = c.items.filter(i => i.status === 'posted')
  const completedItems  = c.items.filter(i => ['approved', 'rejected'].includes(i.status))

  return `
    <div class="camp-card">
      <div class="camp-card-header">
        <div class="camp-card-title-row">
          <div class="app-badge ${c.product}">${c.product === 'crevaxo' ? 'Crevaxo' : 'Rostura'}</div>
          <h3 class="camp-name">${escHtml(c.name)}</h3>
          <span class="camp-status-pill" style="color:${statusColor};border-color:${statusColor}20;background:${statusColor}12">
            ${c.status}
          </span>
        </div>
        <div class="camp-card-meta">
          <span class="camp-brief">${escHtml(c.brief.substring(0, 120))}${c.brief.length > 120 ? '…' : ''}</span>
          <span class="camp-age">${age}</span>
        </div>
      </div>

      <div class="camp-counts">
        ${Object.entries(counts).map(([s, n]) => n > 0 ? `
          <div class="camp-count-chip" style="color:${(CONTENT_STATUS_LABEL[s]?.color) ?? '#6b7280'}">
            <span class="camp-count-n">${n}</span>
            <span class="camp-count-label">${CONTENT_STATUS_LABEL[s]?.label ?? s}</span>
          </div>` : '').join('')}
        <div class="camp-count-chip" style="color:#6b7280">
          <span class="camp-count-n">${spend}</span>
          <span class="camp-count-label">Spend${budget !== '—' ? ` / ${budget}` : ''}</span>
        </div>
      </div>

      ${pendingItems.length ? `
        <div class="camp-section">
          <div class="camp-section-header">
            <span class="camp-section-title">⏳ Awaiting Approval (${pendingItems.length})</span>
            <button class="camp-section-toggle" data-target="pending-${c.id}">Hide ▲</button>
          </div>
          <div id="pending-${c.id}" class="camp-items-list">
            ${pendingItems.map(i => contentRowHTML(i, true)).join('')}
          </div>
        </div>
      ` : ''}

      ${queuedItems.length ? `
        <div class="camp-section">
          <div class="camp-section-header">
            <span class="camp-section-title">📅 Queued to Buffer (${queuedItems.length})</span>
            <button class="camp-section-toggle" data-target="queued-${c.id}">Hide ▲</button>
          </div>
          <div id="queued-${c.id}" class="camp-items-list">
            ${queuedItems.map(i => contentRowHTML(i, false)).join('')}
          </div>
        </div>
      ` : ''}

      ${postedItems.length ? `
        <div class="camp-section">
          <div class="camp-section-header">
            <span class="camp-section-title">✅ Posted (${postedItems.length})</span>
            <button class="camp-section-toggle" data-target="posted-${c.id}">Show ▼</button>
          </div>
          <div id="posted-${c.id}" class="camp-items-list" style="display:none">
            ${postedItems.map(i => contentRowHTML(i, false)).join('')}
          </div>
        </div>
      ` : ''}

      ${completedItems.length && !pendingItems.length && !queuedItems.length && !postedItems.length ? `
        <div class="camp-section">
          <div class="camp-section-header">
            <span class="camp-section-title">📋 Reviewed (${completedItems.length})</span>
            <button class="camp-section-toggle" data-target="done-${c.id}">Show ▼</button>
          </div>
          <div id="done-${c.id}" class="camp-items-list" style="display:none">
            ${completedItems.map(i => contentRowHTML(i, false)).join('')}
          </div>
        </div>
      ` : ''}
    </div>
  `
}

function contentRowHTML(item, showActions) {
  const sl     = CONTENT_STATUS_LABEL[item.status] ?? { label: item.status, color: '#6b7280' }
  const emoji  = AGENT_EMOJI[item.agent] ?? '📄'
  const sched  = item.scheduled_for ? fmtDate(item.scheduled_for) : null
  const preview = item.output.length > 140 ? item.output.substring(0, 140) + '…' : item.output

  return `
    <div class="camp-item-row" id="camprow-${item.id}">
      <div class="camp-item-left">
        <span class="camp-item-emoji">${emoji}</span>
        <div class="camp-item-info">
          <div class="camp-item-type">${taskLabel(item.task_type)}${item.platform ? ` · ${item.platform}` : ''}</div>
          <div class="camp-item-preview">${escHtml(preview)}</div>
          ${sched ? `<div class="camp-item-sched">📅 ${sched}</div>` : ''}
        </div>
      </div>
      <div class="camp-item-right">
        <span class="camp-item-status" style="color:${sl.color}">${sl.label}</span>
        ${showActions ? `
          <div class="camp-item-actions">
            <button class="inbox-approve" data-id="${item.id}">✅</button>
            <button class="inbox-reject"  data-id="${item.id}">❌</button>
          </div>
        ` : ''}
      </div>
    </div>
  `
}

// ── Decision handling ─────────────────────────────────────────
async function handleDecision(contentId, action) {
  const row = document.getElementById(`camprow-${contentId}`)
  row?.querySelectorAll('button').forEach(b => { b.disabled = true })

  try {
    const res  = await fetch(`/api/agents/${action}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ contentId }),
    })
    const data = await res.json()
    if (!res.ok || !data.ok) throw new Error(data.error ?? 'Request failed')

    const msg = action === 'approve'
      ? (data.status === 'scheduled' ? `✅ Queued to Buffer for ${fmtDate(data.scheduled_for)}` : '✅ Approved')
      : '❌ Rejected'
    showToast(msg, action === 'approve' ? 'success' : 'info')

    // Refresh data
    await fetchCampaigns()
  } catch (err) {
    showToast('Error: ' + err.message, 'error')
    row?.querySelectorAll('button').forEach(b => { b.disabled = false })
  }
}

// ── Filters ───────────────────────────────────────────────────
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const group = btn.dataset.filter
    document.querySelectorAll(`.filter-btn[data-filter="${group}"]`).forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    filters[group] = btn.dataset.value
    render()
  })
})

document.getElementById('refresh-btn').addEventListener('click', () => {
  document.getElementById('camp-loading').style.display = 'flex'
  document.getElementById('camp-list').style.display    = 'none'
  document.getElementById('camp-empty').style.display   = 'none'
  fetchCampaigns()
})

// ── Helpers ───────────────────────────────────────────────────
function escHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

function taskLabel(type) {
  return (type ?? '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

let toastTimer
function showToast(msg, type = 'info') {
  const el = document.getElementById('toast')
  el.textContent = msg
  el.className   = `toast toast-${type}`
  el.style.display = 'flex'
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { el.style.display = 'none' }, 4000)
}

// ── Init ──────────────────────────────────────────────────────
fetchCampaigns()
