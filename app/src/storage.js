/* Where the data lives.

   Everything is on the phone, in localStorage. There is no account and no
   server in the normal path, which is why the app works offline and why a
   backup file is the only copy that survives a lost phone.

   The optional local server (start-wallet.bat) is for viewing the same data on
   a PC; when it isn't there, `serverless` is true and nothing is lost. */

const listeners = new Set();

export const sync = {
  online: false,
  pending: false,
  serverless: true,
  subscribe(fn) {
    listeners.add(fn);
    fn({ ...sync });
    return () => listeners.delete(fn);
  },
  announce() {
    listeners.forEach((fn) => fn({ ...sync }));
  },
};

const mem = new Map();

/* Everything is stored under a "wallet:" prefix, and always has been. This is
   not cosmetic: drop it and the app reads empty keys, so a phone full of data
   looks wiped. */
const PREFIX = "wallet:";

function lsGet(key) {
  try {
    const v = localStorage.getItem(PREFIX + key);
    return v === null ? undefined : v;
  } catch (e) {
    return mem.get(key);            // private mode, quota, or storage disabled
  }
}

function lsSet(key, value) {
  try {
    localStorage.setItem(PREFIX + key, value);
    mem.set(key, value);
  } catch (e) {
    mem.set(key, value);            // keep working for this session at least
    throw e;
  }
}

export const storage = {
  async get(key) {
    const value = lsGet(key);
    if (value === undefined) throw new Error(`no value for ${key}`);
    return { key, value };
  },

  async set(key, value) {
    sync.pending = true;
    sync.announce();
    try {
      lsSet(key, value);
      return { key, value };
    } finally {
      sync.pending = false;
      sync.announce();
    }
  },

  async delete(key) {
    try { localStorage.removeItem(PREFIX + key); } catch (e) { /* fine */ }
    mem.delete(key);
    return { key, deleted: true };
  },
};
