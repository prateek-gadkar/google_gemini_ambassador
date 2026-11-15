import crypto from 'node:crypto';

const COOKIE = 'gsa_sid';
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function b64url(buf) {
  return Buffer.from(buf).toString('base64url');
}

function hmac(secret, body) {
  return crypto.createHmac('sha256', secret).update(body).digest();
}

/**
 * Sessions are stateless: the cookie carries the student id and an expiry,
 * signed with a secret that lives in the data file. Survives restarts without
 * a session table, and cannot be forged without the secret.
 */
export function signSession(secret, studentId, now = Date.now()) {
  const body = b64url(JSON.stringify({ s: studentId, exp: now + TTL_MS }));
  return `${body}.${b64url(hmac(secret, body))}`;
}

export function verifySession(secret, token, now = Date.now()) {
  if (typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1), 'base64url');
  const expected = hmac(secret, body);
  if (given.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(given, expected)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!payload || typeof payload.s !== 'string') return null;
  if (typeof payload.exp !== 'number' || payload.exp < now) return null;
  return payload.s;
}

/**
 * Builds the session cookie.
 *
 * `secure` switches to SameSite=None; Secure, which is what a cross-site
 * iframe needs (the preview host frames this app from another site). A Lax
 * cookie is silently dropped in that context, which looks exactly like "it
 * says signing in and never proceeds".
 */
export function sessionCookie(secret, studentId, opts = {}) {
  const attrs = opts.secure
    ? '; Path=/; HttpOnly; SameSite=None; Secure'
    : '; Path=/; HttpOnly; SameSite=Lax';
  return `${COOKIE}=${signSession(secret, studentId)}${attrs}; Max-Age=${Math.floor(TTL_MS / 1000)}`;
}

/**
 * Reads the session from either an Authorization: Bearer header or the cookie.
 *
 * Browsers that block third-party cookies (and the preview iframe is exactly
 * that) will never send the cookie, so the header path is the one that keeps
 * students signed in. The token is the same signed value either way.
 */
export function tokenFromRequest(secret, req) {
  const header = req.headers.authorization;
  if (typeof header === 'string') {
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (match) {
      const id = verifySession(secret, match[1].trim());
      if (id) return id;
    }
  }
  return verifySession(secret, readCookie(req.headers.cookie));
}

export function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function readCookie(cookieHeader, name = COOKIE) {
  if (!cookieHeader) return null;
  for (const part of String(cookieHeader).split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    if (part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
  }
  return null;
}

export function studentIdFromRequest(secret, req) {
  return tokenFromRequest(secret, req);
}

/** Constant-time admin key check. */
export function isAdmin(req, adminKey) {
  if (!adminKey) return false;
  const given = req.headers['x-admin-key'];
  if (typeof given !== 'string' || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(adminKey);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
