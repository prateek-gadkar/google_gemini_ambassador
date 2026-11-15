#!/usr/bin/env node
/**
 * Build-time check of the real database.
 *
 * This is the one place the project can prove the hosted-storage path works for
 * real. It runs on the build machine — which has internet — using the very same
 * RestStore the site uses, and everything it prints lands in the deployment's
 * build log. A mock is not Supabase; this is.
 *
 * It changes nothing: the write it performs re-saves the document it just read
 * under the same version guard a normal request uses.
 *
 * Strictness:
 *   - neither SUPABASE_URL nor SUPABASE_SERVICE_KEY set  → SKIP, build proceeds
 *     (that is a deliberate local/file-storage deploy)
 *   - either one set, or PREFLIGHT_REQUIRED=1           → failures exit non-zero,
 *     so a half-configured database can never reach students
 */
import { RestStore } from '../lib/rest-store.js';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
const table = process.env.SUPABASE_TABLE || 'state';
const required = process.env.PREFLIGHT_REQUIRED === '1' || Boolean(url || key);

let failures = 0;

const pass = (label, detail) =>
  console.log(`PASS  ${label}${detail ? ` — ${detail}` : ''}`);
const fail = (label, detail) => {
  failures += 1;
  console.log(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
};
const note = (label, detail) =>
  console.log(`NOTE  ${label}${detail ? ` — ${detail}` : ''}`);

function finish() {
  if (failures) {
    console.log(`\ndatabase preflight: ${failures} problem(s)`);
    if (required) process.exitCode = 1;
    else console.log('              (not fatal: no database configured for this deploy)');
  } else {
    console.log('\ndatabase preflight: OK');
  }
}

async function main() {
  if (!url || !key) {
    const detail = 'SUPABASE_URL and SUPABASE_SERVICE_KEY are not both set';
    if (required) fail('database configured', detail);
    else note('database configured', `${detail} — this deploy will use file storage`);
    return finish();
  }

  // Never print the key. The project URL is public and safe to show.
  console.log(`checking ${url.trim().replace(/\/+$/, '')} → table "${table}"`);

  let store;
  try {
    store = await new RestStore({ url, key, table }).init();
  } catch (err) {
    fail('reach the table', err.message);
    console.log(
      '\n  Most likely: the service_role key is wrong, the table does not exist ' +
        '(run app/db/schema.sql), or the project is paused.'
    );
    return finish();
  }
  pass('reached the table', `row present, version ${store.version}`);

  const students = store.read((d) => Object.keys(d.students || {}).length);
  pass('document readable', `${students} registration(s) stored`);
  if (store.read((d) => Boolean(d.secret))) pass('signing secret present');
  else fail('signing secret present', 'missing — every login would break on a restart');

  // The write path: bump the version, leave the data untouched.
  const before = store.version;
  try {
    await store.mutate(() => {});
  } catch (err) {
    fail('write with a version guard', err.message);
    return finish();
  }
  if (store.version === before + 1 && store.version !== null) {
    pass('write with a version guard', `version ${before} → ${store.version}`);
  } else {
    fail('write with a version guard', `expected version ${before + 1}, got ${store.version}`);
  }

  // A separate instance must see the same row. This is the entire reason the
  // data is not a file: two serverless instances, one truth.
  try {
    const other = await new RestStore({ url, key, table }).init();
    const same =
      other.version === store.version &&
      other.read((d) => Object.keys(d.students || {}).length) === students;
    if (same) pass('a second instance sees the same row', `version ${other.version}`);
    else fail('a second instance sees the same row', `version ${other.version} vs ${store.version}`);
  } catch (err) {
    fail('a second instance sees the same row', err.message);
  }

  // The document holds names and the admin key, so it must not be readable
  // without credentials. The schema turns on row level security; this proves it.
  try {
    const res = await fetch(`${store.base}/rest/v1/${table}?select=id`, {
      signal: AbortSignal.timeout(10000),
    });
    if (res.status === 401 || res.status === 403) {
      pass('unauthenticated read refused', `HTTP ${res.status}`);
    } else if (res.ok) {
      fail('unauthenticated read refused', `HTTP ${res.status} — the table is public, check row level security`);
    } else {
      note('unauthenticated read refused', `HTTP ${res.status}`);
    }
  } catch (err) {
    note('unauthenticated read refused', `not checked — ${err.message}`);
  }

  finish();
}

main()
  .catch((err) => {
    fail('preflight crashed', err && err.stack ? err.stack.split('\n')[0] : String(err));
    finish();
  })
  .finally(() => {
    // Leave promptly: the HTTP client keeps sockets open for a few idle seconds
    // and a build step should not wait for them. Unref'd, so it only fires if
    // something else is holding the process open.
    const guard = setTimeout(() => process.exit(process.exitCode ?? 0), 1500);
    guard.unref?.();
  });
