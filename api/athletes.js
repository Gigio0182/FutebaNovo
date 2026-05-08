const { getDb } = require('./_lib/firebase');
const { handleOptions, parseBody, sendJson } = require('./_lib/http');
const { requireAuth } = require('./_lib/auth');
const { getAthletesCollectionName } = require('./_lib/group');
const { sanitizeAthleteName, normalizeNameKey } = require('./_lib/names');
const cache = require('./_lib/cache');

module.exports = async (req, res) => {
  if (handleOptions(req, res)) {
    return;
  }

  try {
    const db = getDb();
    const collectionName = getAthletesCollectionName(req);
    const athletesCollection = db.collection(collectionName);

    if (req.method === 'GET') {
      if (!requireAuth(req, res)) {
        return;
      }

      let athletes = cache.getAthletes(collectionName);
      if (!athletes) {
        const snapshot = await athletesCollection.orderBy('name', 'asc').get();
        athletes = cache.setAthletes(
          collectionName,
          snapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data()
          }))
        );
      }

      sendJson(res, 200, { athletes });
      return;
    }

    if (req.method === 'POST') {
      if (!requireAuth(req, res)) {
        return;
      }

      const body = await parseBody(req);
      const name = sanitizeAthleteName(body.name || '');

      if (!name) {
        sendJson(res, 400, { error: 'Nome do atleta e obrigatorio.' });
        return;
      }

      const duplicateKey = normalizeNameKey(name);
      let athletes = cache.getAthletes(collectionName);
      if (!athletes) {
        const existingSnapshot = await athletesCollection.orderBy('name', 'asc').get();
        athletes = cache.setAthletes(
          collectionName,
          existingSnapshot.docs.map((doc) => ({
            id: doc.id,
            ...doc.data()
          }))
        );
      }

      const existingDuplicate = athletes.find((athlete) => normalizeNameKey((athlete || {}).name) === duplicateKey);
      if (existingDuplicate) {
        sendJson(res, 409, { error: 'Ja existe um atleta cadastrado com esse nome.' });
        return;
      }

      const createdAt = new Date().toISOString();
      const created = await athletesCollection.add({
        name,
        goals: 0,
        assists: 0,
        games: 0,
        mvp: 0,
        worst: 0,
        defender: 0,
        createdAt
      });

      cache.upsertAthlete(collectionName, {
        id: created.id,
        name,
        goals: 0,
        assists: 0,
        games: 0,
        mvp: 0,
        worst: 0,
        defender: 0,
        createdAt
      });

      sendJson(res, 201, {
        athlete: {
          id: created.id,
          name,
          goals: 0,
          assists: 0,
          games: 0,
          mvp: 0,
          worst: 0,
          defender: 0
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
      const nextName = sanitizeAthleteName(body.name || '');
      const deltaRaw = Number(body.delta);
      const delta = Number.isFinite(deltaRaw) && deltaRaw !== 0 ? deltaRaw : 1;
      const now = new Date().toISOString();

      if (!id) {
        sendJson(res, 400, { error: 'ID do atleta e obrigatorio.' });
        return;
      }

      if (nextName && !field) {
        const docRef = athletesCollection.doc(id);
        const currentSnap = await docRef.get();

        if (!currentSnap.exists) {
          sendJson(res, 404, { error: 'Atleta nao encontrado.' });
          return;
        }

        const duplicateKey = normalizeNameKey(nextName);
        let athletes = cache.getAthletes(collectionName);
        if (!athletes) {
          const existingSnapshot = await athletesCollection.orderBy('name', 'asc').get();
          athletes = cache.setAthletes(
            collectionName,
            existingSnapshot.docs.map((doc) => ({
              id: doc.id,
              ...doc.data()
            }))
          );
        }

        const existingDuplicate = athletes.find((athlete) => athlete.id !== id && normalizeNameKey((athlete || {}).name) === duplicateKey);
        if (existingDuplicate) {
          sendJson(res, 409, { error: 'Ja existe um atleta cadastrado com esse nome.' });
          return;
        }

        await docRef.set(
          {
            name: nextName,
            updatedAt: now
          },
          { merge: true }
        );

        cache.upsertAthlete(collectionName, {
          id,
          ...currentSnap.data(),
          name: nextName,
          updatedAt: now
        });

        sendJson(res, 200, { ok: true, name: nextName });
        return;
      }

      const allowed = new Set(['goals', 'assists', 'games', 'mvp', 'worst', 'defender']);
      if (!allowed.has(field)) {
        sendJson(res, 400, { error: 'Campo invalido para incremento.' });
        return;
      }

      const docRef = athletesCollection.doc(id);
      const currentSnap = await docRef.get();

      if (!currentSnap.exists) {
        sendJson(res, 404, { error: 'Atleta nao encontrado.' });
        return;
      }

      const current = currentSnap.data();
      const currentValue = Number(current[field] || 0);
      const nextValue = Math.max(0, currentValue + delta);

      await docRef.set(
        {
          [field]: nextValue,
          updatedAt: now
        },
        { merge: true }
      );

      cache.upsertAthlete(collectionName, {
        id,
        ...current,
        [field]: nextValue,
        updatedAt: now
      });

      sendJson(res, 200, { ok: true, field, value: nextValue });
      return;
    }

    if (req.method === 'DELETE') {
      if (!requireAuth(req, res)) {
        return;
      }

      const body = await parseBody(req);
      const idFromQuery = req.query && typeof req.query.id === 'string' ? req.query.id : '';
      const id = String(idFromQuery || body.id || '').trim();

      if (!id) {
        sendJson(res, 400, { error: 'ID do atleta e obrigatorio.' });
        return;
      }

      const docRef = athletesCollection.doc(id);
      const currentSnap = await docRef.get();

      if (!currentSnap.exists) {
        sendJson(res, 200, { ok: true, deleted: false });
        return;
      }

      await docRef.delete();
      cache.removeAthlete(collectionName, id);
      sendJson(res, 200, { ok: true, deleted: true });
      return;
    }

    sendJson(res, 405, { error: 'Metodo nao permitido.' });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
};
