const body = document.getElementById('ranking-body');
const statusEl = document.getElementById('status');
const loginForm = document.getElementById('login-form');
const logoutBtn = document.getElementById('logout-btn');
const TOKEN_KEY = 'app_futeba_token';
const passwordInput = document.getElementById('admin-password');
const loginBtn = loginForm.querySelector('button[type="submit"]');
const authIndicator = document.getElementById('auth-indicator');

function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

function saveToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

function updateAuthUi() {
  const loggedIn = Boolean(getToken());
  passwordInput.classList.toggle('hidden', loggedIn);
  loginBtn.classList.toggle('hidden', loggedIn);
  logoutBtn.classList.toggle('hidden', !loggedIn);
  authIndicator.textContent = loggedIn ? 'Logado' : 'Nao logado';
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle('error', isError);
}

async function loadRanking() {
  try {
    const token = getToken();
    const response = await fetch('/api/ranking', {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Erro ao carregar ranking.');
    }

    body.innerHTML = data.ranking
      .map(
        (row, index) => `
          <tr>
            <td>${index + 1}</td>
            <td>${row.name}</td>
            <td>${row.games}</td>
            <td>${row.goals}</td>
            <td>${row.assists}</td>
            <td><strong>${row.points}</strong></td>
          </tr>
        `
      )
      .join('');

    if (!data.ranking.length) {
      setStatus('Ainda nao ha dados para ranking.');
      return;
    }

    setStatus('Ranking atualizado.');
  } catch (error) {
    setStatus(error.message, true);
  }
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
  updateAuthUi();
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const password = passwordInput.value;
    await loginWithPassword(password);
    passwordInput.value = '';
    await loadRanking();
    setStatus('Login realizado.');
  } catch (error) {
    setStatus(error.message, true);
  }
});

logoutBtn.addEventListener('click', () => {
  clearToken();
  updateAuthUi();
  body.innerHTML = '';
  setStatus('Sessao encerrada.');
});

updateAuthUi();

if (getToken()) {
  loadRanking();
} else {
  setStatus('Faca login para ver o ranking.');
}
