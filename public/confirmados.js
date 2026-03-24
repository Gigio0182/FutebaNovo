const confirmadosForm = document.getElementById('confirmados-form');
const matchDateInput = document.getElementById('match-date');
const confirmedNamesInput = document.getElementById('confirmed-names');
const confirmadosListEl = document.getElementById('confirmados-list');
const clearFormBtn = document.getElementById('clear-form-btn');
const statusEl = document.getElementById('status');
const TOKEN_KEY = document.body.dataset.group === 'domingo'
  ? 'app_futeba_domingo_token'
  : 'app_futeba_token';
const GROUP_VALUE = document.body.dataset.group || '';
const TEAMS_STORAGE_KEY = GROUP_VALUE
  ? `app_futeba_partidas_teams_${GROUP_VALUE}`
  : 'app_futeba_partidas_teams';

let recordsCache = [];
const teamsByDate = new Map();
let expandedRecordDate = null;

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

function normalizeNames(text) {
  return Array.from(
    new Set(
      String(text || '')
        .split(/\r?\n/)
        .map((line) => {
          const match = String(line || '').match(/^\s*\d+\s*[-.)]\s*(.+)$/);
          if (!match) {
            return '';
          }

          return match[1]
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

function renderRecords(records) {
  if (!records.length) {
    confirmadosListEl.innerHTML = '<p>Nenhuma lista salva ainda.</p>';
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

  if (expandedRecordDate && !validDates.has(expandedRecordDate)) {
    expandedRecordDate = null;
  }

  confirmadosListEl.innerHTML = records
    .map((record) => {
      const teams = getTeamsForRecord(record);
      const isExpanded = expandedRecordDate === record.date;

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
        </div>
        ` : ''}
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

    await request(buildApiUrl(), {
      method: 'POST',
      body: JSON.stringify({ date, names })
    });

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

    assignPlayer(date, player, target);
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

  try {
    await request(buildApiUrl({ date }), {
      method: 'DELETE'
    });

    teamsByDate.delete(date);
    saveTeams();

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

setDefaultDate();
loadTeams();
loadRecords().then(() => {
  setStatus('Listas carregadas.');
}).catch((error) => {
  setStatus(error.message, true);
});
