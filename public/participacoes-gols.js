const listEl = document.getElementById('participacoes-gols-list');
const statusEl = document.getElementById('status');

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle('error', isError);
}

async function loadParticipacoes() {
  try {
    const response = await fetch('/api/ranking');
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Erro ao carregar dados.');
    }
      const rows = (data.ranking || [])
        .map(row => ({
          ...row,
          pontos: Number(row.goals || 0) + Number(row.assists || 0)
        }))
        .filter(row => row.pontos > 0)
        .sort((a, b) => {
          if (b.pontos !== a.pontos) return b.pontos - a.pontos;
          if (a.games !== b.games) return a.games - b.games;
          return a.name.localeCompare(b.name, 'pt-BR');
        });

    if (!rows.length) {
      listEl.innerHTML = '<p>Nenhum atleta com gols ou assistências.</p>';
      setStatus('Nenhum atleta encontrado.');
      return;
    }

    listEl.innerHTML = `
      <table class="ranking-table">
        <thead>
          <tr>
            <th>Nome do atleta</th>
            <th>Jogos</th>
            <th>Gols</th>
            <th>Assistências</th>
            <th>Pontos</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(row => `
            <tr>
              <td>${row.name}</td>
              <td>${row.games}</td>
              <td>${row.goals}</td>
              <td>${row.assists}</td>
              <td>${calcularPontos(row)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
    setStatus('Lista carregada.');
  } catch (error) {
    setStatus(error.message, true);
  }
}

function calcularPontos({ games = 0, goals = 0, assists = 0, mvp = 0, worst = 0 }) {
  const pontos = (Number(games) * 0.25) + (Number(goals) * 1.25) + (Number(assists) * 1) + (Number(mvp) * 0.25) - (Number(worst) * 0.25);
  return Math.max(0, Math.round(pontos * 100) / 100);
}

document.addEventListener('DOMContentLoaded', loadParticipacoes);
