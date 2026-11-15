#!/usr/bin/env node
/**
 * End-to-end check of a running site, with no browser.
 *
 * Registers a throwaway student, walks the exact path a real one walks —
 * locked with one task done, unlocked with two, wrong name refused, certificate
 * issued — and then deletes the student so the roster is untouched.
 *
 * Run it by hand:
 *   node app/scripts/smoke.mjs https://your-site.vercel.app <admin-key>
 *
 * The deploy pipeline runs it automatically against the live production
 * deployment (see preflight.mjs), because that is the only way to prove the
 * hosted site really works from a machine that cannot browse it.
 */

const NAME = 'Smoke Test';
const RECEIPT = 'Smoke test: this receipt exists only to prove the gate works.';

function makeClient(base) {
  let token = '';
  return {
    get token() {
      return token;
    },
    set token(v) {
      token = v;
    },
    async request(path, options = {}) {
      const headers = { ...(options.headers || {}) };
      if (token && !headers.authorization) headers.authorization = `Bearer ${token}`;
      if (options.json !== undefined) headers['content-type'] = 'application/json';
      const res = await fetch(base + path, {
        method: options.method || 'GET',
        headers,
        body: options.json !== undefined ? JSON.stringify(options.json) : undefined,
        redirect: 'manual',
        signal: AbortSignal.timeout(30000),
      });
      const type = res.headers.get('content-type') || '';
      const body = type.includes('application/json')
        ? await res.json().catch(() => null)
        : await res.text();
      return { status: res.status, body, headers: res.headers };
    },
  };
}

export async function runSmoke({ base, adminKey = '', log = console.log, strict = false }) {
  const checks = [];
  const record = (ok, label, detail = '') => {
    checks.push({ ok, label, detail });
    log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
    return ok;
  };
  const skip = (label, detail = '') => {
    checks.push({ ok: true, skipped: true, label, detail });
    log(`SKIP  ${label}${detail ? ` — ${detail}` : ''}`);
    return true;
  };

  const target = String(base).replace(/\/+$/, '');
  log(`smoke testing ${target}`);

  const client = makeClient(target);
  let studentId = null;

  try {
    // --- the site is up, and it is using the database it should be ---------
    let health;
    try {
      health = await client.request('/healthz');
    } catch (err) {
      record(false, 'the site answers', err.message);
      return summarise();
    }
    record(health.status === 200 && health.body?.ok === true, 'the site answers', `HTTP ${health.status}`);
    record(
      health.body?.storage === 'postgres',
      'storage is the hosted database',
      health.body?.storage ? `storage: ${health.body.storage}` : 'no storage reported'
    );

    const page = await client.request('/');
    record(
      page.status === 200 && String(page.body).includes('<html'),
      'the student page is served',
      `HTTP ${page.status}`
    );

    const art = await client.request('/assets/certificate-template.jpg');
    record(
      art.status === 200 && (art.headers.get('content-type') || '').includes('image'),
      'the certificate artwork is reachable',
      `HTTP ${art.status}, ${art.headers.get('content-type')}`
    );

    // --- register ----------------------------------------------------------
    const email = `smoke-${Date.now()}@example.com`;
    const reg = await client.request('/api/register', {
      method: 'POST',
      json: { name: NAME, email, campus: 'Smoke test' },
    });
    studentId = reg.body?.student?.id || null;
    if (reg.status !== 201 || !studentId) {
      record(false, 'a student can register', `HTTP ${reg.status} ${JSON.stringify(reg.body).slice(0, 160)}`);
      return summarise();
    }
    client.token = reg.body.token || '';
    record(true, 'a student can register', 'id issued, session token returned');

    // --- the gate: one of two tasks is not enough --------------------------
    let me = await client.request('/api/me');
    record(me.body?.student?.unlocked === false, 'a new student is locked', '');

    const pre = await client.request('/api/tasks/pre/receipt', { method: 'POST', json: { receipt: RECEIPT } });
    record(pre.status === 200, 'the first receipt is accepted', `HTTP ${pre.status}`);

    me = await client.request('/api/me');
    record(me.body?.student?.unlocked === false, 'one task of two is still locked', '');

    const post = await client.request('/api/tasks/post/receipt', { method: 'POST', json: { receipt: RECEIPT } });
    record(post.status === 200, 'the second receipt is accepted', `HTTP ${post.status}`);

    me = await client.request('/api/me');
    const unlocked = me.body?.student?.unlocked === true;
    record(unlocked, 'two tasks unlock the certificate', '');

    if (!unlocked) return summarise();

    // --- issuing -----------------------------------------------------------
    const wrong = await client.request('/api/certificate/issue', {
      method: 'POST',
      json: { name: 'Someone Else Entirely' },
    });
    record(wrong.status === 403, 'a different name is refused', `HTTP ${wrong.status}`);

    const view = me.body?.cert || {};
    if (!view.signatureReady) {
      skip('a certificate is issued', 'no signature uploaded yet, so the site refuses by design');
    } else {
      const issued = await client.request('/api/certificate/issue', { method: 'POST', json: { name: NAME } });
      record(
        issued.status === 200 && Boolean(issued.body?.cert?.serial),
        'a certificate is issued',
        `HTTP ${issued.status}${issued.body?.cert?.serial ? `, serial ${issued.body.cert.serial}` : ''}`
      );
      const again = await client.request('/api/certificate/issue', { method: 'POST', json: { name: NAME } });
      record(
        again.body?.cert?.serial === issued.body?.cert?.serial,
        'the same student gets the same serial twice',
        'no duplicate serials'
      );
    }
  } finally {
    // --- leave nothing behind ---------------------------------------------
    if (studentId) {
      if (!adminKey) {
        record(false, 'the test registration is removed', 'no admin key, so it was left in the roster');
      } else {
        const removal = await makeClient(target).request(`/api/admin/students/${studentId}`, {
          method: 'DELETE',
          headers: { 'x-admin-key': adminKey },
        });
        record(removal.status === 200, 'the test registration is removed', `HTTP ${removal.status}`);
      }
    }
  }

  // The checks have all been recorded by now; this is what the caller reads.
  return summarise();

  function summarise() {
    const failed = checks.filter((c) => !c.ok);
    const ran = checks.filter((c) => !c.skipped).length;
    if (failed.length) {
      log(`\nsmoke test: ${failed.length} of ${ran} checks failed`);
      if (strict) process.exitCode = 1;
      return { ok: false, checks };
    }
    log(`\nsmoke test: ${ran} checks passed`);
    return { ok: true, checks };
  }
}

// --- CLI -------------------------------------------------------------------
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) {
  const base = process.argv[2] || process.env.SMOKE_URL || '';
  const adminKey = process.argv[3] || process.env.ADMIN_KEY || '';
  if (!base) {
    console.log('usage: node app/scripts/smoke.mjs <base-url> [admin-key]');
    process.exit(2);
  }
  runSmoke({ base, adminKey, strict: true }).catch((err) => {
    console.error('smoke test crashed:', err);
    process.exit(1);
  });
}
