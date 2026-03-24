const confirmadosListEl = document.getElementById('confirmados-list');
const statusEl = document.getElementById('status');
const cornerAuthBtn = document.getElementById('corner-auth-btn');
const GROUP_VALUE = document.body.dataset.group || '';
const TOKEN_KEY = GROUP_VALUE === 'domingo' ? 'app_futeba_domingo_token' : 'app_futeba_token';
const PARTIDAS_UPDATE_KEY = 'app_futeba_partidas_update';
const AUTO_REFRESH_MS = 3000;
let isLoadingRecords = false;
const expandedRecordDates = new Set();

function updateCornerAuthButton() {
  if (!cornerAuthBtn) {
    return;
  }

  const isLoggedIn = Boolean(localStorage.getItem(TOKEN_KEY));
  cornerAuthBtn.textContent = isLoggedIn ? 'Cadastro' : 'Login';
  cornerAuthBtn.title = isLoggedIn ? 'Ir para cadastro' : 'Acessar area de login';
  cornerAuthBtn.setAttribute('aria-label', cornerAuthBtn.title);
}

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

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle('error', isError);
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

function buildTeamEvents(record, names) {
  const events = [];

  names.forEach((name) => {
    const goals = getGoalsForName(record, name);
    const assists = getAssistsForName(record, name);

    for (let i = 0; i < goals; i += 1) {
      events.push({ type: 'goal', name });
    }

    for (let i = 0; i < assists; i += 1) {
      events.push({ type: 'assist', name });
    }
  });

  return events;
}

function renderTeamEvents(events) {
  if (!events.length) {
    return '<li class="partidas-event-empty">Sem gols ou assistências.</li>';
  }

  return events
    .map((event) => {
      const icon = event.type === 'goal' ? '⚽' : '👟';
      return `
      <li class="partidas-event-row partidas-event-${event.type}">
        <span class="partidas-event-icon" aria-hidden="true">${icon}</span>
        <span class="partidas-event-player">${escapeHtml(event.name)}</span>
      </li>
    `;
    })
    .join('');
}

function attachDateToggleHandlers() {
  confirmadosListEl.querySelectorAll('[data-date-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const targetId = button.getAttribute('aria-controls');
      const detailsEl = targetId ? document.getElementById(targetId) : null;
      if (!detailsEl) {
        return;
      }

      const isExpanded = button.getAttribute('aria-expanded') === 'true';
      const date = button.getAttribute('data-date') || '';
      button.setAttribute('aria-expanded', String(!isExpanded));
      detailsEl.hidden = isExpanded;

      if (date) {
        if (isExpanded) {
          expandedRecordDates.delete(date);
        } else {
          expandedRecordDates.add(date);
        }
      }

      const chevron = button.querySelector('.partidas-date-chevron');
      if (chevron) {
        chevron.textContent = isExpanded ? 'Expandir' : 'Recolher';
      }
    });
  });
}

function renderRecords(records) {
  if (!records.length) {
    confirmadosListEl.innerHTML = '<p>Nenhuma partida encontrada.</p>';
    return;
  }

  const availableDates = new Set(records.map((record) => String(record.date || '')));
  Array.from(expandedRecordDates).forEach((date) => {
    if (!availableDates.has(date)) {
      expandedRecordDates.delete(date);
    }
  });

  confirmadosListEl.innerHTML = records
    .map((record) => {
      const teamA = Array.isArray(record.teamA) ? record.teamA : [];
      const teamB = Array.isArray(record.teamB) ? record.teamB : [];
      const scoreA = Number(record.scoreA || 0);
      const scoreB = Number(record.scoreB || 0);
      const eventsA = buildTeamEvents(record, teamA);
      const eventsB = buildTeamEvents(record, teamB);
      const confirmadosCount = Number(record.count || 0) || (teamA.length + teamB.length);
      const dateValue = String(record.date || '');
      const detailsId = `partidas-details-${dateValue.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
      const isExpanded = expandedRecordDates.has(dateValue);

      return `
      <article class="confirmados-item partidas-collapsible-item">
        <button class="partidas-date-toggle" type="button" data-date-toggle data-date="${dateValue}" aria-expanded="${isExpanded ? 'true' : 'false'}" aria-controls="${detailsId}">
          <span class="partidas-date-title">${formatDate(record.date)}</span>
          <span class="partidas-date-meta">${confirmadosCount} confirmados</span>
          <span class="partidas-date-chevron">${isExpanded ? 'Recolher' : 'Expandir'}</span>
        </button>

        <div id="${detailsId}" class="partidas-details" ${isExpanded ? '' : 'hidden'}>
          <div class="partidas-scoreboard">
            <div class="partidas-score-col">
              <p class="partidas-score-team-label">Time A</p>
              <p class="partidas-score-value">${scoreA}</p>
              <ul class="partidas-events-list">
                ${renderTeamEvents(eventsA)}
              </ul>
            </div>

            <span class="partidas-score-sep" aria-hidden="true">x</span>

            <div class="partidas-score-col">
              <p class="partidas-score-team-label">Time B</p>
              <p class="partidas-score-value">${scoreB}</p>
              <ul class="partidas-events-list partidas-events-list-right">
                ${renderTeamEvents(eventsB)}
              </ul>
            </div>
          </div>
        </div>
      </article>
    `;
    })
    .join('');

  attachDateToggleHandlers();
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Erro na requisicao.');
  }

  return data;
}

async function loadRecords() {
  if (isLoadingRecords) {
    return;
  }

  isLoadingRecords = true;
  try {
    const data = await request(buildApiUrl());
    renderRecords(data.records || []);
  } finally {
    isLoadingRecords = false;
  }
}

function handleAutoRefreshError(error) {
  // Keep silent for background refreshes; surface only if it is the first load.
  if (!confirmadosListEl.innerHTML.trim()) {
    setStatus(error.message, true);
  }
}

function isSameGroupUpdate(payload) {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  const payloadGroup = String(payload.group || '');
  return payloadGroup === GROUP_VALUE;
}

function startAutoRefresh() {
  window.setInterval(() => {
    loadRecords().catch(handleAutoRefreshError);
  }, AUTO_REFRESH_MS);
}

loadRecords().then(() => {
  setStatus('Partidas carregadas.');
}).catch((error) => {
  setStatus(error.message, true);
});

window.addEventListener('storage', (event) => {
  if (event.key === PARTIDAS_UPDATE_KEY && event.newValue) {
    try {
      const payload = JSON.parse(event.newValue);
      if (isSameGroupUpdate(payload)) {
        loadRecords().catch(handleAutoRefreshError);
      }
    } catch {
      // Ignore malformed payloads.
    }
  }

  updateCornerAuthButton();
});

startAutoRefresh();
updateCornerAuthButton();
