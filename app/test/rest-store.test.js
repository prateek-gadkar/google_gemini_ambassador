import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import { RestStore } from '../lib/rest-store.js';
import { createServer } from '../server.js';

/**
 * A faithful stand-in for the PostgREST endpoints RestStore uses. It is not
 * Supabase — it is the contract RestStore is written against, so a mistake in
 * the client logic shows up here. The real service still needs one run before
 * the event, and that is called out in the docs.
 */
function mockPostgrest() {
  const rows = new Map();
  const control = { beforePatch: null, requests: [] };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const body = raw ? JSON.parse(raw) : null;
      control.requests.push({ method: req.method, query: url.search, body });

      const send = (status, payload) => {
        const text = JSON.stringify(payload);
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(text);
      };

      if (!url.pathname.endsWith('/state')) return send(404, { message: 'no such table' });

      const idFilter = url.searchParams.get('id');
      const versionFilter = url.searchParams.get('version');

      if (req.method === 'GET') {
        const out = [];
        for (const [id, row] of rows) {
          if (idFilter && idFilter !== `eq.${id}`) continue;
          out.push({ doc: row.doc, version: row.version });
        }
        return send(200, out);
      }

      if (req.method === 'POST') {
        const incoming = Array.isArray(body) ? body : [body];
        for (const item of incoming) {
          if (rows.has(item.id)) return send(409, { message: 'duplicate key' });
        }
        for (const item of incoming) {
          rows.set(item.id, { doc: item.doc, version: item.version ?? 0 });
        }
        return send(201, incoming);
      }

      if (req.method === 'PATCH') {
        if (control.beforePatch) {
          const hook = control.beforePatch;
          control.beforePatch = null;
          hook(rows);
        }
        const targetId = idFilter ? Number(idFilter.replace('eq.', '')) : null;
        const row = rows.get(targetId);
        const wantVersion = versionFilter ? Number(versionFilter.replace('eq.', '')) : null;
        if (!row || (wantVersion !== null && row.version !== wantVersion)) {
          return send(200, []); // no rows matched, exactly like PostgREST
        }
        row.doc = body.doc;
        row.version = body.version;
        return send(200, [{ doc: row.doc, version: row.version }]);
      }

      return send(405, { message: 'method not allowed' });
    });
  });

  return {
    control,
    rows,
    async listen() {
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      return `http://127.0.0.1:${server.address().port}`;
    },
    close: () =>
      new Promise((r) => {
        server.close(r);
        // undici keeps sockets alive; without this the run hangs until they idle out.
        server.closeAllConnections?.();
      }),
  };
}

async function withMock(fn) {
  const mock = mockPostgrest();
  const url = await mock.listen();
  try {
    await fn({ url, mock });
  } finally {
    await mock.close();
  }
}

// ---------------------------------------------------------------------------
test('a fresh database gets its row created on first use', async () => {
  await withMock(async ({ url, mock }) => {
    assert.equal(mock.rows.size, 0);
    const store = await new RestStore({ url, key: 'service-key' }).init();
    assert.equal(mock.rows.size, 1);
    assert.equal(store.version, 0);
    assert.ok(store.read((d) => d.secret), 'a signing secret was generated');
    assert.deepEqual(store.read((d) => d.students), {});
  });
});

test('writes persist and survive a brand new instance', async () => {
  await withMock(async ({ url }) => {
    const first = await new RestStore({ url, key: 'k' }).init();
    await first.mutate((data) => {
      data.students['s1'] = { id: 's1', name: 'Ananya Sharma', email: 'a@campus.edu', tasks: {} };
    });
    assert.equal(first.version, 1);

    const second = await new RestStore({ url, key: 'k' }).init();
    assert.equal(second.read((d) => d.students.s1.name), 'Ananya Sharma');
    assert.equal(
      second.read((d) => d.secret),
      first.read((d) => d.secret),
      'the signing secret survives, or every session breaks on a cold start'
    );
  });
});

test('two instances writing at the same time both keep their change', async () => {
  await withMock(async ({ url, mock }) => {
    const a = await new RestStore({ url, key: 'k' }).init();
    const b = await new RestStore({ url, key: 'k' }).init();

    // Simulate a write landing between b's read and b's write.
    mock.control.beforePatch = () => {};

    await Promise.all([
      a.mutate((data) => {
        data.students.a = { id: 'a', name: 'A', email: 'a@x.edu', tasks: {} };
      }),
      b.mutate((data) => {
        data.students.b = { id: 'b', name: 'B', email: 'b@x.edu', tasks: {} };
      }),
    ]);

    const final = await new RestStore({ url, key: 'k' }).init();
    const ids = Object.keys(final.read((d) => d.students)).sort();
    assert.deepEqual(ids, ['a', 'b'], 'neither write was lost');
  });
});

test('a losing write is retried against the newest document', async () => {
  await withMock(async ({ url, mock }) => {
    const a = await new RestStore({ url, key: 'k' }).init();
    const b = await new RestStore({ url, key: 'k' }).init();

    // Just before b's PATCH, a third writer bumps the version.
    mock.control.beforePatch = (rows) => {
      const row = rows.get(1);
      row.doc.students.zz = { id: 'zz', name: 'Interloper', email: 'z@x.edu', tasks: {} };
      row.version += 1;
    };

    await b.mutate((data) => {
      data.students.b = { id: 'b', name: 'B', email: 'b@x.edu', tasks: {} };
    });

    const final = await new RestStore({ url, key: 'k' }).init();
    const ids = Object.keys(final.read((d) => d.students)).sort();
    assert.deepEqual(ids, ['b', 'zz'], 'the interloper and the retried write both survive');
    assert.ok(a.version >= 0);
  });
});

test('refresh picks up another instance’s write', async () => {
  await withMock(async ({ url }) => {
    const a = await new RestStore({ url, key: 'k' }).init();
    const b = await new RestStore({ url, key: 'k' }).init();

    await a.mutate((data) => {
      data.students.late = { id: 'late', name: 'Late', email: 'l@x.edu', tasks: {} };
    });

    assert.equal(b.read((d) => d.students.late), undefined, 'stale before refresh');
    await b.refresh();
    assert.ok(b.read((d) => d.students.late), 'fresh after refresh');
  });
});

test('a bad key or table surfaces a clear error instead of hanging', async () => {
  await withMock(async ({ url }) => {
    // Point at a table the server does not have.
    const store = new RestStore({ url, key: 'k', table: 'does_not_exist' });
    await assert.rejects(() => store.init(), /storage (read|init) failed\s*\(404\)/);
  });
});

// ---------------------------------------------------------------------------
test('the whole app works end to end on the serverless store', async () => {
  await withMock(async ({ url }) => {
    const store = await new RestStore({ url, key: 'k' }).init();
    const { handle } = await createServer({
      store,
      adminKey: 'api-key',
      dataDir: '/tmp/gsa-rest-test',
    });

    // A tiny adapter so this test can reuse real HTTP requests.
    const server = http.createServer((req, res) => {
      Promise.resolve(handle(req, res)).catch(() => res.destroy());
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;

    try {
      const reg = await fetch(base + '/api/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Ananya Sharma', email: 'a@campus.edu' }),
      });
      const regBody = await reg.json();
      assert.equal(reg.status, 201);
      const auth = { authorization: 'Bearer ' + regBody.token };

      const me = await (await fetch(base + '/api/me', { headers: auth })).json();
      assert.equal(me.signedIn, true, 'session works across the store');

      for (const key of ['pre', 'post']) {
        const res = await fetch(`${base}/api/tasks/${key}/receipt`, {
          method: 'POST',
          headers: { ...auth, 'content-type': 'application/json' },
          body: JSON.stringify({ receipt: `${key} confirmation` }),
        });
        assert.equal(res.status, 200);
      }

      // Nothing unlocks on its own any more: the organiser approves each entry.
      const pending = await (await fetch(base + '/api/me', { headers: auth })).json();
      assert.equal(pending.student.unlocked, false);
      assert.deepEqual(pending.student.waitingFor, ['Pre-survey form', 'Post-survey form']);

      const roster = await (
        await fetch(base + '/api/admin/students', { headers: { 'x-admin-key': 'api-key' } })
      ).json();
      const studentId = roster.students[0].id;
      for (const key of ['pre', 'post']) {
        const approved = await fetch(`${base}/api/admin/students/${studentId}/task`, {
          method: 'POST',
          headers: { 'x-admin-key': 'api-key', 'content-type': 'application/json' },
          body: JSON.stringify({ key, status: 'verified' }),
        });
        assert.equal(approved.status, 200, `approving ${key} across the store`);
      }

      const unlocked = await (await fetch(base + '/api/me', { headers: auth })).json();
      assert.equal(unlocked.student.unlocked, true, 'approval is what unlocks');

      // The gate still holds for a different name.
      const wrong = await fetch(base + '/api/certificate/issue', {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Somebody Else' }),
      });
      assert.equal(wrong.status, 403);

      // The student list is visible to the admin across a fresh instance.
      const admin = await (await fetch(base + '/api/admin/students', {
        headers: { 'x-admin-key': 'api-key' },
      })).json();
      assert.equal(admin.stats.total, 1);
      assert.equal(admin.stats.unlocked, 1);
    } finally {
      await new Promise((r) => {
        server.close(r);
        server.closeAllConnections?.();
      });
    }
  });
});

// ---------------------------------------------------------------------------
test('a project URL pasted straight from Supabase works, with or without /rest/v1', async () => {
  await withMock(async ({ url }) => {
    // The dashboard shows ".../rest/v1/"; the client appends that path itself.
    for (const form of [url + '/rest/v1/', url + '/rest/v1', url + '/', url]) {
      const store = await new RestStore({ url: form, key: 'k' }).init();
      assert.ok(store.version !== null, `failed for ${form}`);
      assert.equal(store.url(), `${url}/rest/v1/state`, `wrong endpoint for ${form}`);
      assert.equal(
        store.url('?id=eq.1'),
        `${url}/rest/v1/state?id=eq.1`,
        `wrong query shape for ${form}`
      );
    }
  });
});
