const rankingList = document.getElementById('ranking-list');
const statusEl = document.getElementById('status');
const onlyWithAssists = document.getElementById('only-with-assists');

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle('error', isError);
}

async function loadBoard() {
  try {
    const response = await fetch('/api/ranking?group=domingo');
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Erro ao carregar garcons.');
    }

    const rows = (data.ranking || []).sort((a, b) => {
      if (b.assists !== a.assists) return b.assists - a.assists;
      return a.name.localeCompare(b.name, 'pt-BR');
    });

    const filteredRows = onlyWithAssists.checked
      ? rows.filter((row) => Number(row.assists || 0) > 0)
      : rows;

    rankingList.innerHTML = filteredRows
      .map((row, index) => {
        const currentPosition = index + 1;

        let medalClass = '';
        if (currentPosition === 1) medalClass = 'row-gold';
        if (currentPosition === 2) medalClass = 'row-silver';
        if (currentPosition === 3) medalClass = 'row-bronze';

        return `
          <article class="ranking-item ${medalClass}">
            <div class="rank-head">
              <span class="rank-pos">${currentPosition}</span>
              <div class="rank-name-meta">
                <h3>${row.name}</h3>
                <span class="stat-pill stat-assists">Assistencias: <strong>${row.assists}</strong></span>
              </div>
            </div>
          </article>
        `;
      })
      .join('');

    if (!filteredRows.length) {
      rankingList.innerHTML = '<p>Nenhum atleta para o filtro atual.</p>';
      setStatus('Ainda nao ha dados de garcons.');
      return;
    }

    setStatus('Lista de garcons atualizada.');
  } catch (error) {
    setStatus(error.message, true);
  }
}

onlyWithAssists.addEventListener('change', loadBoard);

loadBoard();
