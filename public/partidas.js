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
                <button class="confirmados-move-btn" type="button" data-action="assign-player" data-date="${record.date}" data-player="${escapeAttr(name)}" data-target="A" ${assignedTeam === 'A' ? 'disabled' : ''}>A</button>
                <button class="confirmados-move-btn" type="button" data-action="assign-player" data-date="${record.date}" data-player="${escapeAttr(name)}" data-target="B" ${assignedTeam === 'B' ? 'disabled' : ''}>B</button>
              </div>
            </li>
          `;
        }).join('')}
      </ul>

      <div class="confirmados-teams">
        <div class="confirmados-team-card">
          <h4>Time A (${teams.teamA.length})</h4>
          <ul class="confirmados-team-list">
            ${teams.teamA.map((name) => `<li><span>${escapeHtml(name)}</span></li>`).join('') || '<li><span>Sem atletas</span></li>'}
          </ul>
        </div>
        <div class="confirmados-team-card">
          <h4>Time B (${teams.teamB.length})</h4>
          <ul class="confirmados-team-list">
            ${teams.teamB.map((name) => `<li><span>${escapeHtml(name)}</span></li>`).join('') || '<li><span>Sem atletas</span></li>'}
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

function assignPlayer(date, playerName, targetTeam) {
  const record = recordsCache.find((item) => item.date === date);
  if (!record) {
    return;
  }

  const teams = getTeamsForRecord(record);
  const playerKey = normalizeNameKey(playerName);
  const canonicalName = (record.names || []).find((name) => normalizeNameKey(name) === playerKey) || playerName;

  teams.teamA = (teams.teamA || []).filter((name) => normalizeNameKey(name) !== playerKey);
  teams.teamB = (teams.teamB || []).filter((name) => normalizeNameKey(name) !== playerKey);

  if (targetTeam === 'A') {
    teams.teamA.push(canonicalName);
  }

  if (targetTeam === 'B') {
    teams.teamB.push(canonicalName);
  }

  teamsByDate.set(date, sanitizeTeamsForRecord(record, teams));
  saveTeams();
  renderRecords(recordsCache);
}

confirmadosListEl.addEventListener('click', (event) => {
  const toggleBtn = event.target.closest('button[data-action="toggle-date"][data-date]');
  if (toggleBtn) {
    const date = toggleBtn.dataset.date;
    expandedDate = expandedDate === date ? null : date;
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

    assignPlayer(date, player, target);
    return;
  }
});

loadTeams();
loadRecords().then(() => {
  setStatus('Partidas carregadas com base nos confirmados por data.');
}).catch((error) => {
  setStatus(error.message, true);
});
