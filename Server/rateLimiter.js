'use strict';
// محدد معدّل بسيط في الذاكرة: max محاولات لكل مفتاح (مثلًا IP) خلال windowMs
function createLimiter({ max, windowMs }) {
  const hits = new Map();
  function allow(key, now = Date.now()) {
    const arr = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) {
      hits.set(key, arr);
      return false;
    }
    arr.push(now);
    hits.set(key, arr);
    return true;
  }
  function sweep(now = Date.now()) {
    for (const [k, arr] of hits) {
      const fresh = arr.filter((t) => now - t < windowMs);
      if (fresh.length) hits.set(k, fresh);
      else hits.delete(k);
    }
  }
  return { allow, sweep, size: () => hits.size };
}
module.exports = { createLimiter };
