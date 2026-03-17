const TOKEN_KEY = 'app_futeba_token';
const loginForm = document.getElementById('login-form');
const statusEl = document.getElementById('status');
const passwordInput = document.getElementById('admin-password');

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle('error', isError);
}

if (localStorage.getItem(TOKEN_KEY)) {
  window.location.href = '/athletes';
}

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

    localStorage.setItem(TOKEN_KEY, data.token);
    setStatus('Login realizado. Redirecionando...');
    window.location.href = '/athletes';
  } catch (error) {
    setStatus(error.message, true);
  }
});
