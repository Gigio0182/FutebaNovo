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
const matchSetupDrafts = new Map();
const setupPickerOpenKeys = new Set();

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

function escapeAttr(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
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

function getTeamDisplayName(value, fallback) {
  return String(value || '').trim() || fallback;
}

function notifyPartidasUpdate(date, action) {
  localStorage.setItem(
    PARTIDAS_UPDATE_KEY,
    JSON.stringify({ ts: Date.now(), group: GROUP_VALUE || '', date, action })
  );
}

function createSetupDraft(record) {
  return {
    teamNameA: getTeamDisplayName(record.teamNameA, 'Time A'),
    teamNameB: getTeamDisplayName(record.teamNameB, 'Time B'),
    teamA: Array.isArray(record.teamA) ? [...record.teamA] : [],
    teamB: Array.isArray(record.teamB) ? [...record.teamB] : []
  };
}

function getSetupDraft(record) {
  const date = String(record.date || '');
  const existing = matchSetupDrafts.get(date);
  if (existing) {
    return existing;
  }

  const draft = createSetupDraft(record);
  matchSetupDrafts.set(date, draft);
  return draft;
}

function syncVisibleSetupDraft(date) {
  const draft = matchSetupDrafts.get(date);
  if (!draft) {
    return;
  }

  const teamNameAInput = confirmadosListEl.querySelector(`input[data-role="team-name-a"][data-date="${CSS.escape(date)}"]`);
  const teamNameBInput = confirmadosListEl.querySelector(`input[data-role="team-name-b"][data-date="${CSS.escape(date)}"]`);

  if (teamNameAInput) {
    draft.teamNameA = String(teamNameAInput.value || '').trim() || 'Time A';
  }

  if (teamNameBInput) {
    draft.teamNameB = String(teamNameBInput.value || '').trim() || 'Time B';
  }
}

function buildSetupSummary(names) {
  if (!names.length) {
    return 'Nenhum atleta selecionado';
  }

  if (names.length === 1) {
    return names[0];
  }

  return `${names.length} atletas selecionados`;
}

function getSetupPickerKey(date, teamKey) {
  return `${String(date || '').trim()}:${teamKey}`;
}

function isSetupPickerOpen(date, teamKey) {
  return setupPickerOpenKeys.has(getSetupPickerKey(date, teamKey));
}

function setSetupPickerOpen(date, teamKey, isOpen) {
  const key = getSetupPickerKey(date, teamKey);
  if (isOpen) {
    setupPickerOpenKeys.add(key);
    return;
  }

  setupPickerOpenKeys.delete(key);
}

function hasActiveSetupInteraction() {
  const activeElement = document.activeElement;
  return Boolean(activeElement && activeElement.closest('.partidas-setup-panel'));
}

function renderTeamChecklist(dateValue, teamKey, names, selectedNames, disabled = false) {
  const role = teamKey === 'A' ? 'team-a-player' : 'team-b-player';
  const title = teamKey === 'A' ? 'Atletas do Time A' : 'Atletas do Time B';
  const summary = buildSetupSummary(selectedNames);
  const isOpen = isSetupPickerOpen(dateValue, teamKey);

  return `
    <details class="partidas-setup-picker" data-role="setup-picker" data-date="${dateValue}" data-team="${teamKey}" ${isOpen ? 'open' : ''}>
      <summary>${title} <span class="partidas-setup-summary">${escapeHtml(summary)}</span></summary>
      <div class="partidas-setup-options">
        ${names.map((name) => {
          const checked = selectedNames.some((item) => normalizeNameKey(item) === normalizeNameKey(name));
          return `
            <label class="partidas-setup-option">
              <input type="checkbox" data-role="${role}" data-date="${dateValue}" value="${escapeAttr(name)}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''} />
              <span>${escapeHtml(name)}</span>
            </label>
          `;
        }).join('') || '<p class="partidas-setup-empty">Nenhum atleta disponivel.</p>'}
      </div>
    </details>
  `;
}

function renderSetupPanel(record, dateValue) {
  const draft = getSetupDraft(record);
  const teamAKeys = new Set(draft.teamA.map((name) => normalizeNameKey(name)));
  const teamBKeys = new Set(draft.teamB.map((name) => normalizeNameKey(name)));
  const allNames = Array.isArray(record.names) ? record.names : [];
  const availableForA = allNames.filter((name) => !teamBKeys.has(normalizeNameKey(name)) || teamAKeys.has(normalizeNameKey(name)));
  const availableForB = allNames.filter((name) => !teamAKeys.has(normalizeNameKey(name)) || teamBKeys.has(normalizeNameKey(name)));
  const isLoggedIn = getIsLoggedIn();

  return `
    <form class="partidas-setup-panel" data-action="start-match-form" data-date="${dateValue}">
      <p class="partidas-setup-copy">A partida ainda nao foi iniciada. Defina nomes e atletas dos dois times para comecar.</p>
      <div class="partidas-setup-grid">
        <label class="confirmados-field">
          Nome do Time A
          <input data-role="team-name-a" data-date="${dateValue}" name="teamNameA" type="text" maxlength="40" value="${escapeAttr(draft.teamNameA)}" placeholder="Time A" required ${isLoggedIn ? '' : 'disabled'} />
        </label>
        ${renderTeamChecklist(dateValue, 'A', availableForA, draft.teamA, !isLoggedIn)}
        <label class="confirmados-field">
          Nome do Time B
          <input data-role="team-name-b" data-date="${dateValue}" name="teamNameB" type="text" maxlength="40" value="${escapeAttr(draft.teamNameB)}" placeholder="Time B" required ${isLoggedIn ? '' : 'disabled'} />
        </label>
        ${renderTeamChecklist(dateValue, 'B', availableForB, draft.teamB, !isLoggedIn)}
      </div>
      <div class="partidas-setup-actions">
        ${isLoggedIn ? '<button class="btn" type="submit">Iniciar partida</button>' : '<span class="partidas-status-helper">Faca login no cadastro para salvar a criacao da partida.</span>'}
      </div>
    </form>
  `;
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
  const teamNameA = getTeamDisplayName(record.teamNameA, 'Time A');
  const teamNameB = getTeamDisplayName(record.teamNameB, 'Time B');
  const teamA = Array.isArray(record.teamA) ? record.teamA : [];
  const teamB = Array.isArray(record.teamB) ? record.teamB : [];
  const scoreA = Number(record.scoreA || 0);
  const scoreB = Number(record.scoreB || 0);

  const teamALines = buildTeamShareLines(record, teamA, 'A').join('\n');
  const teamBLines = buildTeamShareLines(record, teamB, 'B').join('\n');

  return [
    `Partida Futeba - ${formatDate(record.date)}`,
    `Placar: ${teamNameA} ${scoreA} x ${scoreB} ${teamNameB}`,
    '',
    teamNameA,
    teamALines,
    '',
    teamNameB,
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
      const teamNameA = getTeamDisplayName(record.teamNameA, 'Time A');
      const teamNameB = getTeamDisplayName(record.teamNameB, 'Time B');
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
          ${matchStatus === 'started' ? `
          <div class="partidas-scoreboard">
            <div class="partidas-score-col">
              <p class="partidas-score-team-label">${escapeHtml(teamNameA)}</p>
              <p class="partidas-score-value">${scoreA}</p>
              <ul class="partidas-events-list">
                ${renderTeamEvents(eventsA)}
              </ul>
            </div>

            <span class="partidas-score-sep" aria-hidden="true">x</span>

            <div class="partidas-score-col">
              <p class="partidas-score-team-label">${escapeHtml(teamNameB)}</p>
              <p class="partidas-score-value">${scoreB}</p>
              <ul class="partidas-events-list partidas-events-list-right">
                ${renderTeamEvents(eventsB)}
              </ul>
            </div>
          </div>
          ` : `
          ${renderSetupPanel(record, escapeAttr(dateValue))}
          `}

          <div class="partidas-share-row">
            ${matchStatus === 'started' && isLoggedIn ? `
            <button class="confirmados-action-btn partidas-status-btn secondary" type="button" data-action="toggle-match-status" data-date="${dateValue}" data-status="${matchStatus}">
              Marcar como nao iniciada
            </button>
            ` : '<span class="partidas-status-helper">Compartilhe o resumo da partida quando quiser.</span>'}
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
      notifyPartidasUpdate(date, 'toggle-match-status');
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

confirmadosListEl.addEventListener('change', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) {
    return;
  }

  const date = String(target.dataset.date || '').trim();
  if (!date) {
    return;
  }

  const draft = matchSetupDrafts.get(date);
  if (!draft) {
    return;
  }

  syncVisibleSetupDraft(date);

  if (target.matches('input[data-role="team-a-player"]')) {
    const name = String(target.value || '').trim();
    const key = normalizeNameKey(name);
    draft.teamA = target.checked
      ? [...draft.teamA.filter((item) => normalizeNameKey(item) !== key), name]
      : draft.teamA.filter((item) => normalizeNameKey(item) !== key);
    draft.teamB = draft.teamB.filter((item) => normalizeNameKey(item) !== key);
    renderRecords(recordsCache);
    return;
  }

  if (target.matches('input[data-role="team-b-player"]')) {
    const name = String(target.value || '').trim();
    const key = normalizeNameKey(name);
    draft.teamB = target.checked
      ? [...draft.teamB.filter((item) => normalizeNameKey(item) !== key), name]
      : draft.teamB.filter((item) => normalizeNameKey(item) !== key);
    draft.teamA = draft.teamA.filter((item) => normalizeNameKey(item) !== key);
    renderRecords(recordsCache);
  }
});

confirmadosListEl.addEventListener('input', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) {
    return;
  }

  const date = String(target.dataset.date || '').trim();
  if (!date) {
    return;
  }

  const draft = matchSetupDrafts.get(date);
  if (!draft) {
    return;
  }

  if (target.matches('input[data-role="team-name-a"]')) {
    draft.teamNameA = String(target.value || '').trim() || 'Time A';
    return;
  }

  if (target.matches('input[data-role="team-name-b"]')) {
    draft.teamNameB = String(target.value || '').trim() || 'Time B';
  }
});

confirmadosListEl.addEventListener('toggle', (event) => {
  const picker = event.target;
  if (!(picker instanceof HTMLDetailsElement) || !picker.matches('details[data-role="setup-picker"][data-date][data-team]')) {
    return;
  }

  setSetupPickerOpen(picker.dataset.date, picker.dataset.team, picker.open);
});

confirmadosListEl.addEventListener('submit', async (event) => {
  const form = event.target.closest('form[data-action="start-match-form"][data-date]');
  if (!form) {
    return;
  }

  event.preventDefault();

  const date = String(form.dataset.date || '').trim();
  if (!date) {
    return;
  }

  if (!getIsLoggedIn()) {
    setStatus('Faca login no cadastro para iniciar a partida.', true);
    return;
  }

  syncVisibleSetupDraft(date);
  const draft = matchSetupDrafts.get(date);
  if (!draft) {
    setStatus('Configuracao da partida nao encontrada.', true);
    return;
  }

  try {
    await request(buildApiUrl(), {
      method: 'PUT',
      body: JSON.stringify({
        action: 'start-match',
        date,
        teamNameA: draft.teamNameA,
        teamNameB: draft.teamNameB,
        teamA: draft.teamA,
        teamB: draft.teamB
      })
    });
    matchSetupDrafts.delete(date);
    setSetupPickerOpen(date, 'A', false);
    setSetupPickerOpen(date, 'B', false);
    expandedRecordDates.add(date);
    await loadRecords();
    notifyPartidasUpdate(date, 'start-match');
    setStatus('Partida iniciada com sucesso.');
  } catch (error) {
    setStatus(error.message || 'Erro ao iniciar partida.', true);
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

async function loadRecords(options = {}) {
  const { background = false } = options;

  if (isLoadingRecords) {
    return;
  }

  if (background && hasActiveSetupInteraction()) {
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
    loadRecords({ background: true }).catch(handleAutoRefreshError);
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
        loadRecords({ background: true }).catch(handleAutoRefreshError);
      }
    } catch {
      // Ignore malformed payloads.
    }
  }

  updateCornerAuthButton();
});

startAutoRefresh();
updateCornerAuthButton();
