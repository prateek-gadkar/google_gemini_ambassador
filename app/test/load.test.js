import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../server.js';

const ADMIN_KEY = 'load-test-key';

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64'
);

function client(base) {
  let cookie = '';
  return {
    async request(url, options = {}) {
      const headers = { ...(options.headers || {}) };
      if (cookie) headers.cookie = cookie;
      if (options.json !== undefined) headers['content-type'] = 'application/json';
      const res = await fetch(base + url, {
        method: options.method || 'GET',
        headers,
        body: options.json !== undefined ? JSON.stringify(options.json) : options.body,
      });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) cookie = setCookie.split(';')[0];
      const type = res.headers.get('content-type') || '';
      const body = type.includes('application/json') ? await res.json() : await res.text();
      return { status: res.status, body };
    },
  };
}

test('seventy students register, submit, get approved and download certificates concurrently', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsa-load-data-'));
  const assetsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsa-load-assets-'));
  const { server, store } = await createServer({ dataDir, assetsDir, adminKey: ADMIN_KEY });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  t.after(() => new Promise((resolve) => server.close(resolve)));

  // Enable downloads the way an organiser would.
  await fetch(base + '/api/admin/template', {
    method: 'POST',
    headers: { 'x-admin-key': ADMIN_KEY },
    body: TINY_PNG,
  });
  await fetch(base + '/api/admin/signature', {
    method: 'POST',
    headers: { 'x-admin-key': ADMIN_KEY },
    body: TINY_PNG,
  });
  await fetch(base + '/api/admin/cert-config', {
    method: 'POST',
    headers: { 'x-admin-key': ADMIN_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ templateReady: true }),
  });

  const TOTAL = 70;
  const students = Array.from({ length: TOTAL }, (_, i) => ({
    name: `Student ${String(i + 1).padStart(2, '0')} Testcase`,
    email: `student${i + 1}@campus.edu`,
    client: client(base),
  }));

  const started = Date.now();

  // 1. Everyone registers at once.
  const registrations = await Promise.all(
    students.map((s) =>
      s.client.request('/api/register', {
        method: 'POST',
        json: { name: s.name, email: s.email, campus: 'Load Test College' },
      })
    )
  );
  registrations.forEach((res, i) => {
    assert.equal(res.status, 201, `registration ${i} failed: ${JSON.stringify(res.body)}`);
  });
  assert.equal(
    store.read((d) => Object.keys(d.students).length),
    TOTAL,
    'no registration was lost under concurrency'
  );

  // 2. Everyone submits both receipts at once.
  const receipts = await Promise.all(
    students.flatMap((s) => [
      s.client.request('/api/tasks/pre/receipt', {
        method: 'POST',
        json: { receipt: `pre:${s.email}` },
      }),
      s.client.request('/api/tasks/post/receipt', {
        method: 'POST',
        json: { receipt: `post:${s.email}` },
      }),
    ])
  );
  receipts.forEach((res, i) => {
    assert.equal(res.status, 200, `receipt ${i} failed: ${JSON.stringify(res.body)}`);
  });

  // 2b. The organiser approves all 140 entries in one burst. Approval is a
  // person pressing a button, but 100 students must not make that slow.
  const admin = client(base);
  const approvals = await Promise.all(
    registrations.flatMap((reg) =>
      ['pre', 'post'].map((key) =>
        admin.request(`/api/admin/students/${reg.body.student.id}/task`, {
          method: 'POST',
          headers: { 'x-admin-key': ADMIN_KEY },
          json: { key, status: 'verified' },
        })
      )
    )
  );
  approvals.forEach((res, i) => {
    assert.equal(res.status, 200, `approval ${i} failed: ${JSON.stringify(res.body)}`);
  });

  // 3. Everyone downloads at once.
  const downloads = await Promise.all(
    students.map((s) =>
      s.client.request('/api/certificate/issue', {
        method: 'POST',
        json: { name: s.name },
      })
    )
  );
  downloads.forEach((res, i) => {
    assert.equal(res.status, 200, `issue ${i} failed: ${JSON.stringify(res.body)}`);
  });

  const serials = new Set(downloads.map((res) => res.body.cert.serial));
  assert.equal(serials.size, TOTAL, 'every certificate got a unique serial');

  downloads.forEach((res, i) => {
    assert.equal(res.body.cert.name, students[i].name, 'name printed matches the registration');
    assert.equal(res.body.cert.serial.length, 13);
  });

  // 4. Data is intact on disk after the burst.
  const reloaded = await store.read((d) => JSON.parse(JSON.stringify(d)));
  assert.equal(Object.keys(reloaded.students).length, TOTAL);
  assert.equal(reloaded.certsIssued, TOTAL);

  const elapsed = Date.now() - started;
  t.diagnostic(
    `${TOTAL} students, ${TOTAL * 6} requests, ${elapsed}ms total ` +
      `(${Math.round((TOTAL * 6) / (elapsed / 1000))} req/s)`
  );

  const list = await admin.request('/api/admin/students', {
    headers: { 'x-admin-key': ADMIN_KEY },
  });
  assert.equal(list.body.stats.total, TOTAL);
  assert.equal(list.body.stats.unlocked, TOTAL);
  assert.equal(list.body.stats.issued, TOTAL);
});

test('the participant cap is enforced, not just advertised', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsa-cap-data-'));
  const assetsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsa-cap-assets-'));
  const { server } = await createServer({ dataDir, assetsDir, adminKey: ADMIN_KEY });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const { CONFIG } = await import('../config.js');
  const limit = CONFIG.maxStudents;

  // Fill the room.
  const filled = await Promise.all(
    Array.from({ length: limit }, (_, i) =>
      fetch(base + '/api/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: `Person ${i}`, email: `p${i}@campus.edu` }),
      })
    )
  );
  assert.equal(filled.filter((r) => r.status === 201).length, limit);

  const overflow = await fetch(base + '/api/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'One Too Many', email: 'overflow@campus.edu' }),
  });
  assert.equal(overflow.status, 409);
  const body = await overflow.json();
  assert.match(body.error, /full/i);
});
