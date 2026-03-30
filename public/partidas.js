const confirmadosListEl = document.getElementById('confirmados-list');
const statusEl = document.getElementById('status');
const cornerAuthBtn = document.getElementById('corner-auth-btn');
const GROUP_VALUE = document.body.dataset.group || '';
const TOKEN_KEY = GROUP_VALUE === 'domingo' ? 'app_futeba_domingo_token' : 'app_futeba_token';
const PARTIDAS_UPDATE_KEY = 'app_futeba_partidas_update';
const AUTO_REFRESH_MS = 3000;

let isLoadingRecords = false;
let recordsCache = [];

function getIsLoggedIn() {
  return Boolean(localStorage.getItem(TOKEN_KEY));
}

function updateCornerAuthButton() {
  if (!cornerAuthBtn) {
    return;
  }

  const isLoggedIn = getIsLoggedIn();
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

function getMatchPageUrl(date) {
  const params = new URLSearchParams({ date: String(date || '') });
  return `${GROUP_VALUE === 'domingo' ? '/domingo/partida' : '/partida'}?${params.toString()}`;
}

function getActionLabel(status) {
  return status === 'started' ? 'Abrir partida' : 'Iniciar';
}

function getTeamScore(record, teamKey) {
  const directValue = Number(teamKey === 'A' ? record.scoreA : record.scoreB);
  if (!Number.isNaN(directValue)) {
    return directValue;
  }

  const goalsByTeamName = record.goalsByTeamName && typeof record.goalsByTeamName === 'object'
    ? record.goalsByTeamName
    : {};
  const teamGoals = goalsByTeamName[teamKey] && typeof goalsByTeamName[teamKey] === 'object'
    ? goalsByTeamName[teamKey]
    : {};

  return Object.values(teamGoals).reduce((total, value) => total + Number(value || 0), 0);
}

function renderTeamPlayers(names) {
  return (Array.isArray(names) ? names : [])
    .map((name) => `<li><span>${escapeHtml(name)}</span></li>`)
    .join('') || '<li><span>Sem atletas</span></li>';
}

function renderStartedMatchDetails(record) {
  const teamA = Array.isArray(record.teamA) ? record.teamA : [];
  const teamB = Array.isArray(record.teamB) ? record.teamB : [];
  const teamNameA = String(record.teamNameA || 'Time A').trim() || 'Time A';
  const teamNameB = String(record.teamNameB || 'Time B').trim() || 'Time B';
  const scoreA = getTeamScore(record, 'A');
  const scoreB = getTeamScore(record, 'B');

  return `
    <div class="partidas-details">
      <div class="partidas-scoreboard">
        <div class="partidas-score-col">
          <p class="partidas-score-team-label">${escapeHtml(teamNameA)}</p>
          <p class="partidas-score-value">${scoreA}</p>
        </div>
        <div class="partidas-score-sep">X</div>
        <div class="partidas-score-col">
          <p class="partidas-score-team-label">${escapeHtml(teamNameB)}</p>
          <p class="partidas-score-value">${scoreB}</p>
        </div>
      </div>

      <div class="confirmados-teams partidas-current-teams">
        <div class="confirmados-team-card">
          <h4>${escapeHtml(teamNameA)} (${teamA.length})</h4>
          <ul class="confirmados-team-list">
            ${renderTeamPlayers(teamA)}
          </ul>
        </div>
        <div class="confirmados-team-card">
          <h4>${escapeHtml(teamNameB)} (${teamB.length})</h4>
          <ul class="confirmados-team-list">
            ${renderTeamPlayers(teamB)}
          </ul>
        </div>
      </div>
    </div>
  `;
}

async function request(url) {
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json'
    }
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Erro na requisicao.');
  }

  return data;
}

function renderRecords(records) {
  if (!records.length) {
    confirmadosListEl.innerHTML = '<p>Nenhuma partida encontrada.</p>';
    return;
  }

  confirmadosListEl.innerHTML = records
    .map((record) => {
      const matchStatus = String(record.matchStatus || 'not-started');
      const confirmadosCount = Number(record.count || 0) || (Array.isArray(record.names) ? record.names.length : 0);

      return `
      <article class="confirmados-item">
        <div class="partidas-list-row">
          <div class="partidas-list-main">
            <h3 class="partidas-date-title">${formatDate(record.date)}</h3>
            <p class="partidas-date-meta">${confirmadosCount} confirmados <span class="partidas-status-badge ${getMatchStatusClassName(matchStatus)}">${getMatchStatusLabel(matchStatus)}</span></p>
          </div>
          <div class="partidas-list-actions">
            <a class="confirmados-action-btn" href="${getMatchPageUrl(record.date)}">${escapeHtml(getActionLabel(matchStatus))}</a>
          </div>
        </div>
        ${matchStatus === 'started' ? renderStartedMatchDetails(record) : ''}
      </article>
    `;
    })
    .join('');
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
  if (!confirmadosListEl.innerHTML.trim()) {
    setStatus(error.message, true);
  }
}

function isSameGroupUpdate(payload) {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  return String(payload.group || '') === GROUP_VALUE;
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
