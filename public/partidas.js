const confirmadosListEl = document.getElementById('confirmados-list');
const statusEl = document.getElementById('status');
const cornerAuthBtn = document.getElementById('corner-auth-btn');
const GROUP_VALUE = document.body.dataset.group || '';
const TOKEN_KEY = GROUP_VALUE === 'domingo' ? 'app_futeba_domingo_token' : 'app_futeba_token';
const PARTIDAS_UPDATE_KEY = 'app_futeba_partidas_update';
const AUTO_REFRESH_MS = 3000;

let isLoadingRecords = false;
let recordsCache = [];
let goalDialog = null;
let goalDialogState = null;
let openFinishedMatchDetails = new Set();

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
  if (status === 'finished') {
    return 'Finalizada';
  }

  return status === 'started' ? 'Iniciada' : 'Nao iniciada';
}

function getMatchStatusClassName(status) {
  if (status === 'finished') {
    return 'is-finished';
  }

  return status === 'started' ? 'is-started' : 'is-not-started';
}

function getMatchPageUrl(date) {
  const params = new URLSearchParams({ date: String(date || '') });
  return `${GROUP_VALUE === 'domingo' ? '/domingo/partida' : '/partida'}?${params.toString()}`;
}

function getActionLabel(status) {
  if (status === 'started') {
    return 'Abrir partida';
  }

  if (status === 'not-started') {
    return 'Iniciar partida';
  }

  return '';
}

function isMatchDetailsCollapsed(date) {
  return !openFinishedMatchDetails.has(String(date || ''));
}

function setMatchDetailsCollapsed(date, shouldCollapse) {
  const key = String(date || '');
  if (!key) {
    return;
  }

  if (shouldCollapse) {
    openFinishedMatchDetails.delete(key);
    return;
  }

  openFinishedMatchDetails.add(key);
}

function getRecordByDate(date) {
  return recordsCache.find((record) => String(record.date || '') === String(date || '')) || null;
}

function getTeamPlayers(record, teamKey) {
  const source = teamKey === 'A' ? record.teamA : record.teamB;
  return Array.isArray(source) ? source : [];
}

function getTeamScore(record, teamKey) {
  const directValue = Number(teamKey === 'A' ? record.scoreA : record.scoreB);
  if (!Number.isNaN(directValue)) {
    return directValue;
  }

  const events = Array.isArray(record.events) ? record.events : [];
  if (events.length) {
    return events.filter((event) => event && event.scoringTeam === teamKey).length;
  }

  const goalsByTeamName = record.goalsByTeamName && typeof record.goalsByTeamName === 'object'
    ? record.goalsByTeamName
    : {};
  const teamGoals = goalsByTeamName[teamKey] && typeof goalsByTeamName[teamKey] === 'object'
    ? goalsByTeamName[teamKey]
    : {};

  return Object.values(teamGoals).reduce((total, value) => total + Number(value || 0), 0);
}

function getLatestEvent(record) {
  const events = Array.isArray(record.events) ? record.events : [];
  if (!events.length) {
    return null;
  }

  return events[events.length - 1] || null;
}

function getEventLabel(event) {
  if (!event || typeof event !== 'object') {
    return 'Gol';
  }

  if (event.ownGoal) {
    return `Gol contra de ${String(event.playerName || '')}`;
  }

  if (event.assistName) {
    return `Gol de ${String(event.playerName || '')} | Assistência: ${String(event.assistName || '')}`;
  }

  return `Gol de ${String(event.playerName || '')}`;
}

function renderTeamPlayers(record, teamKey, isEditable = false) {
  const names = getTeamPlayers(record, teamKey);

  return names.map((name) => `
      <li class="partidas-player-row">
        <span class="partidas-player-name">${escapeHtml(name)}</span>
        ${isEditable ? `
          <button
            type="button"
            class="confirmados-action-btn partidas-goal-btn"
            data-action="open-goal-dialog"
            data-date="${escapeAttr(record.date)}"
            data-team="${teamKey}"
            data-name="${escapeAttr(name)}"
          >
            GOL
          </button>
        ` : ''}
      </li>
    `).join('') || '<li><span>Sem atletas</span></li>';
}

function renderTeamEvents(record, teamKey, isEditable = false, latestEventId = '') {
  const events = Array.isArray(record.events) ? record.events : [];
  const teamEvents = events.filter((event) => event && event.scoringTeam === teamKey);

  if (!teamEvents.length) {
    return '<li class="partidas-event-empty">Nenhum evento registrado.</li>';
  }

  return teamEvents.map((event) => {
    const canRemove = Boolean(isEditable && event && event.id && String(event.id) === String(latestEventId));

    return `
      <li class="partidas-event-row">
        <span class="partidas-event-icon">⚽</span>
        <span class="partidas-event-player">${escapeHtml(getEventLabel(event))}</span>
        ${canRemove ? `
          <button
            type="button"
            class="partidas-event-remove-btn"
            data-action="remove-last-event"
            data-date="${escapeAttr(record.date)}"
            data-team="${teamKey}"
            data-name="${escapeAttr(String(event.playerName || ''))}"
            data-own-goal="${event.ownGoal ? '1' : '0'}"
          >🗑️</button>
        ` : ''}
      </li>
    `;
  }).join('');
}

function renderGoalDialogOptions(record, teamKey, playerName) {
  const teammates = getTeamPlayers(record, teamKey)
    .filter((name) => normalizeNameKey(name) !== normalizeNameKey(playerName));

  return [`<option value="">(nenhuma)</option>`]
    .concat(teammates.map((name) => `<option value="${escapeAttr(name)}">${escapeHtml(name)}</option>`))
    .join('');
}

function ensureGoalDialog() {
  if (goalDialog) {
    return goalDialog;
  }

  const existing = document.getElementById('goal-dialog');
  if (existing) {
    goalDialog = existing;
    return goalDialog;
  }

  document.body.insertAdjacentHTML('beforeend', `
    <dialog id="goal-dialog" class="help-dialog partidas-goal-dialog">
      <form id="goal-dialog-form" class="help-dialog-content partidas-goal-content">
        <div class="partidas-goal-header">
          <div>
            <h2>Registrar Gol</h2>
            <p class="help-dialog-subtitle">Preencha os dados do lance antes de confirmar.</p>
          </div>
          <button class="partidas-goal-close" type="button" data-action="close-goal-dialog" aria-label="Fechar">&times;</button>
        </div>

        <div class="partidas-goal-meta">
          <span class="partidas-goal-label">Autor</span>
          <strong data-role="goal-author"></strong>
        </div>

        <label class="partidas-goal-toggle">
          <input type="checkbox" data-role="goal-own-goal" />
          <span>Gol contra</span>
        </label>

        <label class="confirmados-field">
          Assistência
          <select data-role="goal-assist"></select>
        </label>

        <p class="partidas-goal-note" data-role="goal-note">Selecione um atleta do mesmo time para a assistência.</p>

        <button class="btn partidas-goal-submit" type="submit">Registrar Gol</button>
      </form>
    </dialog>
  `);

  goalDialog = document.getElementById('goal-dialog');
  return goalDialog;
}

function closeGoalDialog() {
  if (goalDialog && typeof goalDialog.close === 'function' && goalDialog.open) {
    goalDialog.close();
  }

  goalDialogState = null;
}

function syncGoalDialogFields() {
  if (!goalDialog || !goalDialogState) {
    return;
  }

  const ownGoalInput = goalDialog.querySelector('[data-role="goal-own-goal"]');
  const assistSelect = goalDialog.querySelector('[data-role="goal-assist"]');
  const noteEl = goalDialog.querySelector('[data-role="goal-note"]');

  if (!(ownGoalInput instanceof HTMLInputElement) || !(assistSelect instanceof HTMLSelectElement)) {
    return;
  }

  const ownGoal = Boolean(ownGoalInput.checked);
  assistSelect.disabled = ownGoal;
  if (ownGoal) {
    assistSelect.value = '';
  }

  if (noteEl) {
    noteEl.textContent = ownGoal
      ? 'Gol contra selecionado. A assistência fica desativada.'
      : 'Selecione um atleta do mesmo time para a assistência.';
  }
}

function openGoalDialog(date, teamKey, playerName) {
  const record = getRecordByDate(date);
  if (!record) {
    return;
  }

  ensureGoalDialog();
  goalDialogState = { date, teamKey, playerName };

  const authorEl = goalDialog.querySelector('[data-role="goal-author"]');
  const ownGoalInput = goalDialog.querySelector('[data-role="goal-own-goal"]');
  const assistSelect = goalDialog.querySelector('[data-role="goal-assist"]');

  if (authorEl) {
    authorEl.textContent = playerName;
  }

  if (ownGoalInput instanceof HTMLInputElement) {
    ownGoalInput.checked = false;
  }

  if (assistSelect instanceof HTMLSelectElement) {
    assistSelect.innerHTML = renderGoalDialogOptions(record, teamKey, playerName);
    assistSelect.value = '';
  }

  syncGoalDialogFields();

  if (typeof goalDialog.showModal === 'function') {
    goalDialog.showModal();
  }
}

function renderMatchDetails(record) {
  const teamNameA = String(record.teamNameA || 'Time A').trim() || 'Time A';
  const teamNameB = String(record.teamNameB || 'Time B').trim() || 'Time B';
  const isEditable = String(record.matchStatus || '') === 'started';
  const isFinished = String(record.matchStatus || '') === 'finished';
  const isCollapsed = isFinished && isMatchDetailsCollapsed(record.date);
  const latestEvent = getLatestEvent(record);
  const latestEventId = latestEvent && latestEvent.id ? String(latestEvent.id) : '';
  const scoreA = getTeamScore(record, 'A');
  const scoreB = getTeamScore(record, 'B');

  return `
    <div class="partidas-details ${isCollapsed ? 'is-collapsed' : ''}" data-role="match-details" data-date="${escapeAttr(record.date)}">
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
          <ul class="confirmados-team-list">
            ${renderTeamPlayers(record, 'A', isEditable)}
          </ul>
          <div class="partidas-team-events">
            <p class="partidas-team-events-title">Eventos</p>
            <ul class="partidas-events-list">
              ${renderTeamEvents(record, 'A', isEditable, latestEventId)}
            </ul>
          </div>
        </div>
        <div class="confirmados-team-card">
          <ul class="confirmados-team-list">
            ${renderTeamPlayers(record, 'B', isEditable)}
          </ul>
          <div class="partidas-team-events">
            <p class="partidas-team-events-title">Eventos</p>
            <ul class="partidas-events-list">
              ${renderTeamEvents(record, 'B', isEditable, latestEventId)}
            </ul>
          </div>
        </div>
      </div>

      ${isEditable ? `
        <div class="partidas-details-footer">
          <button type="button" class="btn danger partidas-finalize-btn" data-action="finalize-match" data-date="${escapeAttr(record.date)}">Finalizar</button>
        </div>
      ` : ''}
    </div>
  `;
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
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
            ${matchStatus === 'finished'
              ? `<button type="button" class="confirmados-action-btn" data-action="toggle-match-details" data-date="${escapeAttr(record.date)}">${isMatchDetailsCollapsed(record.date) ? 'Mostrar detalhes' : 'Ocultar detalhes'}</button>`
              : `<a class="confirmados-action-btn" href="${getMatchPageUrl(record.date)}">${escapeHtml(getActionLabel(matchStatus))}</a>`}
          </div>
        </div>
        ${matchStatus === 'started' || matchStatus === 'finished' ? renderMatchDetails(record) : ''}
      </article>
    `;
    })
    .join('');
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
    // Ignore storage failures.
  }
}

confirmadosListEl.addEventListener('click', (event) => {
  const toggleDetailsButton = event.target.closest('[data-action="toggle-match-details"]');
  if (toggleDetailsButton) {
    const date = String(toggleDetailsButton.dataset.date || '').trim();
    const record = getRecordByDate(date);
    if (!record || String(record.matchStatus || '') !== 'finished') {
      return;
    }

    const nextCollapsed = !isMatchDetailsCollapsed(date);
    setMatchDetailsCollapsed(date, nextCollapsed);
    renderRecords(recordsCache);
    return;
  }

  const removeEventButton = event.target.closest('[data-action="remove-last-event"]');
  if (removeEventButton) {
    const date = String(removeEventButton.dataset.date || '').trim();
    const team = String(removeEventButton.dataset.team || '').trim().toUpperCase();
    const name = String(removeEventButton.dataset.name || '').trim();
    const ownGoal = String(removeEventButton.dataset.ownGoal || '') === '1';
    const record = getRecordByDate(date);

    if (!record || String(record.matchStatus || '') !== 'started' || !name || (team !== 'A' && team !== 'B')) {
      return;
    }

    event.preventDefault();
    (async () => {
      try {
        await request(buildApiUrl(), {
          method: 'PUT',
          body: JSON.stringify({
            action: 'remove-goal',
            date,
            name,
            team,
            ownGoal
          })
        });

        notifyPartidasUpdate(date, 'remove-goal');
        await loadRecords();
        setStatus('Registro removido com sucesso.');
      } catch (error) {
        setStatus(error.message, true);
      }
    })();
    return;
  }

  const finalizeButton = event.target.closest('[data-action="finalize-match"]');
  if (finalizeButton) {
    const date = String(finalizeButton.dataset.date || '').trim();
    const record = getRecordByDate(date);
    if (!record || String(record.matchStatus || '') !== 'started') {
      return;
    }

    event.preventDefault();
    (async () => {
      try {
        await request(buildApiUrl(), {
          method: 'PUT',
          body: JSON.stringify({
            action: 'finalize-match',
            date,
            teamNameA: record.teamNameA,
            teamNameB: record.teamNameB,
            teamA: record.teamA,
            teamB: record.teamB
          })
        });

        notifyPartidasUpdate(date, 'finalize-match');
        await loadRecords();
        setStatus('Partida finalizada com sucesso.');
      } catch (error) {
        setStatus(error.message, true);
      }
    })();
    return;
  }

  const actionButton = event.target.closest('a.confirmados-action-btn[href]');
  if (actionButton) {
    const href = actionButton.getAttribute('href') || '';
    if (!href) {
      return;
    }

    const date = String(new URL(href, window.location.origin).searchParams.get('date') || '').trim();
    const record = getRecordByDate(date);
    if (record && String(record.matchStatus || '') === 'not-started') {
      const hasStartedMatch = recordsCache.some((item) => String(item.matchStatus || '') === 'started');
      if (hasStartedMatch) {
        event.preventDefault();
        window.alert('Ja existe uma partida iniciada. Finalize a atual antes de iniciar outra.');
        return;
      }
    }

    return;
  }

  const button = event.target.closest('[data-action="open-goal-dialog"]');
  if (!button) {
    return;
  }

  const date = String(button.dataset.date || '').trim();
  const teamKey = String(button.dataset.team || '').trim().toUpperCase();
  const playerName = String(button.dataset.name || '').trim();
  if (!date || !playerName || (teamKey !== 'A' && teamKey !== 'B')) {
    return;
  }

  openGoalDialog(date, teamKey, playerName);
});

document.addEventListener('click', (event) => {
  if (event.target instanceof HTMLElement && event.target.closest('[data-action="close-goal-dialog"]')) {
    closeGoalDialog();
    return;
  }

  if (goalDialog && event.target === goalDialog) {
    closeGoalDialog();
  }
});

document.addEventListener('change', (event) => {
  if (!goalDialog || !goalDialogState) {
    return;
  }

  if (event.target instanceof HTMLInputElement && event.target.matches('[data-role="goal-own-goal"]')) {
    syncGoalDialogFields();
  }
});

document.addEventListener('submit', async (event) => {
  if (!goalDialog || !goalDialogState) {
    return;
  }

  const form = event.target.closest('#goal-dialog-form');
  if (!form) {
    return;
  }

  event.preventDefault();

  const ownGoalInput = goalDialog.querySelector('[data-role="goal-own-goal"]');
  const assistSelect = goalDialog.querySelector('[data-role="goal-assist"]');
  const ownGoal = Boolean(ownGoalInput instanceof HTMLInputElement && ownGoalInput.checked);
  const assistName = ownGoal || !(assistSelect instanceof HTMLSelectElement) ? '' : String(assistSelect.value || '').trim();

  try {
    await request(buildApiUrl(), {
      method: 'PUT',
      body: JSON.stringify({
        action: 'add-goal',
        date: goalDialogState.date,
        name: goalDialogState.playerName,
        team: goalDialogState.teamKey,
        ownGoal,
        assistName
      })
    });

    notifyPartidasUpdate(goalDialogState.date, 'add-goal');
    closeGoalDialog();
    await loadRecords();
    setStatus('Gol registrado com sucesso.');
  } catch (error) {
    setStatus(error.message, true);
  }
});

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
