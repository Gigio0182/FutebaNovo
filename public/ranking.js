const rankingList = document.getElementById('ranking-list');
const statusEl = document.getElementById('status');
const rankingSearchInput = document.getElementById('ranking-search');
let rankingCache = [];

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

    rankingCache = data.ranking || [];
    renderRanking();

    if (!rankingCache.length) {
      setStatus('Ainda nao ha dados para ranking.');
      return;
    }

    setStatus('Ranking atualizado.');
  } catch (error) {
    setStatus(error.message, true);
  }
}

function renderRanking() {
  const term = (rankingSearchInput.value || '').trim().toLowerCase();
  let lastKey = '';
  let currentPosition = 0;

  const rankedRows = rankingCache.map((row, index) => {
    const key = `${row.goals}|${row.assists}|${row.games}|${row.mvp}|${row.worst}`;
    if (key !== lastKey) {
      currentPosition = index + 1;
      lastKey = key;
    }

    return {
      ...row,
      position: currentPosition
    };
  });

  const rows = !term
    ? rankedRows
    : rankedRows.filter((row) =>
        String(row.name || '').toLowerCase().includes(term)
      );

  if (!rows.length) {
    rankingList.innerHTML = '<p>Nenhum atleta encontrado para a busca.</p>';
    setStatus('Nenhum atleta encontrado para a busca.');
    return;
  }

  rankingList.innerHTML = rows
    .map((row) => {
      const current = row.position;

      let medalClass = '';
      if (current === 1) medalClass = 'row-gold';
      if (current === 2) medalClass = 'row-silver';
      if (current === 3) medalClass = 'row-bronze';

      return `
        <article class="ranking-item ${medalClass}">
          <div class="rank-head">
            <span class="rank-pos">${current}</span>
            <h3>${row.name}</h3>
          </div>
          <div class="rank-metrics">
            <span class="stat-pill stat-games">Jogos: <strong>${row.games}</strong></span>
            <span class="stat-pill stat-goals">Gols: <strong>${row.goals}</strong></span>
            <span class="stat-pill stat-assists">Assistencias: <strong>${row.assists}</strong></span>
            <span class="stat-pill stat-mvp">MVP: <strong>${row.mvp || 0}</strong></span>
            <span class="stat-pill stat-worst">Pior em campo: <strong>${row.worst || 0}</strong></span>
          </div>
        </article>
      `;
    })
    .join('');

  setStatus('Ranking atualizado.');
}

rankingSearchInput.addEventListener('input', renderRanking);

loadRanking();
