const { getDb } = require('./_lib/firebase');
const { handleOptions, parseBody, sendJson } = require('./_lib/http');
const { requireAuth } = require('./_lib/auth');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) {
    return;
  }

  try {
    const db = getDb();

    if (req.method === 'GET') {
      if (!requireAuth(req, res)) {
        return;
      }

      const snapshot = await db
        .collection('athletes')
        .orderBy('name', 'asc')
        .get();

      const athletes = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data()
      }));

      sendJson(res, 200, { athletes });
      return;
    }

    if (req.method === 'POST') {
      if (!requireAuth(req, res)) {
        return;
      }

      const body = await parseBody(req);
      const name = (body.name || '').trim();

      if (!name) {
        sendJson(res, 400, { error: 'Nome do atleta e obrigatorio.' });
        return;
      }

      const created = await db.collection('athletes').add({
        name,
        goals: 0,
        assists: 0,
        games: 0,
        mvp: 0,
        worst: 0,
        createdAt: new Date().toISOString()
      });

      sendJson(res, 201, {
        athlete: {
          id: created.id,
          name,
          goals: 0,
          assists: 0,
          games: 0,
          mvp: 0,
          worst: 0
        }
      });
      return;
    }

    if (req.method === 'PUT') {
      if (!requireAuth(req, res)) {
        return;
      }

      const body = await parseBody(req);
      const id = (body.id || '').trim();
      const field = (body.field || '').trim();
      const nextName = (body.name || '').trim();
      const deltaRaw = Number(body.delta);
      const delta = Number.isFinite(deltaRaw) && deltaRaw !== 0 ? deltaRaw : 1;

      if (!id) {
        sendJson(res, 400, { error: 'ID do atleta e obrigatorio.' });
        return;
      }

      const allowed = new Set(['goals', 'assists', 'games', 'mvp', 'worst']);
      if (!allowed.has(field)) {
        sendJson(res, 400, { error: 'Campo invalido para incremento.' });
        return;
      }

      const docRef = db.collection('athletes').doc(id);
      const currentSnap = await docRef.get();

      if (!currentSnap.exists) {
        sendJson(res, 404, { error: 'Atleta nao encontrado.' });
        return;
      }

      if (nextName && !field) {
        await docRef.set(
          {
            name: nextName,
            updatedAt: new Date().toISOString()
          },
          { merge: true }
        );

        sendJson(res, 200, { ok: true, name: nextName });
        return;
      }

      const current = currentSnap.data();
      const currentValue = Number(current[field] || 0);
      const nextValue = Math.max(0, currentValue + delta);

      await docRef.set(
        {
          [field]: nextValue,
          updatedAt: new Date().toISOString()
        },
        { merge: true }
      );

      sendJson(res, 200, { ok: true, field, value: nextValue });
      return;
    }

    sendJson(res, 405, { error: 'Metodo nao permitido.' });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
};
