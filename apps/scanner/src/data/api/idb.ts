/**
 * The scanner's IndexedDB (D-17): one database, two stores.
 *   scans  every scan this device made, keyed by its idempotency key — the durable queue and the
 *          local history in one (a scan is written here before its verdict is shown)
 *   kv     signed allowlist (raw JWS, re-verified on load), public signing keys, gate cache, clock
 * Nothing secret is stored here: the allowlist holds hashes, the keys are public.
 */
export const DB_NAME = "synan-scanner";
const DB_VERSION = 1;

export const SCANS = "scans";
export const KV = "kv";

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    // A request error either aborts the transaction (onabort) or was handled (preventDefault).
    tx.onabort = () => reject(tx.error ?? new Error("transaction aborted"));
  });
}

export class Idb {
  private constructor(private readonly db: IDBDatabase) {}

  static open(name = DB_NAME, factory: IDBFactory = indexedDB): Promise<Idb> {
    return new Promise((resolve, reject) => {
      const r = factory.open(name, DB_VERSION);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains(SCANS)) {
          const s = db.createObjectStore(SCANS, { keyPath: "idem_key" });
          s.createIndex("state", "state");
          s.createIndex("at", "at");
        }
        if (!db.objectStoreNames.contains(KV)) db.createObjectStore(KV);
      };
      r.onsuccess = () => {
        const db = r.result;
        // Another tab upgrading: let it.
        db.onversionchange = () => db.close();
        resolve(new Idb(db));
      };
      r.onerror = () => reject(r.error);
      r.onblocked = () => reject(new Error("database blocked"));
    });
  }

  close() {
    this.db.close();
  }

  async get<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
    const tx = this.db.transaction(store, "readonly");
    return (await req(tx.objectStore(store).get(key))) as T | undefined;
  }

  async put(store: string, value: unknown, key?: IDBValidKey): Promise<void> {
    const tx = this.db.transaction(store, "readwrite");
    tx.objectStore(store).put(value, key);
    await done(tx);
  }

  /** Insert only; resolves false when the key already exists (never overwrites). */
  async add(store: string, value: unknown): Promise<boolean> {
    const tx = this.db.transaction(store, "readwrite");
    const r = tx.objectStore(store).add(value);
    let added = true;
    r.onerror = (e) => {
      added = false;
      // ConstraintError: keep the transaction alive and do not bubble it to the transaction.
      e.preventDefault();
      e.stopPropagation();
    };
    await done(tx);
    return added;
  }

  async all<T>(store: string): Promise<T[]> {
    const tx = this.db.transaction(store, "readonly");
    return (await req(tx.objectStore(store).getAll())) as T[];
  }

  async byIndex<T>(store: string, index: string, value: IDBValidKey): Promise<T[]> {
    const tx = this.db.transaction(store, "readonly");
    return (await req(tx.objectStore(store).index(index).getAll(value))) as T[];
  }

  async count(store: string, index: string, value: IDBValidKey): Promise<number> {
    const tx = this.db.transaction(store, "readonly");
    return req(tx.objectStore(store).index(index).count(value));
  }

  /**
   * Read-modify-write of one record in a single transaction, so two tabs never overwrite each
   * other's newer state. `fn` returns the new value, or undefined to leave it unchanged.
   */
  async update<T>(store: string, key: IDBValidKey, fn: (current: T | undefined) => T | undefined): Promise<T | undefined> {
    const tx = this.db.transaction(store, "readwrite");
    const os = tx.objectStore(store);
    const current = (await req(os.get(key))) as T | undefined;
    const next = fn(current);
    if (next !== undefined) os.put(next);
    await done(tx);
    return next ?? current;
  }

  async delete(store: string, keys: IDBValidKey[]): Promise<void> {
    if (keys.length === 0) return;
    const tx = this.db.transaction(store, "readwrite");
    const os = tx.objectStore(store);
    for (const k of keys) os.delete(k);
    await done(tx);
  }
}
