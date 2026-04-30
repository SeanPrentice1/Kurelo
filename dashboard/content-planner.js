// ── Supabase config ───────────────────────────────────────────────────────
// Fill in your Rostura project values from supabase.com → Project Settings → API
const SUPABASE_URL      = 'https://ovmlohgptdiryvlwztxz.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im92bWxvaGdwdGRpcnl2bHd6dHh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5ODQwNjYsImV4cCI6MjA5MTU2MDA2Nn0.oItHZhkUTmCPP9CO1-RacGyl8tD14pxdv71nxz6N3F4'

const { createClient } = window.supabase
const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

// ── Local cache ───────────────────────────────────────────────────────────
let data = { posts: [], hashtags: [], captions: [], tags: [] }

// ── State ─────────────────────────────────────────────────────────────────
const state = {
  view: 'pipeline',
  productFilter: 'all',
  platformFilter: 'all',
  htagProductFilter: 'all',
  weekOffset: 0,
  monthOffset: 0,
  editingPostId: null,
  editingCaptionId: null,
}

let _editingTagId    = null
let _selectedTagIds  = new Set()

// ── Constants ─────────────────────────────────────────────────────────────
const PLATFORM_LABELS = { instagram: 'Instagram', tiktok: 'TikTok', linkedin: 'LinkedIn', reddit: 'Reddit' }
const STATUS_ORDER    = ['idea', 'draft', 'ready', 'scheduled', 'posted']

// ── Helpers ───────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function platformChipHTML(platform) {
  return `<span class="platform-chip ${platform}">${PLATFORM_LABELS[platform] ?? platform}</span>`
}

function productBadgeHTML(product) {
  return `<div class="app-badge ${product}">${product === 'crevaxo' ? 'Crevaxo' : 'Rostura'}</div>`
}

function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
}

function postPlatforms(post) {
  if (post.platforms?.length) return post.platforms
  return post.platform ? [post.platform] : []
}

function filteredPosts() {
  return data.posts.filter(p => {
    if (state.productFilter !== 'all' && p.product !== state.productFilter) return false
    if (state.platformFilter !== 'all' && !postPlatforms(p).includes(state.platformFilter)) return false
    return true
  })
}

// ── Loading state ─────────────────────────────────────────────────────────
function setLoading(on) {
  document.getElementById('cp-loading').style.display = on ? 'flex' : 'none'
}

// ── Data fetching ─────────────────────────────────────────────────────────
async function fetchAll() {
  const [{ data: posts, error: e1 }, { data: hashtags, error: e2 }, { data: captions, error: e3 }, { data: tags, error: e4 }] =
    await Promise.all([
      sb.from('cp_posts').select('*').order('created_at'),
      sb.from('cp_hashtags').select('*').order('created_at'),
      sb.from('cp_captions').select('*').order('created_at'),
      sb.from('cp_tags').select('*').order('created_at'),
    ])
  if (e1 || e2 || e3 || e4) { showToast('Error loading data'); return false }
  data.posts    = posts    ?? []
  data.hashtags = hashtags ?? []
  data.captions = captions ?? []
  data.tags     = tags     ?? []
  return true
}

async function fetchTags() {
  const { data: rows, error } = await sb.from('cp_tags').select('*').order('created_at')
  if (error) { showToast('Error loading tags'); return }
  data.tags = rows ?? []
}

async function fetchPosts() {
  const { data: rows, error } = await sb.from('cp_posts').select('*').order('created_at')
  if (error) { showToast('Error loading posts'); return }
  data.posts = rows ?? []
}

async function fetchHashtags() {
  const { data: rows, error } = await sb.from('cp_hashtags').select('*').order('created_at')
  if (error) { showToast('Error loading hashtags'); return }
  data.hashtags = rows ?? []
}

async function fetchCaptions() {
  const { data: rows, error } = await sb.from('cp_captions').select('*').order('created_at')
  if (error) { showToast('Error loading captions'); return }
  data.captions = rows ?? []
}

// ── Render ────────────────────────────────────────────────────────────────
function render() {
  if (state.view === 'pipeline') renderPipeline()
  else if (state.view === 'week') renderWeek()
  else if (state.view === 'month') renderMonth()
  renderHashtags()
  renderCaptions()
  renderTagLibrary()
}

// ── Pipeline ──────────────────────────────────────────────────────────────
function renderPipeline() {
  const posts = filteredPosts()
  STATUS_ORDER.forEach(status => {
    const col = posts.filter(p => p.status === status)
    document.getElementById(`count-${status}`).textContent = col.length
    const container = document.getElementById(`cards-${status}`)
    container.innerHTML = col.length
      ? col.map(postCardHTML).join('')
      : `<div class="empty-state">No posts</div>`
  })
}

function postCardHTML(post) {
  const dateStr = post.scheduled_date
    ? new Date(post.scheduled_date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : ''
  const tagIds = post.tag_ids || []
  const flairsHTML = tagIds.map(tid => {
    const tag = data.tags.find(t => t.id === tid)
    if (!tag) return ''
    return `<span class="post-card-flair" style="--tag-color:${tag.color}">${escHtml(tag.name)}</span>`
  }).filter(Boolean).join('')
  const plats = postPlatforms(post)
  const platformsHTML = plats.map(p => platformChipHTML(p)).join('')
  return `
    <div class="post-card" data-id="${post.id}" draggable="true">
      <div class="post-card-top">
        ${productBadgeHTML(post.product)}
        ${platformsHTML}
      </div>
      <div class="post-card-title">${escHtml(post.title || 'Untitled')}</div>
      ${flairsHTML ? `<div class="post-card-flairs">${flairsHTML}</div>` : ''}
      ${dateStr ? `<div class="post-card-date">${dateStr}</div>` : ''}
    </div>`
}

// ── Tag Library ───────────────────────────────────────────────────────────
function renderTagLibrary() {
  const container = document.getElementById('tag-library-chips')
  if (!container) return
  container.innerHTML = data.tags.length
    ? data.tags.map(t => `
        <div class="tag-library-chip" data-tag-lib-id="${t.id}" style="--tag-color:${t.color}">
          <span class="tag-flair-dot"></span>
          ${escHtml(t.name)}
          <span class="tag-lib-edit">✎</span>
        </div>`).join('')
    : `<div class="empty-state" style="padding:6px 0;align-items:flex-start">No tags yet — create one to label your posts.</div>`
}

function renderPostTagPicker() {
  const container = document.getElementById('post-tag-picker')
  if (!container) return
  if (!data.tags.length) {
    container.innerHTML = `<span class="tag-picker-empty">No tags yet — create them in the Tag Library below.</span>`
    return
  }
  container.innerHTML = data.tags.map(t => {
    const sel = _selectedTagIds.has(t.id)
    return `<button class="post-tag-chip${sel ? ' selected' : ''}" data-toggle-tag="${t.id}" style="--tag-color:${t.color}">${escHtml(t.name)}</button>`
  }).join('')
}

// ── Week view ─────────────────────────────────────────────────────────────
function getWeekDays(offset) {
  const now = new Date()
  const monday = new Date(now)
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7) + offset * 7)
  monday.setHours(0, 0, 0, 0)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return d
  })
}

function renderWeek() {
  const days = getWeekDays(state.weekOffset)
  const fmt = d => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  document.getElementById('week-label').textContent =
    `${fmt(days[0])} — ${fmt(days[6])}, ${days[0].getFullYear()}`

  const today = new Date(); today.setHours(0, 0, 0, 0)
  const posts = filteredPosts()
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

  document.getElementById('week-grid').innerHTML = days.map((day, i) => {
    const isToday = day.getTime() === today.getTime()
    const dayPosts = posts.filter(p => p.scheduled_date &&
      isSameDay(new Date(p.scheduled_date + 'T00:00:00'), day))
    return `
      <div class="week-day${isToday ? ' today' : ''}">
        <div class="week-day-header">
          <span class="week-day-name">${dayNames[i]}</span>
          <span class="week-day-num">${day.getDate()}</span>
        </div>
        <div class="week-day-cards">${dayPosts.map(calCardHTML).join('')}</div>
      </div>`
  }).join('')
}

// ── Month view ────────────────────────────────────────────────────────────
function renderMonth() {
  const now = new Date()
  const target = new Date(now.getFullYear(), now.getMonth() + state.monthOffset, 1)
  document.getElementById('month-label').textContent =
    target.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  const today = new Date(); today.setHours(0, 0, 0, 0)
  const posts = filteredPosts()
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

  const firstDay = new Date(target.getFullYear(), target.getMonth(), 1)
  const lastDay  = new Date(target.getFullYear(), target.getMonth() + 1, 0)
  const startOffset = (firstDay.getDay() + 6) % 7
  const totalCells  = Math.ceil((startOffset + lastDay.getDate()) / 7) * 7

  const headerHTML = dayNames.map(d => `<div class="month-day-label">${d}</div>`).join('')
  let daysHTML = ''

  for (let i = 0; i < totalCells; i++) {
    const d = new Date(firstDay)
    d.setDate(1 - startOffset + i)
    d.setHours(0, 0, 0, 0)
    const inMonth = d.getMonth() === target.getMonth()
    const isToday = d.getTime() === today.getTime()
    const dayPosts = posts.filter(p => p.scheduled_date &&
      isSameDay(new Date(p.scheduled_date + 'T00:00:00'), d))
    const shown = dayPosts.slice(0, 3)
    const more  = dayPosts.length - 3
    daysHTML += `
      <div class="month-day${!inMonth ? ' other-month' : ''}${isToday ? ' today' : ''}">
        <div class="month-day-num">${d.getDate()}</div>
        <div class="month-day-cards">
          ${shown.map(calCardHTML).join('')}
          ${more > 0 ? `<span class="cal-more">+${more} more</span>` : ''}
        </div>
      </div>`
  }

  document.getElementById('month-grid').innerHTML = headerHTML + daysHTML
}

function calCardHTML(post) {
  return `<div class="cal-card ${post.product}" data-id="${post.id}" title="${escHtml(post.title || 'Untitled')}">${escHtml(post.title || 'Untitled')}</div>`
}

// ── Hashtag Bank ──────────────────────────────────────────────────────────
function renderHashtags() {
  const filter = state.htagProductFilter
  const tags   = data.hashtags.filter(h => filter === 'all' || h.product === filter)
  const container = document.getElementById('hashtag-chips')
  container.innerHTML = tags.length
    ? tags.map(h => `
        <div class="hashtag-chip ${h.product}" data-htag-id="${h.id}" title="Click to copy">
          <span class="htag-dot"></span>#${escHtml(h.tag)}
          <span class="htag-del" data-htag-del="${h.id}">✕</span>
        </div>`).join('')
    : `<div class="empty-state" style="width:100%;padding:12px">No hashtags yet — add some to get started.</div>`
}

// ── Caption Storage ───────────────────────────────────────────────────────
function renderCaptions() {
  const container = document.getElementById('caption-list')
  container.innerHTML = data.captions.length
    ? data.captions.map(c => `
        <div class="caption-item" data-caption-id="${c.id}">
          <div class="caption-item-header">
            ${productBadgeHTML(c.product)}
            ${platformChipHTML(c.platform)}
            <span class="caption-item-label">${escHtml(c.label || '')}</span>
            <button class="caption-copy-btn" data-copy-caption="${c.id}">Copy</button>
          </div>
          <div class="caption-item-text">${escHtml(c.text)}</div>
        </div>`).join('')
    : `<div class="empty-state">No captions saved yet.</div>`
}

// ── Post Modal ────────────────────────────────────────────────────────────
function openPostModal(post = null, defaultStatus = 'idea') {
  state.editingPostId = post?.id ?? null
  document.getElementById('post-modal-title').textContent = post ? 'Edit Post' : 'New Post'
  document.getElementById('post-title').value   = post?.title    ?? ''
  document.getElementById('post-caption').value = post?.caption  ?? ''
  // notes are set into Quill after the modal becomes visible (see setTimeout below)
  const activePlats = post?.platforms?.length ? post.platforms : (post?.platform ? [post.platform] : [])
  document.querySelectorAll('#post-platforms .plat-btn').forEach(btn => {
    btn.classList.toggle('active', activePlats.includes(btn.dataset.plat))
  })
  document.getElementById('post-status').value   = post?.status   ?? defaultStatus
  document.getElementById('post-date').value     = post?.scheduled_date ?? ''
  const productVal = post?.product ?? 'rostura'
  document.querySelectorAll('input[name="post-product"]').forEach(r => { r.checked = r.value === productVal })
  _selectedTagIds = new Set(post?.tag_ids ?? [])
  renderPostTagPicker()
  document.getElementById('post-delete-btn').style.display = post ? '' : 'none'
  document.getElementById('post-modal-overlay').classList.remove('hidden')
  setTimeout(() => {
    initNotesQuill()
    if (_notesQuill) {
      const notes = post?.notes ?? ''
      // Handle both legacy plain text and stored HTML
      if (notes && !notes.startsWith('<')) {
        _notesQuill.setText(notes)
      } else {
        _notesQuill.root.innerHTML = notes
      }
    }
    document.getElementById('post-title').focus()
  }, 50)
}

function closePostModal() {
  document.getElementById('post-modal-overlay').classList.add('hidden')
  state.editingPostId = null
}

async function savePost() {
  const title = document.getElementById('post-title').value.trim()
  if (!title) { document.getElementById('post-title').focus(); return }

  const payload = {
    title,
    product:        document.querySelector('input[name="post-product"]:checked')?.value ?? 'rostura',
    platforms:      [...document.querySelectorAll('#post-platforms .plat-btn.active')].map(b => b.dataset.plat),
    platform:       document.querySelector('#post-platforms .plat-btn.active')?.dataset.plat ?? 'instagram',
    status:         document.getElementById('post-status').value,
    caption:        document.getElementById('post-caption').value.trim(),
    notes:          _notesQuill ? _notesQuill.root.innerHTML : '',
    scheduled_date: document.getElementById('post-date').value || null,
    tag_ids:        [..._selectedTagIds],
  }

  const btn = document.getElementById('post-save-btn')
  btn.textContent = 'Saving…'; btn.disabled = true

  let error
  if (state.editingPostId) {
    ;({ error } = await sb.from('cp_posts')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', state.editingPostId))
  } else {
    ;({ error } = await sb.from('cp_posts').insert(payload))
  }

  btn.textContent = 'Save Post'; btn.disabled = false

  if (error) { showToast('Error saving post'); console.error(error); return }

  closePostModal()
  await fetchPosts()
  render()
}

async function deletePost() {
  if (!state.editingPostId || !confirm('Delete this post?')) return
  const { error } = await sb.from('cp_posts').delete().eq('id', state.editingPostId)
  if (error) { showToast('Error deleting post'); return }
  closePostModal()
  await fetchPosts()
  render()
}

// ── Hashtag Modal ─────────────────────────────────────────────────────────
function openHashtagModal() {
  document.getElementById('htag-text').value = ''
  document.querySelector('input[name="htag-product"][value="both"]').checked = true
  document.getElementById('htag-modal-overlay').classList.remove('hidden')
  setTimeout(() => document.getElementById('htag-text').focus(), 50)
}

function closeHashtagModal() {
  document.getElementById('htag-modal-overlay').classList.add('hidden')
}

async function saveHashtag() {
  const tag = document.getElementById('htag-text').value.trim().replace(/^#+/, '')
  if (!tag) { document.getElementById('htag-text').focus(); return }

  const product = document.querySelector('input[name="htag-product"]:checked')?.value ?? 'both'
  const { error } = await sb.from('cp_hashtags').insert({ tag, product })
  if (error) { showToast('Error saving hashtag'); return }

  closeHashtagModal()
  await fetchHashtags()
  renderHashtags()
}

async function deleteHashtag(id) {
  const { error } = await sb.from('cp_hashtags').delete().eq('id', id)
  if (error) { showToast('Error deleting hashtag'); return }
  await fetchHashtags()
  renderHashtags()
}

// ── Caption Modal ─────────────────────────────────────────────────────────
function openCaptionModal(caption = null) {
  state.editingCaptionId = caption?.id ?? null
  document.getElementById('caption-modal-title').textContent = caption ? 'Edit Caption' : 'Add Caption'
  document.getElementById('caption-text').value     = caption?.text     ?? ''
  document.getElementById('caption-label').value    = caption?.label    ?? ''
  document.getElementById('caption-platform').value = caption?.platform ?? 'instagram'
  const productVal = caption?.product ?? 'rostura'
  document.querySelectorAll('input[name="caption-product"]').forEach(r => { r.checked = r.value === productVal })
  document.getElementById('caption-delete-btn').style.display = caption ? '' : 'none'
  document.getElementById('caption-modal-overlay').classList.remove('hidden')
  setTimeout(() => document.getElementById('caption-text').focus(), 50)
}

function closeCaptionModal() {
  document.getElementById('caption-modal-overlay').classList.add('hidden')
  state.editingCaptionId = null
}

async function saveCaption() {
  const text = document.getElementById('caption-text').value.trim()
  if (!text) { document.getElementById('caption-text').focus(); return }

  const payload = {
    text,
    label:    document.getElementById('caption-label').value.trim(),
    platform: document.getElementById('caption-platform').value,
    product:  document.querySelector('input[name="caption-product"]:checked')?.value ?? 'rostura',
  }

  const btn = document.getElementById('caption-save-btn')
  btn.textContent = 'Saving…'; btn.disabled = true

  let error
  if (state.editingCaptionId) {
    ;({ error } = await sb.from('cp_captions').update(payload).eq('id', state.editingCaptionId))
  } else {
    ;({ error } = await sb.from('cp_captions').insert(payload))
  }

  btn.textContent = 'Save Caption'; btn.disabled = false

  if (error) { showToast('Error saving caption'); return }

  closeCaptionModal()
  await fetchCaptions()
  renderCaptions()
}

async function deleteCaption() {
  if (!state.editingCaptionId || !confirm('Delete this caption?')) return
  const { error } = await sb.from('cp_captions').delete().eq('id', state.editingCaptionId)
  if (error) { showToast('Error deleting caption'); return }
  closeCaptionModal()
  await fetchCaptions()
  renderCaptions()
}

// ── Tag Modal ─────────────────────────────────────────────────────────────
function openTagModal(tag = null) {
  _editingTagId = tag?.id ?? null
  document.getElementById('tag-modal-title').textContent = tag ? 'Edit Tag' : 'New Tag'
  document.getElementById('tag-name-input').value  = tag?.name  ?? ''
  document.getElementById('tag-color-input').value = tag?.color ?? '#8b5cf6'
  document.getElementById('tag-delete-btn').style.display = tag ? '' : 'none'
  document.getElementById('tag-modal-overlay').classList.remove('hidden')
  setTimeout(() => document.getElementById('tag-name-input').focus(), 50)
}

function closeTagModal() {
  document.getElementById('tag-modal-overlay').classList.add('hidden')
  _editingTagId = null
}

async function saveTag() {
  const name  = document.getElementById('tag-name-input').value.trim()
  if (!name) { document.getElementById('tag-name-input').focus(); return }
  const color = document.getElementById('tag-color-input').value

  const btn = document.getElementById('tag-save-btn')
  btn.textContent = 'Saving…'; btn.disabled = true

  let error
  if (_editingTagId) {
    ;({ error } = await sb.from('cp_tags').update({ name, color }).eq('id', _editingTagId))
  } else {
    ;({ error } = await sb.from('cp_tags').insert({ name, color }))
  }

  btn.textContent = 'Save Tag'; btn.disabled = false
  if (error) { showToast('Error saving tag'); return }

  closeTagModal()
  await fetchTags()
  renderTagLibrary()
  renderPostTagPicker()
  renderPipeline()
}

async function deleteTag() {
  if (!_editingTagId || !confirm('Delete this tag? It will be removed from all posts.')) return
  const { error } = await sb.from('cp_tags').delete().eq('id', _editingTagId)
  if (error) { showToast('Error deleting tag'); return }
  data.posts.forEach(p => { p.tag_ids = (p.tag_ids || []).filter(id => id !== _editingTagId) })
  _selectedTagIds.delete(_editingTagId)
  closeTagModal()
  await fetchTags()
  renderTagLibrary()
  renderPostTagPicker()
  renderPipeline()
}

// ── Clipboard + Toast ─────────────────────────────────────────────────────
function copyText(text) {
  navigator.clipboard.writeText(text).then(() => showToast('Copied to clipboard'))
}

function showToast(msg) {
  const toast = document.getElementById('copied-toast')
  toast.textContent = msg
  toast.classList.add('show')
  clearTimeout(toast._timer)
  toast._timer = setTimeout(() => toast.classList.remove('show'), 2200)
}

// ── Event delegation ──────────────────────────────────────────────────────
document.addEventListener('click', e => {
  const postCard = e.target.closest('.post-card, .cal-card')
  if (postCard && !e.target.closest('.htag-del')) {
    const post = data.posts.find(p => p.id === postCard.dataset.id)
    if (post) { openPostModal(post); return }
  }

  const pipelineAdd = e.target.closest('.pipeline-add-btn')
  if (pipelineAdd) { openPostModal(null, pipelineAdd.dataset.status); return }

  if (e.target.matches('[data-filter="product"]')) {
    state.productFilter = e.target.dataset.value
    document.querySelectorAll('[data-filter="product"]').forEach(b =>
      b.classList.toggle('active', b.dataset.value === state.productFilter))
    render(); return
  }

  if (e.target.matches('[data-filter="platform"]')) {
    state.platformFilter = e.target.dataset.value
    document.querySelectorAll('[data-filter="platform"]').forEach(b =>
      b.classList.toggle('active', b.dataset.value === state.platformFilter))
    render(); return
  }

  if (e.target.matches('[data-filter="htag-product"]')) {
    state.htagProductFilter = e.target.dataset.value
    document.querySelectorAll('[data-filter="htag-product"]').forEach(b =>
      b.classList.toggle('active', b.dataset.value === state.htagProductFilter))
    renderHashtags(); return
  }

  const htagDel = e.target.closest('[data-htag-del]')
  if (htagDel) { deleteHashtag(htagDel.dataset.htagDel); return }

  const htagChip = e.target.closest('.hashtag-chip')
  if (htagChip) {
    const tag = data.hashtags.find(h => h.id === htagChip.dataset.htagId)
    if (tag) copyText(`#${tag.tag}`)
    return
  }

  const copyBtn = e.target.closest('[data-copy-caption]')
  if (copyBtn) {
    e.stopPropagation()
    const cap = data.captions.find(c => c.id === copyBtn.dataset.copyCaption)
    if (cap) copyText(cap.text)
    return
  }

  const captionItem = e.target.closest('.caption-item')
  if (captionItem) {
    const cap = data.captions.find(c => c.id === captionItem.dataset.captionId)
    if (cap) openCaptionModal(cap)
    return
  }

  const tagLibChip = e.target.closest('.tag-library-chip')
  if (tagLibChip) {
    const tag = data.tags.find(t => t.id === tagLibChip.dataset.tagLibId)
    if (tag) openTagModal(tag)
    return
  }

  const platBtn = e.target.closest('.plat-btn')
  if (platBtn) { platBtn.classList.toggle('active'); return }

  const toggleTag = e.target.closest('[data-toggle-tag]')
  if (toggleTag) {
    const id = toggleTag.dataset.toggleTag
    if (_selectedTagIds.has(id)) {
      _selectedTagIds.delete(id)
      toggleTag.classList.remove('selected')
    } else {
      _selectedTagIds.add(id)
      toggleTag.classList.add('selected')
    }
    return
  }

  const presetBtn = e.target.closest('.tag-preset')
  if (presetBtn) {
    document.getElementById('tag-color-input').value = presetBtn.dataset.color
    return
  }
})

// View toggle
document.querySelectorAll('.view-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    state.view = btn.dataset.view
    document.querySelectorAll('.view-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.view === state.view))
    document.querySelectorAll('.cp-view').forEach(v =>
      v.classList.toggle('hidden', v.id !== `view-${state.view}`))
    render()
  })
})

document.getElementById('new-post-btn').addEventListener('click', () => openPostModal())

document.getElementById('post-modal-close').addEventListener('click', closePostModal)
document.getElementById('post-cancel-btn').addEventListener('click', closePostModal)
document.getElementById('post-save-btn').addEventListener('click', savePost)
document.getElementById('post-delete-btn').addEventListener('click', deletePost)
document.getElementById('post-modal-overlay').addEventListener('click', e => {
  if (e.target === e.currentTarget) closePostModal()
})

document.getElementById('add-hashtag-btn').addEventListener('click', openHashtagModal)
document.getElementById('htag-modal-close').addEventListener('click', closeHashtagModal)
document.getElementById('htag-cancel-btn').addEventListener('click', closeHashtagModal)
document.getElementById('htag-save-btn').addEventListener('click', saveHashtag)
document.getElementById('htag-modal-overlay').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeHashtagModal()
})
document.getElementById('htag-text').addEventListener('keydown', e => {
  if (e.key === 'Enter') saveHashtag()
})

document.getElementById('add-caption-btn').addEventListener('click', () => openCaptionModal())
document.getElementById('caption-modal-close').addEventListener('click', closeCaptionModal)
document.getElementById('caption-cancel-btn').addEventListener('click', closeCaptionModal)
document.getElementById('caption-save-btn').addEventListener('click', saveCaption)
document.getElementById('caption-delete-btn').addEventListener('click', deleteCaption)
document.getElementById('caption-modal-overlay').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeCaptionModal()
})

document.getElementById('week-prev').addEventListener('click', () => { state.weekOffset--; renderWeek() })
document.getElementById('week-next').addEventListener('click', () => { state.weekOffset++; renderWeek() })
document.getElementById('week-today').addEventListener('click', () => { state.weekOffset = 0; renderWeek() })

document.getElementById('month-prev').addEventListener('click', () => { state.monthOffset--; renderMonth() })
document.getElementById('month-next').addEventListener('click', () => { state.monthOffset++; renderMonth() })
document.getElementById('month-today').addEventListener('click', () => { state.monthOffset = 0; renderMonth() })

document.getElementById('add-tag-btn').addEventListener('click', () => openTagModal())
document.getElementById('tag-modal-close').addEventListener('click', closeTagModal)
document.getElementById('tag-cancel-btn').addEventListener('click', closeTagModal)
document.getElementById('tag-save-btn').addEventListener('click', saveTag)
document.getElementById('tag-delete-btn').addEventListener('click', deleteTag)
document.getElementById('tag-modal-overlay').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeTagModal()
})
document.getElementById('tag-name-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') saveTag()
})

document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return
  closePostModal(); closeHashtagModal(); closeCaptionModal(); closeTagModal()
})

// ── Drag and drop ─────────────────────────────────────────────────────────
let _notesQuill = null

function initNotesQuill() {
  if (_notesQuill || typeof Quill === 'undefined') return
  _notesQuill = new Quill('#post-notes-editor', {
    theme: 'snow',
    placeholder: 'Add structured notes — why it works, format, content breakdown…',
    modules: {
      toolbar: [
        ['bold', 'italic'],
        [{ header: 2 }, { header: 3 }],
        [{ list: 'ordered' }, { list: 'bullet' }],
        ['clean'],
      ],
    },
  })
}

let dragPostId = null

function initDragDrop() {
  // Dragstart / dragend via delegation (cards are re-rendered)
  document.addEventListener('dragstart', e => {
    const card = e.target.closest('.post-card')
    if (!card) return
    dragPostId = card.dataset.id
    e.dataTransfer.effectAllowed = 'move'
    // Defer class add so the ghost image captures the un-dimmed card
    requestAnimationFrame(() => card.classList.add('dragging'))
  })

  document.addEventListener('dragend', e => {
    const card = e.target.closest('.post-card')
    if (card) card.classList.remove('dragging')
    document.querySelectorAll('.pipeline-col.drag-over')
      .forEach(col => col.classList.remove('drag-over'))
    dragPostId = null
  })

  // Columns are static — wire them up once
  document.querySelectorAll('.pipeline-col').forEach(col => {
    col.addEventListener('dragover', e => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      col.classList.add('drag-over')
    })

    col.addEventListener('dragleave', e => {
      if (!col.contains(e.relatedTarget)) col.classList.remove('drag-over')
    })

    col.addEventListener('drop', async e => {
      e.preventDefault()
      col.classList.remove('drag-over')
      if (!dragPostId) return

      const newStatus = col.dataset.status
      const post = data.posts.find(p => p.id === dragPostId)
      if (!post || post.status === newStatus) return

      // Optimistic update — feels instant
      post.status = newStatus
      renderPipeline()

      const { error } = await sb.from('cp_posts')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', dragPostId)

      if (error) {
        showToast('Error moving post')
        await fetchPosts()
        renderPipeline()
      }
    })
  })
}

// ── Init ──────────────────────────────────────────────────────────────────
async function init() {
  setLoading(true)
  const ok = await fetchAll()
  setLoading(false)
  if (ok) render()
  initDragDrop()
}

init()
