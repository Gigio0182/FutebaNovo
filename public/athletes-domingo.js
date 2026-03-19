const athleteForm = document.getElementById('athlete-form');
const athleteNameInput = document.getElementById('athlete-name');
const athleteSearchInput = document.getElementById('athlete-search');
const athletesList = document.getElementById('athletes-list');
const statusEl = document.getElementById('status');
const logoutBtn = document.getElementById('logout-btn');
const syncStateEl = document.getElementById('sync-state');
const TOKEN_KEY = 'app_futeba_domingo_token';
const QUEUE_KEY = 'app_futeba_domingo_offline_queue';
const CACHE_KEY = 'app_futeba_domingo_athletes_cache';
let athletesCache = [];
let syncInProgress = false;
let editingNameAthleteId = null;

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

function redirectToLogin() {
  window.location.href = '/domingo';
}

function loadQueue() {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
  } catch (error) {
    return [];
  }
}

function saveQueue(queue) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  updateSyncState();
}

function saveAthletesCache() {
  localStorage.setItem(CACHE_KEY, JSON.stringify(athletesCache));
}

function loadAthletesCache() {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || '[]');
  } catch (error) {
    return [];
  }
}

function updateSyncState(customText) {
  if (customText) {
    syncStateEl.textContent = customText;
    return;
  }

  const queueCount = loadQueue().length;
  if (!navigator.onLine) {
    syncStateEl.textContent = `Offline${queueCount ? ` | pendencias: ${queueCount}` : ''}`;
    return;
  }

  if (syncInProgress) {
    syncStateEl.textContent = 'Sincronizando...';
    return;
  }

  syncStateEl.textContent = queueCount ? `Pendencias: ${queueCount}` : 'Sincronizado';
}

function enqueueAction(action) {
  const queue = loadQueue();
  queue.push({ ...action, queuedAt: Date.now() });
  saveQueue(queue);
}

function adjustMetricLocal(athleteId, field, delta) {
  athletesCache = athletesCache.map((athlete) => {
    if (athlete.id !== athleteId) {
      return athlete;
    }

    const current = Number(athlete[field] || 0);
    return {
      ...athlete,
      [field]: Math.max(0, current + delta)
    };
  });

  saveAthletesCache();
  applySearchFilter();
}

function renameAthleteLocal(athleteId, name) {
  athletesCache = athletesCache.map((athlete) =>
    athlete.id === athleteId
      ? {
          ...athlete,
          name
        }
      : athlete
  );

  athletesCache.sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR'));
  saveAthletesCache();
  applySearchFilter();
}

async function commitNameEdit(athleteId, rawName) {
  const athlete = athletesCache.find((item) => item.id === athleteId);
  editingNameAthleteId = null;

  if (!athlete) {
    applySearchFilter();
    return;
  }

  const nextName = String(rawName || '').trim();
  const currentName = String(athlete.name || '').trim();

  if (!nextName || nextName === currentName) {
    applySearchFilter();
    return;
  }

  renameAthleteLocal(athleteId, nextName);

  if (!navigator.onLine) {
    enqueueAction({ type: 'rename-athlete', id: athleteId, name: nextName });
    setStatus('Nome alterado offline. Sera sincronizado automaticamente.');
    applySearchFilter();
    return;
  }

  try {
    await request('/api/athletes?group=domingo', {
      method: 'PUT',
      body: JSON.stringify({ id: athleteId, name: nextName })
    });
    await loadAthletes(true);
    setStatus('Nome atualizado com sucesso.');
  } catch (error) {
    await loadAthletes(true);
    setStatus(error.message, true);
  }

  applySearchFilter();
}

function addLocalAthlete(name, localId) {
  athletesCache.push({
    id: localId,
    name,
    goals: 0,
    assists: 0,
    games: 0,
    mvp: 0,
    worst: 0,
    pending: true
  });

  athletesCache.sort((a, b) => String(a.name).localeCompare(String(b.name), 'pt-BR'));
  saveAthletesCache();
  applySearchFilter();
}

function removeAthleteLocal(athleteId) {
  athletesCache = athletesCache.filter((athlete) => athlete.id !== athleteId);
  if (editingNameAthleteId === athleteId) {
    editingNameAthleteId = null;
  }
  saveAthletesCache();
  applySearchFilter();
}

function replaceAthleteId(oldId, newAthlete) {
  athletesCache = athletesCache.map((athlete) =>
    athlete.id === oldId
      ? {
          ...athlete,
          id: newAthlete.id,
          pending: false
        }
      : athlete
  );
  saveAthletesCache();
}

async function flushQueue() {
  if (!navigator.onLine || syncInProgress) {
    return;
  }

  const queue = loadQueue();
  if (!queue.length) {
    updateSyncState();
    return;
  }

  syncInProgress = true;
  updateSyncState();

  const remaining = [...queue];

  try {
    while (remaining.length) {
      const action = remaining[0];

      if (action.type === 'create-athlete') {
        const data = await request('/api/athletes?group=domingo', {
          method: 'POST',
          body: JSON.stringify({ name: action.name })
        });

        if (data.athlete && action.localId) {
          replaceAthleteId(action.localId, data.athlete);
          for (let i = 1; i < remaining.length; i += 1) {
            if (remaining[i].id === action.localId) {
              remaining[i].id = data.athlete.id;
            }
          }
        }
      }

      if (action.type === 'adjust-metric') {
        await request('/api/athletes?group=domingo', {
          method: 'PUT',
          body: JSON.stringify({
            id: action.id,
            field: action.field,
            delta: action.delta
          })
        });
      }

      if (action.type === 'rename-athlete') {
        await request('/api/athletes?group=domingo', {
          method: 'PUT',
          body: JSON.stringify({
            id: action.id,
            name: action.name
          })
        });
      }

      if (action.type === 'delete-athlete') {
        await request('/api/athletes?group=domingo', {
          method: 'DELETE',
          body: JSON.stringify({ id: action.id })
        });
      }

      remaining.shift();
      saveQueue(remaining);
    }

    await loadAthletes(true);
    setStatus('Pendencias sincronizadas com sucesso.');
  } catch (error) {
    setStatus('Ainda existem pendencias offline. Elas serao reenviadas quando voltar conexao.');
  } finally {
    syncInProgress = false;
    updateSyncState();
  }
}

async function request(url, options = {}) {
  const token = localStorage.getItem(TOKEN_KEY) || '';

  const response = await fetch(url, {
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    },
    ...options
  });

  const data = await response.json();
  if (response.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
    redirectToLogin();
    throw new Error('Sessao expirada.');
  }

  if (!response.ok) {
    throw new Error(data.error || 'Erro na requisicao.');
  }

  return data;
}

function renderAthletes(athletes) {
  if (!athletes.length) {
    athletesList.innerHTML = '<p>Nenhum atleta cadastrado.</p>';
    return;
  }

  const metricCard = (athlete, field, label) => {
    const value = Number(athlete[field] || 0);
    const minusDisabled = value <= 0 ? 'disabled' : '';

    return `
      <div class="metric-card">
        <span class="metric-title">${label}</span>
        <div class="metric-cell">
          <span class="metric-value">${value}</span>
          <div class="metric-actions">
            <button class="metric-btn metric-btn-minus" data-id="${athlete.id}" data-field="${field}" data-delta="-1" type="button" ${minusDisabled}>-</button>
            <button class="metric-btn" data-id="${athlete.id}" data-field="${field}" data-delta="1" type="button">+</button>
          </div>
        </div>
      </div>
    `;
  };

  athletesList.innerHTML = athletes
    .map((athlete) => {
      const editingName = editingNameAthleteId === athlete.id;
      return `
      <article class="athlete-item ${athlete.pending ? 'pending' : ''}">
        <div class="athlete-header-row">
          <span class="athlete-summary-name" data-action="edit-name" data-id="${athlete.id}" style="flex:1;cursor:pointer;font-weight:700;${editingName ? 'display:none;' : ''}">${escapeAttr(athlete.name)}</span>
          <form class="athlete-edit-name-form" data-id="${athlete.id}" style="display:${editingName ? 'flex' : 'none'};align-items:center;flex:1;" onsubmit="return false;">
            <input class="name-edit-input" data-edit-name-for="${athlete.id}" value="${escapeAttr(athlete.name)}" maxlength="60" style="width:140px;" />
          </form>
        </div>
        <div class="metrics-grid">
          ${metricCard(athlete, 'goals', 'Gols')}
          ${metricCard(athlete, 'assists', 'Assistencias')}
          ${metricCard(athlete, 'games', 'Jogos')}
          ${metricCard(athlete, 'mvp', 'MVP')}
          ${metricCard(athlete, 'worst', 'Pior em campo')}
        </div>
        <div class="athlete-danger-row">
          <button class="delete-athlete-btn" type="button" data-action="delete-athlete" data-id="${athlete.id}">Remover atleta</button>
        </div>
      </article>
    `;
    })
    .join('');
}

function applySearchFilter() {
  const term = (athleteSearchInput.value || '').trim().toLowerCase();
  const filtered = !term
    ? athletesCache
    : athletesCache.filter((athlete) =>
        String(athlete.name || '').toLowerCase().includes(term)
      );

  renderAthletes(filtered);
}

async function loadAthletes(quiet = false) {
  if (!navigator.onLine) {
    if (!quiet) {
      setStatus('Sem conexao. Exibindo dados salvos localmente.');
    }
    athletesCache = loadAthletesCache();
    applySearchFilter();
    updateSyncState();
    return;
  }

  const data = await request('/api/athletes?group=domingo');
  athletesCache = data.athletes || [];
  saveAthletesCache();
  applySearchFilter();
  updateSyncState();
}

athleteForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  try {
    const name = athleteNameInput.value.trim();
    if (!name) {
      setStatus('Nome do atleta e obrigatorio.', true);
      return;
    }

    if (!navigator.onLine) {
      const localId = `local-${Date.now()}`;
      addLocalAthlete(name, localId);
      enqueueAction({ type: 'create-athlete', name, localId });
      setStatus('Atleta salvo offline. Sera sincronizado quando houver conexao.');
    } else {
      await request('/api/athletes?group=domingo', {
        method: 'POST',
        body: JSON.stringify({ name })
      });
      await loadAthletes(true);
      setStatus('Atleta cadastrado com sucesso.');
    }

    athleteForm.reset();
  } catch (error) {
    setStatus(error.message, true);
  }
});

athletesList.addEventListener('click', async (event) => {
  const nameSpan = event.target.closest('.athlete-summary-name[data-action="edit-name"][data-id]');
  if (nameSpan) {
    editingNameAthleteId = nameSpan.dataset.id;
    applySearchFilter();
    setTimeout(() => {
      const input = athletesList.querySelector(`input[data-edit-name-for="${editingNameAthleteId}"]`);
      if (input) {
        input.focus();
        input.select();
      }
    }, 0);
    return;
  }

  const deleteButton = event.target.closest('button[data-action="delete-athlete"][data-id]');
  if (deleteButton) {
    const athleteId = deleteButton.dataset.id;
    const athlete = athletesCache.find((item) => item.id === athleteId);
    if (!athlete) {
      return;
    }

    const confirmed = window.confirm(`Remover atleta ${athlete.name}?`);
    if (!confirmed) {
      return;
    }

    removeAthleteLocal(athleteId);

    if (!navigator.onLine) {
      enqueueAction({ type: 'delete-athlete', id: athleteId });
      setStatus('Remocao salva offline. Sera sincronizada automaticamente.');
      return;
    }

    try {
      await request('/api/athletes?group=domingo', {
        method: 'DELETE',
        body: JSON.stringify({ id: athleteId })
      });
      setStatus('Atleta removido com sucesso.');
    } catch (error) {
      await loadAthletes(true);
      setStatus(error.message, true);
    }
    return;
  }

  const button = event.target.closest('button[data-id][data-field]');
  if (!button) {
    return;
  }

  try {
    const payload = {
      id: button.dataset.id,
      field: button.dataset.field,
      delta: Number(button.dataset.delta || 1)
    };

    adjustMetricLocal(payload.id, payload.field, payload.delta);

    if (!navigator.onLine) {
      enqueueAction({ type: 'adjust-metric', ...payload });
      setStatus('Alteracao salva offline. Sera sincronizada automaticamente.');
      return;
    }

    await request('/api/athletes?group=domingo', {
      method: 'PUT',
      body: JSON.stringify(payload)
    });

    await loadAthletes(true);
    setStatus('Estatistica atualizada.');
  } catch (error) {
    setStatus(error.message, true);
  }
});

athletesList.addEventListener('focusout', async (event) => {
  const input = event.target.closest('input[data-edit-name-for]');
  if (!input) {
    return;
  }

  const athleteId = input.dataset.editNameFor;
  if (!athleteId || editingNameAthleteId !== athleteId) {
    return;
  }

  await commitNameEdit(athleteId, input.value);
});

athletesList.addEventListener('keydown', (event) => {
  const input = event.target.closest('input[data-edit-name-for]');
  if (!input) {
    return;
  }

  if (event.key === 'Enter') {
    event.preventDefault();
    input.blur();
    return;
  }

  if (event.key === 'Escape') {
    event.preventDefault();
    editingNameAthleteId = null;
    applySearchFilter();
  }
});

logoutBtn.addEventListener('click', async () => {
  try {
    await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' });
  } finally {
    localStorage.removeItem(TOKEN_KEY);
    redirectToLogin();
  }
});

athleteSearchInput.addEventListener('input', applySearchFilter);

window.addEventListener('online', () => {
  updateSyncState();
  flushQueue();
});

window.addEventListener('offline', () => {
  updateSyncState();
  setStatus('Sem conexao. Voce pode continuar editando e sincronizar depois.');
});

athletesCache = loadAthletesCache();
applySearchFilter();
updateSyncState();

loadAthletes(true)
  .then(() => flushQueue())
  .catch((error) => {
    setStatus(error.message, true);
    updateSyncState();
  });
