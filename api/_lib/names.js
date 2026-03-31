function sanitizeAthleteName(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\u0000-\u001F\u007F\u00AD\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function normalizeNameKey(value) {
  return sanitizeAthleteName(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = {
  sanitizeAthleteName,
  normalizeNameKey
};