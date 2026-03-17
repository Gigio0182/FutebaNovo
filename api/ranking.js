const { getDb } = require('./_lib/firebase');
const { handleOptions, sendJson } = require('./_lib/http');
const { requireAuth } = require('./_lib/auth');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) {
    return;
  }

  if (!requireAuth(req, res)) {
    return;
  }

  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Metodo nao permitido.' });
    return;
  }

  try {
    const db = getDb();

    const [athletesSnap, matchesSnap, eventsSnap] = await Promise.all([
      db.collection('athletes').get(),
      db.collection('matches').get(),
      db.collection('events').get()
    ]);

    const athletesMap = new Map();
    athletesSnap.docs.forEach((doc) => {
      athletesMap.set(doc.id, {
        athleteId: doc.id,
        name: doc.data().name,
        games: 0,
        goals: 0,
        assists: 0,
        points: 0
      });
    });

    matchesSnap.docs.forEach((doc) => {
      const match = doc.data();
      const participants = Array.isArray(match.participantIds)
        ? match.participantIds
        : [];

      participants.forEach((athleteId) => {
        const row = athletesMap.get(athleteId);
        if (row) {
          row.games += 1;
        }
      });
    });

    eventsSnap.docs.forEach((doc) => {
      const event = doc.data();
      const row = athletesMap.get(event.athleteId);
      if (!row) {
        return;
      }

      if (event.type === 'goal') {
        row.goals += 1;
      }

      if (event.type === 'assist') {
        row.assists += 1;
      }
    });

    const ranking = Array.from(athletesMap.values())
      .map((row) => ({
        ...row,
        points: row.goals * 2 + row.assists
      }))
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
