const confirmadosListEl = document.getElementById('confirmados-list');
const statusEl = document.getElementById('status');
const cornerAuthBtn = document.getElementById('corner-auth-btn');
const importListBtn = document.getElementById('import-list-btn');
const importListDialog = document.getElementById('import-list-dialog');
const importListForm = document.getElementById('import-list-form');
const importMatchDateInput = document.getElementById('import-match-date');
const importConfirmedNamesInput = document.getElementById('import-confirmed-names');
const importClearFormBtn = document.getElementById('import-clear-form-btn');
const GROUP_VALUE = document.body.dataset.group || '';
const TOKEN_KEY = GROUP_VALUE === 'domingo' ? 'app_futeba_domingo_token' : 'app_futeba_token';
const PARTIDAS_UPDATE_KEY = 'app_futeba_partidas_update';
const PARTIDAS_FINALIZE_DRAFT_KEY = GROUP_VALUE === 'domingo' ? 'app_futeba_domingo_finalize_draft' : 'app_futeba_finalize_draft';
const AUTO_REFRESH_MS = 120000;

let isLoadingRecords = false;
let recordsCache = [];
let goalDialog = null;
let goalDialogState = null;
let openFinishedMatchDetails = new Set();
let serverClockOffsetMs = 0;
let finalizeDraftByDate = new Map();
let pendingRequests = new Map();

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

function sanitizeAthleteName(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001F\u007F\u00AD\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function normalizeNameKey(value) {
  return sanitizeAthleteName(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeNames(text) {
  const uniqueByKey = new Map();

  String(text || '')
    .split(/\r?\n/)
    .forEach((line) => {
      const raw = String(line || '').trim();
      
      // Ignorar linhas vazias, que começam com FUT ou que não combinam com o padrão
      if (!raw || raw.toUpperCase().startsWith('FUT')) {
        return;
      }
      
      // Aceitar apenas linhas no formato: número - nome
      const match = raw.match(/^\d+\s*-\s*(.+)$/);
      if (!match) {
        return;
      }
      
      const name = sanitizeAthleteName(
        match[1]
          .replace(/\(\s*avulso\s*\)/gi, '')
          .replace(/\s{2,}/g, ' ')
          .trim()
      );
      const key = normalizeNameKey(name);

      if (!key || uniqueByKey.has(key)) {
        return;
      }

      uniqueByKey.set(key, name);
    });

  return Array.from(uniqueByKey.values());
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

function getPartidasListUrl() {
  const path = GROUP_VALUE === 'domingo' ? '/domingo/partidas' : '/partidas';
  return `${window.location.origin}${path}`;
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

function formatMatchTimer(totalSeconds) {
  const safeSeconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function getServerAlignedNowMs() {
  return Date.now() + serverClockOffsetMs;
}

function syncServerClock(serverNow) {
  const serverNowMs = Date.parse(String(serverNow || ''));
  if (Number.isNaN(serverNowMs)) {
    return;
  }

  serverClockOffsetMs = serverNowMs - Date.now();
}

function getMatchTimerState(record) {
  const source = record && typeof record.matchTimer === 'object' ? record.matchTimer : {};
  const status = String(source.status || 'paused').trim().toLowerCase() === 'running' ? 'running' : 'paused';
  const elapsedSeconds = Math.max(0, Math.floor(Number(source.elapsedSeconds || 0)));
  const startedAt = String(source.startedAt || '').trim();

  return {
    status,
    elapsedSeconds,
    startedAt
  };
}

function getMatchTimerElapsedSeconds(timerState) {
  const elapsedSeconds = Math.max(0, Math.floor(Number(timerState && timerState.elapsedSeconds || 0)));
  if (!timerState || timerState.status !== 'running' || !timerState.startedAt) {
    return elapsedSeconds;
  }

  const startedAtMs = Date.parse(timerState.startedAt);
  if (Number.isNaN(startedAtMs)) {
    return elapsedSeconds;
  }

  return elapsedSeconds + Math.max(0, Math.floor((getServerAlignedNowMs() - startedAtMs) / 1000));
}

function getMatchTimerLabel(record) {
  return getMatchTimerState(record).status === 'running' ? 'Pausar' : 'Reiniciar';
}

function updateMatchTimerDisplays() {
  const timerElements = confirmadosListEl.querySelectorAll('[data-role="match-timer"]');
  timerElements.forEach((timerEl) => {
    const status = String(timerEl.dataset.timerStatus || 'paused').trim().toLowerCase();
    const elapsedSeconds = Math.max(0, Math.floor(Number(timerEl.dataset.timerElapsed || 0)));
    const startedAt = String(timerEl.dataset.timerStartedAt || '').trim();
    const displaySeconds = getMatchTimerElapsedSeconds({ status, elapsedSeconds, startedAt });
    const valueEl = timerEl.querySelector('[data-role="match-timer-value"]');
    if (valueEl) {
      valueEl.textContent = formatMatchTimer(displaySeconds);
    }

    const footerButton = timerEl.closest('.partidas-details')?.querySelector('[data-action="toggle-match-timer"]');
    if (footerButton) {
      footerButton.textContent = status === 'running' ? 'Pausar' : 'Reiniciar';
    }
  });
}

let matchTimerTicker = null;

function startMatchTimerTicker() {
  if (matchTimerTicker) {
    return;
  }

  updateMatchTimerDisplays();
  matchTimerTicker = window.setInterval(updateMatchTimerDisplays, 1000);
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

function sortRecordsByDateDesc(records) {
  return [...records].sort((left, right) => String(right.date || '').localeCompare(String(left.date || '')));
}

function upsertRecord(nextRecord) {
  if (!nextRecord || !nextRecord.date) {
    return null;
  }

  const index = recordsCache.findIndex((record) => String(record.date || '') === String(nextRecord.date || ''));
  if (index >= 0) {
    const nextRecords = [...recordsCache];
    nextRecords[index] = {
      ...recordsCache[index],
      ...nextRecord
    };
    recordsCache = sortRecordsByDateDesc(nextRecords);
  } else {
    recordsCache = sortRecordsByDateDesc([...recordsCache, nextRecord]);
  }

  renderRecords(recordsCache);
  return getRecordByDate(nextRecord.date);
}

function patchRecord(date, patch) {
  const current = getRecordByDate(date);
  if (!current) {
    return null;
  }

  return upsertRecord({
    ...current,
    ...patch,
    date: current.date
  });
}

function saveFinalizeDrafts() {
  try {
    localStorage.setItem(
      PARTIDAS_FINALIZE_DRAFT_KEY,
      JSON.stringify({
        group: GROUP_VALUE || '',
        drafts: Object.fromEntries(finalizeDraftByDate)
      })
    );
  } catch {
    // Ignore storage failures.
  }
}

function loadFinalizeDrafts() {
  try {
    const raw = localStorage.getItem(PARTIDAS_FINALIZE_DRAFT_KEY);
    if (!raw) {
      return;
    }

    const payload = JSON.parse(raw);
    if (String(payload.group || '') !== GROUP_VALUE) {
      return;
    }

    const drafts = payload.drafts && typeof payload.drafts === 'object' ? payload.drafts : {};
    finalizeDraftByDate = new Map(Object.entries(drafts));
  } catch {
    finalizeDraftByDate = new Map();
  }
}

function getFinalizeDraft(date) {
  const key = String(date || '');
  if (!key || !finalizeDraftByDate.has(key)) {
    return null;
  }

  const draft = finalizeDraftByDate.get(key);
  return draft && typeof draft === 'object' ? draft : null;
}

function setFinalizeDraft(date, nextDraft) {
  const key = String(date || '');
  if (!key) {
    return;
  }

  if (!nextDraft || (!nextDraft.mvpName && !nextDraft.worstName && !nextDraft.defenderName)) {
    finalizeDraftByDate.delete(key);
  } else {
    finalizeDraftByDate.set(key, {
      mvpName: String(nextDraft.mvpName || '').trim(),
      worstName: String(nextDraft.worstName || '').trim(),
      defenderName: String(nextDraft.defenderName || '').trim()
    });
  }

  saveFinalizeDrafts();
}

function clearFinalizeDraft(date) {
  const key = String(date || '');
  if (!key) {
    return;
  }

  finalizeDraftByDate.delete(key);
  saveFinalizeDrafts();
}

function getTeamPlayers(record, teamKey) {
  const source = teamKey === 'A' ? record.teamA : record.teamB;
  return Array.isArray(source) ? source : [];
}

function getFinalizeMetricPlayers(record) {
  const players = [...getTeamPlayers(record, 'A'), ...getTeamPlayers(record, 'B')];
  const seen = new Set();

  return players.filter((name) => {
    const key = normalizeNameKey(name);
    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function getSelectedMetricName(record, metricKey) {
  const draft = getFinalizeDraft(record && record.date);
  if (draft) {
    let draftValue = '';
    if (metricKey === 'worst') {
      draftValue = draft.worstName;
    } else if (metricKey === 'defender') {
      draftValue = draft.defenderName;
    } else {
      draftValue = draft.mvpName;
    }
    if (draftValue) {
      return draftValue;
    }
  }

  let metricByName = record.mvpByName;
  if (metricKey === 'worst') {
    metricByName = record.worstByName;
  } else if (metricKey === 'defender') {
    metricByName = record.defenderByName;
  }

  const selectedKeys = Object.entries(metricByName && typeof metricByName === 'object' ? metricByName : {})
    .filter(([, value]) => Number(value || 0) > 0)
    .map(([key]) => key);

  if (!selectedKeys.length) {
    return '';
  }

  const selectedKey = selectedKeys[0];
  const selectedPlayer = getFinalizeMetricPlayers(record).find((name) => normalizeNameKey(name) === selectedKey);
  return selectedPlayer || '';
}

function hasMetricSelection(record, metricKey, playerName) {
  let source = record.mvpByName;
  if (metricKey === 'worst') {
    source = record.worstByName;
  } else if (metricKey === 'defender') {
    source = record.defenderByName;
  }
  const key = normalizeNameKey(playerName);
  return Boolean(key && source && typeof source === 'object' && Number(source[key] || 0) > 0);
}

function buildFinalizeMetricOptions(record, selectedName = '') {
  const selectedKey = normalizeNameKey(selectedName);
  const options = getFinalizeMetricPlayers(record).map((name) => {
    const key = normalizeNameKey(name);
    const selected = key && key === selectedKey ? 'selected' : '';
    return `<option value="${escapeAttr(name)}" ${selected}>${escapeHtml(name)}</option>`;
  });

  return [`<option value="">Selecione</option>`].concat(options).join('');
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

function getEventPrimaryLabel(event) {
  if (!event || typeof event !== 'object') {
    return 'Gol';
  }

  if (event.ownGoal) {
    return `Gol contra de ${String(event.playerName || '')}`;
  }

  return `Gol de ${String(event.playerName || '')}`;
}

function getEventElapsedSeconds(event, record) {
  const storedSeconds = Number(event && event.matchElapsedSeconds);
  if (!Number.isNaN(storedSeconds) && storedSeconds >= 0) {
    return Math.floor(storedSeconds);
  }

  const createdAt = Date.parse(String(event && event.createdAt || ''));
  const startedAt = Date.parse(String(record && record.matchTimer && record.matchTimer.startedAt || ''));
  if (Number.isNaN(createdAt) || Number.isNaN(startedAt)) {
    return 0;
  }

  return Math.max(0, Math.floor((createdAt - startedAt) / 1000));
}

function formatEventMinute(event, record) {
  const elapsedSeconds = getEventElapsedSeconds(event, record);
  return `${Math.max(1, Math.floor(elapsedSeconds / 60))}'`;
}

function joinSummaryParts(parts) {
  if (!parts.length) {
    return '';
  }

  if (parts.length === 1) {
    return parts[0];
  }

  if (parts.length === 2) {
    return `${parts[0]} e ${parts[1]}`;
  }

  return `${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]}`;
}

function formatContributionLabel(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function buildSummulaEventLines(record) {
  const events = Array.isArray(record && record.events) ? record.events : [];
  if (!events.length) {
    return 'Sem eventos registrados.';
  }

  const summaryByPlayer = new Map();

  const ensurePlayerSummary = (playerName) => {
    const name = String(playerName || '').trim();
    if (!name) {
      return null;
    }

    const key = normalizeNameKey(name);
    if (!key) {
      return null;
    }

    if (!summaryByPlayer.has(key)) {
      summaryByPlayer.set(key, {
        name,
        goals: 0,
        assists: 0,
        ownGoals: 0
      });
    }

    return summaryByPlayer.get(key);
  };

  events.forEach((event) => {
    if (!event || typeof event !== 'object') {
      return;
    }

    const playerSummary = ensurePlayerSummary(event.playerName);
    if (playerSummary) {
      if (event.ownGoal) {
        playerSummary.ownGoals += 1;
      } else {
        playerSummary.goals += 1;
      }
    }

    if (!event.ownGoal) {
      const assistSummary = ensurePlayerSummary(event.assistName);
      if (assistSummary) {
        assistSummary.assists += 1;
      }
    }
  });

  const lines = Array.from(summaryByPlayer.values())
    .map((summary) => {
      const pontosPartida = (Number(summary.goals) * 2.5) + (Number(summary.assists) * 1.5) + 0.5;
      return {
        ...summary,
        pontos: Math.max(0, Math.round(pontosPartida * 100) / 100)
      };
    })
    .sort((left, right) => {
      if (right.pontos !== left.pontos) return right.pontos - left.pontos;
      return left.name.localeCompare(right.name, 'pt-BR', { sensitivity: 'base' });
    })
    .map((summary) => {
      const parts = [];

      if (summary.goals > 0) {
        parts.push(formatContributionLabel(summary.goals, 'gol'));
      }

      if (summary.assists > 0) {
        parts.push(formatContributionLabel(summary.assists, 'assist.', 'assist.'));
      }

      if (summary.ownGoals > 0) {
        parts.push(formatContributionLabel(summary.ownGoals, 'gol contra', 'gols contra'));
      }

      if (!parts.length) {
        return '';
      }

      const pontosText = summary.pontos > 0 ? ` (${summary.pontos} pts)` : '';
      return `• ${summary.name}${pontosText} - ${joinSummaryParts(parts)}`;
    })
    .filter(Boolean);

  return lines.length ? lines.join('\n') : 'Sem eventos registrados.';
}

function buildSummulaText(record) {
  const teamNameA = String(record.teamNameA || 'Time A').trim() || 'Time A';
  const teamNameB = String(record.teamNameB || 'Time B').trim() || 'Time B';
  const scoreA = getTeamScore(record, 'A');
  const scoreB = getTeamScore(record, 'B');
  const dateLabel = formatDate(record.date);
  const teamAPlayers = getTeamPlayers(record, 'A').join(', ') || 'Sem atletas';
  const teamBPlayers = getTeamPlayers(record, 'B').join(', ') || 'Sem atletas';
  const eventLines = buildSummulaEventLines(record);

  return [
    `*SÚMULA* - ${dateLabel}`,
    `*Placar:* ${teamNameA} ${scoreA} x ${scoreB} ${teamNameB}`,
    '',
    '*Escalações*',
    `• ${teamNameA}: ${teamAPlayers}`,
    `• ${teamNameB}: ${teamBPlayers}`,
    '',
    '*Eventos*',
    eventLines,
    '',
    '*Partidas*',
    getPartidasListUrl()
  ].join('\n');
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'readonly');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

function openWhatsappShare(text) {
  const message = encodeURIComponent(text);
  const mobileUrl = `whatsapp://send?text=${message}`;
  const webUrl = `https://wa.me/?text=${message}`;

  const popup = window.open(mobileUrl, '_blank', 'noopener,noreferrer');
  if (!popup) {
    window.open(webUrl, '_blank', 'noopener,noreferrer');
  }
}

async function shareSummula(record) {
  const text = buildSummulaText(record);

  if (navigator.share && typeof navigator.share === 'function') {
    try {
      await navigator.share({
        title: 'Súmula',
        text
      });
      return;
    } catch (error) {
      if (error && error.name === 'AbortError') {
        return;
      }
    }
  }

  openWhatsappShare(text);
}

function renderTeamPlayers(record, teamKey, isEditable = false) {
  const names = getTeamPlayers(record, teamKey);

  return names.map((name) => `
      <li class="partidas-player-row">
        <span class="partidas-player-name">${escapeHtml(name)}</span>
        ${!isEditable && (hasMetricSelection(record, 'mvp', name) || hasMetricSelection(record, 'worst', name)) ? `
          <span class="partidas-player-awards" aria-label="Premiacoes da partida">
            ${hasMetricSelection(record, 'mvp', name) ? '<span class="partidas-player-award is-mvp" title="MVP">★</span>' : ''}
            ${hasMetricSelection(record, 'worst', name) ? '<span class="partidas-player-award is-worst" title="Pior em campo">👎</span>' : ''}
          </span>
        ` : ''}
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

function renderMatchEvents(record, isEditable = false, latestEventId = '') {
  const events = Array.isArray(record.events) ? record.events : [];

  if (!events.length) {
    return '<li class="partidas-event-empty">Nenhum evento registrado.</li>';
  }

  return events.map((event) => {
    const eventTeam = String(event && (event.playerTeam || event.scoringTeam) || 'A').trim().toUpperCase() === 'B' ? 'B' : 'A';
    const canRemove = Boolean(isEditable && event && event.id && String(event.id) === String(latestEventId));
    const minuteLabel = formatEventMinute(event, record);
    const hasAssist = Boolean(event && !event.ownGoal && String(event.assistName || '').trim());

    return `
      <li class="partidas-event-row is-team-${eventTeam.toLowerCase()}">
        <article class="partidas-event-card">
          <div class="partidas-event-main">
            <span class="partidas-event-time">${escapeHtml(minuteLabel)}</span>
            <span class="partidas-event-icon ${event.ownGoal ? 'is-own-goal' : ''}">⚽</span>
            <span class="partidas-event-player">${escapeHtml(getEventPrimaryLabel(event))}</span>
          </div>
          ${hasAssist ? `<p class="partidas-event-assist">Assistência: ${escapeHtml(String(event.assistName || '').trim())}</p>` : ''}
          ${canRemove ? `
            <button
              type="button"
              class="partidas-event-remove-btn"
              data-action="remove-last-event"
              data-date="${escapeAttr(record.date)}"
              data-team="${eventTeam}"
              data-name="${escapeAttr(String(event.playerName || ''))}"
              data-own-goal="${event.ownGoal ? '1' : '0'}"
            >🗑️</button>
          ` : ''}
        </article>
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

function setDefaultImportDate() {
  const now = new Date();
  const localIso = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
  importMatchDateInput.value = localIso;
}

function resetImportForm() {
  setDefaultImportDate();
  importConfirmedNamesInput.value = '';
}

function openImportListDialog() {
  if (!importListDialog) {
    return;
  }
  
  resetImportForm();
  if (typeof importListDialog.showModal === 'function') {
    importListDialog.showModal();
  }
}

function closeImportListDialog() {
  if (importListDialog && typeof importListDialog.close === 'function' && importListDialog.open) {
    importListDialog.close();
  }
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
  const canResetMatch = getIsLoggedIn() && (isEditable || isFinished);
  const isCollapsed = isFinished && isMatchDetailsCollapsed(record.date);
  const latestEvent = getLatestEvent(record);
  const latestEventId = latestEvent && latestEvent.id ? String(latestEvent.id) : '';
  const scoreA = getTeamScore(record, 'A');
  const scoreB = getTeamScore(record, 'B');
  const timerState = getMatchTimerState(record);
  const timerText = formatMatchTimer(getMatchTimerElapsedSeconds(timerState));

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

      ${isEditable ? `
        <div class="partidas-clock-row">
          <span class="partidas-clock-label">Tempo</span>
          <strong
            class="partidas-clock-value"
            data-role="match-timer"
            data-date="${escapeAttr(record.date)}"
            data-timer-status="${escapeAttr(timerState.status)}"
            data-timer-elapsed="${escapeAttr(String(timerState.elapsedSeconds || 0))}"
            data-timer-started-at="${escapeAttr(timerState.startedAt || '')}"
          >${escapeHtml(timerText)}</strong>
        </div>
      ` : ''}

      <div class="confirmados-teams partidas-current-teams">
        <div class="confirmados-team-card">
          <ul class="confirmados-team-list">
            ${renderTeamPlayers(record, 'A', isEditable)}
          </ul>
        </div>
        <div class="confirmados-team-card">
          <ul class="confirmados-team-list">
            ${renderTeamPlayers(record, 'B', isEditable)}
          </ul>
        </div>
      </div>

      <div class="partidas-events-panel">
        <p class="partidas-team-events-title">Eventos da partida</p>
        <ul class="partidas-events-list partidas-events-timeline">
          ${renderMatchEvents(record, isEditable, latestEventId)}
        </ul>
      </div>

      ${isEditable ? `
        <div class="partidas-finalize-metrics">
          <label class="confirmados-field">
            MVP da partida
            <select data-role="finalize-mvp">
              ${buildFinalizeMetricOptions(record, getSelectedMetricName(record, 'mvp'))}
            </select>
          </label>
          <label class="confirmados-field">
            Pior em campo
            <select data-role="finalize-worst">
              ${buildFinalizeMetricOptions(record, getSelectedMetricName(record, 'worst'))}
            </select>
          </label>
          <label class="confirmados-field">
            Melhor Defensor
            <select data-role="finalize-defender">
              ${buildFinalizeMetricOptions(record, getSelectedMetricName(record, 'defender'))}
            </select>
          </label>
        </div>
      ` : ''}

      ${isEditable || canResetMatch ? `
        <div class="partidas-details-footer">
          ${isEditable ? `<button type="button" class="btn danger partidas-finalize-btn" data-action="finalize-match" data-date="${escapeAttr(record.date)}">Finalizar</button>` : ''}
          ${isEditable ? `<button type="button" class="btn secondary partidas-pause-btn" data-action="toggle-match-timer" data-date="${escapeAttr(record.date)}">${getMatchTimerLabel(record)}</button>` : ''}
          ${canResetMatch ? `<button type="button" class="btn danger partidas-reset-btn" data-action="reset-match" data-date="${escapeAttr(record.date)}">Resetar partida</button>` : ''}
        </div>
      ` : ''}
    </div>
  `;
}

async function request(url, options = {}) {
  if (options.method === 'GET' && pendingRequests.has(url)) {
    return pendingRequests.get(url);
  }

  const token = localStorage.getItem(TOKEN_KEY) || '';
  const fetchPromise = fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  }).then(async (response) => {
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Erro na requisicao.');
    }
    return data;
  }).finally(() => {
    if (options.method === 'GET') {
      pendingRequests.delete(url);
    }
  });

  if (options.method === 'GET') {
    pendingRequests.set(url, fetchPromise);
  }

  return fetchPromise;
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
      const isStartAction = matchStatus === 'not-started';

      return `
      <article class="confirmados-item">
        <div class="partidas-list-row">
          <div class="partidas-list-main">
            <h3 class="partidas-date-title">${formatDate(record.date)}</h3>
            <p class="partidas-date-meta">${confirmadosCount} confirmados <span class="partidas-status-badge ${getMatchStatusClassName(matchStatus)}">${getMatchStatusLabel(matchStatus)}</span></p>
          </div>
          <div class="partidas-list-actions">
            ${matchStatus === 'finished'
              ? `
                <button type="button" class="confirmados-action-btn" data-action="toggle-match-details" data-date="${escapeAttr(record.date)}">${isMatchDetailsCollapsed(record.date) ? 'Mostrar detalhes' : 'Ocultar detalhes'}</button>
                <button type="button" class="confirmados-action-btn" data-action="copy-summula" data-date="${escapeAttr(record.date)}">Súmula</button>
              `
              : `<a class="confirmados-action-btn ${isStartAction ? 'is-start-match' : ''}" href="${getMatchPageUrl(record.date)}">${escapeHtml(getActionLabel(matchStatus))}</a>`}
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
  const copySummulaButton = event.target.closest('[data-action="copy-summula"]');
  if (copySummulaButton) {
    const date = String(copySummulaButton.dataset.date || '').trim();
    const record = getRecordByDate(date);
    if (!record || String(record.matchStatus || '') !== 'finished') {
      return;
    }

    event.preventDefault();
    (async () => {
      try {
        await shareSummula(record);
        setStatus('Súmula pronta para compartilhar.');
      } catch (error) {
        setStatus(error.message || 'Nao foi possivel copiar a súmula.', true);
      }
    })();
    return;
  }

  const toggleTimerButton = event.target.closest('[data-action="toggle-match-timer"]');
  if (toggleTimerButton) {
    const date = String(toggleTimerButton.dataset.date || '').trim();
    const record = getRecordByDate(date);
    if (!record || String(record.matchStatus || '') !== 'started') {
      return;
    }

    const timerState = getMatchTimerState(record);
    const action = timerState.status === 'running' ? 'pause-match-timer' : 'resume-match-timer';

    event.preventDefault();
    (async () => {
      try {
        const data = await request(buildApiUrl(), {
          method: 'PUT',
          body: JSON.stringify({
            action,
            date
          })
        });

        patchRecord(date, {
          matchTimer: data.matchTimer
        });

        notifyPartidasUpdate(date, action);
        setStatus(action === 'pause-match-timer' ? 'Cronometro pausado.' : 'Cronometro reiniciado.');
      } catch (error) {
        setStatus(error.message, true);
      }
    })();
    return;
  }

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
        const data = await request(buildApiUrl(), {
          method: 'PUT',
          body: JSON.stringify({
            action: 'remove-goal',
            date,
            name,
            team,
            ownGoal
          })
        });

        patchRecord(date, {
          events: data.events,
          scoreA: data.scoreA,
          scoreB: data.scoreB,
          goalsByName: data.goalsByName,
          goalsByTeamName: data.goalsByTeamName,
          assistsByName: data.assistsByName,
          assistsByTeamName: data.assistsByTeamName
        });
        notifyPartidasUpdate(date, 'remove-goal');
        setStatus('Registro removido com sucesso.');
      } catch (error) {
        setStatus(error.message, true);
      }
    })();
    return;
  }

  const resetMatchButton = event.target.closest('[data-action="reset-match"]');
  if (resetMatchButton) {
    const date = String(resetMatchButton.dataset.date || '').trim();
    const record = getRecordByDate(date);
    if (!record || !getIsLoggedIn()) {
      return;
    }

    const confirmed = window.confirm('Isso vai apagar gols, assistencias, MVP, pior em campo e voltar a partida para nao iniciada. Deseja continuar?');
    if (!confirmed) {
      return;
    }

    event.preventDefault();
    (async () => {
      try {
        await request(buildApiUrl(), {
          method: 'PUT',
          body: JSON.stringify({
            action: 'reset-match',
            date
          })
        });

        clearFinalizeDraft(date);
        patchRecord(date, {
          matchStatus: 'not-started',
          scoreA: 0,
          scoreB: 0,
          events: [],
          goalsByName: {},
          assistsByName: {},
          goalsByTeamName: { A: {}, B: {} },
          assistsByTeamName: { A: {}, B: {} },
          mvpByName: {},
          worstByName: {},
          defenderByName: {},
          matchTimer: {
            status: 'paused',
            elapsedSeconds: 0,
            startedAt: ''
          }
        });
        notifyPartidasUpdate(date, 'reset-match');
        setStatus('Partida resetada com sucesso.');
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
    if (!record) {
      return;
    }

    const detailsEl = finalizeButton.closest('.partidas-details');
    const mvpSelect = detailsEl ? detailsEl.querySelector('[data-role="finalize-mvp"]') : null;
    const worstSelect = detailsEl ? detailsEl.querySelector('[data-role="finalize-worst"]') : null;
    const defenderSelect = detailsEl ? detailsEl.querySelector('[data-role="finalize-defender"]') : null;
    const mvpName = mvpSelect instanceof HTMLSelectElement ? String(mvpSelect.value || '').trim() : '';
    const worstName = worstSelect instanceof HTMLSelectElement ? String(worstSelect.value || '').trim() : '';
    const defenderName = defenderSelect instanceof HTMLSelectElement ? String(defenderSelect.value || '').trim() : '';

    if (mvpName && worstName && normalizeNameKey(mvpName) === normalizeNameKey(worstName)) {
      setStatus('MVP e pior em campo nao podem ser o mesmo atleta.', true);
      return;
    }

    event.preventDefault();
    (async () => {
      try {
        const data = await request(buildApiUrl(), {
          method: 'PUT',
          body: JSON.stringify({
            action: 'finalize-match',
            date,
            teamNameA: record.teamNameA,
            teamNameB: record.teamNameB,
            teamA: record.teamA,
            teamB: record.teamB,
            mvpName,
            worstName,
            defenderName
          })
        });

        clearFinalizeDraft(date);
        patchRecord(date, {
          matchStatus: data.matchStatus,
          teamNameA: data.teamNameA,
          teamNameB: data.teamNameB,
          teamA: data.teamA,
          teamB: data.teamB,
          mvpByName: data.mvpByName,
          worstByName: data.worstByName,
          defenderByName: data.defenderByName,
          matchTimer: data.matchTimer,
          scoreA: data.scoreA,
          scoreB: data.scoreB
        });
        notifyPartidasUpdate(date, 'finalize-match');
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

confirmadosListEl.addEventListener('change', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLSelectElement)) {
    return;
  }

  if (!target.matches('[data-role="finalize-mvp"], [data-role="finalize-worst"], [data-role="finalize-defender"]')) {
    return;
  }

  const detailsEl = target.closest('.partidas-details');
  const date = detailsEl ? String(detailsEl.dataset.date || '').trim() : '';
  if (!date) {
    return;
  }

  const mvpSelect = detailsEl.querySelector('[data-role="finalize-mvp"]');
  const worstSelect = detailsEl.querySelector('[data-role="finalize-worst"]');
  const defenderSelect = detailsEl.querySelector('[data-role="finalize-defender"]');
  const mvpName = mvpSelect instanceof HTMLSelectElement ? String(mvpSelect.value || '').trim() : '';
  const worstName = worstSelect instanceof HTMLSelectElement ? String(worstSelect.value || '').trim() : '';
  const defenderName = defenderSelect instanceof HTMLSelectElement ? String(defenderSelect.value || '').trim() : '';

  setFinalizeDraft(date, { mvpName, worstName, defenderName });
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
    const data = await request(buildApiUrl(), {
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

    patchRecord(goalDialogState.date, {
      events: data.events,
      scoreA: data.scoreA,
      scoreB: data.scoreB,
      goalsByName: data.goalsByName,
      goalsByTeamName: data.goalsByTeamName,
      assistsByName: data.assistsByName,
      assistsByTeamName: data.assistsByTeamName
    });
    notifyPartidasUpdate(goalDialogState.date, 'add-goal');
    closeGoalDialog();
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
    syncServerClock(data.serverNow);
    recordsCache = data.records || [];
    recordsCache.forEach((record) => {
      if (String(record.matchStatus || '') !== 'started') {
        clearFinalizeDraft(record.date);
      }
    });
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

// Import List Dialog Event Listeners
if (importListBtn) {
  importListBtn.addEventListener('click', openImportListDialog);
}

if (importListDialog) {
  const closeBtn = importListDialog.querySelector('[data-action="close-import-dialog"]');
  if (closeBtn) {
    closeBtn.addEventListener('click', closeImportListDialog);
  }
}

if (importListForm) {
  importListForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    try {
      const date = String(importMatchDateInput.value || '').trim();
      const names = normalizeNames(importConfirmedNamesInput.value);

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

      try {
        localStorage.setItem(
          PARTIDAS_UPDATE_KEY,
          JSON.stringify({
            ts: Date.now(),
            group: GROUP_VALUE || '',
            date: String(date || ''),
            action: 'save-list'
          })
        );
      } catch {
        // Silent fail: localStorage may be unavailable in private contexts.
      }

      resetImportForm();
      closeImportListDialog();
      await loadRecords();
      setStatus('Lista de confirmados salva com sucesso. Se a data ja existia, a lista foi atualizada.');
    } catch (error) {
      setStatus(error.message, true);
    }
  });
}

if (importClearFormBtn) {
  importClearFormBtn.addEventListener('click', () => {
    resetImportForm();
    setStatus('Formulario limpo.');
  });
}

loadFinalizeDrafts();

loadRecords().then(() => {
  setStatus('Partidas carregadas.');
  startMatchTimerTicker();
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
