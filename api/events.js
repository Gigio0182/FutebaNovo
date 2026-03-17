const { getDb } = require('./_lib/firebase');
const { handleOptions, parseBody, sendJson } = require('./_lib/http');
const { requireAuth } = require('./_lib/auth');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) {
    return;
  }

  if (!requireAuth(req, res)) {
    return;
  }

  try {
    const db = getDb();

    if (req.method === 'GET') {
      const matchId = req.query.matchId;
      let query = db.collection('events').orderBy('createdAt', 'desc');

      if (matchId) {
        query = query.where('matchId', '==', matchId);
      }

      const snapshot = await query.get();
      const events = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data()
      }));

      sendJson(res, 200, { events });
      return;
    }

    if (req.method === 'POST') {
      const body = await parseBody(req);
      const matchId = (body.matchId || '').trim();
      const athleteId = (body.athleteId || '').trim();
      const type = (body.type || '').trim().toLowerCase();
      const minute = Number(body.minute || 0);

      if (!matchId || !athleteId) {
        sendJson(res, 400, { error: 'Jogo e atleta sao obrigatorios.' });
        return;
      }

      if (type !== 'goal' && type !== 'assist') {
        sendJson(res, 400, { error: 'Tipo deve ser goal ou assist.' });
        return;
      }

      const created = await db.collection('events').add({
        matchId,
        athleteId,
        type,
        minute,
        createdAt: new Date().toISOString()
      });

      sendJson(res, 201, {
        event: {
          id: created.id,
          matchId,
          athleteId,
          type,
          minute
        }
      });
      return;
    }

    sendJson(res, 405, { error: 'Metodo nao permitido.' });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
};
