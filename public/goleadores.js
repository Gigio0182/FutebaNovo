const body = document.getElementById('ranking-body');
const statusEl = document.getElementById('status');

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle('error', isError);
}

async function loadBoard() {
  try {
    const response = await fetch('/api/ranking');
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Erro ao carregar goleadores.');
    }

    const rows = (data.ranking || []).sort((a, b) => {
      if (b.goals !== a.goals) return b.goals - a.goals;
      return a.name.localeCompare(b.name, 'pt-BR');
    });

    let lastGoals = null;
    let currentPosition = 0;

    body.innerHTML = rows
      .map((row, index) => {
        if (row.goals !== lastGoals) {
          currentPosition = index + 1;
          lastGoals = row.goals;
        }

        let medalClass = '';
        if (currentPosition === 1) medalClass = 'row-gold';
        if (currentPosition === 2) medalClass = 'row-silver';
        if (currentPosition === 3) medalClass = 'row-bronze';

        return `
          <tr class="${medalClass}">
            <td>${currentPosition}</td>
            <td>${row.name}</td>
            <td>${row.goals}</td>
          </tr>
        `;
      })
      .join('');

    if (!rows.length) {
      setStatus('Ainda nao ha dados de goleadores.');
      return;
    }

    setStatus('Lista de goleadores atualizada.');
  } catch (error) {
    setStatus(error.message, true);
  }
}

loadBoard();
