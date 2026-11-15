import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
};

/**
 * Note on framing: X-Frame-Options SAMEORIGIN lets the preview host embed the
 * site in its own frame while still blocking unrelated sites from framing it.
 */
export function sendJson(res, status, body, headers = {}) {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': payload.length,
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

export function sendText(res, status, text, headers = {}) {
  const payload = Buffer.from(text);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': payload.length,
    ...headers,
  });
  res.end(payload);
}

export function redirect(res, location) {
  res.writeHead(302, { ...SECURITY_HEADERS, Location: location });
  res.end();
}

/** Reads a request body, refusing anything larger than `limit` bytes. */
export function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    const fail = (err) => {
      if (done) return;
      done = true;
      req.destroy();
      reject(err);
    };
    req.on('data', (chunk) => {
      if (done) return;
      size += chunk.length;
      if (size > limit) {
        // Reject, but do not destroy the socket: the caller still needs to
        // send a readable 413. Remaining bytes are read and discarded by the
        // `done` guard above.
        done = true;
        chunks.length = 0;
        reject(Object.assign(new Error('payload_too_large'), { status: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      resolve(Buffer.concat(chunks));
    });
    req.on('error', fail);
    req.on('aborted', () => fail(Object.assign(new Error('aborted'), { status: 400 })));
  });
}

export async function readJson(req, limit = 64 * 1024) {
  const raw = await readBody(req, limit);
  if (!raw.length) return {};
  try {
    const parsed = JSON.parse(raw.toString('utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      const err = new Error('invalid_json');
      err.status = 400;
      throw err;
    }
    return parsed;
  } catch (err) {
    if (err.status) throw err;
    const bad = new Error('invalid_json');
    bad.status = 400;
    throw bad;
  }
}

/**
 * Serves a file from `root`. Returns false when there is nothing to serve so
 * the caller can decide on a 404. Path traversal is rejected before any
 * filesystem access.
 */
export async function serveStatic(res, root, urlPath) {
  let rel;
  try {
    rel = decodeURIComponent(urlPath);
  } catch {
    return false;
  }
  if (rel.includes('\0')) return false;
  const clean = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
  if (clean.includes('..')) return false;
  const full = path.join(root, clean);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (full !== root && !full.startsWith(rootWithSep)) return false;

  let stat;
  try {
    stat = await fs.stat(full);
  } catch {
    return false;
  }
  if (stat.isDirectory()) return false;

  const type = MIME[path.extname(full).toLowerCase()] || 'application/octet-stream';
  const headers = {
    ...SECURITY_HEADERS,
    'Content-Type': type,
    'Content-Length': stat.size,
    // Templates get replaced during setup; don't let phones cache a stale one.
    'Cache-Control': 'no-cache',
  };
  res.writeHead(200, headers);
  if (res.req && res.req.method === 'HEAD') {
    res.end();
    return true;
  }
  // Path-based stream: Node owns and closes the descriptor. Opening a
  // FileHandle by hand and never closing it leaks descriptors under load.
  const stream = createReadStream(full);
  stream.on('error', () => {
    if (!res.headersSent) res.writeHead(500, SECURITY_HEADERS);
    res.destroy();
  });
  stream.pipe(res);
  return true;
}
