/* Persistence for the prototype: browser storage, one key per data set.
 * Every change runs as a transaction: read the latest saved copy, apply the
 * rule function to a draft, then save only if nobody else saved in between
 * (revision check, under a cross-tab lock when the browser offers one).
 * On a clash it re-reads and re-applies the rules, so capacity is re-checked
 * against the newest data. This protects tabs in one browser; it is NOT a
 * shared multi-user database. */
(function (root) {
  'use strict';
  function createStore(opts) {
    const storage = opts.storage, key = opts.key, locks = opts.locks || null;
    const maxAttempts = opts.maxAttempts || 12;
    const delay = opts._testDelay || null;
    let memory = null; // used if storage is unavailable
    let available = true;

    function read() {
      try {
        const raw = storage.getItem(key);
        return raw ? JSON.parse(raw) : null;
      } catch (e) { available = false; return memory ? JSON.parse(memory) : null; }
    }
    function write(obj) {
      const raw = JSON.stringify(obj);
      try { storage.setItem(key, raw); available = true; } catch (e) { available = false; memory = raw; }
    }
    async function withLock(fn) {
      if (locks && locks.request) return locks.request('wapcpd:' + key, { mode: 'exclusive' }, fn);
      return fn();
    }
    async function transact(fn) {
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const cur = read();
        if (!cur) throw new Error('No data set loaded.');
        const draft = JSON.parse(JSON.stringify(cur));
        const result = fn(draft); // may throw RuleError -> nothing saved
        draft.rev = (cur.rev || 0) + 1;
        if (delay) await delay();
        const ok = await withLock(async () => {
          const latest = read();
          if ((latest && latest.rev) !== cur.rev) return false;
          write(draft);
          return true;
        });
        if (ok) return { result, state: draft };
      }
      const e = new Error('The data was busy. Please try again.');
      e.code = 'busy';
      throw e;
    }
    function replace(obj) { write(obj); }
    function clear() { try { storage.removeItem(key); } catch (e) { memory = null; } }
    return { read, write: replace, transact, clear, isAvailable: () => available, key };
  }
  const api = { createStore };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CPDStore = api;
})(typeof window !== 'undefined' ? window : globalThis);
