import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Store, normaliseName, certSerial } from '../lib/store.js';
import { signSession, verifySession, readCookie } from '../lib/auth.js';

await import('../public/cert-render.js');
const { computeNamePlacement, drawCertificate } = globalThis.CertRender;

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gsa-unit-'));
}

// ---------------------------------------------------------------------------
test('normaliseName ignores case, padding and repeated spaces', () => {
  assert.equal(normaliseName('  Ananya   Sharma '), 'ananya sharma');
  assert.equal(normaliseName('ANANYA SHARMA'), 'ananya sharma');
  assert.equal(normaliseName(null), '');
  assert.notEqual(normaliseName('Ananya Sharma'), normaliseName('Ananya Sharmaa'));
});

test('certSerial looks like a certificate id and does not repeat', () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const serial = certSerial();
    assert.match(serial, /^CERT-[0-9A-F]{8}$/);
    seen.add(serial);
  }
  assert.equal(seen.size, 200);
});

// ---------------------------------------------------------------------------
test('store persists, reloads, and keeps the signing secret stable', async () => {
  const dir = tempDir();
  const file = path.join(dir, 'db.json');

  const first = await new Store(file).init();
  const secret = first.data.secret;
  await first.mutate((data) => {
    data.students['abc'] = { id: 'abc', name: 'Test Student', email: 't@x.edu', tasks: {} };
  });

  const second = await new Store(file).init();
  assert.equal(second.data.students.abc.name, 'Test Student');
  assert.equal(second.data.secret, secret, 'secret must survive a restart or sessions break');
});

test('store survives a corrupted file instead of crashing on boot', async () => {
  const dir = tempDir();
  const file = path.join(dir, 'db.json');
  fs.writeFileSync(file, '{ this is not json');
  const store = await new Store(file).init();
  assert.deepEqual(store.data.students, {});
  assert.ok(store.data.secret);
});

test('store serialises concurrent writes without losing records', async () => {
  const dir = tempDir();
  const file = path.join(dir, 'db.json');
  const store = await new Store(file).init();

  await Promise.all(
    Array.from({ length: 50 }, (_, i) =>
      store.mutate((data) => {
        data.students['id' + i] = { id: 'id' + i, name: 'S' + i, email: i + '@x.edu', tasks: {} };
      })
    )
  );

  const reloaded = await new Store(file).init();
  assert.equal(Object.keys(reloaded.data.students).length, 50);
});

// ---------------------------------------------------------------------------
test('sessions verify, reject tampering, and expire', () => {
  const secret = 'a'.repeat(64);
  const token = signSession(secret, 'student-1');
  assert.equal(verifySession(secret, token), 'student-1');

  // Different secret
  assert.equal(verifySession('b'.repeat(64), token), null);

  // Tampered payload
  const [body, sig] = token.split('.');
  const forgedBody = Buffer.from(JSON.stringify({ s: 'student-2', exp: Date.now() + 1e6 }))
    .toString('base64url');
  assert.equal(verifySession(secret, `${forgedBody}.${sig}`), null);

  // Expired
  const old = signSession(secret, 'student-1', Date.now() - 40 * 24 * 3600 * 1000);
  assert.equal(verifySession(secret, old), null);

  // Junk
  assert.equal(verifySession(secret, 'nonsense'), null);
  assert.equal(verifySession(secret, undefined), null);
  assert.equal(verifySession(secret, '.abc'), null);
});

test('readCookie pulls the right value out of a header', () => {
  assert.equal(readCookie('a=1; gsa_sid=xyz.abc; b=2'), 'xyz.abc');
  assert.equal(readCookie('nothing=here'), null);
  assert.equal(readCookie(undefined), null);
});

// ---------------------------------------------------------------------------
test('name placement scales with the template and clamps bad input', () => {
  const place = computeNamePlacement(2000, 1414, { x: 0.5, y: 0.5, size: 0.05 });
  assert.equal(place.x, 1000);
  assert.equal(place.y, 707);
  assert.equal(place.fontSize, Math.round(1414 * 0.05));
  assert.equal(place.font, `600 ${place.fontSize}px serif`);
  assert.equal(place.align, 'center');
  assert.equal(place.maxWidth, 2000 * 0.8);

  const big = computeNamePlacement(4000, 2828, { x: 0.5, y: 0.5, size: 0.05 });
  assert.equal(big.fontSize, Math.round(2828 * 0.05), 'font scales with the template height');

  const wild = computeNamePlacement(1000, 1000, { x: 9, y: -3, size: 0, maxWidth: 5, color: 'red' });
  assert.equal(wild.x, 1000, 'x is clamped to 1');
  assert.equal(wild.y, 0, 'y is clamped to 0');
  assert.ok(wild.fontSize >= 8, 'font never goes below the floor');
  assert.equal(wild.maxWidth, 1000, 'maxWidth is clamped to full width');
  assert.equal(wild.color, '#111111', 'invalid colour falls back rather than throwing');
});

test('drawCertificate draws the template then the name, in that order', () => {
  const calls = [];
  let currentFont = '';

  const ctx = {
    fillStyle: '',
    textAlign: '',
    textBaseline: '',
    get font() { return currentFont; },
    set font(value) { currentFont = value; },
    clearRect: (...args) => calls.push(['clearRect', ...args]),
    drawImage: (...args) => calls.push(['drawImage', ...args]),
    fillText: (...args) => calls.push(['fillText', ...args]),
    measureText(text) {
      const size = Number((currentFont.match(/(\d+)px/) || [0, 16])[1]);
      return { width: text.length * size * 0.5 };
    },
  };

  const image = { width: 2000, height: 1414 };
  const result = drawCertificate(ctx, image, 'Ananya Sharma', {
    x: 0.5, y: 0.6, size: 0.04, align: 'center', color: '#223344',
  });

  const order = calls.map((c) => c[0]);
  assert.deepEqual(order, ['clearRect', 'drawImage', 'fillText']);
  assert.deepEqual(calls[1].slice(1), [image, 0, 0, 2000, 1414]);

  const nameCall = calls[2];
  assert.equal(nameCall[1], 'Ananya Sharma');
  assert.equal(nameCall[2], 1000);
  assert.equal(nameCall[3], 1414 * 0.6);
  assert.equal(ctx.textAlign, 'center');
  assert.equal(ctx.textBaseline, 'middle');
  assert.equal(ctx.fillStyle, '#223344');
  assert.ok(result.fontSize > 0);
});

test('an over-long name shrinks to stay inside the text box', () => {
  let currentFont = '';
  let lastFill = null;
  const ctx = {
    fillStyle: '', textAlign: '', textBaseline: '',
    get font() { return currentFont; },
    set font(value) { currentFont = value; },
    clearRect() {},
    drawImage() {},
    fillText: (text, x, y) => { lastFill = { text, x, y }; },
    measureText(text) {
      const size = Number((currentFont.match(/(\d+)px/) || [0, 16])[1]);
      return { width: text.length * size * 0.5 };
    },
  };

  const image = { width: 2000, height: 1414 };
  const longName = 'Ananyasharma Venkataramanasubramaniam Krishnamurthy';
  const result = drawCertificate(ctx, image, longName, {
    x: 0.5, y: 0.5, size: 0.06, maxWidth: 0.5,
  });

  const startSize = Math.round(1414 * 0.06);
  assert.ok(result.fontSize < startSize, 'font shrank');
  const widthAtEnd = longName.length * result.fontSize * 0.5;
  assert.ok(widthAtEnd <= 2000 * 0.5 + 1, 'text now fits inside the box');
  assert.equal(lastFill.text, longName);
});
