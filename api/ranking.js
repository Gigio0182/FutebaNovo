const { getDb } = require('./_lib/firebase');
const { handleOptions, sendJson } = require('./_lib/http');

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

    const athletesSnap = await db.collection('athletes').get();

    const ranking = athletesSnap.docs
      .map((doc) => {
        const data = doc.data();
        const goals = Number(data.goals || 0);
        const assists = Number(data.assists || 0);
        const games = Number(data.games || 0);

        return {
        athleteId: doc.id,
          name: data.name,
          games,
          goals,
          assists,
          points: goals * 2 + assists
        };
      })
      .sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        if (b.goals !== a.goals) return b.goals - a.goals;
        if (b.assists !== a.assists) return b.assists - a.assists;
        return a.name.localeCompare(b.name, 'pt-BR');
      });

    sendJson(res, 200, { ranking });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
};
