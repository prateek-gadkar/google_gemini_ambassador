import { blankDoc } from './store.js';

/**
 * Serverless-safe storage.
 *
 * Vercel wipes the filesystem between requests and may serve two requests on
 * different instances at once, so the whole document lives in one row of a
 * hosted Postgres table reached over its REST API (PostgREST — what Supabase
 * exposes). No SQL driver, no dependencies, nothing to install.
 *
 * The table is one row holding the entire document plus a version number:
 *
 *   create table state (
 *     id      int primary key,
 *     doc     jsonb not null,
 *     version int  not null default 0
 *   );
 *
 * Writes are conditional on the version we read — `... where id = 1 and
 * version = <seen>` — so two instances cannot silently overwrite each other.
 * A losing writer reloads, re-runs its change and retries.
 */
const MAX_ATTEMPTS = 6;

class VersionConflict extends Error {}

export class RestStore {
  constructor(options = {}) {
    this.base = String(options.url || '').replace(/\/+$/, '');
    this.key = options.key || '';
    this.table = options.table || 'state';
    this.docId = options.docId ?? 1;
    this.timeoutMs = options.timeoutMs || 15000;
    this.data = blankDoc();
    this.version = null;
    this._queue = Promise.resolve();
    if (!this.base) throw new Error('RestStore needs a url');
  }

  headers(extra = {}) {
    return {
      apikey: this.key,
      Authorization: `Bearer ${this.key}`,
      'Content-Type': 'application/json',
      ...extra,
    };
  }

  url(query = '') {
    return `${this.base}/rest/v1/${this.table}${query}`;
  }

  async request(url, options = {}) {
    const res = await fetch(url, {
      ...options,
      headers: this.headers(options.headers || {}),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await res.text();
    let body = null;
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    return { ok: res.ok, status: res.status, body, text };
  }

  async readRow() {
    const res = await this.request(this.url(`?id=eq.${this.docId}&select=doc,version`));
    if (!res.ok) {
      throw new Error(`storage read failed (${res.status}): ${res.text.slice(0, 200)}`);
    }
    if (!Array.isArray(res.body) || res.body.length === 0) return null;
    return { doc: res.body[0].doc, version: res.body[0].version };
  }

  async createRow() {
    const res = await this.request(this.url(), {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify([{ id: this.docId, doc: this.data, version: 0 }]),
    });
    // 409 means somebody else created it first; the caller re-reads.
    if (!res.ok && res.status !== 409) {
      throw new Error(`storage init failed (${res.status}): ${res.text.slice(0, 300)}`);
    }
  }

  async init() {
    let row = await this.readRow();
    if (!row) {
      await this.createRow();
      row = await this.readRow();
    }
    if (!row) {
      throw new Error(
        'storage table is not readable. Check the table name, the service key, ' +
          'and that row level security allows the service key.'
      );
    }
    this.adopt(row);
    return this;
  }

  adopt(row) {
    const base = blankDoc();
    const doc = row.doc && typeof row.doc === 'object' ? row.doc : {};
    this.data = {
      ...base,
      ...doc,
      students: doc.students || {},
      certConfig: { ...base.certConfig, ...(doc.certConfig || {}) },
      secret: doc.secret || base.secret,
    };
    this.version = row.version;
  }

  /** Pull the latest document. Called once per request so reads are never stale. */
  async refresh() {
    const row = await this.readRow();
    if (!row) {
      this.data = blankDoc();
      this.version = null;
      return;
    }
    this.adopt(row);
  }

  async flush() {
    if (this.version === null) {
      await this.createRow();
      const row = await this.readRow();
      if (row) this.adopt(row);
      return;
    }
    const nextVersion = this.version + 1;
    const res = await this.request(
      this.url(`?id=eq.${this.docId}&version=eq.${this.version}`),
      {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ doc: this.data, version: nextVersion }),
      }
    );
    if (!res.ok) {
      throw new Error(`storage write failed (${res.status}): ${res.text.slice(0, 200)}`);
    }
    if (!Array.isArray(res.body) || res.body.length === 0) {
      // Nobody matched our version: someone else wrote first.
      throw new VersionConflict('version conflict');
    }
    this.version = nextVersion;
  }

  read(fn) {
    return fn(this.data);
  }

  /**
   * Applies a change with exclusive access and retries if another instance
   * wrote in between. `fn` must be safe to run against a freshly loaded copy.
   */
  mutate(fn) {
    const run = async () => {
      let lastError;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        try {
          const result = await fn(this.data);
          await this.flush();
          return result;
        } catch (err) {
          if (!(err instanceof VersionConflict)) throw err;
          lastError = err;
          await this.refresh();
          await new Promise((r) => setTimeout(r, 20 * (attempt + 1)));
        }
      }
      throw lastError || new Error('storage write kept conflicting');
    };
    this._queue = this._queue.then(run, run);
    return this._queue;
  }
}
