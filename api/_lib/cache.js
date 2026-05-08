const cache = new Map();
const MAX_AGE_MS = 5 * 60 * 1000;

function getCacheKey(collection, group = '') {
  return `${collection}:${group}`;
}

function getEntry(key) {
  const entry = cache.get(key);
  if (!entry) {
    return null;
  }

  if (Date.now() - entry.timestamp > MAX_AGE_MS) {
    cache.delete(key);
    return null;
  }

  return entry;
}

function cloneAthlete(athlete) {
  return athlete ? { ...athlete } : athlete;
}

function get(collection, group = '') {
  const key = getCacheKey(collection, group);
  const entry = getEntry(key);
  return entry ? entry.data : null;
}

function set(collection, data, group = '') {
  const key = getCacheKey(collection, group);
  cache.set(key, {
    data,
    timestamp: Date.now()
  });
}

function invalidate(collection, group = '') {
  const key = getCacheKey(collection, group);
  cache.delete(key);
}

function getAthletes(collectionName) {
  const athletes = get('athletes', collectionName);
  if (!Array.isArray(athletes)) {
    return null;
  }

  return athletes.map(cloneAthlete);
}

function setAthletes(collectionName, athletes) {
  const safeAthletes = Array.isArray(athletes)
    ? athletes.map(cloneAthlete)
    : [];

  set('athletes', safeAthletes, collectionName);
  invalidate('ranking', collectionName);
  return safeAthletes.map(cloneAthlete);
}

function upsertAthlete(collectionName, athlete) {
  if (!athlete || !athlete.id) {
    return null;
  }

  const athletes = getAthletes(collectionName) || [];
  const nextAthlete = cloneAthlete(athlete);
  const index = athletes.findIndex((item) => item && item.id === nextAthlete.id);

  if (index >= 0) {
    athletes[index] = {
      ...athletes[index],
      ...nextAthlete
    };
  } else {
    athletes.push(nextAthlete);
  }

  athletes.sort((left, right) => String(left.name || '').localeCompare(String(right.name || ''), 'pt-BR'));
  setAthletes(collectionName, athletes);
  return cloneAthlete(nextAthlete);
}

function removeAthlete(collectionName, athleteId) {
  if (!athleteId) {
    return;
  }

  const athletes = getAthletes(collectionName);
  if (!athletes) {
    invalidate('ranking', collectionName);
    return;
  }

  setAthletes(
    collectionName,
    athletes.filter((athlete) => athlete && athlete.id !== athleteId)
  );
}

function findAthleteByNameKey(collectionName, normalizeNameKey, athleteName) {
  const athletes = getAthletes(collectionName);
  if (!athletes || !athleteName) {
    return null;
  }

  const targetKey = normalizeNameKey(athleteName);
  return athletes.find((athlete) => normalizeNameKey(athlete.name) === targetKey) || null;
}

function invalidateAll() {
  cache.clear();
}

module.exports = {
  findAthleteByNameKey,
  get,
  getAthletes,
  invalidate,
  invalidateAll,
  removeAthlete,
  set,
  setAthletes,
  upsertAthlete
};
