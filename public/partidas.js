const confirmadosListEl = document.getElementById('confirmados-list');
const statusEl = document.getElementById('status');
const cornerAuthBtn = document.getElementById('corner-auth-btn');
const GROUP_VALUE = document.body.dataset.group || '';
const TOKEN_KEY = GROUP_VALUE === 'domingo' ? 'app_futeba_domingo_token' : 'app_futeba_token';
const PARTIDAS_UPDATE_KEY = 'app_futeba_partidas_update';
const AUTO_REFRESH_MS = 3000;
let isLoadingRecords = false;
let recordsCache = [];
const expandedRecordDates = new Set();

function getIsLoggedIn() {
  return Boolean(localStorage.getItem(TOKEN_KEY));
}

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

function getMatchStatusLabel(status) {
  return status === 'started' ? 'Iniciada' : 'Nao iniciada';
}

function getMatchStatusClassName(status) {
  return status === 'started' ? 'is-started' : 'is-not-started';
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

function buildTeamEvents(record, names, teamKey) {
  const events = [];

  names.forEach((name) => {
    const goals = getTeamStatForName(record, name, teamKey, 'goalsByTeamName');
    const assists = getTeamStatForName(record, name, teamKey, 'assistsByTeamName');

    for (let i = 0; i < goals; i += 1) {
      events.push({ type: 'goal', name });
    }

    for (let i = 0; i < assists; i += 1) {
      events.push({ type: 'assist', name });
    }
  });

  return events;
}

function buildTeamShareLines(record, teamNames, teamKey) {
  const lines = [];

  teamNames.forEach((name) => {
    const goals = getTeamStatForName(record, name, teamKey, 'goalsByTeamName');
    const assists = getTeamStatForName(record, name, teamKey, 'assistsByTeamName');

    if (goals > 0) {
      lines.push(`⚽ ${name}${goals > 1 ? ` x${goals}` : ''}`);
    }

    if (assists > 0) {
      lines.push(`👟 ${name}${assists > 1 ? ` x${assists}` : ''}`);
    }
  });

  return lines.length ? lines : ['Sem gols ou assistências'];
}

function buildShareText(record) {
  const teamA = Array.isArray(record.teamA) ? record.teamA : [];
  const teamB = Array.isArray(record.teamB) ? record.teamB : [];
  const scoreA = Number(record.scoreA || 0);
  const scoreB = Number(record.scoreB || 0);

  const teamALines = buildTeamShareLines(record, teamA, 'A').join('\n');
  const teamBLines = buildTeamShareLines(record, teamB, 'B').join('\n');

  return [
    `Partida Futeba - ${formatDate(record.date)}`,
    `Placar: Time A ${scoreA} x ${scoreB} Time B`,
    '',
    'Time A',
    teamALines,
    '',
    'Time B',
    teamBLines
  ].join('\n');
}

async function shareMatchRecord(record) {
  const text = buildShareText(record);

  if (navigator.share) {
    try {
      await navigator.share({
        title: 'Partida Futeba',
        text
      });
      setStatus('Resumo da partida compartilhado.');
      return;
    } catch (error) {
      if (error && error.name === 'AbortError') {
        return;
      }
    }
  }

  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
  const popup = window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
  if (popup) {
    setStatus('Abrindo compartilhamento no WhatsApp.');
    return;
  }

  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    await navigator.clipboard.writeText(text);
    setStatus('Nao foi possivel abrir o WhatsApp. Texto copiado para compartilhar manualmente.');
    return;
  }

  setStatus('Nao foi possivel abrir o compartilhamento no momento.', true);
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
      const matchStatus = String(record.matchStatus || 'not-started');
      const teamA = Array.isArray(record.teamA) ? record.teamA : [];
      const teamB = Array.isArray(record.teamB) ? record.teamB : [];
      const scoreA = Number(record.scoreA || 0);
      const scoreB = Number(record.scoreB || 0);
      const eventsA = buildTeamEvents(record, teamA, 'A');
      const eventsB = buildTeamEvents(record, teamB, 'B');
      const confirmadosCount = Number(record.count || 0) || (teamA.length + teamB.length);
      const dateValue = String(record.date || '');
      const detailsId = `partidas-details-${dateValue.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
      const isExpanded = expandedRecordDates.has(dateValue);
      const statusLabel = getMatchStatusLabel(matchStatus);
      const isLoggedIn = getIsLoggedIn();

      return `
      <article class="confirmados-item partidas-collapsible-item">
        <button class="partidas-date-toggle" type="button" data-date-toggle data-date="${dateValue}" aria-expanded="${isExpanded ? 'true' : 'false'}" aria-controls="${detailsId}">
          <span class="partidas-date-title">${formatDate(record.date)}</span>
          <span class="partidas-date-meta">${confirmadosCount} confirmados <span class="partidas-status-badge ${getMatchStatusClassName(matchStatus)}">${statusLabel}</span></span>
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

          <div class="partidas-share-row">
            ${isLoggedIn ? `
            <button class="confirmados-action-btn partidas-status-btn ${matchStatus === 'started' ? 'secondary' : ''}" type="button" data-action="toggle-match-status" data-date="${dateValue}" data-status="${matchStatus}">
              ${matchStatus === 'started' ? 'Marcar como nao iniciada' : 'Iniciar partida'}
            </button>
            ` : '<span class="partidas-status-helper">Faca login no cadastro para alterar o status.</span>'}
            <button class="confirmados-action-btn partidas-share-btn" type="button" data-action="share-match" data-date="${dateValue}">
              Compartilhar
            </button>
          </div>
        </div>
      </article>
    `;
    })
    .join('');

  attachDateToggleHandlers();
}

confirmadosListEl.addEventListener('click', async (event) => {
  const statusBtn = event.target.closest('button[data-action="toggle-match-status"][data-date]');
  if (statusBtn) {
    const date = String(statusBtn.dataset.date || '').trim();
    if (!date) {
      return;
    }

    if (!getIsLoggedIn()) {
      setStatus('Faca login no cadastro para alterar o status da partida.', true);
      return;
    }

    try {
      await request(buildApiUrl(), {
        method: 'PUT',
        body: JSON.stringify({
          action: 'toggle-match-status',
          date
        })
      });
      expandedRecordDates.add(date);
      await loadRecords();
      localStorage.setItem(
        PARTIDAS_UPDATE_KEY,
        JSON.stringify({ ts: Date.now(), group: GROUP_VALUE || '', date, action: 'toggle-match-status' })
      );
      const updatedRecord = recordsCache.find((item) => String(item.date || '') === date);
      const updatedLabel = getMatchStatusLabel(updatedRecord && updatedRecord.matchStatus);
      setStatus(`Status da partida atualizado para ${updatedLabel}.`);
    } catch (error) {
      setStatus(error.message || 'Erro ao atualizar status da partida.', true);
    }
    return;
  }

  const shareBtn = event.target.closest('button[data-action="share-match"][data-date]');
  if (!shareBtn) {
    return;
  }

  const date = String(shareBtn.dataset.date || '').trim();
  if (!date) {
    return;
  }

  const record = recordsCache.find((item) => String(item.date || '') === date);
  if (!record) {
    setStatus('Partida nao encontrada para compartilhar.', true);
    return;
  }

  try {
    await shareMatchRecord(record);
  } catch (error) {
    setStatus(error.message || 'Erro ao compartilhar partida.', true);
  }
});

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
    recordsCache = data.records || [];
    renderRecords(recordsCache);
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
