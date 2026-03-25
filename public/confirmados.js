const confirmadosForm = document.getElementById('confirmados-form');
const matchDateInput = document.getElementById('match-date');
const confirmedNamesInput = document.getElementById('confirmed-names');
const confirmadosListEl = document.getElementById('confirmados-list');
const clearFormBtn = document.getElementById('clear-form-btn');
const statusEl = document.getElementById('status');
const GROUP_VALUE = document.body.dataset.group || '';
const TOKEN_KEY = GROUP_VALUE === 'domingo'
  ? 'app_futeba_domingo_token'
  : 'app_futeba_token';
const QUEUE_KEY = GROUP_VALUE === 'domingo'
  ? 'app_futeba_domingo_confirmados_queue'
  : 'app_futeba_confirmados_queue';
const logoutBtn = document.getElementById('logout-btn');
const syncStateEl = document.getElementById('sync-state');
const PARTIDAS_UPDATE_KEY = 'app_futeba_partidas_update';

let recordsCache = [];
let expandedRecordDate = null;
let syncInProgress = false;

function buildApiUrl(extraParams = {}) {
  const params = new URLSearchParams();
  if (GROUP_VALUE) {
    params.set('group', GROUP_VALUE);
  }

  Object.entries(extraParams).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim()) {
      params.set(key, String(value).trim());
    }
  });

  const query = params.toString();
  return query ? `/api/confirmados?${query}` : '/api/confirmados';
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle('error', isError);
}

function redirectToLogin() {
  window.location.href = GROUP_VALUE === 'domingo' ? '/domingo' : '/';
}

function loadQueue() {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveQueue(queue) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  updateSyncState();
}

function updateSyncState() {
  if (!syncStateEl) {
    return;
  }

  const pending = loadQueue().length;
  if (!navigator.onLine) {
    syncStateEl.textContent = pending ? `Offline | pendencias: ${pending}` : 'Offline';
    return;
  }

  if (syncInProgress) {
    syncStateEl.textContent = `Sincronizando${pending ? ` (${pending})` : '...'}`;
    return;
  }

  syncStateEl.textContent = pending ? `Pendencias: ${pending}` : 'Sincronizado';
}

function enqueueAction(action) {
  const queue = loadQueue();
  queue.push({ ...action, queuedAt: Date.now() });
  saveQueue(queue);
}

async function executeQueuedAction(action) {
  if (action.type === 'save-list') {
    await request(buildApiUrl(), {
      method: 'POST',
      body: JSON.stringify({ date: action.date, names: action.names })
    });
    notifyPartidasUpdate(action.date, 'save-list');
    return;
  }

  if (action.type === 'delete-record') {
    await request(buildApiUrl({ date: action.date }), {
      method: 'DELETE'
    });
    notifyPartidasUpdate(action.date, 'delete-record');
    return;
  }

  if (action.type === 'set-team') {
    await request(buildApiUrl(), {
      method: 'PUT',
      body: JSON.stringify({
        action: 'set-team',
        date: action.date,
        name: action.name,
        team: action.team
      })
    });
    notifyPartidasUpdate(action.date, 'set-team');
    return;
  }

  if (action.type === 'player-action') {
    await request(buildApiUrl(), {
      method: 'PUT',
      body: JSON.stringify({
        action: action.action,
        date: action.date,
        name: action.name
      })
    });
    notifyPartidasUpdate(action.date, action.action);
  }
}

async function flushQueue() {
  if (!navigator.onLine || syncInProgress) {
    return;
  }

  const queue = loadQueue();
  if (!queue.length) {
    updateSyncState();
    return;
  }

  syncInProgress = true;
  updateSyncState();

  const remaining = [...queue];

  try {
    while (remaining.length) {
      await executeQueuedAction(remaining[0]);
      remaining.shift();
      saveQueue(remaining);
    }

    await loadRecords();
    setStatus('Pendencias offline sincronizadas com sucesso.');
  } catch (error) {
    setStatus('Ainda existem pendencias offline para sincronizar.', true);
  } finally {
    syncInProgress = false;
    updateSyncState();
  }
}

function notifyPartidasUpdate(date, action) {
  try {
    localStorage.setItem(
      PARTIDAS_UPDATE_KEY,
      JSON.stringify({
        ts: Date.now(),
        group: GROUP_VALUE || '',
        date: String(date || ''),
        action: String(action || '')
      })
    );
  } catch {
    // Silent fail: localStorage may be unavailable in private contexts.
  }
}

function normalizeNames(text) {
  return Array.from(
    new Set(
      String(text || '')
        .split(/\r?\n/)
        .map((line) => {
          const raw = String(line || '');
          const match = raw.match(/^\s*\d+\s*[-.)–—]\s*(.+)$/u);
          const candidate = match ? match[1] : raw;

          return candidate
            .replace(/\(\s*avulso\s*\)/gi, '')
            .replace(/\s{2,}/g, ' ')
            .trim();
        })
        .filter(Boolean)
    )
  );
}

function normalizeNameKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function formatDate(dateText) {
  const [year, month, day] = String(dateText || '').split('-').map(Number);
  if (!year || !month || !day) {
    return dateText;
  }
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString('pt-BR', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

function getGoalsForName(record, name) {
  const key = normalizeNameKey(name);
  const goalsByName = record.goalsByName && typeof record.goalsByName === 'object'
    ? record.goalsByName
    : {};
  return Number(goalsByName[key] || 0);
}

function getAssistsForName(record, name) {
  const key = normalizeNameKey(name);
  const assistsByName = record.assistsByName && typeof record.assistsByName === 'object'
    ? record.assistsByName
    : {};
  return Number(assistsByName[key] || 0);
}

function getMvpForName(record, name) {
  const key = normalizeNameKey(name);
  const mvpByName = record.mvpByName && typeof record.mvpByName === 'object'
    ? record.mvpByName
    : {};
  return Number(mvpByName[key] || 0) > 0;
}

function getWorstForName(record, name) {
  const key = normalizeNameKey(name);
  const worstByName = record.worstByName && typeof record.worstByName === 'object'
    ? record.worstByName
    : {};
  return Number(worstByName[key] || 0) > 0;
}

function getAssignedTeam(record, name) {
  const key = normalizeNameKey(name);
  const teamA = Array.isArray(record.teamA) ? record.teamA : [];
  const teamB = Array.isArray(record.teamB) ? record.teamB : [];

  if (teamA.some((item) => normalizeNameKey(item) === key)) {
    return 'A';
  }

  if (teamB.some((item) => normalizeNameKey(item) === key)) {
    return 'B';
  }

  return '';
}

function renderRecords(records) {
  if (!records.length) {
    confirmadosListEl.innerHTML = '<p>Nenhuma lista salva ainda.</p>';
    return;
  }

  const validDates = new Set(records.map((record) => record.date));
  if (expandedRecordDate && !validDates.has(expandedRecordDate)) {
    expandedRecordDate = null;
  }

  confirmadosListEl.innerHTML = records
    .map((record) => {
      const isExpanded = expandedRecordDate === record.date;
      const teamA = Array.isArray(record.teamA) ? record.teamA : [];
      const teamB = Array.isArray(record.teamB) ? record.teamB : [];

      return `
      <article class="confirmados-item">
        <button class="partidas-date-toggle" type="button" data-action="toggle-date" data-date="${record.date}">
          <span>${formatDate(record.date)}</span>
          <span class="partidas-date-meta">${record.count} confirmados</span>
          <span class="partidas-date-chevron">${isExpanded ? 'Ocultar' : 'Ver'}</span>
        </button>

        ${isExpanded ? `
        <div class="partidas-details">
          <div class="confirmados-head-right" style="margin-bottom:0.55rem;">
            <span class="confirmados-count">${record.count} confirmados</span>
            <div class="confirmados-actions">
              <button class="confirmados-action-btn" type="button" data-action="edit-record" data-date="${record.date}">Editar</button>
              <button class="confirmados-action-btn danger" type="button" data-action="delete-record" data-date="${record.date}">Remover</button>
            </div>
          </div>

          <h4 class="partidas-subtitle">Selecionar time dos atletas</h4>
          <ul class="partidas-player-list confirmados-assign-list">
            ${(record.names || []).map((name) => {
              const assignedTeam = getAssignedTeam(record, name);
              const isMvp = getMvpForName(record, name);
              const isWorst = getWorstForName(record, name);

              return `
                <li class="confirmados-assign-row">
                  <span class="confirmados-assign-name">${escapeHtml(name)}</span>
                  <div class="confirmados-assign-controls">
                    <div class="confirmados-team-switch" role="group" aria-label="Selecionar time de ${escapeAttr(name)}">
                      <button class="confirmados-team-btn ${assignedTeam === 'A' ? 'active' : ''}" type="button" data-action="assign-player" data-date="${record.date}" data-player="${escapeAttr(name)}" data-target="A">A</button>
                      <button class="confirmados-team-btn ${assignedTeam === 'B' ? 'active' : ''}" type="button" data-action="assign-player" data-date="${record.date}" data-player="${escapeAttr(name)}" data-target="B">B</button>
                    </div>
                    <div class="confirmados-award-switch" role="group" aria-label="MVP e pior em campo de ${escapeAttr(name)}">
                      <button class="confirmados-award-btn ${isMvp ? 'active' : ''}" type="button" data-action="toggle-mvp" data-date="${record.date}" data-player="${escapeAttr(name)}" title="Marcar MVP">⭐</button>
                      <button class="confirmados-award-btn ${isWorst ? 'active' : ''}" type="button" data-action="toggle-worst" data-date="${record.date}" data-player="${escapeAttr(name)}" title="Marcar pior em campo">👎</button>
                    </div>
                  </div>
                </li>
              `;
            }).join('')}
          </ul>

          <div class="confirmados-teams">
            <div class="confirmados-team-card">
              <h4>Time A (${teamA.length})</h4>
              <ul class="confirmados-team-list">
                ${teamA.map((name) => `
                  <li class="confirmados-team-player-row">
                    <div class="partidas-stat-group confirmados-stat-stack">
                      <button class="partidas-stat-btn danger" type="button" data-action="remove-assist" data-date="${record.date}" data-player="${escapeAttr(name)}" title="Desfazer assistencia">-</button>
                      <button class="partidas-stat-btn" type="button" data-action="add-assist" data-date="${record.date}" data-player="${escapeAttr(name)}" title="Adicionar assistencia">&#128095;</button>
                      <span class="confirmados-stat-count">${getAssistsForName(record, name)}</span>
                    </div>
                    <span class="confirmados-player-name">${escapeHtml(name)}</span>
                    <div class="partidas-stat-group confirmados-stat-stack">
                      <button class="partidas-stat-btn danger" type="button" data-action="remove-goal" data-date="${record.date}" data-player="${escapeAttr(name)}" title="Desfazer gol">-</button>
                      <button class="partidas-stat-btn" type="button" data-action="add-goal" data-date="${record.date}" data-player="${escapeAttr(name)}" title="Adicionar gol">&#9917;</button>
                      <span class="confirmados-stat-count">${getGoalsForName(record, name)}</span>
                    </div>
                  </li>
                `).join('') || '<li><span>Sem atletas</span></li>'}
              </ul>
            </div>
            <div class="confirmados-team-card">
              <h4>Time B (${teamB.length})</h4>
              <ul class="confirmados-team-list">
                ${teamB.map((name) => `
                  <li class="confirmados-team-player-row">
                    <div class="partidas-stat-group confirmados-stat-stack">
                      <button class="partidas-stat-btn danger" type="button" data-action="remove-assist" data-date="${record.date}" data-player="${escapeAttr(name)}" title="Desfazer assistencia">-</button>
                      <button class="partidas-stat-btn" type="button" data-action="add-assist" data-date="${record.date}" data-player="${escapeAttr(name)}" title="Adicionar assistencia">&#128095;</button>
                      <span class="confirmados-stat-count">${getAssistsForName(record, name)}</span>
                    </div>
                    <span class="confirmados-player-name">${escapeHtml(name)}</span>
                    <div class="partidas-stat-group confirmados-stat-stack">
                      <button class="partidas-stat-btn danger" type="button" data-action="remove-goal" data-date="${record.date}" data-player="${escapeAttr(name)}" title="Desfazer gol">-</button>
                      <button class="partidas-stat-btn" type="button" data-action="add-goal" data-date="${record.date}" data-player="${escapeAttr(name)}" title="Adicionar gol">&#9917;</button>
                      <span class="confirmados-stat-count">${getGoalsForName(record, name)}</span>
                    </div>
                  </li>
                `).join('') || '<li><span>Sem atletas</span></li>'}
              </ul>
            </div>
          </div>
        </div>
        ` : ''}
      </article>
    `;
    })
    .join('');
}

async function request(url, options = {}) {
  const token = localStorage.getItem(TOKEN_KEY) || '';

  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    },
    ...options
  });

  const data = await response.json();
  if (response.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
    redirectToLogin();
    throw new Error('Sessao expirada. Faca login novamente.');
  }

  if (!response.ok) {
    throw new Error(data.error || 'Erro na requisicao.');
  }

  return data;
}

async function loadRecords() {
  const data = await request(buildApiUrl());
  recordsCache = data.records || [];
  renderRecords(recordsCache);
}

function setDefaultDate() {
  const now = new Date();
  const localIso = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
  matchDateInput.value = localIso;
}

function resetForm() {
  setDefaultDate();
  confirmedNamesInput.value = '';
}

function fillFormFromRecord(record) {
  matchDateInput.value = record.date;
  confirmedNamesInput.value = (record.names || []).join('\n');
  confirmedNamesInput.focus();
}

async function updateTeam(date, playerName, team) {
  await request(buildApiUrl(), {
    method: 'PUT',
    body: JSON.stringify({
      action: 'set-team',
      date,
      name: playerName,
      team
    })
  });
}

async function registerGoal(date, playerName) {
  await request(buildApiUrl(), {
    method: 'PUT',
    body: JSON.stringify({
      action: 'add-goal',
      date,
      name: playerName
    })
  });
}

async function registerAssist(date, playerName) {
  await request(buildApiUrl(), {
    method: 'PUT',
    body: JSON.stringify({
      action: 'add-assist',
      date,
      name: playerName
    })
  });
}

async function undoGoal(date, playerName) {
  await request(buildApiUrl(), {
    method: 'PUT',
    body: JSON.stringify({
      action: 'remove-goal',
      date,
      name: playerName
    })
  });
}

async function undoAssist(date, playerName) {
  await request(buildApiUrl(), {
    method: 'PUT',
    body: JSON.stringify({
      action: 'remove-assist',
      date,
      name: playerName
    })
  });
}

async function toggleMvp(date, playerName) {
  await request(buildApiUrl(), {
    method: 'PUT',
    body: JSON.stringify({
      action: 'toggle-mvp',
      date,
      name: playerName
    })
  });
}

async function toggleWorst(date, playerName) {
  await request(buildApiUrl(), {
    method: 'PUT',
    body: JSON.stringify({
      action: 'toggle-worst',
      date,
      name: playerName
    })
  });
}

confirmadosForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  try {
    const date = String(matchDateInput.value || '').trim();
    const names = normalizeNames(confirmedNamesInput.value);

    if (!date) {
      setStatus('Informe a data da partida.', true);
      return;
    }

    if (!names.length) {
      setStatus('Cole ao menos um nome na lista.', true);
      return;
    }

    if (!navigator.onLine) {
      enqueueAction({ type: 'save-list', date, names });
      resetForm();
      setStatus('Lista salva offline. Sera sincronizada quando voltar conexao.');
      return;
    }

    await request(buildApiUrl(), {
      method: 'POST',
      body: JSON.stringify({ date, names })
    });

    notifyPartidasUpdate(date, 'save-list');
    expandedRecordDate = date;
    resetForm();
    await loadRecords();
    setStatus('Lista de confirmados salva com sucesso. Se a data ja existia, a lista foi atualizada.');
  } catch (error) {
    setStatus(error.message, true);
  }
});

confirmadosListEl.addEventListener('click', async (event) => {
  const toggleBtn = event.target.closest('button[data-action="toggle-date"][data-date]');
  if (toggleBtn) {
    const date = toggleBtn.dataset.date;
    expandedRecordDate = expandedRecordDate === date ? null : date;
    renderRecords(recordsCache);
    return;
  }

  const assignBtn = event.target.closest('button[data-action="assign-player"][data-date][data-player][data-target]');
  if (assignBtn) {
    const date = assignBtn.dataset.date;
    const player = String(assignBtn.dataset.player || '').trim();
    const target = assignBtn.dataset.target;
    if (!date || !player || (target !== 'A' && target !== 'B')) {
      return;
    }

    if (!navigator.onLine) {
      enqueueAction({ type: 'set-team', date, name: player, team: target });
      setStatus(`Ajuste de time para ${player} salvo offline.`);
      return;
    }

    try {
      await updateTeam(date, player, target);
      expandedRecordDate = date;
      await loadRecords();
      notifyPartidasUpdate(date, 'set-team');
      setStatus(`Time do atleta ${player} atualizado para ${target}.`);
    } catch (error) {
      setStatus(error.message, true);
    }
    return;
  }

  const goalBtn = event.target.closest('button[data-action="add-goal"][data-date][data-player]');
  if (goalBtn) {
    const date = goalBtn.dataset.date;
    const player = String(goalBtn.dataset.player || '').trim();
    if (!date || !player) {
      return;
    }

    if (!navigator.onLine) {
      enqueueAction({ type: 'player-action', action: 'add-goal', date, name: player });
      setStatus(`Gol para ${player} salvo offline.`);
      return;
    }

    try {
      await registerGoal(date, player);
      expandedRecordDate = date;
      await loadRecords();
      notifyPartidasUpdate(date, 'add-goal');
      setStatus(`Gol registrado para ${player}.`);
    } catch (error) {
      setStatus(error.message, true);
    }
    return;
  }

  const assistBtn = event.target.closest('button[data-action="add-assist"][data-date][data-player]');
  if (assistBtn) {
    const date = assistBtn.dataset.date;
    const player = String(assistBtn.dataset.player || '').trim();
    if (!date || !player) {
      return;
    }

    if (!navigator.onLine) {
      enqueueAction({ type: 'player-action', action: 'add-assist', date, name: player });
      setStatus(`Assistencia para ${player} salva offline.`);
      return;
    }

    try {
      await registerAssist(date, player);
      expandedRecordDate = date;
      await loadRecords();
      notifyPartidasUpdate(date, 'add-assist');
      setStatus(`Assistencia registrada para ${player}.`);
    } catch (error) {
      setStatus(error.message, true);
    }
    return;
  }

  const undoGoalBtn = event.target.closest('button[data-action="remove-goal"][data-date][data-player]');
  if (undoGoalBtn) {
    const date = undoGoalBtn.dataset.date;
    const player = String(undoGoalBtn.dataset.player || '').trim();
    if (!date || !player) {
      return;
    }

    if (!navigator.onLine) {
      enqueueAction({ type: 'player-action', action: 'remove-goal', date, name: player });
      setStatus(`Desfazer gol de ${player} salvo offline.`);
      return;
    }

    try {
      await undoGoal(date, player);
      expandedRecordDate = date;
      await loadRecords();
      notifyPartidasUpdate(date, 'remove-goal');
      setStatus(`Gol desfeito para ${player}.`);
    } catch (error) {
      setStatus(error.message, true);
    }
    return;
  }

  const undoAssistBtn = event.target.closest('button[data-action="remove-assist"][data-date][data-player]');
  if (undoAssistBtn) {
    const date = undoAssistBtn.dataset.date;
    const player = String(undoAssistBtn.dataset.player || '').trim();
    if (!date || !player) {
      return;
    }

    if (!navigator.onLine) {
      enqueueAction({ type: 'player-action', action: 'remove-assist', date, name: player });
      setStatus(`Desfazer assistencia de ${player} salvo offline.`);
      return;
    }

    try {
      await undoAssist(date, player);
      expandedRecordDate = date;
      await loadRecords();
      notifyPartidasUpdate(date, 'remove-assist');
      setStatus(`Assistencia desfeita para ${player}.`);
    } catch (error) {
      setStatus(error.message, true);
    }
    return;
  }

  const toggleMvpBtn = event.target.closest('button[data-action="toggle-mvp"][data-date][data-player]');
  if (toggleMvpBtn) {
    const date = toggleMvpBtn.dataset.date;
    const player = String(toggleMvpBtn.dataset.player || '').trim();
    if (!date || !player) {
      return;
    }

    if (!navigator.onLine) {
      enqueueAction({ type: 'player-action', action: 'toggle-mvp', date, name: player });
      setStatus(`Ajuste de MVP para ${player} salvo offline.`);
      return;
    }

    try {
      await toggleMvp(date, player);
      expandedRecordDate = date;
      await loadRecords();
      setStatus(`MVP atualizado para ${player}.`);
    } catch (error) {
      setStatus(error.message, true);
    }
    return;
  }

  const toggleWorstBtn = event.target.closest('button[data-action="toggle-worst"][data-date][data-player]');
  if (toggleWorstBtn) {
    const date = toggleWorstBtn.dataset.date;
    const player = String(toggleWorstBtn.dataset.player || '').trim();
    if (!date || !player) {
      return;
    }

    if (!navigator.onLine) {
      enqueueAction({ type: 'player-action', action: 'toggle-worst', date, name: player });
      setStatus(`Ajuste de pior em campo para ${player} salvo offline.`);
      return;
    }

    try {
      await toggleWorst(date, player);
      expandedRecordDate = date;
      await loadRecords();
      setStatus(`Pior em campo atualizado para ${player}.`);
    } catch (error) {
      setStatus(error.message, true);
    }
    return;
  }

  const editBtn = event.target.closest('button[data-action="edit-record"][data-date]');
  if (editBtn) {
    const record = recordsCache.find((item) => item.date === editBtn.dataset.date);
    if (!record) {
      return;
    }

    fillFormFromRecord(record);
    setStatus(`Modo edicao ativado para ${formatDate(record.date)}. Altere e salve novamente.`);
    return;
  }

  const deleteBtn = event.target.closest('button[data-action="delete-record"][data-date]');
  if (!deleteBtn) {
    return;
  }

  const date = deleteBtn.dataset.date;
  const confirmed = window.confirm(`Remover a lista de ${formatDate(date)}?`);
  if (!confirmed) {
    return;
  }

  if (!navigator.onLine) {
    enqueueAction({ type: 'delete-record', date });
    setStatus(`Remocao de ${formatDate(date)} salva offline.`);
    return;
  }

  try {
    await request(buildApiUrl({ date }), {
      method: 'DELETE'
    });

    notifyPartidasUpdate(date, 'delete-record');

    if (expandedRecordDate === date) {
      expandedRecordDate = null;
    }

    await loadRecords();
    if (matchDateInput.value === date) {
      resetForm();
    }
    setStatus(`Lista de ${formatDate(date)} removida com sucesso.`);
  } catch (error) {
    setStatus(error.message, true);
  }
});

if (clearFormBtn) {
  clearFormBtn.addEventListener('click', () => {
    resetForm();
    setStatus('Formulario limpo.');
  });
}

if (logoutBtn) {
  logoutBtn.addEventListener('click', async () => {
    try {
      await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
    } finally {
      localStorage.removeItem(TOKEN_KEY);
      redirectToLogin();
    }
  });
}

window.addEventListener('online', () => {
  updateSyncState();
  flushQueue();
});

window.addEventListener('offline', () => {
  updateSyncState();
});

setDefaultDate();
loadRecords().then(() => {
  setStatus('Listas carregadas.');
}).catch((error) => {
  setStatus(error.message, true);
});

updateSyncState();
flushQueue();
