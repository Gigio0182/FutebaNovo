const confirmadosListEl = document.getElementById('confirmados-list');
const statusEl = document.getElementById('status');
const GROUP_VALUE = document.body.dataset.group || '';

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

function getContributors(record, names) {
  return names
    .map((name) => {
      const goals = getGoalsForName(record, name);
      const assists = getAssistsForName(record, name);
      return { name, goals, assists, totalActions: goals + assists };
    })
    .filter((player) => player.totalActions > 0)
    .sort((a, b) => {
      if (b.totalActions !== a.totalActions) {
        return b.totalActions - a.totalActions;
      }
      if (b.goals !== a.goals) {
        return b.goals - a.goals;
      }
      return a.name.localeCompare(b.name, 'pt-BR');
    });
}

function renderContributors(contributors) {
  if (!contributors.length) {
    return '<li><span>Nenhum gol ou assistência registrado.</span></li>';
  }

  return contributors
    .map((player) => `
      <li>
        <span class="partidas-player-name">${escapeHtml(player.name)}</span>
        <span class="partidas-player-stats">
          <span class="partidas-player-stat" title="Gols">
            <span class="partidas-stat-icon" aria-hidden="true">⚽</span>
            <strong>${player.goals}</strong>
          </span>
          <span class="partidas-player-stat" title="Assistências">
            <span class="partidas-stat-icon" aria-hidden="true">🅰</span>
            <strong>${player.assists}</strong>
          </span>
        </span>
      </li>
    `)
    .join('');
}

function renderRecords(records) {
  if (!records.length) {
    confirmadosListEl.innerHTML = '<p>Nenhuma partida encontrada.</p>';
    return;
  }

  confirmadosListEl.innerHTML = records
    .map((record) => {
      const teamA = Array.isArray(record.teamA) ? record.teamA : [];
      const teamB = Array.isArray(record.teamB) ? record.teamB : [];
      const scoreA = Number(record.scoreA || 0);
      const scoreB = Number(record.scoreB || 0);
      const contributorsA = getContributors(record, teamA);
      const contributorsB = getContributors(record, teamB);
      const confirmadosCount = Number(record.count || 0) || (teamA.length + teamB.length);

      return `
      <article class="confirmados-item">
        <div class="confirmados-item-head">
          <h3>${formatDate(record.date)}</h3>
          <span class="confirmados-count">${confirmadosCount} confirmados</span>
        </div>

        <div class="partidas-scoreboard">
          <span class="partidas-score-team-label">Time A</span>
          <span class="partidas-score-value">${scoreA}</span>
          <span class="partidas-score-sep">x</span>
          <span class="partidas-score-value">${scoreB}</span>
          <span class="partidas-score-team-label">Time B</span>
        </div>

        <div class="confirmados-teams">
          <div class="confirmados-team-card">
            <h4>Time A (${teamA.length})</h4>
            <p class="partidas-subtitle">Somente atletas com gol ou assistência</p>
            <ul class="confirmados-team-list">
              ${renderContributors(contributorsA)}
            </ul>
          </div>
          <div class="confirmados-team-card">
            <h4>Time B (${teamB.length})</h4>
            <p class="partidas-subtitle">Somente atletas com gol ou assistência</p>
            <ul class="confirmados-team-list">
              ${renderContributors(contributorsB)}
            </ul>
          </div>
        </div>
      </article>
    `;
    })
    .join('');
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
  const data = await request(buildApiUrl());
  renderRecords(data.records || []);
}

loadRecords().then(() => {
  setStatus('Partidas carregadas.');
}).catch((error) => {
  setStatus(error.message, true);
});
