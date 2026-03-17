const body = document.getElementById('ranking-body');
const statusEl = document.getElementById('status');

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle('error', isError);
}

async function loadRanking() {
  try {
    const response = await fetch('/api/ranking');
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

loadRanking();
