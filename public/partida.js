const rootEl = document.getElementById('match-setup-root');
const statusEl = document.getElementById('status');
const cornerAuthBtn = document.getElementById('corner-auth-btn');
const GROUP_VALUE = document.body.dataset.group || '';
const AUTH_LINK = document.body.dataset.authLink || (GROUP_VALUE === 'domingo' ? '/domingo/athletes' : '/athletes');
const TOKEN_KEY = GROUP_VALUE === 'domingo' ? 'app_futeba_domingo_token' : 'app_futeba_token';
const PARTIDAS_UPDATE_KEY = 'app_futeba_partidas_update';
const setupPickerOpenKeys = new Set();
const currentDate = String(new URLSearchParams(window.location.search).get('date') || '').trim();

let recordCache = null;
let setupDraft = null;

function getIsLoggedIn() {
  return Boolean(localStorage.getItem(TOKEN_KEY));
}

function updateCornerAuthButton() {
  if (!cornerAuthBtn) {
    return;
  }

  const isLoggedIn = getIsLoggedIn();
  cornerAuthBtn.textContent = isLoggedIn ? 'Cadastro' : 'Login';
  cornerAuthBtn.href = AUTH_LINK;
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

function getSetupPickerKey(teamKey) {
  return `${currentDate}:${teamKey}`;
}

function isSetupPickerOpen(teamKey) {
  return setupPickerOpenKeys.has(getSetupPickerKey(teamKey));
}

function setSetupPickerOpen(teamKey, isOpen) {
  const key = getSetupPickerKey(teamKey);
  if (isOpen) {
    setupPickerOpenKeys.add(key);
    return;
  }

  setupPickerOpenKeys.delete(key);
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

function getAvailableNamesForTeam(teamKey) {
  const draft = getSetupDraft();
  const allNames = Array.isArray(recordCache && recordCache.names) ? recordCache.names : [];
  const selectedAKeys = new Set(draft.teamA.map((name) => normalizeNameKey(name)));
  const selectedBKeys = new Set(draft.teamB.map((name) => normalizeNameKey(name)));

  if (teamKey === 'A') {
    return allNames.filter((name) => !selectedBKeys.has(normalizeNameKey(name)) || selectedAKeys.has(normalizeNameKey(name)));
  }

  return allNames.filter((name) => !selectedAKeys.has(normalizeNameKey(name)) || selectedBKeys.has(normalizeNameKey(name)));
}

function buildTeamChecklistOptions(teamKey, names, selectedNames, disabled = false) {
  const role = teamKey === 'A' ? 'team-a-player' : 'team-b-player';

  return names.map((name) => {
    const checked = selectedNames.some((item) => normalizeNameKey(item) === normalizeNameKey(name));
    return `
      <label class="partidas-setup-option">
        <input type="checkbox" data-role="${role}" value="${escapeAttr(name)}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''} />
        <span>${escapeHtml(name)}</span>
      </label>
    `;
  }).join('') || '<p class="partidas-setup-empty">Nenhum atleta disponivel.</p>';
}

function createSetupDraft(record) {
  return {
    teamNameA: getTeamDisplayName(record.teamNameA, 'Time A'),
    teamNameB: getTeamDisplayName(record.teamNameB, 'Time B'),
    teamA: Array.isArray(record.teamA) ? [...record.teamA] : [],
    teamB: Array.isArray(record.teamB) ? [...record.teamB] : []
  };
}

function getSetupDraft() {
  if (setupDraft) {
    return setupDraft;
  }

  setupDraft = createSetupDraft(recordCache || {});
  return setupDraft;
}

function syncTeamNameInputs() {
  const draft = getSetupDraft();
  const teamNameAInput = document.getElementById('team-name-a');
  const teamNameBInput = document.getElementById('team-name-b');

  if (teamNameAInput) {
    draft.teamNameA = String(teamNameAInput.value || '').trim() || 'Time A';
  }

  if (teamNameBInput) {
    draft.teamNameB = String(teamNameBInput.value || '').trim() || 'Time B';
  }
}

function renderTeamChecklist(teamKey, names, selectedNames, disabled = false) {
  const title = teamKey === 'A' ? 'Atletas do Time A' : 'Atletas do Time B';
  const summary = buildSetupSummary(selectedNames);
  const isOpen = isSetupPickerOpen(teamKey);

  return `
    <details class="partidas-setup-picker" data-role="setup-picker" data-team="${teamKey}" ${isOpen ? 'open' : ''}>
      <summary>${title} <span class="partidas-setup-summary">${escapeHtml(summary)}</span></summary>
      <div class="partidas-setup-options">${buildTeamChecklistOptions(teamKey, names, selectedNames, disabled)}</div>
    </details>
  `;
}

function updateSetupPickerSummary(teamKey) {
  const picker = rootEl.querySelector(`details[data-role="setup-picker"][data-team="${teamKey}"]`);
  if (!picker) {
    return;
  }

  const summaryEl = picker.querySelector('.partidas-setup-summary');
  const draft = getSetupDraft();
  const selectedNames = teamKey === 'A' ? draft.teamA : draft.teamB;

  if (summaryEl) {
    summaryEl.textContent = buildSetupSummary(selectedNames);
  }
}

function refreshTeamPickerUI(teamKey) {
  const draft = getSetupDraft();
  const picker = rootEl.querySelector(`details[data-role="setup-picker"][data-team="${teamKey}"]`);
  if (!picker) {
    return;
  }

  const summaryEl = picker.querySelector('.partidas-setup-summary');
  const optionsEl = picker.querySelector('.partidas-setup-options');
  const selectedNames = teamKey === 'A' ? draft.teamA : draft.teamB;
  const names = getAvailableNamesForTeam(teamKey);

  if (summaryEl) {
    summaryEl.textContent = buildSetupSummary(selectedNames);
  }

  if (optionsEl) {
    optionsEl.innerHTML = buildTeamChecklistOptions(teamKey, names, selectedNames, !getIsLoggedIn());
  }

  picker.open = isSetupPickerOpen(teamKey);
}

function refreshSetupPickers() {
  refreshTeamPickerUI('A');
  refreshTeamPickerUI('B');
}

function closeAllSetupPickers() {
  rootEl.querySelectorAll('details[data-role="setup-picker"][open]').forEach((picker) => {
    if (!(picker instanceof HTMLDetailsElement)) {
      return;
    }

    picker.open = false;
    setSetupPickerOpen(picker.dataset.team, false);
  });
}

function renderCurrentTeams(record) {
  if (record.matchStatus !== 'started') {
    return '';
  }

  const teamA = Array.isArray(record.teamA) ? record.teamA : [];
  const teamB = Array.isArray(record.teamB) ? record.teamB : [];
  const teamNameA = getTeamDisplayName(record.teamNameA, 'Time A');
  const teamNameB = getTeamDisplayName(record.teamNameB, 'Time B');

  return `
    <div class="confirmados-teams partida-current-teams">
      <div class="confirmados-team-card">
        <h4>${escapeHtml(teamNameA)} (${teamA.length})</h4>
        <ul class="confirmados-team-list">
          ${teamA.map((name) => `<li><span>${escapeHtml(name)}</span></li>`).join('') || '<li><span>Sem atletas</span></li>'}
        </ul>
      </div>
      <div class="confirmados-team-card">
        <h4>${escapeHtml(teamNameB)} (${teamB.length})</h4>
        <ul class="confirmados-team-list">
          ${teamB.map((name) => `<li><span>${escapeHtml(name)}</span></li>`).join('') || '<li><span>Sem atletas</span></li>'}
        </ul>
      </div>
    </div>
  `;
}

function renderSetupForm(record) {
  const draft = getSetupDraft();
  const isLoggedIn = getIsLoggedIn();
  const allNames = Array.isArray(record.names) ? record.names : [];
  const teamAKeys = new Set(draft.teamA.map((name) => normalizeNameKey(name)));
  const teamBKeys = new Set(draft.teamB.map((name) => normalizeNameKey(name)));
  const availableForA = allNames.filter((name) => !teamBKeys.has(normalizeNameKey(name)) || teamAKeys.has(normalizeNameKey(name)));
  const availableForB = allNames.filter((name) => !teamAKeys.has(normalizeNameKey(name)) || teamBKeys.has(normalizeNameKey(name)));
  const submitLabel = record.matchStatus === 'started' ? 'Salvar configuracao' : 'Iniciar partida';

  return `
    <form id="match-setup-form" class="partidas-setup-panel" autocomplete="off">
      <p class="partidas-setup-copy">Escolha os nomes dos times e selecione os atletas da partida.</p>
      <div class="partidas-setup-grid">
        <label class="confirmados-field">
          Nome do Time A
          <input id="team-name-a" type="text" maxlength="40" value="${escapeAttr(draft.teamNameA)}" placeholder="Time A" required autocomplete="off" autocorrect="off" autocapitalize="words" spellcheck="false" ${isLoggedIn ? '' : 'disabled'} />
        </label>
        ${renderTeamChecklist('A', availableForA, draft.teamA, !isLoggedIn)}
        <label class="confirmados-field">
          Nome do Time B
          <input id="team-name-b" type="text" maxlength="40" value="${escapeAttr(draft.teamNameB)}" placeholder="Time B" required autocomplete="off" autocorrect="off" autocapitalize="words" spellcheck="false" ${isLoggedIn ? '' : 'disabled'} />
        </label>
        ${renderTeamChecklist('B', availableForB, draft.teamB, !isLoggedIn)}
      </div>
      <div class="partidas-setup-actions">
        ${isLoggedIn
          ? `<button class="btn" type="submit">${submitLabel}</button>`
          : '<span class="partidas-status-helper">Faca login no cadastro para salvar a partida.</span>'}
      </div>
    </form>
  `;
}

function renderPage() {
  if (!currentDate) {
    rootEl.innerHTML = '<section class="card"><p>Informe a data da partida para continuar.</p></section>';
    setStatus('Data da partida ausente na URL.', true);
    return;
  }

  if (!recordCache) {
    rootEl.innerHTML = '<section class="card"><p>Partida nao encontrada para a data informada.</p></section>';
    return;
  }

  const matchStatus = String(recordCache.matchStatus || 'not-started');
  const confirmadosCount = Number(recordCache.count || 0) || (Array.isArray(recordCache.names) ? recordCache.names.length : 0);

  rootEl.innerHTML = `
    <section class="card partida-summary-card">
      <div class="partida-summary-grid">
        <div>
          <h2>${formatDate(recordCache.date)}</h2>
          <p class="partida-summary-copy">${confirmadosCount} confirmados para esta data.</p>
        </div>
        <div class="partida-summary-side">
          <span class="partidas-status-badge ${getMatchStatusClassName(matchStatus)}">${getMatchStatusLabel(matchStatus)}</span>
        </div>
      </div>
    </section>

    <section class="card partida-page-stack">
      <h2>${matchStatus === 'started' ? 'Editar Partida' : 'Criar Partida'}</h2>
      ${renderSetupForm(recordCache)}
      ${renderCurrentTeams(recordCache)}
    </section>
  `;
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
  if (!response.ok) {
    throw new Error(data.error || 'Erro na requisicao.');
  }

  return data;
}

async function loadRecord() {
  if (!currentDate) {
    renderPage();
    return;
  }

  const data = await request(buildApiUrl({ date: currentDate }));
  recordCache = Array.isArray(data.records) ? data.records[0] || null : null;
  if (!setupDraft && recordCache) {
    setupDraft = createSetupDraft(recordCache);
  }
  renderPage();
}

rootEl.addEventListener('input', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || !setupDraft) {
    return;
  }

  if (target.id === 'team-name-a') {
    setupDraft.teamNameA = String(target.value || '').trim() || 'Time A';
    return;
  }

  if (target.id === 'team-name-b') {
    setupDraft.teamNameB = String(target.value || '').trim() || 'Time B';
  }
});

rootEl.addEventListener('change', (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement) || !setupDraft) {
    return;
  }

  if (target.matches('input[data-role="team-a-player"]')) {
    const name = String(target.value || '').trim();
    const key = normalizeNameKey(name);
    setupDraft.teamA = target.checked
      ? [...setupDraft.teamA.filter((item) => normalizeNameKey(item) !== key), name]
      : setupDraft.teamA.filter((item) => normalizeNameKey(item) !== key);
    setupDraft.teamB = setupDraft.teamB.filter((item) => normalizeNameKey(item) !== key);
    updateSetupPickerSummary('A');
    updateSetupPickerSummary('B');
    return;
  }

  if (target.matches('input[data-role="team-b-player"]')) {
    const name = String(target.value || '').trim();
    const key = normalizeNameKey(name);
    setupDraft.teamB = target.checked
      ? [...setupDraft.teamB.filter((item) => normalizeNameKey(item) !== key), name]
      : setupDraft.teamB.filter((item) => normalizeNameKey(item) !== key);
    setupDraft.teamA = setupDraft.teamA.filter((item) => normalizeNameKey(item) !== key);
    updateSetupPickerSummary('A');
    updateSetupPickerSummary('B');
  }
});

rootEl.addEventListener('toggle', (event) => {
  const picker = event.target;
  if (!(picker instanceof HTMLDetailsElement) || !picker.matches('details[data-role="setup-picker"][data-team]')) {
    return;
  }

  setSetupPickerOpen(picker.dataset.team, picker.open);
  if (!picker.open) {
    refreshSetupPickers();
  }
});

document.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Element)) {
    return;
  }

  if (target.closest('.partidas-setup-picker')) {
    return;
  }

  closeAllSetupPickers();
});

rootEl.addEventListener('submit', async (event) => {
  const form = event.target.closest('#match-setup-form');
  if (!form) {
    return;
  }

  event.preventDefault();

  if (!getIsLoggedIn()) {
    setStatus('Faca login no cadastro para salvar a partida.', true);
    return;
  }

  syncTeamNameInputs();

  try {
    await request(buildApiUrl(), {
      method: 'PUT',
      body: JSON.stringify({
        action: 'start-match',
        date: currentDate,
        teamNameA: setupDraft.teamNameA,
        teamNameB: setupDraft.teamNameB,
        teamA: setupDraft.teamA,
        teamB: setupDraft.teamB
      })
    });

    setupDraft = null;
    setSetupPickerOpen('A', false);
    setSetupPickerOpen('B', false);
    await loadRecord();
    localStorage.setItem(
      PARTIDAS_UPDATE_KEY,
      JSON.stringify({ ts: Date.now(), group: GROUP_VALUE || '', date: currentDate, action: 'start-match' })
    );
    setStatus('Partida salva com sucesso.');
  } catch (error) {
    setStatus(error.message || 'Erro ao salvar partida.', true);
  }
});

window.addEventListener('storage', (event) => {
  if (event.key === PARTIDAS_UPDATE_KEY && event.newValue) {
    try {
      const payload = JSON.parse(event.newValue);
      if (String(payload.group || '') === GROUP_VALUE && String(payload.date || '') === currentDate) {
        setupDraft = null;
        loadRecord().catch((error) => {
          setStatus(error.message, true);
        });
      }
    } catch {
      // Ignore malformed payloads.
    }
  }

  updateCornerAuthButton();
});

updateCornerAuthButton();
loadRecord().then(() => {
  if (!statusEl.textContent) {
    setStatus('Partida carregada.');
  }
}).catch((error) => {
  setStatus(error.message, true);
});