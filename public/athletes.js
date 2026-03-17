const athleteForm = document.getElementById('athlete-form');
const athleteNameInput = document.getElementById('athlete-name');
const athletesList = document.getElementById('athletes-list');
const statusEl = document.getElementById('status');
const logoutBtn = document.getElementById('logout-btn');
const TOKEN_KEY = 'app_futeba_token';

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle('error', isError);
}

function redirectToLogin() {
  window.location.href = '/';
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
    .map(
      (athlete) => `
      <article class="athlete-item">
        <h3>${athlete.name}</h3>
        <div class="metrics-grid">
          ${metricCard(athlete, 'goals', 'Gols')}
          ${metricCard(athlete, 'assists', 'Assistencias')}
          ${metricCard(athlete, 'games', 'Jogos')}
          ${metricCard(athlete, 'mvp', 'MVP')}
          ${metricCard(athlete, 'worst', 'Pior em campo')}
        </div>
      </article>
    `
    )
    .join('');
}

async function loadAthletes() {
  const data = await request('/api/athletes');
  renderAthletes(data.athletes || []);
}

athleteForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  try {
    await request('/api/athletes', {
      method: 'POST',
      body: JSON.stringify({ name: athleteNameInput.value })
    });

    athleteForm.reset();
    await loadAthletes();
    setStatus('Atleta cadastrado com sucesso.');
  } catch (error) {
    setStatus(error.message, true);
  }
});

athletesList.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-id][data-field]');
  if (!button) {
    return;
  }

  try {
    await request('/api/athletes', {
      method: 'PUT',
      body: JSON.stringify({
        id: button.dataset.id,
        field: button.dataset.field,
        delta: Number(button.dataset.delta || 1)
      })
    });

    await loadAthletes();
    setStatus('Estatistica atualizada.');
  } catch (error) {
    setStatus(error.message, true);
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

loadAthletes().catch((error) => setStatus(error.message, true));
