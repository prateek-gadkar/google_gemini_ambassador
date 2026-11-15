import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { CONFIG } from './config.js';
import { Store, newId, certSerial, normaliseName } from './lib/store.js';
import {
  sessionCookie,
  clearCookie,
  studentIdFromRequest,
  isAdmin,
} from './lib/auth.js';
import { sendJson, sendText, readJson, readBody, serveStatic } from './lib/http.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(HERE, 'public');
const ASSETS_DIR = path.join(PUBLIC_DIR, 'assets');

const MAX_PROOF_BYTES = 4 * 1024 * 1024;
const MAX_TEMPLATE_BYTES = 12 * 1024 * 1024;
const MAX_BODY_BYTES = 64 * 1024;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function badRequest(message, status = 400) {
  return Object.assign(new Error(message), { status, expose: true });
}

function cleanText(value, max) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Detects image type from magic bytes; never trusts the Content-Type header. */
function detectImage(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: 'jpg', mime: 'image/jpeg' };
  }
  if (
    buf.length > 8 &&
    buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
  ) {
    return { ext: 'png', mime: 'image/png' };
  }
  return null;
}

function taskStatus(student, key) {
  const entry = student.tasks?.[key];
  return entry && entry.status ? entry.status : 'empty';
}

/**
 * A task counts as satisfied when its receipt is verified, or when receipts
 * auto-verify and one has been submitted. Rejection always wins.
 */
function isSatisfied(student, task) {
  const status = taskStatus(student, task.key);
  if (status === 'rejected') return false;
  if (status === 'verified') return true;
  if (status === 'submitted') return CONFIG.autoVerifyReceipts && !!task.required;
  return false;
}

export function evaluate(student) {
  const tasks = CONFIG.tasks.map((task) => {
    const entry = student.tasks?.[task.key] || {};
    return {
      key: task.key,
      label: task.label,
      hint: task.hint || '',
      formUrl: task.formUrl || '',
      required: !!task.required,
      proofRequired: !!task.proofRequired,
      status: entry.status || 'empty',
      receipt: entry.receipt || '',
      hasProof: !!entry.proofFile,
      at: entry.at || null,
      satisfied: isSatisfied(student, task),
    };
  });
  const missing = tasks.filter((t) => t.required && !t.satisfied).map((t) => t.label);
  return { tasks, missing, unlocked: missing.length === 0 };
}

function publicStudent(student) {
  const gate = evaluate(student);
  return {
    id: student.id,
    name: student.name,
    email: student.email,
    campus: student.campus || '',
    createdAt: student.createdAt,
    tasks: gate.tasks.map(({ satisfied, ...rest }) => ({ ...rest, satisfied })),
    missing: gate.missing,
    unlocked: gate.unlocked,
    cert: student.cert || null,
  };
}

function certView(store) {
  const cfg = store.read((d) => d.certConfig);
  return {
    templateReady: !!cfg.templateReady,
    templateUrl: cfg.templateFile ? `/assets/${cfg.templateFile}` : null,
    name: { ...cfg.name },
    event: { ...CONFIG.event },
    missingEventFields: Object.entries({
      title: CONFIG.event.title,
      date: CONFIG.event.date,
    })
      .filter(([, value]) => !String(value || '').trim())
      .map(([key]) => key),
  };
}

function makeRateLimiter(limit, windowMs) {
  const hits = new Map();
  return function allow(ip) {
    const now = Date.now();
    const entry = hits.get(ip);
    if (!entry || entry.resetAt <= now) {
      hits.set(ip, { count: 1, resetAt: now + windowMs });
      return true;
    }
    entry.count += 1;
    if (hits.size > 5000) {
      for (const [key, value] of hits) {
        if (value.resetAt <= now) hits.delete(key);
      }
    }
    return entry.count <= limit;
  };
}

export async function createServer(options = {}) {
  const dataDir = options.dataDir || path.join(HERE, 'data');
  const assetsDir = options.assetsDir || ASSETS_DIR;
  const adminKey = options.adminKey || process.env.ADMIN_KEY || null;

  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(assetsDir, { recursive: true });

  const store = await new Store(path.join(dataDir, 'gsa.json')).init();

  // A stable fallback admin key so the console still works after a restart
  // when no ADMIN_KEY is configured.
  let effectiveAdminKey = adminKey;
  if (!effectiveAdminKey) {
    await store.mutate((data) => {
      if (!data.adminKey) data.adminKey = crypto.randomBytes(12).toString('base64url');
      effectiveAdminKey = data.adminKey;
    });
  }

  const limitRegister = makeRateLimiter(
    CONFIG.rateLimit.perIp,
    CONFIG.rateLimit.windowMinutes * 60 * 1000
  );

  function clientIp(req) {
    return (
      String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
      req.socket.remoteAddress ||
      'unknown'
    );
  }

  function requireStudent(req) {
    const secret = store.read((d) => d.secret);
    const id = studentIdFromRequest(secret, req);
    if (!id) throw badRequest('not_signed_in', 401);
    const student = store.read((d) => d.students[id]);
    if (!student) throw badRequest('not_signed_in', 401);
    return student;
  }

  function requireAdmin(req) {
    if (!isAdmin(req, effectiveAdminKey)) throw badRequest('not_admin', 403);
  }

  async function handler(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const route = url.pathname;
    const method = req.method || 'GET';

    // ---- student account ---------------------------------------------------
    if (route === '/api/health' && method === 'GET') {
      return sendJson(res, 200, {
        ok: true,
        students: store.read((d) => Object.keys(d.students).length),
        templateReady: store.read((d) => !!d.certConfig.templateReady),
      });
    }

    if (route === '/api/register' && method === 'POST') {
      if (!limitRegister(clientIp(req))) throw badRequest('too_many_requests', 429);
      const body = await readJson(req, MAX_BODY_BYTES);
      const name = cleanText(body.name, 80);
      const email = cleanText(body.email, 120).toLowerCase();
      const campus = cleanText(body.campus, 80);

      if (name.length < 2) throw badRequest('Name must be at least 2 characters.');
      if (!EMAIL_RE.test(email)) throw badRequest('That email address does not look right.');

      const existing = store.read((d) =>
        Object.values(d.students).find((s) => s.email === email)
      );
      if (existing) {
        throw badRequest('That email is already registered. Sign in instead.', 409);
      }

      const created = await store.mutate((data) => {
        const count = Object.keys(data.students).length;
        if (count >= CONFIG.maxStudents) {
          throw badRequest(
            `This event is full (${CONFIG.maxStudents} students). Please contact the organiser.`,
            409
          );
        }
        const student = {
          id: newId(),
          name,
          email,
          campus,
          createdAt: new Date().toISOString(),
          tasks: {},
          cert: null,
        };
        data.students[student.id] = student;
        return student;
      });

      const secret = store.read((d) => d.secret);
      return sendJson(
        res,
        201,
        { student: publicStudent(created) },
        { 'Set-Cookie': sessionCookie(secret, created.id) }
      );
    }

    if (route === '/api/login' && method === 'POST') {
      if (!limitRegister(clientIp(req))) throw badRequest('too_many_requests', 429);
      const body = await readJson(req, MAX_BODY_BYTES);
      const email = cleanText(body.email, 120).toLowerCase();
      if (!EMAIL_RE.test(email)) throw badRequest('That email address does not look right.');
      const student = store.read((d) =>
        Object.values(d.students).find((s) => s.email === email)
      );
      if (!student) throw badRequest('No registration found for that email.', 404);
      const secret = store.read((d) => d.secret);
      return sendJson(
        res,
        200,
        { student: publicStudent(student) },
        { 'Set-Cookie': sessionCookie(secret, student.id) }
      );
    }

    if (route === '/api/logout' && method === 'POST') {
      return sendJson(res, 200, { ok: true }, { 'Set-Cookie': clearCookie() });
    }

    if (route === '/api/me' && method === 'GET') {
      const secret = store.read((d) => d.secret);
      const id = studentIdFromRequest(secret, req);
      const student = id ? store.read((d) => d.students[id]) : null;
      return sendJson(res, 200, {
        signedIn: !!student,
        student: student ? publicStudent(student) : null,
        cert: certView(store),
        tasks: CONFIG.tasks.map((t) => ({
          key: t.key,
          label: t.label,
          hint: t.hint || '',
          formUrl: t.formUrl || '',
          required: !!t.required,
        })),
        site: { name: CONFIG.siteName, tagline: CONFIG.tagline },
      });
    }

    // ---- task receipts -----------------------------------------------------
    let match = route.match(/^\/api\/tasks\/([a-z0-9_]+)\/(receipt|proof)$/i);
    if (match && method === 'POST') {
      const student = requireStudent(req);
      const key = match[1];
      const kind = match[2];
      const task = CONFIG.tasks.find((t) => t.key === key);
      if (!task) throw badRequest('unknown_task', 404);

      if (kind === 'receipt') {
        const body = await readJson(req, MAX_BODY_BYTES);
        const receipt = cleanText(body.receipt, 1000);
        if (receipt.length < 3) {
          throw badRequest('Paste your confirmation message or link so it can be checked.');
        }
        const updated = await store.mutate((data) => {
          const target = data.students[student.id];
          target.tasks = target.tasks || {};
          target.tasks[key] = {
            ...(target.tasks[key] || {}),
            receipt,
            status: 'submitted',
            at: new Date().toISOString(),
          };
          return target;
        });
        return sendJson(res, 200, { student: publicStudent(updated) });
      }

      // proof screenshot: raw image bytes
      const raw = await readBody(req, MAX_PROOF_BYTES);
      const kindOfImage = detectImage(raw);
      if (!kindOfImage) throw badRequest('Upload a JPG or PNG screenshot.');
      const filename = `${student.id}-${key}.${kindOfImage.ext}`;
      const proofsDir = path.join(dataDir, 'proofs');
      await fs.mkdir(proofsDir, { recursive: true });
      await fs.writeFile(path.join(proofsDir, filename), raw);

      const updated = await store.mutate((data) => {
        const target = data.students[student.id];
        target.tasks = target.tasks || {};
        const prev = target.tasks[key] || {};
        target.tasks[key] = {
          ...prev,
          proofFile: filename,
          status: prev.status === 'empty' || !prev.status ? 'submitted' : prev.status,
          at: new Date().toISOString(),
        };
        return target;
      });
      return sendJson(res, 200, { student: publicStudent(updated) });
    }

    match = route.match(/^\/api\/tasks\/([a-z0-9_]+)\/proof$/i);
    if (match && method === 'GET') {
      const student = requireStudent(req);
      const entry = student.tasks?.[match[1]];
      if (!entry?.proofFile) throw badRequest('not_found', 404);
      const full = path.join(dataDir, 'proofs', entry.proofFile);
      const buf = await fs.readFile(full).catch(() => null);
      if (!buf) throw badRequest('not_found', 404);
      const image = detectImage(buf) || { mime: 'application/octet-stream' };
      res.writeHead(200, {
        'Content-Type': image.mime,
        'Content-Length': buf.length,
        'Cache-Control': 'no-store',
      });
      return res.end(buf);
    }

    // ---- certificate -------------------------------------------------------
    if (route === '/api/certificate/issue' && method === 'POST') {
      const student = requireStudent(req);
      const gate = evaluate(student);
      if (!gate.unlocked) {
        throw badRequest(
          `Not unlocked yet. Still required: ${gate.missing.join(', ')}.`,
          403
        );
      }
      const body = await readJson(req, MAX_BODY_BYTES);
      const typed = normaliseName(body.name);
      if (!typed) throw badRequest('Type your full name exactly as it should appear.');
      if (typed !== normaliseName(student.name)) {
        throw badRequest(
          'That name does not match your registration. Use the same spelling you registered with.',
          403
        );
      }

      const view = certView(store);
      if (!view.templateReady) {
        throw badRequest(
          'The certificate template has not been loaded yet. Please ask the organiser.',
          409
        );
      }

      const updated = await store.mutate((data) => {
        const target = data.students[student.id];
        if (!target.cert) {
          target.cert = {
            serial: certSerial(),
            name: target.name,
            issuedAt: new Date().toISOString(),
          };
          data.certsIssued = (data.certsIssued || 0) + 1;
        }
        return target;
      });

      return sendJson(res, 200, {
        cert: updated.cert,
        render: view,
      });
    }

    // ---- admin -------------------------------------------------------------
    if (route === '/api/admin/students' && method === 'GET') {
      requireAdmin(req);
      const list = store.read((d) =>
        Object.values(d.students)
          .map((s) => {
            const gate = evaluate(s);
            return {
              id: s.id,
              name: s.name,
              email: s.email,
              campus: s.campus || '',
              createdAt: s.createdAt,
              tasks: gate.tasks.map((t) => ({
                key: t.key,
                label: t.label,
                status: t.status,
                receipt: t.receipt,
                at: t.at,
                hasProof: t.hasProof,
              })),
              unlocked: gate.unlocked,
              missing: gate.missing,
              cert: s.cert || null,
            };
          })
          .sort((a, b) => a.name.localeCompare(b.name))
      );
      return sendJson(res, 200, {
        students: list,
        stats: {
          total: list.length,
          unlocked: list.filter((s) => s.unlocked).length,
          issued: list.filter((s) => s.cert).length,
        },
        cert: certView(store),
      });
    }

    match = route.match(/^\/api\/admin\/students\/([\w-]+)\/task$/);
    if (match && method === 'POST') {
      requireAdmin(req);
      const body = await readJson(req, MAX_BODY_BYTES);
      const key = cleanText(body.key, 40);
      const status = cleanText(body.status, 20);
      if (!['verified', 'rejected', 'reset'].includes(status)) {
        throw badRequest('status must be verified, rejected or reset');
      }
      if (!CONFIG.tasks.some((t) => t.key === key)) throw badRequest('unknown_task', 404);

      const updated = await store.mutate((data) => {
        const target = data.students[match[1]];
        if (!target) throw badRequest('not_found', 404);
        target.tasks = target.tasks || {};
        if (status === 'reset') {
          delete target.tasks[key];
        } else {
          target.tasks[key] = { ...(target.tasks[key] || {}), status };
        }
        // Revoking a task re-locks the certificate so it cannot be re-downloaded.
        if (status === 'rejected' && target.cert) target.cert = null;
        return target;
      });
      return sendJson(res, 200, { student: publicStudent(updated) });
    }

    match = route.match(/^\/api\/admin\/students\/([\w-]+)\/proof\/([a-z0-9_]+)$/i);
    if (match && method === 'GET') {
      requireAdmin(req);
      const entry = store.read((d) => d.students[match[1]]?.tasks?.[match[2]]);
      if (!entry?.proofFile) throw badRequest('not_found', 404);
      const buf = await fs.readFile(path.join(dataDir, 'proofs', entry.proofFile)).catch(
        () => null
      );
      if (!buf) throw badRequest('not_found', 404);
      const image = detectImage(buf) || { mime: 'application/octet-stream' };
      res.writeHead(200, { 'Content-Type': image.mime, 'Content-Length': buf.length, 'Cache-Control': 'no-store' });
      return res.end(buf);
    }

    if (route === '/api/admin/cert-config' && method === 'POST') {
      requireAdmin(req);
      const body = await readJson(req, MAX_BODY_BYTES);
      const clamp = (v, lo, hi, fallback) => {
        const n = Number(v);
        if (!Number.isFinite(n)) return fallback;
        return Math.min(hi, Math.max(lo, n));
      };
      const updated = await store.mutate((data) => {
        const cfg = data.certConfig;
        const n = body.name || {};
        cfg.name = {
          x: clamp(n.x, 0, 1, cfg.name.x),
          y: clamp(n.y, 0, 1, cfg.name.y),
          size: clamp(n.size, 0.01, 0.4, cfg.name.size),
          color: /^#[0-9a-f]{6}$/i.test(String(n.color)) ? n.color : cfg.name.color,
          font: ['serif', 'sans-serif'].includes(n.font) ? n.font : cfg.name.font,
          weight: ['400', '500', '600', '700'].includes(String(n.weight))
            ? String(n.weight)
            : cfg.name.weight,
          align: ['left', 'center', 'right'].includes(n.align) ? n.align : cfg.name.align,
          maxWidth: clamp(n.maxWidth, 0.1, 1, cfg.name.maxWidth),
        };
        if (typeof body.templateReady === 'boolean') {
          // Never allow downloads to be enabled without an actual template.
          cfg.templateReady = body.templateReady && !!cfg.templateFile;
        }
        return cfg;
      });
      return sendJson(res, 200, { cert: certView(store), config: updated });
    }

    if (route === '/api/admin/template' && method === 'POST') {
      requireAdmin(req);
      const raw = await readBody(req, MAX_TEMPLATE_BYTES);
      const image = detectImage(raw);
      if (!image) throw badRequest('Upload the template as a JPG or PNG image.');
      const filename = `certificate-template.${image.ext}`;
      await fs.writeFile(path.join(assetsDir, filename), raw);
      // Clear any previous template under the other extension.
      const other = filename.endsWith('.jpg') ? 'certificate-template.png' : 'certificate-template.jpg';
      await fs.unlink(path.join(assetsDir, other)).catch(() => {});
      await store.mutate((data) => {
        data.certConfig.templateFile = filename;
        data.certConfig.templateReady = false; // enable only after calibration
      });
      return sendJson(res, 200, { cert: certView(store) });
    }

    if (route === '/api/admin/export.csv' && method === 'GET') {
      requireAdmin(req);
      const rows = store.read((d) =>
        Object.values(d.students).map((s) => {
          const gate = evaluate(s);
          const cells = [
            s.name,
            s.email,
            s.campus || '',
            s.createdAt,
            ...gate.tasks.map((t) => t.status),
            gate.unlocked ? 'yes' : 'no',
            s.cert ? s.cert.serial : '',
            s.cert ? s.cert.issuedAt : '',
            s.cert ? s.cert.name : '',
          ];
          return cells;
        })
      );
      const header = [
        'name',
        'email',
        'campus',
        'registered_at',
        ...CONFIG.tasks.map((t) => t.key),
        'unlocked',
        'cert_serial',
        'issued_at',
        'cert_name',
      ];
      const esc = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
      const body = [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="certificate-station.csv"',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store',
      });
      return res.end(body);
    }

    // ---- static ------------------------------------------------------------
    if (method === 'GET' || method === 'HEAD') {
      const aliases = {
        '/': '/index.html',
        '/certificate': '/certificate.html',
        '/admin': '/admin.html',
        '/calibrate': '/calibrate.html',
      };
      if (route.startsWith('/assets/')) {
        if (await serveStatic(res, assetsDir, route.slice('/assets'.length))) return undefined;
      }
      const target = aliases[route] || route;
      if (await serveStatic(res, PUBLIC_DIR, target)) return undefined;
    }

    if (route.startsWith('/api/')) return sendJson(res, 404, { error: 'not_found' });
    return sendText(res, 404, 'Not found');
  }

  const server = http.createServer((req, res) => {
    const started = Date.now();
    res.on('finish', () => {
      if (process.env.QUIET === '1') return;
      const ms = Date.now() - started;
      console.log(`${req.method} ${req.url} ${res.statusCode} ${ms}ms`);
    });
    Promise.resolve(handler(req, res)).catch((err) => {
      const status = err.status || 500;
      const message = err.expose ? err.message : 'Something went wrong on the server.';
      if (!err.expose) console.error('handler error:', err);
      if (res.headersSent) {
        res.destroy();
        return;
      }
      // A refused upload leaves the request body unread, so the connection
      // cannot be reused; say so explicitly instead of letting the client hang.
      const headers = status === 413 ? { Connection: 'close' } : {};
      sendJson(res, status, { error: message }, headers);
      if (status === 413) {
        res.on('finish', () => req.destroy());
      }
    });
  });

  return { server, store, adminKey: effectiveAdminKey };
}

// --- CLI -------------------------------------------------------------------
const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT || 8080);
  const host = process.env.HOST || '0.0.0.0';
  createServer().then(({ server, adminKey }) => {
    server.listen(port, host, () => {
      console.log(`\n  ${CONFIG.siteName}`);
      console.log(`  listening on http://${host}:${port}`);
      console.log(`  students : ${CONFIG.maxStudents} max`);
      console.log(`  admin key: ${adminKey}`);
      console.log(`  admin    : http://localhost:${port}/admin\n`);
    });
  });
}
