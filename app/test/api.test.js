import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../server.js';

const ADMIN_KEY = 'test-admin-key-abcdef';

// A real 1x1 PNG, used to stand in for the certificate template.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64'
);

function makeClient(base) {
  let cookie = '';
  return {
    get cookie() { return cookie; },
    async request(url, options = {}) {
      const headers = { ...(options.headers || {}) };
      if (cookie) headers.cookie = cookie;
      if (options.json !== undefined) {
        headers['content-type'] = 'application/json';
      }
      const res = await fetch(base + url, {
        method: options.method || 'GET',
        headers,
        body: options.json !== undefined ? JSON.stringify(options.json) : options.body,
        redirect: 'manual',
      });
      const setCookie = res.headers.get('set-cookie');
      if (setCookie) {
        const pair = setCookie.split(';')[0];
        cookie = /Max-Age=0/.test(setCookie) ? '' : pair;
      }
      const type = res.headers.get('content-type') || '';
      const body = type.includes('application/json')
        ? await res.json()
        : await res.text();
      return { status: res.status, body, headers: res.headers };
    },
  };
}

async function withServer(fn) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsa-data-'));
  const assetsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsa-assets-'));
  const { server, store } = await createServer({ dataDir, assetsDir, adminKey: ADMIN_KEY });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn({ base, store, dataDir, assetsDir, admin: makeClient(base) });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

const adminHeaders = { 'x-admin-key': ADMIN_KEY };

/**
 * Approving each entry is an admin act now, not a side effect of submitting, so
 * every test that needs an unlocked student does it the way the organiser will
 * on the day.
 */
async function approve(admin, studentId, keys = ['pre', 'post']) {
  for (const key of keys) {
    const res = await admin.request(`/api/admin/students/${studentId}/task`, {
      method: 'POST',
      headers: adminHeaders,
      json: { key, status: 'verified' },
    });
    assert.equal(res.status, 200, `approving ${key}`);
  }
}

// ---------------------------------------------------------------------------
test('health check reports an empty, template-less install', async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(base + '/api/health');
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.students, 0);
    assert.equal(body.templateReady, false);
  });
});

test('a signed-out visitor sees no student data', async () => {
  await withServer(async ({ base }) => {
    const client = makeClient(base);
    const res = await client.request('/api/me');
    assert.equal(res.status, 200);
    assert.equal(res.body.signedIn, false);
    assert.equal(res.body.student, null);
  });
});

test('registration validates input and rejects duplicates', async () => {
  await withServer(async ({ base }) => {
    const client = makeClient(base);

    const bad = await client.request('/api/register', { method: 'POST', json: { name: 'A', email: 'nope' } });
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /at least 2/);

    const badEmail = await client.request('/api/register', { method: 'POST', json: { name: 'Test Student', email: 'nope' } });
    assert.equal(badEmail.status, 400);
    assert.match(badEmail.body.error, /email/i);

    const ok = await client.request('/api/register', {
      method: 'POST',
      json: { name: 'Ananya Sharma', email: 'Ananya@Campus.edu', campus: 'Test College' },
    });
    assert.equal(ok.status, 201);
    assert.equal(ok.body.student.name, 'Ananya Sharma');
    assert.equal(ok.body.student.email, 'ananya@campus.edu', 'email is normalised');
    assert.equal(ok.body.student.unlocked, false);

    const dupe = await client.request('/api/register', {
      method: 'POST',
      json: { name: 'Someone Else', email: 'ananya@campus.edu' },
    });
    assert.equal(dupe.status, 409);
  });
});

test('the certificate stays locked until every required task is approved', async () => {
  await withServer(async ({ base, admin }) => {
    const client = makeClient(base);
    await client.request('/api/register', {
      method: 'POST',
      json: { name: 'Ananya Sharma', email: 'a@campus.edu' },
    });

    let me = await client.request('/api/me');
    assert.equal(me.body.student.unlocked, false);
    assert.deepEqual(me.body.student.missing, ['Pre-survey form', 'Post-survey form']);

    const early = await client.request('/api/certificate/issue', {
      method: 'POST',
      json: { name: 'Ananya Sharma' },
    });
    assert.equal(early.status, 403);
    assert.match(early.body.error, /Not unlocked yet/);

    // Too-short receipt is refused.
    const tooShort = await client.request('/api/tasks/pre/receipt', {
      method: 'POST',
      json: { receipt: 'ok' },
    });
    assert.equal(tooShort.status, 400);

    const pre = await client.request('/api/tasks/pre/receipt', {
      method: 'POST',
      json: { receipt: 'https://forms.gle/pretest - submitted 10:04' },
    });
    assert.equal(pre.status, 200);

    me = await client.request('/api/me');
    const studentId = me.body.student.id;
    assert.equal(me.body.student.unlocked, false, 'one of two tasks is not enough');
    assert.deepEqual(
      me.body.student.missing,
      ['Pre-survey form', 'Post-survey form'],
      'a waiting entry still counts as missing until the organiser approves it'
    );
    assert.deepEqual(
      me.body.student.waitingFor,
      ['Pre-survey form'],
      'a submitted receipt waits for approval instead of counting'
    );
    assert.deepEqual(me.body.student.untouched, ['Post-survey form']);

    const stillLocked = await client.request('/api/certificate/issue', {
      method: 'POST',
      json: { name: 'Ananya Sharma' },
    });
    assert.equal(stillLocked.status, 403);

    const post = await client.request('/api/tasks/post/receipt', {
      method: 'POST',
      json: { receipt: 'https://forms.gle/posttest - submitted 11:52' },
    });
    assert.equal(post.status, 200);
    assert.equal(post.body.student.unlocked, false, 'submitting is a claim, not a pass');
    assert.deepEqual(post.body.student.waitingFor, ['Pre-survey form', 'Post-survey form']);
    assert.deepEqual(post.body.student.untouched, []);

    // The organiser approves both. Only then does the gate open.
    await approve(admin, studentId);
    me = await client.request('/api/me');
    assert.equal(me.body.student.unlocked, true, 'approval is what unlocks');
    assert.deepEqual(me.body.student.missing, []);
    assert.deepEqual(me.body.student.waitingFor, []);

    // Unlocked, but the artwork is missing: still no certificate.
    const noTemplate = await client.request('/api/certificate/issue', {
      method: 'POST',
      json: { name: 'Ananya Sharma' },
    });
    assert.equal(noTemplate.status, 409);
    assert.match(noTemplate.body.error, /artwork/i);
  });
});

test('unknown task keys are rejected', async () => {
  await withServer(async ({ base }) => {
    const client = makeClient(base);
    await client.request('/api/register', {
      method: 'POST',
      json: { name: 'Ananya Sharma', email: 'a@campus.edu' },
    });
    const res = await client.request('/api/tasks/nonsense/receipt', {
      method: 'POST',
      json: { receipt: 'something long enough' },
    });
    assert.equal(res.status, 404);
  });
});

test('the name typed at download must match the registration', async () => {
  await withServer(async ({ base, admin }) => {
    const client = makeClient(base);
    await client.request('/api/register', {
      method: 'POST',
      json: { name: 'Ananya Sharma', email: 'a@campus.edu' },
    });
    await client.request('/api/tasks/pre/receipt', { method: 'POST', json: { receipt: 'pre done' } });
    await client.request('/api/tasks/post/receipt', { method: 'POST', json: { receipt: 'post done' } });
    await approve(admin, (await client.request('/api/me')).body.student.id);

    // Admin uploads artwork, then the signature, then enables downloads.
    const upload = await admin.request('/api/admin/template', {
      method: 'POST',
      headers: adminHeaders,
      body: TINY_PNG,
    });
    assert.equal(upload.status, 200);
    assert.equal(upload.body.cert.templateReady, false, 'upload alone must not enable downloads');
    assert.equal(upload.body.cert.signatureReady, false);

    const sig = await admin.request('/api/admin/signature', {
      method: 'POST',
      headers: adminHeaders,
      body: TINY_PNG,
    });
    assert.equal(sig.status, 200);
    assert.equal(sig.body.cert.signatureReady, true);
    assert.equal(sig.body.cert.ready, false, 'still not enabled');

    const enabled = await admin.request('/api/admin/cert-config', {
      method: 'POST',
      headers: adminHeaders,
      json: { name: { x: 0.5, y: 0.55, size: 0.05 }, templateReady: true },
    });
    assert.equal(enabled.status, 200);
    assert.equal(enabled.body.cert.templateReady, true);
    assert.equal(enabled.body.cert.ready, true);

    const wrong = await client.request('/api/certificate/issue', {
      method: 'POST',
      json: { name: 'Ananya Sharmaa' },
    });
    assert.equal(wrong.status, 403);
    assert.match(wrong.body.error, /does not match/);

    const blank = await client.request('/api/certificate/issue', { method: 'POST', json: { name: '   ' } });
    assert.equal(blank.status, 400);

    const good = await client.request('/api/certificate/issue', {
      method: 'POST',
      json: { name: '  ananya   SHARMA ' },
    });
    assert.equal(good.status, 200);
    assert.match(good.body.cert.serial, /^CERT-[0-9A-F]{8}$/);
    assert.equal(good.body.cert.name, 'Ananya Sharma', 'the registered spelling is what gets printed');
    assert.equal(good.body.render.templateReady, true);
    assert.equal(good.body.render.templateUrl, '/assets/certificate-template.png');
    assert.equal(good.body.render.fields.name.y, 0.55);

    const again = await client.request('/api/certificate/issue', {
      method: 'POST',
      json: { name: 'Ananya Sharma' },
    });
    assert.equal(again.body.cert.serial, good.body.cert.serial, 're-issuing is idempotent');
  });
});

test('admin actions require the key, and rejection re-locks the certificate', async () => {
  await withServer(async ({ base, admin }) => {
    const client = makeClient(base);
    const reg = await client.request('/api/register', {
      method: 'POST',
      json: { name: 'Ananya Sharma', email: 'a@campus.edu' },
    });
    const studentId = reg.body.student.id;

    // No key / wrong key.
    const noKey = await fetch(base + '/api/admin/students');
    assert.equal(noKey.status, 403);
    const badKey = await fetch(base + '/api/admin/students', { headers: { 'x-admin-key': 'wrong' } });
    assert.equal(badKey.status, 403);

    await client.request('/api/tasks/pre/receipt', { method: 'POST', json: { receipt: 'pre done' } });
    await client.request('/api/tasks/post/receipt', { method: 'POST', json: { receipt: 'post done' } });
    await approve(admin, studentId);

    await admin.request('/api/admin/template', { method: 'POST', headers: adminHeaders, body: TINY_PNG });
    await admin.request('/api/admin/signature', { method: 'POST', headers: adminHeaders, body: TINY_PNG });
    await admin.request('/api/admin/cert-config', {
      method: 'POST', headers: adminHeaders, json: { templateReady: true },
    });

    const issued = await client.request('/api/certificate/issue', {
      method: 'POST', json: { name: 'Ananya Sharma' },
    });
    assert.equal(issued.status, 200);
    const serial = issued.body.cert.serial;

    const list = await admin.request('/api/admin/students', { headers: adminHeaders });
    assert.equal(list.body.stats.total, 1);
    assert.equal(list.body.stats.unlocked, 1);
    assert.equal(list.body.stats.issued, 1);
    assert.equal(list.body.students[0].cert.serial, serial);

    // Reject the post-survey: the certificate must lock again and be revoked.
    const reject = await admin.request(`/api/admin/students/${studentId}/task`, {
      method: 'POST', headers: adminHeaders, json: { key: 'post', status: 'rejected' },
    });
    assert.equal(reject.status, 200);
    assert.equal(reject.body.student.unlocked, false);
    assert.equal(reject.body.student.cert, null, 'revoked');

    const afterReject = await client.request('/api/certificate/issue', {
      method: 'POST', json: { name: 'Ananya Sharma' },
    });
    assert.equal(afterReject.status, 403);

    // Put it back.
    const verify = await admin.request(`/api/admin/students/${studentId}/task`, {
      method: 'POST', headers: adminHeaders, json: { key: 'post', status: 'verified' },
    });
    assert.equal(verify.body.student.unlocked, true);

    const reissued = await client.request('/api/certificate/issue', {
      method: 'POST', json: { name: 'Ananya Sharma' },
    });
    assert.equal(reissued.status, 200);

    // CSV contains the new serial and escapes commas/quotes safely.
    const csv = await admin.request('/api/admin/export.csv', { headers: adminHeaders });
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get('content-type'), /text\/csv/);
    assert.match(csv.body, /cert_serial/);
    assert.match(csv.body, /"Ananya Sharma","a@campus\.edu"/);
    assert.ok(csv.body.includes('"' + reissued.body.cert.serial + '"'));
  });
});

test('admin status values are validated', async () => {
  await withServer(async ({ base, admin }) => {
    const client = makeClient(base);
    const reg = await client.request('/api/register', {
      method: 'POST', json: { name: 'Ananya Sharma', email: 'a@campus.edu' },
    });
    const id = reg.body.student.id;

    const bad = await admin.request(`/api/admin/students/${id}/task`, {
      method: 'POST', headers: adminHeaders, json: { key: 'post', status: 'maybe' },
    });
    assert.equal(bad.status, 400);

    const unknownTask = await admin.request(`/api/admin/students/${id}/task`, {
      method: 'POST', headers: adminHeaders, json: { key: 'nope', status: 'verified' },
    });
    assert.equal(unknownTask.status, 404);

    const unknownStudent = await admin.request('/api/admin/students/doesnotexist/task', {
      method: 'POST', headers: adminHeaders, json: { key: 'pre', status: 'verified' },
    });
    assert.equal(unknownStudent.status, 404);
  });
});

test('downloads can never be enabled without a signature on disk', async () => {
  await withServer(async ({ base, admin }) => {
    const res = await admin.request('/api/admin/cert-config', {
      method: 'POST', headers: adminHeaders, json: { templateReady: true },
    });
    assert.equal(res.status, 200);
    // The official artwork ships with the app, so it is adopted on boot...
    assert.match(res.body.cert.templateUrl || '', /certificate-template/);
    // ...but an unsigned certificate is not a certificate, so downloads stay off.
    assert.equal(res.body.cert.templateReady, false, 'refused: no signature yet');
    assert.equal(res.body.cert.signatureReady, false);
    assert.equal(res.body.cert.ready, false);
  });
});

test('uploaded files land in the data directory so a deploy cannot lose them', async (t) => {
  // Production shape: no assetsDir override, exactly like a mounted disk.
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsa-prod-'));
  const { server } = await createServer({ dataDir, adminKey: ADMIN_KEY });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const upload = await fetch(base + '/api/admin/signature', {
    method: 'POST',
    headers: { 'x-admin-key': ADMIN_KEY },
    body: TINY_PNG,
  });
  assert.equal(upload.status, 200);

  const onDisk = path.join(dataDir, 'assets', 'signature.png');
  assert.ok(fs.existsSync(onDisk), 'signature written under DATA_DIR, not next to the code');

  const served = await fetch(base + '/assets/signature.png');
  assert.equal(served.status, 200);
  assert.match(served.headers.get('content-type'), /image\/png/);

  // The bundled artwork still resolves through the same /assets path.
  const artwork = await fetch(base + '/assets/certificate-template.jpg');
  assert.equal(artwork.status, 200);
  assert.match(artwork.headers.get('content-type'), /image\/jpeg/);
});

test('artwork without a signature cannot be enabled, and issues nothing', async () => {
  await withServer(async ({ base, admin }) => {
    const client = makeClient(base);
    await client.request('/api/register', {
      method: 'POST', json: { name: 'Ananya Sharma', email: 'a@campus.edu' },
    });
    await client.request('/api/tasks/pre/receipt', { method: 'POST', json: { receipt: 'pre done' } });
    await client.request('/api/tasks/post/receipt', { method: 'POST', json: { receipt: 'post done' } });
    await approve(admin, (await client.request('/api/me')).body.student.id);

    await admin.request('/api/admin/template', { method: 'POST', headers: adminHeaders, body: TINY_PNG });

    // Enabling without a signature must be refused, not silently accepted.
    const enabled = await admin.request('/api/admin/cert-config', {
      method: 'POST', headers: adminHeaders, json: { templateReady: true },
    });
    assert.equal(enabled.status, 200);
    assert.equal(enabled.body.cert.templateReady, false, 'no signature, so no enabling');
    assert.equal(enabled.body.cert.ready, false);

    const issue = await client.request('/api/certificate/issue', {
      method: 'POST', json: { name: 'Ananya Sharma' },
    });
    assert.equal(issue.status, 409);

    // Now add the signature and try again.
    await admin.request('/api/admin/signature', { method: 'POST', headers: adminHeaders, body: TINY_PNG });
    const retry = await admin.request('/api/admin/cert-config', {
      method: 'POST', headers: adminHeaders, json: { templateReady: true },
    });
    assert.equal(retry.body.cert.ready, true);

    const issued = await client.request('/api/certificate/issue', {
      method: 'POST', json: { name: 'Ananya Sharma' },
    });
    assert.equal(issued.status, 200);
    assert.equal(issued.body.render.signatureUrl, '/assets/signature.png');
  });
});

test('a non-image signature upload is refused', async () => {
  await withServer(async ({ base, admin }) => {
    const res = await admin.request('/api/admin/signature', {
      method: 'POST',
      headers: { ...adminHeaders, 'content-type': 'application/pdf' },
      body: Buffer.from('%PDF-1.4 not really an image'),
    });
    assert.equal(res.status, 400);
  });
});

test('a non-image template upload is refused', async () => {
  await withServer(async ({ base, admin }) => {
    const res = await admin.request('/api/admin/template', {
      method: 'POST',
      headers: { ...adminHeaders, 'content-type': 'application/pdf' },
      body: Buffer.from('%PDF-1.4 not really an image'),
    });
    assert.equal(res.status, 400);
  });
});

test('login works for a registered email and fails for an unknown one', async () => {
  await withServer(async ({ base }) => {
    const first = makeClient(base);
    await first.request('/api/register', {
      method: 'POST', json: { name: 'Ananya Sharma', email: 'a@campus.edu' },
    });

    const second = makeClient(base);
    const missing = await second.request('/api/login', {
      method: 'POST', json: { email: 'nobody@campus.edu' },
    });
    assert.equal(missing.status, 404);

    const ok = await second.request('/api/login', {
      method: 'POST', json: { email: 'A@Campus.edu' },
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.student.email, 'a@campus.edu');

    const me = await second.request('/api/me');
    assert.equal(me.body.signedIn, true);
    assert.equal(me.body.student.name, 'Ananya Sharma');

    const out = await second.request('/api/logout', { method: 'POST' });
    assert.equal(out.status, 200);
    const after = await second.request('/api/me');
    assert.equal(after.body.signedIn, false);
  });
});

test('a browser that refuses cookies still stays signed in', async () => {
  // Exactly the preview-iframe and blocked-third-party-cookie case: no cookie
  // is ever stored or sent, only the Bearer token from the response body.
  await withServer(async ({ base }) => {
    const reg = await fetch(base + '/api/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Ananya Sharma', email: 'a@campus.edu' }),
    });
    const regBody = await reg.json();
    assert.equal(reg.status, 201);
    assert.ok(regBody.token, 'registration returns a token');
    assert.ok(reg.headers.get('set-cookie'), 'the cookie is still offered as a fallback');

    const auth = { authorization: 'Bearer ' + regBody.token };

    // No cookie header at all from here on.
    const me = await fetch(base + '/api/me', { headers: auth });
    const meBody = await me.json();
    assert.equal(meBody.signedIn, true, 'the token alone identifies the student');
    assert.equal(meBody.student.name, 'Ananya Sharma');

    const receipt = await fetch(base + '/api/tasks/pre/receipt', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ receipt: 'pre done' }),
    });
    assert.equal(receipt.status, 200);

    const post = await fetch(base + '/api/tasks/post/receipt', {
      method: 'POST',
      headers: { ...auth, 'content-type': 'application/json' },
      body: JSON.stringify({ receipt: 'post done' }),
    });
    const postBody = await post.json();
    assert.equal(postBody.student.unlocked, false, 'submitted, so waiting — the session is what matters here');
    assert.equal(postBody.student.waitingFor.length, 2);

    // Sign in on a fresh "browser": token comes back again.
    const login = await fetch(base + '/api/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@campus.edu' }),
    });
    const loginBody = await login.json();
    assert.ok(loginBody.token);
    const me2 = await (await fetch(base + '/api/me', {
      headers: { authorization: 'Bearer ' + loginBody.token },
    })).json();
    assert.equal(me2.signedIn, true);
    assert.equal(me2.student.unlocked, false, 'both entries are still waiting for the organiser');
    assert.deepEqual(
      me2.student.tasks.filter((t) => t.status === 'submitted').map((t) => t.key),
      ['pre', 'post'],
      'task state survives the re-login'
    );
  });
});

test('a forged or tampered bearer token is not accepted', async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(base + '/api/me', { headers: { authorization: 'Bearer made.up' } });
    const body = await res.json();
    assert.equal(body.signedIn, false);

    const reg = await fetch(base + '/api/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Ananya Sharma', email: 'a@campus.edu' }),
    });
    const token = (await reg.json()).token;
    const [body64] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ s: 'someone-else', exp: Date.now() + 1e9 }))
      .toString('base64url');

    const tampered = await (await fetch(base + '/api/me', {
      headers: { authorization: 'Bearer ' + forged + '.' + token.split('.')[1] },
    })).json();
    assert.equal(tampered.signedIn, false, 'payload swap rejected');

    const good = await (await fetch(base + '/api/me', {
      headers: { authorization: 'Bearer ' + token },
    })).json();
    assert.equal(good.signedIn, true);
    assert.ok(body64.length > 0);
  });
});

test('students cannot reach another student’s screenshot', async () => {
  await withServer(async ({ base }) => {
    const first = makeClient(base);
    await first.request('/api/register', {
      method: 'POST', json: { name: 'Ananya Sharma', email: 'a@campus.edu' },
    });
    const upload = await first.request('/api/tasks/pre/proof', {
      method: 'POST', headers: { 'content-type': 'image/png' }, body: TINY_PNG,
    });
    assert.equal(upload.status, 200);
    assert.equal(upload.body.student.tasks[0].hasProof, true);

    const own = await first.request('/api/tasks/pre/proof');
    assert.equal(own.status, 200);

    const other = makeClient(base);
    await other.request('/api/register', {
      method: 'POST', json: { name: 'Rahul Verma', email: 'r@campus.edu' },
    });
    const stolen = await other.request('/api/tasks/pre/proof');
    assert.equal(stolen.status, 404, 'second student has no proof of their own');

    const anonymous = await fetch(base + '/api/tasks/pre/proof');
    assert.equal(anonymous.status, 401);
  });
});

test('paths outside the public folder and unknown routes are refused', async () => {
  await withServer(async ({ base }) => {
    const traversal = await fetch(base + '/..%2f..%2fpackage.json');
    assert.notEqual(traversal.status, 200);

    const sneaky = await fetch(base + '/assets/../../server.js');
    assert.notEqual(sneaky.status, 200);

    const api = await fetch(base + '/api/does-not-exist');
    assert.equal(api.status, 404);

    const html = await fetch(base + '/');
    assert.equal(html.status, 200);
    assert.match(html.headers.get('content-type'), /text\/html/);

    const certPage = await fetch(base + '/certificate');
    assert.equal(certPage.status, 200);
    assert.match(await certPage.text(), /cert-render\.js/);

    const adminPage = await fetch(base + '/admin');
    assert.equal(adminPage.status, 200);

    const styles = await fetch(base + '/styles.css');
    assert.equal(styles.status, 200);
    assert.match(styles.headers.get('content-type'), /text\/css/);

    // The brand marks ship with the app: a page that references them and a
    // deploy that drops them is a page of broken images.
    for (const asset of [
      '/brand/google-g-64.png',
      '/brand/gemini-sparkle.png',
      '/brand/gemini-wordmark.png',
      '/brand/favicon-32.png',
      '/icons.js',
    ]) {
      const res = await fetch(base + asset);
      assert.equal(res.status, 200, `${asset} is served`);
      const body = Buffer.from(await res.arrayBuffer());
      assert.ok(body.length > 500, `${asset} is not an empty file`);
    }

    const page = await (await fetch(base + '/')).text();
    assert.match(page, /brand\/google-g-64\.png/, 'the page carries the Google mark');
    assert.match(page, /brand\/gemini-sparkle\.png/, 'the page carries the Gemini mark');
  });
});

test('the site is reachable from the preview host (no origin allowlist)', async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(base + '/api/health', {
      headers: { origin: 'https://1234-abc.e2b.app', 'x-forwarded-host': '1234-abc.e2b.app' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), null, 'same-origin app: no CORS needed');
  });
});

test('oversized receipt bodies are refused', async () => {
  await withServer(async ({ base }) => {
    const client = makeClient(base);
    await client.request('/api/register', {
      method: 'POST', json: { name: 'Ananya Sharma', email: 'a@campus.edu' },
    });
    const res = await client.request('/api/tasks/pre/receipt', {
      method: 'POST',
      json: { receipt: 'x'.repeat(200 * 1024) },
    });
    assert.ok(res.status === 413 || res.status === 400, `expected refusal, got ${res.status}`);
  });
});

// ---------------------------------------------------------------------------
test('health reports which storage is in use', async () => {
  await withServer(async ({ base }) => {
    const health = await (await fetch(base + '/healthz')).json();
    assert.equal(health.storage, 'file');
    const api = await (await fetch(base + '/api/health')).json();
    assert.equal(api.storage, 'file');
  });
});

test('booting on a serverless host with no database warns instead of failing silently', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsa-data-'));
  const assetsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsa-assets-'));
  const original = console.error;
  const lines = [];
  console.error = (...args) => lines.push(args.join(' '));
  const previous = process.env.VERCEL;
  process.env.VERCEL = '1';
  let server;
  try {
    const started = await createServer({ dataDir, assetsDir, adminKey: ADMIN_KEY });
    server = started.server;
    // The warning belongs at boot, before anyone can register into the void.
    assert.match(lines.join('\n'), /WILL be lost/);
    assert.equal(started.storage, 'file');
  } finally {
    console.error = original;
    if (previous === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previous;
    if (server) await new Promise((resolve) => server.close(resolve));
  }
});

// ---------------------------------------------------------------------------
test('an admin can remove a registration, and nobody else can', async () => {
  await withServer(async ({ base, admin }) => {
    const reg = await admin.request('/api/register', {
      method: 'POST',
      json: { name: 'Smoke Test', email: 'smoke@example.com', campus: 'Test' },
    });
    assert.equal(reg.status, 201);
    const id = reg.body.student.id;

    const asStudent = await admin.request(`/api/admin/students/${id}`, { method: 'DELETE' });
    assert.equal(asStudent.status, 403, 'a student session must not remove anyone');

    const unknown = await admin.request('/api/admin/students/nope-nope', {
      method: 'DELETE',
      headers: adminHeaders,
    });
    assert.equal(unknown.status, 404, 'removing something that is not there is a 404');

    const removed = await admin.request(`/api/admin/students/${id}`, {
      method: 'DELETE',
      headers: adminHeaders,
    });
    assert.equal(removed.status, 200);
    assert.equal(removed.body.removed, true);

    const list = await admin.request('/api/admin/students', { headers: adminHeaders });
    assert.equal(list.body.stats.total, 0, 'the roster is back to empty');
  });
});

// ---------------------------------------------------------------------------
test('a signature supplied through the environment is adopted, so a hosted deploy needs no upload', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsa-data-'));
  const assetsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsa-assets-'));
  const uri = `data:image/png;base64,${TINY_PNG.toString('base64')}`;
  const { server } = await createServer({ dataDir, assetsDir, adminKey: ADMIN_KEY, signatureDataUri: uri });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const me = await (await fetch(base + '/api/me')).json();
    assert.equal(me.cert.signatureReady, true, 'the signature counts as present');
    assert.equal(me.cert.signatureUrl, '/assets/signature.png');
    assert.ok(fs.existsSync(path.join(assetsDir, 'signature.png')), 'and it is on disk for the renderer');
    const served = await fetch(base + '/assets/signature.png');
    assert.equal(served.status, 200, 'the browser can fetch it');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('a signature that is not really an image is refused instead of trusted', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsa-data-'));
  const assetsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsa-assets-'));
  const original = console.error;
  const lines = [];
  console.error = (...args) => lines.push(args.join(' '));
  let server;
  try {
    const started = await createServer({
      dataDir,
      assetsDir,
      adminKey: ADMIN_KEY,
      // Base64 of plain text, which is the shape a wrong paste takes.
      signatureDataUri: Buffer.from('this is not an image, it is a sentence').toString('base64'),
    });
    server = started.server;
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    const me = await (await fetch(base + '/api/me')).json();
    assert.equal(me.cert.signatureReady, false, 'a bad value must not unlock certificates');
    assert.match(lines.join('\n'), /SIGNATURE_DATA_URI/);
  } finally {
    console.error = original;
    if (server) await new Promise((resolve) => server.close(resolve));
  }
});
