const confirmadosForm = document.getElementById('confirmados-form');
const matchDateInput = document.getElementById('match-date');
const confirmedNamesInput = document.getElementById('confirmed-names');
const confirmadosListEl = document.getElementById('confirmados-list');
const statusEl = document.getElementById('status');
const TOKEN_KEY = document.body.dataset.group === 'domingo'
  ? 'app_futeba_domingo_token'
  : 'app_futeba_token';
const GROUP_QUERY = document.body.dataset.group ? `?group=${encodeURIComponent(document.body.dataset.group)}` : '';

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle('error', isError);
}

function normalizeNames(text) {
  return Array.from(
    new Set(
      String(text || '')
        .split(/\r?\n/)
        .map((line) => line.replace(/^\s*[-*\d.)]+\s*/, '').trim())
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
          <span class="confirmados-count">${record.count} confirmados</span>
        </div>
        <ul class="confirmados-names">
          ${(record.names || []).map((name) => `<li>${name}</li>`).join('')}
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
  const data = await request(`/api/confirmados${GROUP_QUERY}`);
  renderRecords(data.records || []);
}

function setDefaultDate() {
  const now = new Date();
  const localIso = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
  matchDateInput.value = localIso;
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

    await request(`/api/confirmados${GROUP_QUERY}`, {
      method: 'POST',
      body: JSON.stringify({ date, names })
    });

    confirmedNamesInput.value = '';
    await loadRecords();
    setStatus('Lista de confirmados salva com sucesso.');
  } catch (error) {
    setStatus(error.message, true);
  }
});

setDefaultDate();
loadRecords().then(() => {
  setStatus('Listas carregadas.');
}).catch((error) => {
  setStatus(error.message, true);
});
