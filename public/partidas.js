const confirmadosListEl = document.getElementById('confirmados-list');
const statusEl = document.getElementById('status');
const TOKEN_KEY = document.body.dataset.group === 'domingo'
  ? 'app_futeba_domingo_token'
  : 'app_futeba_token';
const GROUP_VALUE = document.body.dataset.group || '';
const TEAMS_STORAGE_KEY = GROUP_VALUE
  ? `app_futeba_partidas_teams_${GROUP_VALUE}`
  : 'app_futeba_partidas_teams';

let recordsCache = [];
let expandedDate = null;
const teamsByDate = new Map();
let athleteIdByKey = new Map();

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

function buildAthletesApiUrl() {
  if (!GROUP_VALUE) {
    return '/api/athletes';
  }
  return `/api/athletes?group=${encodeURIComponent(GROUP_VALUE)}`;
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

function saveTeams() {
  const payload = {};
  teamsByDate.forEach((teams, date) => {
    payload[date] = {
      teamA: Array.isArray(teams.teamA) ? teams.teamA : [],
      teamB: Array.isArray(teams.teamB) ? teams.teamB : []
    };
  });

  localStorage.setItem(TEAMS_STORAGE_KEY, JSON.stringify(payload));
}

function loadTeams() {
  try {
    const raw = localStorage.getItem(TEAMS_STORAGE_KEY);
    if (!raw) {
      return;
    }

    const parsed = JSON.parse(raw);
    Object.entries(parsed).forEach(([date, teams]) => {
      teamsByDate.set(date, {
        teamA: Array.isArray(teams.teamA) ? teams.teamA : [],
        teamB: Array.isArray(teams.teamB) ? teams.teamB : []
      });
    });
  } catch (error) {
    teamsByDate.clear();
  }
}

function sanitizeTeamsForRecord(record, teams) {
  const names = Array.isArray(record.names) ? record.names : [];
  const nameByKey = new Map();
  names.forEach((name) => {
    const key = normalizeNameKey(name);
    if (key && !nameByKey.has(key)) {
      nameByKey.set(key, name);
    }
  });

  const usedKeys = new Set();
  const teamA = [];
  const teamB = [];

  (teams.teamA || []).forEach((name) => {
    const key = normalizeNameKey(name);
    if (!key || usedKeys.has(key) || !nameByKey.has(key)) {
      return;
    }
    usedKeys.add(key);
    teamA.push(nameByKey.get(key));
  });

  (teams.teamB || []).forEach((name) => {
    const key = normalizeNameKey(name);
    if (!key || usedKeys.has(key) || !nameByKey.has(key)) {
      return;
    }
    usedKeys.add(key);
    teamB.push(nameByKey.get(key));
  });

  return { teamA, teamB };
}

function getTeamsForRecord(record) {
  const existing = teamsByDate.get(record.date) || { teamA: [], teamB: [] };
  const sanitized = sanitizeTeamsForRecord(record, existing);
  teamsByDate.set(record.date, sanitized);
  return sanitized;
}

function getAssignedTeam(name, teams) {
  const key = normalizeNameKey(name);
  if ((teams.teamA || []).some((item) => normalizeNameKey(item) === key)) {
    return 'A';
  }
  if ((teams.teamB || []).some((item) => normalizeNameKey(item) === key)) {
    return 'B';
  }
  return '';
}

function renderExpandedDetails(record) {
  const teams = getTeamsForRecord(record);

  return `
    <div class="partidas-details">
      <h4 class="partidas-subtitle">Atletas confirmados</h4>
      <ul class="partidas-player-list">
        ${(record.names || []).map((name) => {
          const assignedTeam = getAssignedTeam(name, teams);
          const teamLabel = assignedTeam ? `Time ${assignedTeam}` : 'Sem time';

          return `
            <li>
              <span>${escapeHtml(name)}</span>
              <div class="partidas-player-actions">
                <span class="partidas-team-badge">${teamLabel}</span>
              </div>
            </li>
          `;
        }).join('')}
      </ul>

      <div class="confirmados-teams">
        <div class="confirmados-team-card">
          <h4>Time A (${teams.teamA.length})</h4>
          <ul class="confirmados-team-list">
            ${teams.teamA.map((name) => `
              <li>
                <button class="partidas-stat-btn" type="button" data-action="add-assist" data-player="${escapeAttr(name)}" title="Adicionar assistencia">&#128095;</button>
                <span>${escapeHtml(name)}</span>
                <button class="partidas-stat-btn" type="button" data-action="add-goal" data-player="${escapeAttr(name)}" title="Adicionar gol">&#9917;</button>
              </li>
            `).join('') || '<li><span>Sem atletas</span></li>'}
          </ul>
        </div>
        <div class="confirmados-team-card">
          <h4>Time B (${teams.teamB.length})</h4>
          <ul class="confirmados-team-list">
            ${teams.teamB.map((name) => `
              <li>
                <button class="partidas-stat-btn" type="button" data-action="add-assist" data-player="${escapeAttr(name)}" title="Adicionar assistencia">&#128095;</button>
                <span>${escapeHtml(name)}</span>
                <button class="partidas-stat-btn" type="button" data-action="add-goal" data-player="${escapeAttr(name)}" title="Adicionar gol">&#9917;</button>
              </li>
            `).join('') || '<li><span>Sem atletas</span></li>'}
          </ul>
        </div>
      </div>
    </div>
  `;
}

function renderRecords(records) {
  if (!records.length) {
    confirmadosListEl.innerHTML = '<p>Nenhuma partida encontrada em Confirmados.</p>';
    return;
  }

  const validDates = new Set(records.map((record) => record.date));
  let changed = false;

  Array.from(teamsByDate.keys()).forEach((date) => {
    if (!validDates.has(date)) {
      teamsByDate.delete(date);
      changed = true;
    }
  });

  if (expandedDate && !validDates.has(expandedDate)) {
    expandedDate = null;
  }

  confirmadosListEl.innerHTML = records
    .map((record) => {
      const isExpanded = expandedDate === record.date;
      return `
        <article class="confirmados-item">
          <button class="partidas-date-toggle" type="button" data-action="toggle-date" data-date="${record.date}">
            <span>${formatDate(record.date)}</span>
            <span class="partidas-date-meta">${record.count} confirmados</span>
            <span class="partidas-date-chevron">${isExpanded ? 'Ocultar' : 'Ver'}</span>
          </button>
          ${isExpanded ? renderExpandedDetails(record) : ''}
        </article>
      `;
    })
    .join('');

  if (changed) {
    saveTeams();
  }
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

async function loadAthleteIdMap() {
  const data = await request(buildAthletesApiUrl());
  const map = new Map();

  (data.athletes || []).forEach((athlete) => {
    const key = normalizeNameKey(athlete.name);
    if (key && !map.has(key) && athlete.id) {
      map.set(key, athlete.id);
    }
  });

  athleteIdByKey = map;
}

async function addMetricToAthlete(playerName, field, successMessage) {
  const key = normalizeNameKey(playerName);
  if (!key) {
    return;
  }

  let athleteId = athleteIdByKey.get(key);
  if (!athleteId) {
    await loadAthleteIdMap();
    athleteId = athleteIdByKey.get(key);
  }

  if (!athleteId) {
    setStatus(`Atleta ${playerName} nao encontrado no cadastro.`, true);
    return;
  }

  await request(buildAthletesApiUrl(), {
    method: 'PUT',
    body: JSON.stringify({ id: athleteId, field, delta: 1 })
  });

  setStatus(successMessage);
}

confirmadosListEl.addEventListener('click', (event) => {
  const toggleBtn = event.target.closest('button[data-action="toggle-date"][data-date]');
  if (toggleBtn) {
    const date = toggleBtn.dataset.date;
    expandedDate = expandedDate === date ? null : date;
    renderRecords(recordsCache);
    return;
  }

  const goalBtn = event.target.closest('button[data-action="add-goal"][data-player]');
  if (goalBtn) {
    const player = String(goalBtn.dataset.player || '').trim();
    addMetricToAthlete(player, 'goals', `Gol adicionado para ${player}.`)
      .catch((error) => setStatus(error.message, true));
    return;
  }

  const assistBtn = event.target.closest('button[data-action="add-assist"][data-player]');
  if (assistBtn) {
    const player = String(assistBtn.dataset.player || '').trim();
    addMetricToAthlete(player, 'assists', `Assistencia adicionada para ${player}.`)
      .catch((error) => setStatus(error.message, true));
    return;
  }
});

loadTeams();
Promise.all([loadAthleteIdMap(), loadRecords()]).then(() => {
  setStatus('Partidas carregadas com base nos confirmados por data.');
}).catch((error) => {
  setStatus(error.message, true);
});
