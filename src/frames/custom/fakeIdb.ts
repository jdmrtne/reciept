/**
 * Hand-written minimal IndexedDB for tests (no dependency). Supports what store.ts uses: open with upgrade, createObjectStore(keyPath),
 * transaction, add / put / get / getAll / delete, tx complete / abort / error, versionchange, structured clone of values (Blobs included),
 * and fault injection (quota, errors, blocked, unavailable). Requests settle asynchronously; a transaction commits once no request is pending.
 */
export interface Fault { op: 'add' | 'put' | 'get' | 'getAll' | 'delete' | 'open'; error: { name: string }; /** 'request' = request.onerror, 'abort' = the transaction aborts (how browsers report quota). */ kind?: 'request' | 'abort'; times?: number }

type Handler = ((ev?: unknown) => void) | null;
const clone = <T,>(v: T): T => structuredClone(v);
const err = (name: string) => Object.assign(new Error(name), { name }) as unknown as DOMException;
const later = (fn: () => void) => setTimeout(fn, 0);

class FakeRequest<T> {
  result!: T; error: DOMException | null = null; onsuccess: Handler = null; onerror: Handler = null; onupgradeneeded: Handler = null; onblocked: Handler = null;
}
class FakeStore {
  constructor(private tx: FakeTx, private data: Map<string, unknown>, private keyPath: string, private db: FakeDb) {}
  private req<T>(op: Fault['op'], exec: () => T): IDBRequest<T> {
    const r = new FakeRequest<T>();
    this.tx.pending++;
    const go = () => {
      if (this.tx.finished) return;
      if (!this.tx.canRun()) return void later(go); // read-write transactions on one store run one after another, as in a browser
      const f = this.db.takeFault(op);
      if (f && f.kind !== 'abort') { r.error = err(f.error.name); r.onerror?.(); this.tx.fail(r.error, true); this.tx.pending--; return; }
      if (f) { this.tx.pending--; this.tx.abort(err(f.error.name)); return; }
      try { r.result = exec(); } catch (e) { r.error = e as DOMException; r.onerror?.(); this.tx.fail(r.error, true); this.tx.pending--; return; }
      r.onsuccess?.();
      this.tx.pending--; this.tx.poke();
    };
    later(go);
    return r as unknown as IDBRequest<T>;
  }
  private write(kind: 'add' | 'put', value: unknown) {
    if (this.tx.mode !== 'readwrite') throw err('ReadOnlyError');
    const key = String((value as Record<string, unknown>)[this.keyPath]), copy = clone(value);
    return this.req<string>(kind, () => {
      if (kind === 'add' && this.data.has(key)) throw err('ConstraintError');
      const prev = this.data.get(key);
      this.tx.undo.push(() => (prev === undefined ? this.data.delete(key) : this.data.set(key, prev)));
      this.data.set(key, copy); return key;
    });
  }
  add(v: unknown) { return this.write('add', v); }
  put(v: unknown) { return this.write('put', v); }
  get(k: string) { return this.req('get', () => { const v = this.data.get(String(k)); return v === undefined ? undefined : clone(v); }); }
  getAll() { return this.req('getAll', () => [...this.data.values()].map(clone)); }
  delete(k: string) {
    if (this.tx.mode !== 'readwrite') throw err('ReadOnlyError');
    return this.req('delete', () => { const key = String(k), prev = this.data.get(key); this.tx.undo.push(() => prev !== undefined && this.data.set(key, prev)); this.data.delete(key); return undefined; });
  }
}
class FakeTx {
  pending = 0; finished = false; error: DOMException | null = null; undo: (() => void)[] = [];
  oncomplete: Handler = null; onabort: Handler = null; onerror: Handler = null; private failed = false; private timer = false;
  private opened = new Map<string, FakeStore>();
  constructor(public mode: IDBTransactionMode, public db: FakeDb, private storeName: string) { later(() => this.poke()); }
  canRun() { if (this.mode !== 'readwrite') return true; if (this.db.lock && this.db.lock !== this) return false; this.db.lock = this; return true; }
  private release() { if (this.db.lock === this) this.db.lock = null; }
  objectStore(name?: string) {
    const n = name ?? this.storeName, def = this.db.stores.get(n);
    if (!def) throw err('NotFoundError');
    let s = this.opened.get(n);
    if (!s) { s = new FakeStore(this, def.data, def.keyPath, this.db); this.opened.set(n, s); }
    return s as unknown as IDBObjectStore;
  }
  poke() { if (this.timer) return; this.timer = true; later(() => { this.timer = false; if (!this.finished && this.pending === 0) { this.finished = true; this.release(); if (this.failed) return; this.oncomplete?.(); } }); }
  fail(e: DOMException, bubble: boolean) { this.error = e; if (bubble) this.onerror?.(); this.abort(e); }
  abort(e: DOMException = err('AbortError')) { if (this.finished) return; this.failed = true; this.finished = true; this.release(); this.error = this.error ?? e; this.undo.reverse().forEach((u) => u()); later(() => this.onabort?.()); }
}
class FakeDb {
  /** One data map per object store (the database has a version, like a browser). */
  stores = new Map<string, { data: Map<string, unknown>; keyPath: string }>(); version = 0;
  objectStoreNames = { contains: (n: string) => this.stores.has(n) }; onversionchange: Handler = null; closed = false; lock: FakeTx | null = null;
  constructor(private owner: FakeIndexedDB) {}
  /** The records of the `frames` store (older tests read it as `db.data`). */
  get data(): Map<string, unknown> { return this.stores.get('frames')?.data ?? new Map(); }
  createObjectStore(name: string, opts?: { keyPath?: string }) { if (!this.stores.has(name)) this.stores.set(name, { data: new Map(), keyPath: opts?.keyPath ?? 'id' }); return {} as IDBObjectStore; }
  transaction(name: string, mode: IDBTransactionMode = 'readonly') {
    if (this.closed) throw err('InvalidStateError');
    if (!this.stores.has(name)) throw err('NotFoundError');
    return new FakeTx(mode, this, name) as unknown as IDBTransaction;
  }
  takeFault(op: Fault['op']) { return this.owner.takeFault(op); }
  close() { this.closed = true; }
}
export class FakeIndexedDB {
  private db: FakeDb | null = null; private faults: Fault[] = []; opens = 0; blocked = false;
  inject(f: Fault) { this.faults.push({ times: 1, ...f }); }
  takeFault(op: Fault['op']): Fault | undefined {
    const i = this.faults.findIndex((f) => f.op === op); if (i < 0) return undefined;
    const f = this.faults[i]; if (--f.times! <= 0) this.faults.splice(i, 1); return f;
  }
  /** Simulates another tab upgrading the database: connected clients get versionchange and must close. */
  versionChange() { this.db?.onversionchange?.(); }
  /** Raw records of one object store (default `frames`), for assertions. */
  records(storeName = 'frames'): unknown[] { return this.db ? [...(this.db.stores.get(storeName)?.data.values() ?? [])] : []; }
  /** Puts a database that already exists at `version` on this "device", with the given records per object store (e.g. a version 1 database holding frames). The next open upgrades it if it asks for a newer version. */
  seed(version: number, stores: Record<string, unknown[]>): void {
    const db = new FakeDb(this); db.version = version;
    for (const [name, rows] of Object.entries(stores)) { db.createObjectStore(name, { keyPath: 'id' }); for (const r of rows) db.stores.get(name)!.data.set(String((r as Record<string, unknown>).id), clone(r)); }
    this.db = db;
  }
  /** Version of the stored database (0 = none yet). */
  get version(): number { return this.db?.version ?? 0; }
  /** Names of the object stores that exist now. */
  storeNames(): string[] { return this.db ? [...this.db.stores.keys()] : []; }
  open(_name: string, version?: number) {
    this.opens++;
    const r = new FakeRequest<FakeDb>();
    later(() => {
      if (this.blocked) { r.onblocked?.(); return; }
      if (this.takeFault('open')) { r.error = err('SecurityError'); r.onerror?.(); return; }
      const want = version ?? 1;
      if (this.db && want < this.db.version) { r.error = err('VersionError'); r.onerror?.(); return; } // asking for an older version than the one on disk fails, as in a browser
      const fresh = !this.db; this.db ??= new FakeDb(this); this.db.closed = false;
      const db = this.db; r.result = db;
      if (fresh || want > db.version) { const oldVersion = db.version; db.version = want; r.onupgradeneeded?.({ oldVersion, newVersion: want }); } // existing object stores and their records are kept
      r.onsuccess?.();
    });
    return r as unknown as IDBOpenDBRequest;
  }
}
