/**
 * In-memory countdown state (process-local v1).
 * Shape is Redis-ready: pure get/snapshot + applyAction mutations.
 * Node is single-threaded; mutations are synchronous and atomic within a tick.
 */

/** @typedef {'set'|'add'|'pause'|'resume'|'toggle'|'reset'|'stop'} CountdownAction */

/**
 * @typedef {object} CountdownSnapshot
 * @property {number} durationSec
 * @property {number} remainingSec
 * @property {boolean} running
 * @property {number|null} endsAt  epoch ms when running, else null
 * @property {number} updatedAt    epoch ms
 */

/**
 * @returns {import('./countdown.js').CountdownStore}
 */
export function createCountdownStore(initialDurationSec = 300) {
  let durationSec = clampDuration(initialDurationSec);
  let running = false;
  /** @type {number|null} */
  let endsAt = null;
  /** Remaining when paused (or after stop/reset while idle). */
  let idleRemainingSec = durationSec;
  let updatedAt = Date.now();
  let revision = 0;

  /** @type {Set<(snap: CountdownSnapshot) => void>} */
  const listeners = new Set();

  function nowMs() {
    return Date.now();
  }

  function clampDuration(sec) {
    const n = Number(sec);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.min(Math.floor(n), 24 * 60 * 60);
  }

  function remainingAt(t = nowMs()) {
    if (running && endsAt != null) {
      return Math.max(0, Math.ceil((endsAt - t) / 1000));
    }
    return Math.max(0, idleRemainingSec);
  }

  /** @returns {CountdownSnapshot} */
  function snapshot(t = nowMs()) {
    const remainingSec = remainingAt(t);
    // Auto-stop when expired while running
    if (running && remainingSec <= 0) {
      running = false;
      endsAt = null;
      idleRemainingSec = 0;
      updatedAt = t;
      revision += 1;
    }
    return {
      durationSec,
      remainingSec: remainingAt(t),
      running,
      endsAt: running ? endsAt : null,
      updatedAt,
    };
  }

  function emit() {
    const snap = snapshot();
    for (const fn of listeners) {
      try {
        fn(snap);
      } catch {
        /* ignore subscriber errors */
      }
    }
    return snap;
  }

  /**
   * @param {CountdownAction} action
   * @param {Record<string, unknown>} [payload]
   * @returns {CountdownSnapshot}
   */
  function applyAction(action, payload = {}) {
    const t = nowMs();
    // Refresh remaining if a previous run just expired
    snapshot(t);

    switch (action) {
      case 'set': {
        const next = clampDuration(payload.durationSec ?? payload.seconds ?? durationSec);
        durationSec = next;
        idleRemainingSec = next;
        running = false;
        endsAt = null;
        break;
      }
      case 'add': {
        const delta = Number(payload.seconds ?? payload.deltaSec ?? 0);
        if (!Number.isFinite(delta)) {
          throw Object.assign(new Error('Invalid seconds for add'), { statusCode: 400 });
        }
        const base = remainingAt(t);
        const next = clampDuration(base + Math.trunc(delta));
        if (running) {
          endsAt = t + next * 1000;
        } else {
          idleRemainingSec = next;
        }
        break;
      }
      case 'pause': {
        if (running) {
          idleRemainingSec = remainingAt(t);
          running = false;
          endsAt = null;
        }
        break;
      }
      case 'resume': {
        if (!running) {
          const rem = remainingAt(t);
          if (rem > 0) {
            running = true;
            endsAt = t + rem * 1000;
          }
        }
        break;
      }
      case 'toggle': {
        if (running) {
          idleRemainingSec = remainingAt(t);
          running = false;
          endsAt = null;
        } else {
          const rem = remainingAt(t);
          if (rem > 0) {
            running = true;
            endsAt = t + rem * 1000;
          }
        }
        break;
      }
      case 'reset': {
        idleRemainingSec = durationSec;
        running = false;
        endsAt = null;
        break;
      }
      case 'stop': {
        idleRemainingSec = 0;
        running = false;
        endsAt = null;
        break;
      }
      default:
        throw Object.assign(new Error(`Unknown action: ${action}`), { statusCode: 400 });
    }

    updatedAt = t;
    revision += 1;
    return emit();
  }

  /**
   * @param {(snap: CountdownSnapshot) => void} fn
   * @returns {() => void}
   */
  function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  return {
    snapshot,
    applyAction,
    subscribe,
    getRevision: () => revision,
  };
}

/**
 * @typedef {ReturnType<typeof createCountdownStore>} CountdownStore
 */
