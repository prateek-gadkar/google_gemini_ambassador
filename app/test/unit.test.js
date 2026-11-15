import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { Store, normaliseName, certSerial, defaultCertConfig } from '../lib/store.js';
import { signSession, verifySession, readCookie } from '../lib/auth.js';

await import('../public/cert-render.js');
const { computeTextPlacement, computeImagePlacement, drawCertificate } = globalThis.CertRender;

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
// ---------------------------------------------------------------------------
// Geometry measured off the official certificate artwork (6142 x 4429) by
// locating the three printed rules. These constants are the ground truth the
// defaults must match.
const TEMPLATE = { width: 6142, height: 4429 };
const RULES = {
  name: { y: 2354, x0: 1348, x1: 4793 },
  date: { y: 3774, x0: 685, x1: 1574 },
  signature: { y: 3774, x0: 4567, x1: 5456 },
};
const BODY_TEXT_BOTTOM = 1882; // bottom of "This is to certify that"

test('text placement scales with the template and clamps bad input', () => {
  const place = computeTextPlacement(TEMPLATE.width, TEMPLATE.height, {
    x: 0.5, y: 0.5, size: 0.05, weight: '500',
  });
  assert.equal(place.x, 3071);
  assert.equal(place.y, 4429 * 0.5);
  assert.equal(place.fontSize, Math.round(4429 * 0.05));
  assert.match(place.font, /^500 \d+px "Google Sans"/);
  assert.equal(place.align, 'center');
  assert.equal(place.maxWidth, TEMPLATE.width * 0.8);

  const small = computeTextPlacement(1000, 1000, { x: 9, y: -3, size: 0, maxWidth: 5, color: 'red', font: 'bogus' });
  assert.equal(small.x, 1000, 'x clamps to 1');
  assert.equal(small.y, 0, 'y clamps to 0');
  assert.ok(small.fontSize >= 8, 'font floor');
  assert.equal(small.maxWidth, 1000, 'maxWidth clamps to full width');
  assert.equal(small.color, '#111111', 'invalid colour falls back');
  assert.match(small.font, /Google Sans/, 'unknown font family falls back');
});

test('signature placement converts fractions to pixels', () => {
  const place = computeImagePlacement(1000, 500, { x: 0.8, y: 0.9, width: 0.2, opacity: 0.5 });
  assert.equal(place.x, 800);
  assert.equal(place.bottom, 450);
  assert.equal(place.width, 200);
  assert.equal(place.opacity, 0.5);

  const wild = computeImagePlacement(1000, 500, { x: -4, y: 12, width: 99, opacity: 0 });
  assert.equal(wild.x, 0);
  assert.equal(wild.bottom, 500);
  assert.equal(wild.width, 1000);
  assert.equal(wild.opacity, 0.1);
});

function stubContext() {
  const calls = [];
  let currentFont = '';
  const ctx = {
    fillStyle: '',
    textAlign: '',
    textBaseline: '',
    globalAlpha: 1,
    get font() { return currentFont; },
    set font(value) { currentFont = value; },
    save: () => calls.push(['save']),
    restore: () => calls.push(['restore']),
    clearRect: (...a) => calls.push(['clearRect', ...a]),
    drawImage: (...a) => calls.push(['drawImage', ...a]),
    fillText: (...a) => calls.push(['fillText', ...a]),
    measureText(text) {
      const size = Number((currentFont.match(/(\d+)px/) || [0, 16])[1]);
      return { width: text.length * size * 0.5 };
    },
  };
  return { ctx, calls };
}

test('drawCertificate fills all three blanks on the real artwork', () => {
  const { ctx, calls } = stubContext();
  const cfg = defaultCertConfig();
  const template = { width: TEMPLATE.width, height: TEMPLATE.height, naturalWidth: TEMPLATE.width, naturalHeight: TEMPLATE.height };
  const signatureImage = { width: 800, height: 300 };

  const out = drawCertificate(
    ctx,
    template,
    { name: 'Ananya Sharma', date: '15 November 2026', signatureImage },
    cfg
  );

  const order = calls.map((c) => c[0]);
  assert.equal(order[0], 'clearRect');
  assert.equal(order[1], 'drawImage', 'template drawn first');

  const texts = calls.filter((c) => c[0] === 'fillText');
  assert.equal(texts.length, 2, 'exactly two text fields: name and date');
  assert.equal(texts[0][1], 'Ananya Sharma');
  assert.equal(texts[1][1], '15 November 2026');

  // Signature image drawn after the text.
  const sigDraw = calls.filter((c) => c[0] === 'drawImage')[1];
  assert.ok(sigDraw, 'signature is drawn');

  assert.equal(ctx.textBaseline, 'alphabetic');
  assert.ok(out.name && out.date && out.signature);
});

test('defaults land on the blanks in the real artwork, not on the rules', () => {
  const cfg = defaultCertConfig();
  const W = TEMPLATE.width;
  const H = TEMPLATE.height;

  const name = computeTextPlacement(W, H, cfg.name);
  assert.ok(Math.abs(name.x - 3070.5) < 8, `name x ${name.x} should centre on 3070.5`);
  assert.ok(name.y < RULES.name.y, 'name baseline must sit above the rule');
  assert.ok(name.y > RULES.name.y - 140, 'but not floating far above it');
  assert.ok(name.y - name.fontSize * 0.75 > BODY_TEXT_BOTTOM + 40,
    'name must not collide with "This is to certify that"');
  assert.ok(name.fontSize > 90 && name.fontSize < 160, 'name between body text and title size');
  assert.ok(name.maxWidth <= RULES.name.x1 - RULES.name.x0, 'name box fits inside the rule');

  const date = computeTextPlacement(W, H, cfg.date);
  assert.ok(Math.abs(date.x - 1129.5) < 8, `date x ${date.x} should centre on 1129.5`);
  assert.ok(date.y < RULES.date.y, 'date baseline above its rule');
  assert.ok(date.y > RULES.date.y - 120);
  assert.ok(date.maxWidth <= RULES.date.x1 - RULES.date.x0, 'date box fits inside its rule');

  const sig = computeImagePlacement(W, H, cfg.signature);
  assert.ok(Math.abs(sig.x - 5011.5) < 8, `signature x ${sig.x} should centre on 5011.5`);
  assert.ok(sig.bottom < RULES.signature.y, 'signature sits above its rule');
  assert.ok(sig.bottom > RULES.signature.y - 90);
  assert.ok(sig.width < RULES.signature.x1 - RULES.signature.x0, 'signature narrower than its rule');
});

test('an over-long name shrinks to stay inside the text box', () => {
  const { ctx } = stubContext();
  const cfg = defaultCertConfig();
  const template = { width: TEMPLATE.width, height: TEMPLATE.height };
  const longName = 'Ananyasharma Venkataramanasubramaniam Krishnamurthy Pillai';

  const out = drawCertificate(ctx, template, { name: longName, date: '', signatureImage: null }, cfg);
  const startSize = Math.round(cfg.name.size * TEMPLATE.height);

  assert.ok(out.name.fontSize < startSize, 'font shrank');
  const boxWidth = cfg.name.maxWidth * TEMPLATE.width;
  const widthAtEnd = longName.length * out.name.fontSize * 0.5;
  assert.ok(widthAtEnd <= boxWidth + 1, 'long name now fits its box');
  assert.equal(out.date, null, 'no date text was drawn');
  assert.equal(out.signature, null, 'no signature drawn');
});

test('an empty name or date draws nothing rather than a blank box', () => {
  const { ctx, calls } = stubContext();
  const cfg = defaultCertConfig();
  const template = { width: TEMPLATE.width, height: TEMPLATE.height };
  const out = drawCertificate(ctx, template, { name: '', date: '', signatureImage: null }, cfg);
  assert.equal(out.name, null);
  assert.equal(out.date, null);
  assert.equal(calls.filter((c) => c[0] === 'fillText').length, 0);
});
