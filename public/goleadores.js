const rankingList = document.getElementById('ranking-list');
const statusEl = document.getElementById('status');
const onlyWithGoals = document.getElementById('only-with-goals');

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

    const filteredRows = onlyWithGoals.checked
      ? rows.filter((row) => Number(row.goals || 0) > 0)
      : rows;

    let lastGoals = null;
    let currentPosition = 0;

    rankingList.innerHTML = filteredRows
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
          <article class="ranking-item ${medalClass}">
            <div class="rank-head">
              <span class="rank-pos">${currentPosition}</span>
              <h3>${row.name}</h3>
            </div>
            <div class="rank-metrics">
              <span class="stat-pill stat-goals">Gols: <strong>${row.goals}</strong></span>
            </div>
          </article>
        `;
      })
      .join('');

    if (!filteredRows.length) {
      rankingList.innerHTML = '<p>Nenhum atleta para o filtro atual.</p>';
      setStatus('Ainda nao ha dados de goleadores.');
      return;
    }

    setStatus('Lista de goleadores atualizada.');
  } catch (error) {
    setStatus(error.message, true);
  }
}

onlyWithGoals.addEventListener('change', loadBoard);

loadBoard();
