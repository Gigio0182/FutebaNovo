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
let recordsCache = [];

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
          const match = String(line || '').match(/^\s*\d+\s*-\s*(.+)$/);
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

function renderRecords(records) {
  if (!records.length) {
    confirmadosListEl.innerHTML = '<p>Nenhuma lista salva ainda.</p>';
    return;
  }

  confirmadosListEl.innerHTML = records
    .map((record) => `
      <article class="confirmados-item">
        <div class="confirmados-item-head">
          <h3>${formatDate(record.date)}</h3>
          <div class="confirmados-head-right">
            <span class="confirmados-count">${record.count} confirmados</span>
            <div class="confirmados-actions">
              <button class="confirmados-action-btn" type="button" data-action="edit-record" data-date="${record.date}">Editar</button>
              <button class="confirmados-action-btn danger" type="button" data-action="delete-record" data-date="${record.date}">Remover</button>
            </div>
          </div>
        </div>
        <ul class="confirmados-names">
          ${(record.names || []).map((name) => `<li>${escapeHtml(name)}</li>`).join('')}
        </ul>
      </article>
    `)
    .join('');
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
loadRecords().then(() => {
  setStatus('Listas carregadas.');
}).catch((error) => {
  setStatus(error.message, true);
});
