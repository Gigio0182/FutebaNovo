const listEl = document.getElementById('participacoes-gols-list');
const statusEl = document.getElementById('status');

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle('error', isError);
}

function calcularMediaParticipacoes({ goals = 0, assists = 0, games = 0 }) {
  const totalParticipacoes = Number(goals || 0) + Number(assists || 0);
  const totalJogos = Number(games || 0);

  if (!totalJogos) {
    return 0;
  }

  return Math.round((totalParticipacoes / totalJogos) * 100) / 100;
}

async function loadParticipacoes() {
  try {
    const response = await fetch('/api/ranking');
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error || 'Erro ao carregar dados.');
    }
      const rows = (data.ranking || [])
        .map((row) => ({
          ...row,
          participacoes: Number(row.goals || 0) + Number(row.assists || 0)
        }))
        .filter((row) => row.participacoes > 0)
        .sort((a, b) => {
          if (b.participacoes !== a.participacoes) return b.participacoes - a.participacoes;
          if (a.games !== b.games) return a.games - b.games;
          return a.name.localeCompare(b.name, 'pt-BR');
        });

    if (!rows.length) {
      listEl.innerHTML = '<p>Nenhum atleta com gols ou assistências.</p>';
      setStatus('Nenhum atleta encontrado.');
      return;
    }

    const rowsWithPosition = rows.map((row, index) => ({
      ...row,
      position: index + 1
    }));

    listEl.innerHTML = `
      <table class="ranking-table participacoes-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Nome do atleta</th>
            <th>Jogos</th>
            <th>Gols</th>
            <th>Assistências</th>
            <th>Participações</th>
            <th>Média</th>
          </tr>
        </thead>
        <tbody>
          ${rowsWithPosition
            .map((row) => {
              let rowClass = '';
              if (row.position === 1) rowClass = 'row-gold';
              if (row.position === 2) rowClass = 'row-silver';
              if (row.position === 3) rowClass = 'row-bronze';

              return `
            <tr class="${rowClass}">
              <td><span class="participacoes-pos">${row.position}</span></td>
              <td class="participacoes-name">${escapeHtml(row.name)}</td>
              <td>${Number(row.games || 0)}</td>
              <td>${Number(row.goals || 0)}</td>
              <td>${Number(row.assists || 0)}</td>
              <td>
                <span class="participacoes-badge">${row.participacoes}</span>
              </td>
              <td>${calcularMediaParticipacoes(row)}</td>
            </tr>
          `;
            })
            .join('')}
        </tbody>
      </table>
    `;
    setStatus('Lista carregada.');
  } catch (error) {
    setStatus(error.message, true);
  }
}

document.addEventListener('DOMContentLoaded', loadParticipacoes);
