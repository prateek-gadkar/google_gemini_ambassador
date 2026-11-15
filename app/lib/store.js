import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const SECRET_BYTES = 32;

export function defaultCertConfig() {
  return {
    // Set only when a real template image has been uploaded by the admin.
    templateFile: null,
    templateReady: false,
    // Name placement, expressed as fractions of the image dimensions so the
    // same numbers work whether the template is 1000px or 4000px wide.
    name: {
      x: 0.5,
      y: 0.52,
      size: 0.055,
      color: '#111111',
      font: 'serif',
      weight: '600',
      align: 'center',
      maxWidth: 0.8,
    },
  };
}

function blank() {
  return {
    version: 1,
    secret: crypto.randomBytes(SECRET_BYTES).toString('hex'),
    students: {},
    certConfig: defaultCertConfig(),
    certsIssued: 0,
  };
}

/**
 * Tiny JSON-backed store: one file, atomic writes, serialised mutations.
 *
 * At 50-100 students the whole dataset is a few hundred kilobytes, so this is
 * both simpler and safer than pulling in a database. Writes go to a temp file
 * and are renamed into place, so a crash mid-write cannot corrupt the file.
 */
export class Store {
  constructor(file) {
    this.file = file;
    this.data = blank();
    this._queue = Promise.resolve();
  }

  async init() {
    try {
      const raw = await fs.readFile(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      const base = blank();
      this.data = {
        ...base,
        ...parsed,
        students: parsed.students || {},
        certConfig: { ...base.certConfig, ...(parsed.certConfig || {}) },
        secret: parsed.secret || base.secret,
      };
    } catch (err) {
      if (err.code !== 'ENOENT' && !(err instanceof SyntaxError)) throw err;
      // Missing or unparseable file: start clean rather than crash on boot.
    }
    return this;
  }

  async save() {
    const dir = path.dirname(this.file);
    await fs.mkdir(dir, { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(this.data, null, 2));
    await fs.rename(tmp, this.file);
  }

  /**
   * Run a mutation with exclusive access to the data, then persist it.
   * Concurrent callers are chained, never interleaved.
   */
  mutate(fn) {
    const run = async () => {
      const result = await fn(this.data);
      await this.save();
      return result;
    };
    this._queue = this._queue.then(run, run);
    return this._queue;
  }

  read(fn) {
    return fn(this.data);
  }
}

export function newId() {
  return crypto.randomBytes(9).toString('base64url');
}

export function certSerial() {
  return 'CERT-' + crypto.randomBytes(4).toString('hex').toUpperCase();
}

/** Normalises a name for comparison: case, padding and repeated spaces. */
export function normaliseName(value) {
  return String(value || '')
    .normalize('NFC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
