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
        action: 'toggle-team',
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
        name: action.name,
        team: action.team
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

function getSelectedMetricName(record, mapName) {
  const source = record && typeof record[mapName] === 'object' ? record[mapName] : {};
  const names = Array.isArray(record.names) ? record.names : [];
  return names.find((name) => Number(source[normalizeNameKey(name)] || 0) > 0) || '';
}

function hasTeam(record, name, teamKey) {
  const key = normalizeNameKey(name);
  const teamA = Array.isArray(record.teamA) ? record.teamA : [];
  const teamB = Array.isArray(record.teamB) ? record.teamB : [];

  if (teamKey === 'A') {
    return teamA.some((item) => normalizeNameKey(item) === key);
  }

  if (teamKey === 'B') {
    return teamB.some((item) => normalizeNameKey(item) === key);
  }

  return false;
}

function getByTeamMap(record, mapName) {
  const source = record && typeof record === 'object' ? record[mapName] : null;
  const sourceA = source && typeof source.A === 'object' ? source.A : {};
  const sourceB = source && typeof source.B === 'object' ? source.B : {};

  return {
    A: sourceA,
    B: sourceB
  };
}

function getTeamStatForName(record, name, teamKey, mapName) {
  const key = normalizeNameKey(name);
  const byTeam = getByTeamMap(record, mapName);
  const explicit = Number(byTeam[teamKey][key] || 0);

  if (explicit > 0) {
    return explicit;
  }

  // Backward compatibility with records saved before team-scoped stats.
  if (!Object.keys(byTeam.A).length && !Object.keys(byTeam.B).length && hasTeam(record, name, teamKey)) {
    if (mapName === 'goalsByTeamName') {
      return getGoalsForName(record, name);
    }

    return getAssistsForName(record, name);
  }

  return explicit;
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

      return `
      <article class="confirmados-item">
        <button class="partidas-date-toggle" type="button" data-action="toggle-date" data-date="${record.date}">
          <span class="partidas-date-title">${formatDate(record.date)}</span>
          <span class="partidas-date-meta">${record.count} confirmados</span>
          <span class="partidas-date-chevron">${isExpanded ? 'Ocultar' : 'Ver'}</span>
        </button>

        ${isExpanded ? `
        <div class="partidas-details">
          <ul class="confirmados-names">
            ${(record.names || []).map((name) => `<li>${escapeHtml(name)}</li>`).join('') || '<li>Sem atletas confirmados.</li>'}
          </ul>
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
      action: 'toggle-team',
      date,
      name: playerName,
      team
    })
  });
}

async function registerGoal(date, playerName, team) {
  await request(buildApiUrl(), {
    method: 'PUT',
    body: JSON.stringify({
      action: 'add-goal',
      date,
      name: playerName,
      team
    })
  });
}

async function registerAssist(date, playerName, team) {
  await request(buildApiUrl(), {
    method: 'PUT',
    body: JSON.stringify({
      action: 'add-assist',
      date,
      name: playerName,
      team
    })
  });
}

async function undoGoal(date, playerName, team) {
  await request(buildApiUrl(), {
    method: 'PUT',
    body: JSON.stringify({
      action: 'remove-goal',
      date,
      name: playerName,
      team
    })
  });
}

async function undoAssist(date, playerName, team) {
  await request(buildApiUrl(), {
    method: 'PUT',
    body: JSON.stringify({
      action: 'remove-assist',
      date,
      name: playerName,
      team
    })
  });
}

async function setMvp(date, playerName) {
  const action = playerName ? 'set-mvp' : 'clear-mvp';
  await request(buildApiUrl(), {
    method: 'PUT',
    body: JSON.stringify({
      action,
      date,
      name: playerName
    })
  });
}

async function setWorst(date, playerName) {
  const action = playerName ? 'set-worst' : 'clear-worst';
  await request(buildApiUrl(), {
    method: 'PUT',
    body: JSON.stringify({
      action,
      date,
      name: playerName
    })
  });
}

confirmadosListEl.addEventListener('change', async (event) => {
  const mvpSelect = event.target.closest('select[data-action="set-mvp-select"][data-date]');
  const worstSelect = event.target.closest('select[data-action="set-worst-select"][data-date]');
  const select = mvpSelect || worstSelect;
  if (!select) {
    return;
  }

  const date = String(select.dataset.date || '').trim();
  const player = String(select.value || '').trim();
  if (!date) {
    return;
  }

  const isMvp = Boolean(mvpSelect);
  const action = isMvp ? (player ? 'set-mvp' : 'clear-mvp') : (player ? 'set-worst' : 'clear-worst');

  if (!navigator.onLine) {
    enqueueAction({ type: 'player-action', action, date, name: player });
    setStatus(`${isMvp ? 'MVP' : 'Pior em campo'} salvo offline.`);
    return;
  }

  try {
    if (isMvp) {
      await setMvp(date, player);
      setStatus(player ? `MVP definido: ${player}.` : 'MVP removido.');
    } else {
      await setWorst(date, player);
      setStatus(player ? `Pior em campo definido: ${player}.` : 'Pior em campo removido.');
    }

    expandedRecordDate = date;
    await loadRecords();
    notifyPartidasUpdate(date, action);
  } catch (error) {
    setStatus(error.message, true);
  }
});

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
