const athleteForm = document.getElementById('athlete-form');
const athleteNameInput = document.getElementById('athlete-name');
const athletesBody = document.getElementById('athletes-body');
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
    athletesBody.innerHTML = '<tr><td colspan="4">Nenhum atleta cadastrado.</td></tr>';
    return;
  }

  athletesBody.innerHTML = athletes
    .map(
      (athlete) => `
      <tr>
        <td>${athlete.name}</td>
        <td>
          ${Number(athlete.goals || 0)}
          <button class="mini-btn" data-id="${athlete.id}" data-field="goals" type="button">+1</button>
        </td>
        <td>
          ${Number(athlete.assists || 0)}
          <button class="mini-btn" data-id="${athlete.id}" data-field="assists" type="button">+1</button>
        </td>
        <td>
          ${Number(athlete.games || 0)}
          <button class="mini-btn" data-id="${athlete.id}" data-field="games" type="button">+1</button>
        </td>
      </tr>
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

athletesBody.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-id][data-field]');
  if (!button) {
    return;
  }

  try {
    await request('/api/athletes', {
      method: 'PUT',
      body: JSON.stringify({
        id: button.dataset.id,
        field: button.dataset.field
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
