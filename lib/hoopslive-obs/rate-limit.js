/**
 * Simple sliding-window rate limiter (per key, in-memory).
 */

export function createRateLimiter({ max = 60, windowMs = 60_000 } = {}) {
  /** @type {Map<string, number[]>} */
  const hits = new Map();

  function prune(key, now) {
    const arr = hits.get(key) || [];
    const next = arr.filter((t) => now - t < windowMs);
    hits.set(key, next);
    return next;
  }

  /**
   * @param {string} key
   * @returns {{ ok: boolean, remaining: number, retryAfterSec: number }}
   */
  function check(key) {
    const now = Date.now();
    const arr = prune(key, now);
    if (arr.length >= max) {
      const oldest = arr[0] || now;
      const retryAfterSec = Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000));
      return { ok: false, remaining: 0, retryAfterSec };
    }
    arr.push(now);
    hits.set(key, arr);
    return { ok: true, remaining: Math.max(0, max - arr.length), retryAfterSec: 0 };
  }

  return { check };
}
