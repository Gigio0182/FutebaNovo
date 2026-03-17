const loginForm = document.getElementById('login-form');
const statusEl = document.getElementById('status');
const passwordInput = document.getElementById('admin-password');
const TOKEN_KEY = 'app_futeba_dia2_token';

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle('error', isError);
}

async function hasSession() {
  try {
    const response = await fetch('/api/athletes?group=dia2', { method: 'GET' });
    return response.ok;
  } catch (error) {
    return false;
  }
}

hasSession().then((ok) => {
  if (ok) {
    window.location.href = '/dia2/athletes';
  }
});

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: passwordInput.value })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Falha no login.');
    }

    if (data.token) {
      localStorage.setItem(TOKEN_KEY, data.token);
    }

    setStatus('Login realizado. Redirecionando...');
    window.location.href = '/dia2/athletes';
  } catch (error) {
    setStatus(error.message, true);
  }
});
