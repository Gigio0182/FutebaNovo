const { getDb } = require('./_lib/firebase');
const { handleOptions, sendJson } = require('./_lib/http');
const { getAthletesCollectionName } = require('./_lib/group');
const cache = require('./_lib/cache');

function calcularPontos({ games = 0, goals = 0, assists = 0, mvp = 0, worst = 0, defender = 0 }) {
  const pontos =
    (Number(games) * 0.5) +
    (Number(assists) * 1.5) +
    (Number(goals) * 2.5) +
    (Number(mvp) * 3) +
    (Number(defender) * 3) -
    (Number(worst) * 0.5);
  return Math.max(0, Math.round(pontos * 100) / 100);
}

module.exports = async (req, res) => {
  if (handleOptions(req, res)) {
    return;
  }

  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Metodo nao permitido.' });
    return;
  }

  try {
    const db = getDb();
    const collectionName = getAthletesCollectionName(req);
    const group = String((req.query && req.query.group) || '').trim();
    const cacheKey = `athletes:${group}`;

    let athletesSnap = cache.get('athletes', group);
    
    if (!athletesSnap) {
      athletesSnap = await db.collection(collectionName).limit(1000).get();
      cache.set('athletes', athletesSnap, group);
    }

    const ranking = athletesSnap.docs
      .map((doc) => {
        const data = doc.data();
        const goals = Number(data.goals || 0);
        const assists = Number(data.assists || 0);
        const games = Number(data.games || 0);
        const mvp = Number(data.mvp || 0);
        const worst = Number(data.worst || 0);
        const defender = Number(data.defender || 0);

        return {
          athleteId: doc.id,
          name: data.name,
          games,
          goals,
          assists,
          mvp,
          worst,
          defender,
          points: calcularPontos({ games, goals, assists, mvp, worst, defender })
        };
      })
      .sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        if (b.goals !== a.goals) return b.goals - a.goals;
        if (b.assists !== a.assists) return b.assists - a.assists;
        if (b.mvp !== a.mvp) return b.mvp - a.mvp;
        if (b.defender !== a.defender) return b.defender - a.defender;
        if (b.games !== a.games) return b.games - a.games;
        if (a.worst !== b.worst) return a.worst - b.worst;
        return a.name.localeCompare(b.name, 'pt-BR');
      });

    sendJson(res, 200, { ranking });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
};
