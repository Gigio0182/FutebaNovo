const rankingList = document.getElementById('ranking-list');
const statusEl = document.getElementById('status');
const rankingSearchInput = document.getElementById('ranking-search');
const helpDialog = document.getElementById('help-dialog');
let rankingCache = [];

function openHelpDialog() {
  if (helpDialog && typeof helpDialog.showModal === 'function') {
    helpDialog.showModal();
  }
}

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


function calcularPontos({ games = 0, goals = 0, assists = 0, mvp = 0, worst = 0 }) {
  const pontos = (Number(games) * 0.5) + (Number(goals) * 1.5) + (Number(assists) * 1) + (Number(mvp) * 0.5) - (Number(worst) * 0.5);
  return Math.max(0, Math.round(pontos * 100) / 100);
}

function renderRanking() {
  const term = (rankingSearchInput.value || '').trim().toLowerCase();
  // Ordenar por pontos antes de atribuir posição
  const sorted = [...rankingCache].map((row) => ({
    ...row,
    pontos: calcularPontos(row)
  })).sort((a, b) => b.pontos - a.pontos || a.name.localeCompare(b.name, 'pt-BR'));
  const rankedRows = sorted.map((row, index) => ({
    ...row,
    position: index + 1
  }));

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
            <div class="rank-name-meta" style="display:flex;align-items:center;gap:0.7rem;justify-content:space-between;width:100%;">
              <h3>${row.name}</h3>
              <div style="display:flex;flex-direction:column;align-items:flex-end;min-width:70px;width:100px;">
                <span class="stat-pill stat-pontos" data-action="open-help" role="button" title="Ver como a pontuação é calculada" style="background:#059669;color:#fff;font-size:1.1rem;font-weight:800;padding:0.38rem 1.1rem;box-shadow:0 2px 8px #05966922;letter-spacing:0.5px;width:100%;display:flex;align-items:center;justify-content:center;text-align:center;cursor:pointer;">${row.pontos}</span>
              </div>
            </div>
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

// Ajuda de pontuação
document.addEventListener('DOMContentLoaded', () => {
  const helpBtn = document.getElementById('help-btn');
  const closeHelpBtn = document.getElementById('close-help-btn');
  if (helpBtn && helpDialog && closeHelpBtn) {
    helpBtn.addEventListener('click', openHelpDialog);
    closeHelpBtn.addEventListener('click', () => helpDialog.close());
  }
});

rankingList.addEventListener('click', (event) => {
  const pointsPill = event.target.closest('.stat-pontos[data-action="open-help"]');
  if (pointsPill) {
    openHelpDialog();
  }
});

rankingSearchInput.addEventListener('input', renderRanking);

loadRanking();
