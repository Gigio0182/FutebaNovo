const body = document.getElementById('ranking-body');
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
  const rows = !term
    ? rankingCache
    : rankingCache.filter((row) =>
        String(row.name || '').toLowerCase().includes(term)
      );

  if (!rows.length) {
    body.innerHTML = '';
    setStatus('Nenhum atleta encontrado para a busca.');
    return;
  }

    let lastKey = '';
    let currentPosition = 0;

    body.innerHTML = rows
      .map((row, index) => {
        const key = `${row.goals}|${row.assists}|${row.games}|${row.mvp}|${row.worst}`;
        if (key !== lastKey) {
          currentPosition = index + 1;
          lastKey = key;
        }

        let medalClass = '';
        if (currentPosition === 1) medalClass = 'row-gold';
        if (currentPosition === 2) medalClass = 'row-silver';
        if (currentPosition === 3) medalClass = 'row-bronze';

        return `
          <tr class="${medalClass}">
            <td>${currentPosition}</td>
            <td>${row.name}</td>
            <td>${row.games}</td>
            <td>${row.goals}</td>
            <td>${row.assists}</td>
            <td>${row.mvp || 0}</td>
            <td>${row.worst || 0}</td>
          </tr>
        `;
      })
      .join('');

  setStatus('Ranking atualizado.');
}

rankingSearchInput.addEventListener('input', renderRanking);

loadRanking();
