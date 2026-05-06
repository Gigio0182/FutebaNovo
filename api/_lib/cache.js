const cache = new Map();

function getCacheKey(collection, group = '') {
  return `${collection}:${group}`;
}

function get(collection, group = '') {
  const key = getCacheKey(collection, group);
  const entry = cache.get(key);
  
  if (!entry) {
    return null;
  }

  const now = Date.now();
  const maxAge = 5 * 60 * 1000; // 5 minutos
  
  if (now - entry.timestamp > maxAge) {
    cache.delete(key);
    return null;
  }

  return entry.data;
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

function invalidateAll() {
  cache.clear();
}

module.exports = {
  get,
  set,
  invalidate,
  invalidateAll
};
