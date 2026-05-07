// ── State ─────────────────────────────────────────────────────
let allItems = []
const filters = { product: 'all', agent: 'all' }

// ── Agent display config ──────────────────────────────────────
const AGENT_META = {
  content:   { label: 'Content Agent',   emoji: '✍️',  color: 'var(--purple)' },
  ads:       { label: 'Ads Agent',       emoji: '📣',  color: '#f97316' },
  research:  { label: 'Research Agent',  emoji: '🔍',  color: '#06b6d4' },
  analytics: { label: 'Analytics Agent', emoji: '📊',  color: '#22c55e' },
}

const PLATFORM_LABELS = {
  instagram: 'Instagram', tiktok: 'TikTok',
  linkedin: 'LinkedIn', reddit: 'Reddit',
  meta_ads: 'Meta Ads', google_ads: 'Google Ads',
}

// ── Fetch ─────────────────────────────────────────────────────
async function fetchInbox() {
  try {
    const res  = await fetch('/api/agents/inbox')
    const data = await res.json()
    if (!res.ok) throw new Error(data.error ?? 'Failed to load inbox')
    allItems = data.items ?? []
    render()
  } catch (err) {
    showToast('Error loading inbox: ' + err.message, 'error')
  }
}

// ── Render ────────────────────────────────────────────────────
function filtered() {
  return allItems.filter(item => {
    if (filters.product !== 'all' && item.product !== filters.product) return false
    if (filters.agent   !== 'all' && item.agent   !== filters.agent)   return false
    return true
  })
}

function render() {
  const items  = filtered()
  const badge  = document.getElementById('inbox-badge')
  const grid   = document.getElementById('inbox-grid')
  const empty  = document.getElementById('inbox-empty')
  const loading = document.getElementById('inbox-loading')

  loading.style.display = 'none'

  badge.textContent = allItems.length || ''
  badge.style.display = allItems.length ? 'inline-flex' : 'none'

  if (!items.length) {
    grid.style.display  = 'none'
    empty.style.display = 'flex'
    return
  }

  empty.style.display = 'none'
  grid.style.display  = 'grid'
  grid.innerHTML = items.map(itemCardHTML).join('')

  grid.querySelectorAll('.inbox-approve').forEach(btn => {
    btn.addEventListener('click', () => handleDecision(btn.dataset.id, 'approve'))
  })
  grid.querySelectorAll('.inbox-reject').forEach(btn => {
    btn.addEventListener('click', () => handleDecision(btn.dataset.id, 'reject'))
  })
}

function itemCardHTML(item) {
  const meta     = AGENT_META[item.agent] ?? { label: item.agent, emoji: '📄', color: 'var(--muted)' }
  const platform = PLATFORM_LABELS[item.platform] ?? item.platform ?? '—'
  const campaign = item.campaign_log?.name ?? '—'
  const age      = timeAgo(item.created_at)

  const hashtags = item.metadata?.hashtags?.length
    ? `<div class="inbox-card-hashtags">${item.metadata.hashtags.slice(0, 6).map(h => `<span class="htag">#${h}</span>`).join('')}</div>`
    : ''

  const hook = item.metadata?.hook
    ? `<div class="inbox-card-hook">${escHtml(item.metadata.hook)}</div>`
    : ''

  const cta = item.metadata?.cta
    ? `<span class="inbox-card-cta">CTA: ${escHtml(item.metadata.cta)}</span>`
    : ''

  const headline = item.metadata?.headline
    ? `<div class="inbox-card-hook">${escHtml(item.metadata.headline)}</div>`
    : ''

  return `
    <div class="inbox-card" id="card-${item.id}">
      <div class="inbox-card-header">
        <div class="inbox-card-labels">
          <div class="app-badge ${item.product}">${item.product === 'crevaxo' ? 'Crevaxo' : 'Rostura'}</div>
          <span class="platform-chip ${item.platform ?? ''}">${platform}</span>
        </div>
        <div class="inbox-card-meta">
          <span class="inbox-agent-label" style="color:${meta.color}">${meta.emoji} ${meta.label}</span>
          <span class="inbox-age">${age}</span>
        </div>
      </div>

      <div class="inbox-card-campaign">Campaign: ${escHtml(campaign)}</div>

      ${hook || headline}
      <div class="inbox-card-output">${escHtml(item.output)}</div>
      ${hashtags}

      <div class="inbox-card-footer">
        ${cta}
        <div class="inbox-card-actions">
          <button class="inbox-approve" data-id="${item.id}">✅ Approve</button>
          <button class="inbox-reject"  data-id="${item.id}">❌ Reject</button>
        </div>
      </div>
    </div>
  `
}

// ── Decision handling ─────────────────────────────────────────
async function handleDecision(contentId, action) {
  const card = document.getElementById(`card-${contentId}`)
  const approveBtn = card?.querySelector('.inbox-approve')
  const rejectBtn  = card?.querySelector('.inbox-reject')
  if (approveBtn) approveBtn.disabled = true
  if (rejectBtn)  rejectBtn.disabled  = true

  try {
    const res  = await fetch(`/api/agents/${action}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ contentId }),
    })
    const data = await res.json()

    if (!res.ok || !data.ok) throw new Error(data.error ?? 'Request failed')

    if (action === 'approve') {
      const msg = data.status === 'scheduled'
        ? `✅ Approved & queued to Buffer for ${fmtDate(data.scheduled_for)}`
        : '✅ Approved'
      showToast(msg, 'success')
    } else {
      showToast('❌ Rejected', 'info')
    }

    // Remove from local state and re-render
    allItems = allItems.filter(i => i.id !== contentId)
    render()
  } catch (err) {
    showToast('Error: ' + err.message, 'error')
    if (approveBtn) approveBtn.disabled = false
    if (rejectBtn)  rejectBtn.disabled  = false
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
  document.getElementById('inbox-loading').style.display = 'flex'
  document.getElementById('inbox-grid').style.display   = 'none'
  document.getElementById('inbox-empty').style.display  = 'none'
  fetchInbox()
})

// ── Helpers ───────────────────────────────────────────────────
function escHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
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
fetchInbox()
