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
      throw new Error(data.error || 'Erro ao carregar garcons.');
    }

    const rows = (data.ranking || []).sort((a, b) => {
      if (b.assists !== a.assists) return b.assists - a.assists;
      return a.name.localeCompare(b.name, 'pt-BR');
    });

    let lastAssists = null;
    let currentPosition = 0;

    body.innerHTML = rows
      .map((row, index) => {
        if (row.assists !== lastAssists) {
          currentPosition = index + 1;
          lastAssists = row.assists;
        }

        let medalClass = '';
        if (currentPosition === 1) medalClass = 'row-gold';
        if (currentPosition === 2) medalClass = 'row-silver';
        if (currentPosition === 3) medalClass = 'row-bronze';

        return `
          <tr class="${medalClass}">
            <td>${currentPosition}</td>
            <td>${row.name}</td>
            <td>${row.assists}</td>
          </tr>
        `;
      })
      .join('');

    if (!rows.length) {
      setStatus('Ainda nao ha dados de garcons.');
      return;
    }

    setStatus('Lista de garcons atualizada.');
  } catch (error) {
    setStatus(error.message, true);
  }
}

loadBoard();
