const $ = (sel) => document.querySelector(sel);

const ICON_EDIT = `<svg width="20" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1.003 1.003 0 0 0 0-1.42l-2.34-2.34a1.003 1.003 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 1.84-1.82z"/></svg>`;

const ICON_DELETE = `<svg width="20" height="19" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>`;

const ICON_FORCE = `<svg width="20" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`;

const ICON_DRAG = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><circle cx="5" cy="4" r="1.25"/><circle cx="11" cy="4" r="1.25"/><circle cx="5" cy="8" r="1.25"/><circle cx="11" cy="8" r="1.25"/><circle cx="5" cy="12" r="1.25"/><circle cx="11" cy="12" r="1.25"/></svg>`;

const THEME_KEY = 'figma-backup-theme';
const FILTER_STORAGE_KEY = 'figmaBackup:linkFilters';

let linksCache = [];
let designersCache = [];
let pendingDeleteId = null;
let backupInProgress = false;
let authReady = false;
let dragState = null;
let filterDesigner = null;
let filterResponsibleOnly = false;

const DEFAULT_AVATAR = '/avatars/Default.png';

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  if (!res.ok && res.status !== 204) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  if (res.status === 204) return null;
  return res.json();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForBackupToFinish() {
  while (true) {
    const status = await api('GET', '/api/auth/status');
    if (!status.backupRunning) return;
    await sleep(500);
  }
}

function appendLog(entry) {
  const panel = $('#log-panel');
  const div = document.createElement('div');
  div.className = `log-entry ${entry.level}`;
  const time = new Date(entry.timestamp).toLocaleTimeString();
  div.textContent = `[${time}] ${entry.message}`;
  panel.appendChild(div);
  panel.scrollTop = panel.scrollHeight;
}

function connectLogs() {
  const source = new EventSource('/api/logs');
  source.onmessage = (e) => appendLog(JSON.parse(e.data));
}

function renderServiceStatus(service, cardEl, statusEl) {
  cardEl.classList.toggle('auth-card-ready', service.ok);
  cardEl.classList.toggle('auth-card-missing', !service.ok);
  statusEl.textContent = service.label;
  statusEl.className = `status-badge ${service.ok ? 'status-badge-ok' : 'status-badge-no'}`;
}

async function refreshAuthStatus() {
  const status = await api('GET', '/api/auth/status');

  $('#auth-hint').textContent = status.hint;
  $('#auth-hint').className = 'auth-hint-main';

  renderServiceStatus(status.figma, $('#card-figma'), $('#status-figma'));
  renderServiceStatus(status.google, $('#card-google'), $('#status-google'));
  authReady = status.ready;
  backupInProgress = Boolean(status.backupRunning);
  syncBackupControls();
  syncDragHandles();
}

function getOrderedIds() {
  return [...$('#links-body').querySelectorAll('tr')].map((tr) => tr.dataset.id);
}

function clearDropIndicators() {
  $('#links-body').querySelectorAll('.drop-before, .drop-after').forEach((row) => {
    row.classList.remove('drop-before', 'drop-after');
  });
}

function syncDragHandles() {
  const disabled = backupInProgress;
  $('#links-body').querySelectorAll('.drag-handle').forEach((handle) => {
    handle.classList.toggle('drag-handle-disabled', disabled);
  });
}

async function persistLinkOrder(previous) {
  try {
    const data = await api('PUT', '/api/links/reorder', { ids: getOrderedIds() });
    linksCache = data.links;
  } catch (err) {
    renderLinks(previous);
    appendLog({ timestamp: new Date().toISOString(), level: 'error', message: err.message });
  }
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function avatarUrl(name) {
  return `/avatars/${encodeURIComponent(name)}.png`;
}

function renderDesignerCell(name) {
  const src = avatarUrl(name);
  return `<td class="col-designer">
    <div class="designer-cell">
      <img class="designer-avatar" src="${escapeHtml(src)}" width="28" height="28" alt="" onerror="this.onerror=null;this.src='${DEFAULT_AVATAR}'">
      <span class="designer-name">${escapeHtml(name)}</span>
    </div>
  </td>`;
}

function setDesignerSelection(field, name) {
  $(`#input-${field}`).value = name || '';
  const valueEl = $(`#dropdown-${field} .designer-dropdown-value`);
  if (name) {
    valueEl.className = 'designer-dropdown-value';
    valueEl.innerHTML = `<img class="designer-avatar" src="${escapeHtml(avatarUrl(name))}" width="24" height="24" alt="" onerror="this.onerror=null;this.src='${DEFAULT_AVATAR}'"><span class="designer-dropdown-name">${escapeHtml(name)}</span>`;
  } else {
    valueEl.className = 'designer-dropdown-value is-placeholder';
    valueEl.textContent = 'Выберите...';
  }
  closeDesignerDropdowns();
  syncDesignerFormState();
}
function buildDesignerDropdowns() {
  for (const field of ['responsible', 'backup']) {
    const menu = $(`#dropdown-${field} .designer-dropdown-menu`);
    if (!menu) continue;
    menu.innerHTML = designersCache.map((name) => `
      <li>
        <button type="button" class="designer-dropdown-option" data-field="${field}" data-name="${escapeHtml(name)}" role="option">
          <img src="${escapeHtml(avatarUrl(name))}" width="28" height="28" alt="" onerror="this.onerror=null;this.src='${DEFAULT_AVATAR}'">
          <span>${escapeHtml(name)}</span>
        </button>
      </li>
    `).join('');
  }
}

function closeDesignerDropdowns(exceptField = null) {
  for (const field of ['responsible', 'backup']) {
    if (field === exceptField) continue;
    const dropdown = $(`#dropdown-${field}`);
    dropdown.querySelector('.designer-dropdown-menu').classList.add('hidden');
    dropdown.querySelector('.designer-dropdown-trigger').setAttribute('aria-expanded', 'false');
  }
}

function toggleDesignerDropdown(field) {
  const dropdown = $(`#dropdown-${field}`);
  const menu = dropdown.querySelector('.designer-dropdown-menu');
  const trigger = dropdown.querySelector('.designer-dropdown-trigger');
  const willOpen = menu.classList.contains('hidden');
  closeDesignerDropdowns();
  if (willOpen) {
    menu.classList.remove('hidden');
    trigger.setAttribute('aria-expanded', 'true');
  }
}

function clearDesignerSelection() {
  setDesignerSelection('responsible', '');
  setDesignerSelection('backup', '');
}

function syncDesignerFormState() {
  const responsible = $('#input-responsible').value;
  const backup = $('#input-backup').value;
  const same = responsible && backup && responsible === backup;
  $('#designer-error').classList.toggle('hidden', !same);
  $('#btn-modal-save').disabled = !responsible || !backup || same;
}

async function loadDesigners() {
  const data = await api('GET', '/api/designers');
  designersCache = data.designers;
  buildDesignerDropdowns();
  buildFilterDropdown();
  loadFiltersFromStorage();
  syncFilterUi();
}

function isFilterActive() {
  return !!filterDesigner;
}

function rowMatchesFilter(link) {
  if (!filterDesigner) return true;
  if (filterResponsibleOnly) return link.responsible === filterDesigner;
  return link.responsible === filterDesigner || link.backup === filterDesigner;
}

function getVisibleLinks() {
  if (!isFilterActive()) return linksCache;
  return linksCache.filter(rowMatchesFilter);
}

function getBackupCandidateIds() {
  return linksCache.filter((l) => l.enabled && rowMatchesFilter(l)).map((l) => l.id);
}

function updateBackupButton() {
  const btn = $('#btn-backup');
  if (!btn) return;
  const count = getBackupCandidateIds().length;
  if (backupInProgress) {
    btn.innerHTML = 'Бэкаплю<span class="backup-btn-dots" aria-hidden="true"></span>';
  } else {
    btn.textContent = count > 0 ? `Сделать бэкап (${count})` : 'Сделать бэкап';
  }
  btn.disabled = !authReady || backupInProgress || count === 0;
}

function syncBackupControls() {
  updateBackupButton();
  const disabled = !authReady || backupInProgress;
  document.querySelectorAll('[data-action="force-backup"]').forEach((btn) => {
    btn.disabled = disabled;
  });
  if (typeof syncCatMascot === 'function') {
    syncCatMascot(backupInProgress);
  }
}

function applyRowFilters() {
  for (const tr of $('#links-body').querySelectorAll('tr')) {
    const link = linksCache.find((l) => l.id === tr.dataset.id);
    tr.classList.toggle('row-filter-hidden', link && !rowMatchesFilter(link));
  }
  updateBackupButton();
  syncSelectAllCheckbox();
}

function loadFiltersFromStorage() {
  try {
    const raw = localStorage.getItem(FILTER_STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.designer && designersCache.includes(data.designer)) {
      filterDesigner = data.designer;
    } else {
      filterDesigner = null;
    }
    filterResponsibleOnly = !!data.responsibleOnly && !!filterDesigner;
  } catch {
    filterDesigner = null;
    filterResponsibleOnly = false;
  }
}

function saveFiltersToStorage() {
  localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify({
    designer: filterDesigner,
    responsibleOnly: filterResponsibleOnly,
  }));
}

function setFilterDesigner(name) {
  filterDesigner = name || null;
  if (!filterDesigner) filterResponsibleOnly = false;
  syncFilterUi();
  saveFiltersToStorage();
  applyRowFilters();
}

function syncFilterUi() {
  const valueEl = $('#filter-dropdown-designer .designer-dropdown-value');
  const responsibleOnly = $('#filter-responsible-only');
  const resetBtn = $('#btn-filter-reset');

  if (filterDesigner) {
    valueEl.className = 'designer-dropdown-value';
    valueEl.innerHTML = `<img class="designer-avatar" src="${escapeHtml(avatarUrl(filterDesigner))}" width="24" height="24" alt="" onerror="this.onerror=null;this.src='${DEFAULT_AVATAR}'"><span class="designer-dropdown-name">${escapeHtml(filterDesigner)}</span>`;
  } else {
    valueEl.className = 'designer-dropdown-value is-placeholder';
    valueEl.innerHTML = `<img class="designer-avatar" src="${DEFAULT_AVATAR}" width="24" height="24" alt=""><span class="designer-dropdown-name">Все дизайнеры</span>`;
  }

  responsibleOnly.checked = filterResponsibleOnly;
  responsibleOnly.disabled = !filterDesigner;
  resetBtn.classList.toggle('hidden', !isFilterActive());
}

function buildFilterDropdown() {
  const menu = $('#filter-dropdown-designer .designer-dropdown-menu');
  if (!menu) return;

  const allOption = `
    <li>
      <button type="button" class="designer-dropdown-option" data-name="" role="option">
        <img src="${DEFAULT_AVATAR}" width="28" height="28" alt="">
        <span>Все дизайнеры</span>
      </button>
    </li>`;
  const designerOptions = designersCache.map((name) => `
    <li>
      <button type="button" class="designer-dropdown-option" data-name="${escapeHtml(name)}" role="option">
        <img src="${escapeHtml(avatarUrl(name))}" width="28" height="28" alt="" onerror="this.onerror=null;this.src='${DEFAULT_AVATAR}'">
        <span>${escapeHtml(name)}</span>
      </button>
    </li>
  `).join('');
  menu.innerHTML = allOption + designerOptions;
}

function closeFilterDropdown() {
  const dropdown = $('#filter-dropdown-designer');
  if (!dropdown) return;
  dropdown.querySelector('.designer-dropdown-menu').classList.add('hidden');
  dropdown.querySelector('.designer-dropdown-trigger').setAttribute('aria-expanded', 'false');
}

function toggleFilterDropdown() {
  const dropdown = $('#filter-dropdown-designer');
  const menu = dropdown.querySelector('.designer-dropdown-menu');
  const trigger = dropdown.querySelector('.designer-dropdown-trigger');
  const willOpen = menu.classList.contains('hidden');
  closeDesignerDropdowns();
  closeFilterDropdown();
  if (willOpen) {
    menu.classList.remove('hidden');
    trigger.setAttribute('aria-expanded', 'true');
  }
}

function resetFilters() {
  filterDesigner = null;
  filterResponsibleOnly = false;
  localStorage.removeItem(FILTER_STORAGE_KEY);
  syncFilterUi();
  applyRowFilters();
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isDark = saved ? saved === 'dark' : prefersDark;
  setTheme(isDark);
  $('#btn-theme').addEventListener('click', () => {
    setTheme(document.documentElement.dataset.theme !== 'dark');
  });
}

function setTheme(isDark) {
  document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
  localStorage.setItem(THEME_KEY, isDark ? 'dark' : 'light');
  const moon = $('.icon-theme-moon');
  const sun = $('.icon-theme-sun');
  if (moon && sun) {
    moon.classList.toggle('hidden', isDark);
    sun.classList.toggle('hidden', !isDark);
  }
  $('#btn-theme').setAttribute('aria-label', isDark ? 'Светлая тема' : 'Тёмная тема');
  $('#btn-theme').title = isDark ? 'Светлая тема' : 'Тёмная тема';
}

function renderLinks(links) {
  linksCache = links;
  const tbody = $('#links-body');
  tbody.innerHTML = '';
  for (const link of links) {
    const tr = document.createElement('tr');
    tr.dataset.id = link.id;
    tr.innerHTML = `
      <td class="col-drag">
        <span class="drag-handle" data-id="${link.id}" aria-label="Перетащить" title="Перетащить">${ICON_DRAG}</span>
      </td>
      <td class="col-check"><input type="checkbox" ${link.enabled ? 'checked' : ''} data-action="toggle" data-id="${link.id}"></td>
      <td class="col-name cell-name">${escapeHtml(link.name)}</td>
      <td class="col-links">
        <div class="link-icons">
          <a class="link-icon" href="${escapeHtml(link.figmaUrl)}" target="_blank" rel="noopener" aria-label="Открыть Figma">
            <img src="/icons/figma.svg" width="20" height="20" alt="">
          </a>
          <a class="link-icon" href="${escapeHtml(link.driveFolderUrl)}" target="_blank" rel="noopener" aria-label="Открыть Google Drive">
            <img src="/icons/logo_drive_2026_color_2x_web_48dp.png" width="20" height="20" alt="">
          </a>
        </div>
      </td>
      ${renderDesignerCell(link.responsible)}
      ${renderDesignerCell(link.backup)}
      <td class="actions-cell">
        <div class="actions-group">
          <button type="button" class="btn-action btn-action-force" data-action="force-backup" data-id="${link.id}" title="Принудительная загрузка" aria-label="Принудительная загрузка">${ICON_FORCE}</button>
          <button type="button" class="btn-action btn-action-edit" data-action="edit" data-id="${link.id}" title="Изменить" aria-label="Изменить">${ICON_EDIT}</button>
          <button type="button" class="btn-action btn-action-delete" data-action="delete" data-id="${link.id}" title="Удалить" aria-label="Удалить">${ICON_DELETE}</button>
        </div>
      </td>`;
    tbody.appendChild(tr);
  }
  syncSelectAllCheckbox();
  syncDragHandles();
  applyRowFilters();
  syncBackupControls();
}

function syncSelectAllCheckbox() {
  const master = $('#toggle-all');
  if (!master) return;

  const visibleLinks = getVisibleLinks();

  if (visibleLinks.length === 0) {
    master.checked = false;
    master.indeterminate = false;
    master.disabled = linksCache.length === 0;
    return;
  }

  master.disabled = false;
  const enabledCount = visibleLinks.filter((l) => l.enabled).length;
  master.checked = enabledCount === visibleLinks.length;
  master.indeterminate = enabledCount > 0 && enabledCount < visibleLinks.length;
}

async function refreshLinks() {
  const data = await api('GET', '/api/links');
  renderLinks(data.links);
}

function openLinkModal(mode, link = null) {
  const modal = $('#link-modal');
  const isEdit = mode === 'edit';

  $('#modal-title').textContent = isEdit ? 'Изменить ссылку' : 'Добавить ссылку';
  $('#btn-modal-save').textContent = isEdit ? 'Сохранить' : 'Добавить';
  $('#input-link-id').value = isEdit ? link.id : '';
  $('#input-name').value = isEdit ? link.name : '';
  $('#input-figma').value = isEdit ? link.figmaUrl : '';
  $('#input-drive').value = isEdit ? link.driveFolderUrl : '';

  if (isEdit) {
    setDesignerSelection('responsible', link.responsible);
    setDesignerSelection('backup', link.backup);
  } else {
    clearDesignerSelection();
  }
  syncDesignerFormState();

  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  $('#input-name').focus();
}

function closeLinkModal() {
  const modal = $('#link-modal');
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
  $('#form-link').reset();
  $('#input-link-id').value = '';
  clearDesignerSelection();
  closeDesignerDropdowns();
  $('#designer-error').classList.add('hidden');
  $('#btn-modal-save').disabled = false;
}

function openDeleteModal(link) {
  pendingDeleteId = link.id;
  $('#delete-modal-text').textContent = `Вы уверены, что хотите удалить «${link.name}»? Это действие нельзя отменить.`;
  const modal = $('#delete-modal');
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
}

function closeDeleteModal() {
  pendingDeleteId = null;
  const modal = $('#delete-modal');
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
}

$('#btn-add-link').addEventListener('click', () => openLinkModal('add'));

$('#link-modal').addEventListener('click', (e) => {
  const trigger = e.target.closest('.designer-dropdown-trigger');
  if (trigger) {
    const field = trigger.closest('.designer-dropdown').id.replace('dropdown-', '');
    toggleDesignerDropdown(field);
    return;
  }

  const option = e.target.closest('.designer-dropdown-option');
  if (option) {
    setDesignerSelection(option.dataset.field, option.dataset.name);
    return;
  }

  if (e.target.closest('[data-close-modal]')) {
    closeLinkModal();
  }
});

document.addEventListener('click', (e) => {
  if (e.target.closest('#link-modal .designer-dropdown')) return;
  closeDesignerDropdowns();
  if (!e.target.closest('#filter-dropdown-designer')) {
    closeFilterDropdown();
  }
});

$('#links-filters').addEventListener('click', (e) => {
  const trigger = e.target.closest('.designer-dropdown-trigger');
  if (trigger && trigger.closest('#filter-dropdown-designer')) {
    toggleFilterDropdown();
    return;
  }

  const option = e.target.closest('.designer-dropdown-option');
  if (option && option.closest('#filter-dropdown-designer')) {
    setFilterDesigner(option.dataset.name || null);
    closeFilterDropdown();
  }
});

$('#filter-responsible-only').addEventListener('change', (e) => {
  if (!filterDesigner) return;
  filterResponsibleOnly = e.target.checked;
  saveFiltersToStorage();
  applyRowFilters();
});

$('#btn-filter-reset').addEventListener('click', () => {
  resetFilters();
  closeFilterDropdown();
});

$('#delete-modal').addEventListener('click', (e) => {
  if (e.target.closest('[data-close-delete]')) {
    closeDeleteModal();
  }
});

$('#btn-confirm-delete').addEventListener('click', async () => {
  if (!pendingDeleteId) return;
  const id = pendingDeleteId;
  closeDeleteModal();
  await api('DELETE', `/api/links/${id}`);
  await refreshLinks();
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('#link-modal').classList.contains('hidden')) closeLinkModal();
  if (!$('#delete-modal').classList.contains('hidden')) closeDeleteModal();
});

$('#form-link').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = $('#input-link-id').value;
  const payload = {
    name: $('#input-name').value.trim(),
    figmaUrl: $('#input-figma').value.trim(),
    driveFolderUrl: $('#input-drive').value.trim(),
    responsible: $('#input-responsible').value,
    backup: $('#input-backup').value,
  };

  if (id) {
    await api('PUT', `/api/links/${id}`, payload);
  } else {
    await api('POST', '/api/links', payload);
  }

  closeLinkModal();
  await refreshLinks();
});

$('#links-body').addEventListener('pointerdown', (e) => {
  const handle = e.target.closest('.drag-handle');
  if (!handle || handle.classList.contains('drag-handle-disabled')) return;
  if (e.button !== 0) return;

  const tr = handle.closest('tr');
  if (!tr) return;

  e.preventDefault();
  dragState = {
    tr,
    pointerId: e.pointerId,
    insertBefore: true,
    target: null,
  };
  tr.classList.add('row-dragging');
  handle.setPointerCapture(e.pointerId);
});

$('#links-body').addEventListener('pointermove', (e) => {
  if (!dragState || e.pointerId !== dragState.pointerId) return;

  const tbody = $('#links-body');
  const target = document.elementFromPoint(e.clientX, e.clientY)?.closest('tr');
  clearDropIndicators();

  if (!target || !tbody.contains(target) || target === dragState.tr) {
    dragState.target = null;
    return;
  }

  const rect = target.getBoundingClientRect();
  const insertBefore = e.clientY < rect.top + rect.height / 2;
  target.classList.add(insertBefore ? 'drop-before' : 'drop-after');
  dragState.target = target;
  dragState.insertBefore = insertBefore;
});

async function finishRowDrag(e) {
  if (!dragState || e.pointerId !== dragState.pointerId) return;

  const tbody = $('#links-body');
  const { tr, target, insertBefore } = dragState;
  dragState = null;
  tr.classList.remove('row-dragging');
  clearDropIndicators();

  if (!target || target === tr) return;

  if (insertBefore) {
    tbody.insertBefore(tr, target);
  } else {
    tbody.insertBefore(tr, target.nextElementSibling);
  }

  await persistLinkOrder([...linksCache]);
}

$('#links-body').addEventListener('pointerup', finishRowDrag);
$('#links-body').addEventListener('pointercancel', finishRowDrag);

$('#links-body').addEventListener('change', async (e) => {
  const input = e.target.closest('[data-action="toggle"]');
  if (!input) return;
  await api('PUT', `/api/links/${input.dataset.id}`, { enabled: input.checked });
  const link = linksCache.find((l) => l.id === input.dataset.id);
  if (link) link.enabled = input.checked;
  updateBackupButton();
  syncSelectAllCheckbox();
});

$('#toggle-all').addEventListener('change', async (e) => {
  const enabled = e.target.checked;
  const toUpdate = getVisibleLinks().filter((l) => l.enabled !== enabled);
  if (toUpdate.length === 0) return;

  await Promise.all(
    toUpdate.map((link) => api('PUT', `/api/links/${link.id}`, { enabled })),
  );

  for (const link of toUpdate) {
    link.enabled = enabled;
  }

  const tbody = $('#links-body');
  for (const link of toUpdate) {
    const cb = tbody.querySelector(`[data-action="toggle"][data-id="${link.id}"]`);
    if (cb) cb.checked = enabled;
  }
  updateBackupButton();
  syncSelectAllCheckbox();
});

$('#links-body').addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn || btn.dataset.action === 'toggle') return;

  const { action, id } = btn.dataset;

  if (action === 'delete') {
    const link = linksCache.find((l) => l.id === id);
    if (link) openDeleteModal(link);
    return;
  }

  if (action === 'edit') {
    const link = linksCache.find((l) => l.id === id);
    if (link) openLinkModal('edit', link);
    return;
  }

  if (action === 'force-backup') {
    backupInProgress = true;
    syncBackupControls();
    syncDragHandles();
    try {
      await api('POST', `/api/links/${id}/backup`, { force: true });
      await waitForBackupToFinish();
    } catch (err) {
      appendLog({ timestamp: new Date().toISOString(), level: 'error', message: err.message });
    } finally {
      backupInProgress = false;
      syncBackupControls();
      syncDragHandles();
    }
  }
});

$('#btn-auth-figma').addEventListener('click', async () => {
  $('#btn-auth-figma').disabled = true;
  try {
    await api('POST', '/api/auth/figma');
    await refreshAuthStatus();
  } catch (err) {
    appendLog({ timestamp: new Date().toISOString(), level: 'error', message: err.message });
  } finally {
    $('#btn-auth-figma').disabled = false;
  }
});

$('#btn-auth-google').addEventListener('click', async () => {
  $('#btn-auth-google').disabled = true;
  try {
    await api('POST', '/api/auth/google');
    await refreshAuthStatus();
  } catch (err) {
    appendLog({ timestamp: new Date().toISOString(), level: 'error', message: err.message });
  } finally {
    $('#btn-auth-google').disabled = false;
  }
});

$('#btn-backup').addEventListener('click', async () => {
  backupInProgress = true;
  syncBackupControls();
  syncDragHandles();
  const ids = getBackupCandidateIds();
  try {
    await api('POST', '/api/backup', { ids });
    await waitForBackupToFinish();
  } catch (err) {
    appendLog({ timestamp: new Date().toISOString(), level: 'error', message: err.message });
  } finally {
    backupInProgress = false;
    syncBackupControls();
    syncDragHandles();
  }
});

if (typeof initCatMascot === 'function') {
  initCatMascot();
}

connectLogs();
initTheme();
loadDesigners().then(() => {
  refreshAuthStatus();
  refreshLinks();
});
setInterval(refreshAuthStatus, 5000);
