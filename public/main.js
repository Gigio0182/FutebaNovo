const state = {
  athletes: [],
  matches: []
};

const TOKEN_KEY = 'app_futeba_token';

const athleteForm = document.getElementById('athlete-form');
const matchForm = document.getElementById('match-form');
const eventForm = document.getElementById('event-form');
const participantsList = document.getElementById('participants-list');
const eventMatch = document.getElementById('event-match');
const eventAthlete = document.getElementById('event-athlete');
const matchesView = document.getElementById('matches-view');
const statusEl = document.getElementById('status');
const loginForm = document.getElementById('login-form');
const logoutBtn = document.getElementById('logout-btn');

function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

function saveToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle('error', isError);
}

async function request(url, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    headers,
    ...options
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Falha na requisicao.');
  }

  return data;
}

function renderParticipants() {
  participantsList.innerHTML = '';

  if (!state.athletes.length) {
    participantsList.innerHTML = '<p>Cadastre atletas primeiro.</p>';
    return;
  }

  state.athletes.forEach((athlete) => {
    const label = document.createElement('label');
    label.className = 'check-item';
    label.innerHTML = `
      <input type="checkbox" value="${athlete.id}" />
      <span>${athlete.name}</span>
    `;
    participantsList.appendChild(label);
  });
}

function renderSelectors() {
  eventMatch.innerHTML = state.matches
    .map(
      (match) =>
        `<option value="${match.id}">${match.date} ${
          match.opponent ? `- ${match.opponent}` : ''
        }</option>`
    )
    .join('');

  eventAthlete.innerHTML = state.athletes
    .map((athlete) => `<option value="${athlete.id}">${athlete.name}</option>`)
    .join('');
}

function renderMatches() {
  matchesView.innerHTML = state.matches
    .map((match) => {
      const participants = Array.isArray(match.participantIds)
        ? match.participantIds.length
        : 0;
      const opponent = match.opponent ? ` x ${match.opponent}` : '';
      return `<li>${match.date}${opponent} | participantes: ${participants}</li>`;
    })
    .join('');
}

async function loadInitialData() {
  const [athletesData, matchesData] = await Promise.all([
    request('/api/athletes'),
    request('/api/matches')
  ]);

  state.athletes = athletesData.athletes || [];
  state.matches = matchesData.matches || [];

  renderParticipants();
  renderSelectors();
  renderMatches();
}

async function loginWithPassword(password) {
  const response = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password })
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Falha no login.');
  }

  saveToken(data.token);
}

athleteForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  try {
    const name = document.getElementById('athlete-name').value;
    await request('/api/athletes', {
      method: 'POST',
      body: JSON.stringify({ name })
    });

    athleteForm.reset();
    await loadInitialData();
    setStatus('Atleta cadastrado com sucesso.');
  } catch (error) {
    setStatus(error.message, true);
  }
});

matchForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  try {
    const participantIds = Array.from(
      participantsList.querySelectorAll('input[type="checkbox"]:checked')
    ).map((input) => input.value);

    await request('/api/matches', {
      method: 'POST',
      body: JSON.stringify({
        date: document.getElementById('match-date').value,
        opponent: document.getElementById('match-opponent').value,
        notes: document.getElementById('match-notes').value,
        participantIds
      })
    });

    matchForm.reset();
    await loadInitialData();
    setStatus('Jogo cadastrado com sucesso.');
  } catch (error) {
    setStatus(error.message, true);
  }
});

eventForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  try {
    await request('/api/events', {
      method: 'POST',
      body: JSON.stringify({
        matchId: document.getElementById('event-match').value,
        athleteId: document.getElementById('event-athlete').value,
        type: document.getElementById('event-type').value,
        minute: document.getElementById('event-minute').value
      })
    });

    eventForm.reset();
    setStatus('Evento registrado com sucesso.');
  } catch (error) {
    setStatus(error.message, true);
  }
});

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  try {
    const password = document.getElementById('admin-password').value;
    await loginWithPassword(password);
    document.getElementById('admin-password').value = '';
    await loadInitialData();
    setStatus('Login realizado.');
  } catch (error) {
    setStatus(error.message, true);
  }
});

logoutBtn.addEventListener('click', () => {
  clearToken();
  setStatus('Sessao encerrada.');
});

if (getToken()) {
  loadInitialData().catch((error) => setStatus(error.message, true));
} else {
  setStatus('Faca login para carregar os dados.');
}
