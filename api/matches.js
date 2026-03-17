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
      const snapshot = await db
        .collection('matches')
        .orderBy('date', 'desc')
        .get();

      const matches = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data()
      }));

      sendJson(res, 200, { matches });
      return;
    }

    if (req.method === 'POST') {
      const body = await parseBody(req);
      const date = (body.date || '').trim();
      const opponent = (body.opponent || '').trim();
      const notes = (body.notes || '').trim();
      const participantIds = Array.isArray(body.participantIds)
        ? body.participantIds.filter(Boolean)
        : [];

      if (!date) {
        sendJson(res, 400, { error: 'Data do jogo e obrigatoria.' });
        return;
      }

      const created = await db.collection('matches').add({
        date,
        opponent,
        notes,
        participantIds,
        createdAt: new Date().toISOString()
      });

      sendJson(res, 201, {
        match: {
          id: created.id,
          date,
          opponent,
          notes,
          participantIds
        }
      });
      return;
    }

    if (req.method === 'PUT') {
      const body = await parseBody(req);
      const id = (body.id || '').trim();
      const participantIds = Array.isArray(body.participantIds)
        ? body.participantIds.filter(Boolean)
        : [];

      if (!id) {
        sendJson(res, 400, { error: 'ID do jogo e obrigatorio.' });
        return;
      }

      await db.collection('matches').doc(id).set(
        {
          participantIds,
          updatedAt: new Date().toISOString()
        },
        { merge: true }
      );

      sendJson(res, 200, { ok: true });
      return;
    }

    sendJson(res, 405, { error: 'Metodo nao permitido.' });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
};
