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
const MANUAL_TEAMS_STORAGE_KEY = GROUP_VALUE
  ? `app_futeba_manual_teams_${GROUP_VALUE}`
  : 'app_futeba_manual_teams';
let recordsCache = [];
const teamSeedByDate = new Map();
const manualTeamsByDate = new Map();

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
          const match = String(line || '').match(/^\s*\d+\s*[-–—]\s*(.+)$/u);
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

function normalizeNameKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function saveManualTeams() {
  const payload = {};
  manualTeamsByDate.forEach((teams, date) => {
    payload[date] = {
      teamA: Array.isArray(teams.teamA) ? teams.teamA : [],
      teamB: Array.isArray(teams.teamB) ? teams.teamB : []
    };
  });
  localStorage.setItem(MANUAL_TEAMS_STORAGE_KEY, JSON.stringify(payload));
}

function loadManualTeams() {
  try {
    const raw = localStorage.getItem(MANUAL_TEAMS_STORAGE_KEY);
    if (!raw) {
      return;
    }
    const parsed = JSON.parse(raw);
    Object.entries(parsed).forEach(([date, teams]) => {
      manualTeamsByDate.set(date, {
        teamA: Array.isArray(teams.teamA) ? teams.teamA : [],
        teamB: Array.isArray(teams.teamB) ? teams.teamB : []
      });
    });
  } catch (error) {
    manualTeamsByDate.clear();
  }
}

function stringToSeed(value) {
  let seed = 0;
  for (let i = 0; i < value.length; i += 1) {
    seed = (seed * 31 + value.charCodeAt(i)) >>> 0;
  }
  return seed || 1;
}

function createSeededRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function getDateSeed(date) {
  if (!teamSeedByDate.has(date)) {
    teamSeedByDate.set(date, stringToSeed(date));
  }
  return teamSeedByDate.get(date);
}

function splitTeamsByDateSeed(date, names) {
  const rng = createSeededRng(getDateSeed(date));
  const shuffled = [...(names || [])];

  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const teamA = [];
  const teamB = [];
  shuffled.forEach((name, index) => {
    if (index % 2 === 0) {
      teamA.push(name);
      return;
    }
    teamB.push(name);
  });

  return { teamA, teamB };
}

function sanitizeManualTeams(record, manualTeams) {
  const names = Array.isArray(record.names) ? record.names : [];
  const nameByKey = new Map();
  names.forEach((name) => {
    const key = normalizeNameKey(name);
    if (key && !nameByKey.has(key)) {
      nameByKey.set(key, name);
    }
  });

  const usedKeys = new Set();
  const normalizedTeamA = [];
  const normalizedTeamB = [];

  (manualTeams.teamA || []).forEach((name) => {
    const key = normalizeNameKey(name);
    if (!key || usedKeys.has(key) || !nameByKey.has(key)) {
      return;
    }
    usedKeys.add(key);
    normalizedTeamA.push(nameByKey.get(key));
  });

  (manualTeams.teamB || []).forEach((name) => {
    const key = normalizeNameKey(name);
    if (!key || usedKeys.has(key) || !nameByKey.has(key)) {
      return;
    }
    usedKeys.add(key);
    normalizedTeamB.push(nameByKey.get(key));
  });

  names.forEach((name) => {
    const key = normalizeNameKey(name);
    if (!key || usedKeys.has(key)) {
      return;
    }
    if (normalizedTeamA.length <= normalizedTeamB.length) {
      normalizedTeamA.push(name);
    } else {
      normalizedTeamB.push(name);
    }
  });

  return { teamA: normalizedTeamA, teamB: normalizedTeamB };
}

function getTeamsForRecord(record) {
  const manualTeams = manualTeamsByDate.get(record.date);
  if (manualTeams) {
    const sanitized = sanitizeManualTeams(record, manualTeams);
    manualTeamsByDate.set(record.date, sanitized);
    return {
      ...sanitized,
      isManual: true
    };
  }

  const autoTeams = splitTeamsByDateSeed(record.date, record.names || []);
  return {
    ...autoTeams,
    isManual: false
  };
}

function ensureManualTeams(record) {
  if (manualTeamsByDate.has(record.date)) {
    const sanitized = sanitizeManualTeams(record, manualTeamsByDate.get(record.date));
    manualTeamsByDate.set(record.date, sanitized);
    return sanitized;
  }

  const autoTeams = splitTeamsByDateSeed(record.date, record.names || []);
  manualTeamsByDate.set(record.date, autoTeams);
  saveManualTeams();
  return autoTeams;
}

function removePlayerFromTeams(teams, playerKey) {
  teams.teamA = (teams.teamA || []).filter((name) => normalizeNameKey(name) !== playerKey);
  teams.teamB = (teams.teamB || []).filter((name) => normalizeNameKey(name) !== playerKey);
}

function renderRecords(records) {
  if (!records.length) {
    confirmadosListEl.innerHTML = '<p>Nenhuma lista salva ainda.</p>';
    return;
  }

  const dates = new Set(records.map((record) => record.date));
  Array.from(teamSeedByDate.keys()).forEach((date) => {
    if (!dates.has(date)) {
      teamSeedByDate.delete(date);
    }
  });

  let manualChanged = false;
  Array.from(manualTeamsByDate.keys()).forEach((date) => {
    if (!dates.has(date)) {
      manualTeamsByDate.delete(date);
      manualChanged = true;
    }
  });

  confirmadosListEl.innerHTML = records
    .map((record) => {
      const teams = getTeamsForRecord(record);
      return `
      <article class="confirmados-item">
        <div class="confirmados-item-head">
          <h3>${formatDate(record.date)}</h3>
          <div class="confirmados-head-right">
            <span class="confirmados-count">${record.count} confirmados</span>
            <div class="confirmados-actions">
              <button class="confirmados-action-btn" type="button" data-action="reshuffle-teams" data-date="${record.date}">Sortear times</button>
              <button class="confirmados-action-btn" type="button" data-action="manual-mode" data-date="${record.date}">${teams.isManual ? 'Manual ativo' : 'Distribuição manual'}</button>
              ${teams.isManual ? `<button class="confirmados-action-btn" type="button" data-action="reset-auto" data-date="${record.date}">Voltar automático</button>` : ''}
              <button class="confirmados-action-btn" type="button" data-action="edit-record" data-date="${record.date}">Editar</button>
              <button class="confirmados-action-btn danger" type="button" data-action="delete-record" data-date="${record.date}">Remover</button>
            </div>
          </div>
        </div>
        <ul class="confirmados-names">
          ${(record.names || []).map((name) => `<li>${escapeHtml(name)}</li>`).join('')}
        </ul>
        <div class="confirmados-teams">
          <div class="confirmados-team-card">
            <h4>Time A (${teams.teamA.length})</h4>
            <ul class="confirmados-team-list">
              ${teams.teamA.map((name) => `
                <li>
                  <span>${escapeHtml(name)}</span>
                  <button class="confirmados-move-btn" type="button" data-action="move-player" data-date="${record.date}" data-target="B" data-player="${escapeAttr(name)}">B</button>
                </li>
              `).join('') || '<li>Aguardando atletas</li>'}
            </ul>
          </div>
          <div class="confirmados-team-card">
            <h4>Time B (${teams.teamB.length})</h4>
            <ul class="confirmados-team-list">
              ${teams.teamB.map((name) => `
                <li>
                  <span>${escapeHtml(name)}</span>
                  <button class="confirmados-move-btn" type="button" data-action="move-player" data-date="${record.date}" data-target="A" data-player="${escapeAttr(name)}">A</button>
                </li>
              `).join('') || '<li>Aguardando atletas</li>'}
            </ul>
          </div>
        </div>
      </article>
    `;
    })
    .join('');

  if (manualChanged) {
    saveManualTeams();
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
  const manualBtn = event.target.closest('button[data-action="manual-mode"][data-date]');
  if (manualBtn) {
    const date = manualBtn.dataset.date;
    const record = recordsCache.find((item) => item.date === date);
    if (!record) {
      return;
    }

    ensureManualTeams(record);
    saveManualTeams();
    renderRecords(recordsCache);
    setStatus(`Distribuição manual ativada para ${formatDate(date)}.`);
    return;
  }

  const resetAutoBtn = event.target.closest('button[data-action="reset-auto"][data-date]');
  if (resetAutoBtn) {
    const date = resetAutoBtn.dataset.date;
    manualTeamsByDate.delete(date);
    saveManualTeams();
    renderRecords(recordsCache);
    setStatus(`Distribuição automática retomada para ${formatDate(date)}.`);
    return;
  }

  const reshuffleBtn = event.target.closest('button[data-action="reshuffle-teams"][data-date]');
  if (reshuffleBtn) {
    const date = reshuffleBtn.dataset.date;
    const nextSeed = (getDateSeed(date) + 1) >>> 0;
    teamSeedByDate.set(date, nextSeed || 1);
    manualTeamsByDate.delete(date);
    saveManualTeams();
    renderRecords(recordsCache);
    setStatus(`Times de ${formatDate(date)} sorteados novamente.`);
    return;
  }

  const movePlayerBtn = event.target.closest('button[data-action="move-player"][data-date][data-target][data-player]');
  if (movePlayerBtn) {
    const date = movePlayerBtn.dataset.date;
    const target = movePlayerBtn.dataset.target;
    const playerName = String(movePlayerBtn.dataset.player || '').trim();
    const playerKey = normalizeNameKey(playerName);
    if (!playerKey || (target !== 'A' && target !== 'B')) {
      return;
    }

    const record = recordsCache.find((item) => item.date === date);
    if (!record) {
      return;
    }

    const teams = ensureManualTeams(record);
    removePlayerFromTeams(teams, playerKey);

    const player = (record.names || []).find((name) => normalizeNameKey(name) === playerKey) || playerName;
    if (target === 'A') {
      teams.teamA.push(player);
    } else {
      teams.teamB.push(player);
    }

    manualTeamsByDate.set(date, sanitizeManualTeams(record, teams));
    saveManualTeams();
    renderRecords(recordsCache);
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
loadManualTeams();
loadRecords().then(() => {
  setStatus('Listas carregadas.');
}).catch((error) => {
  setStatus(error.message, true);
});
