import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const SECRET_BYTES = 32;

export function defaultCertConfig() {
  return {
    // Set only when the real files have been uploaded by the admin.
    templateFile: null,
    signatureFile: null,
    templateReady: false,

    // All positions are fractions of the artwork, measured off the official
    // JPG (6142 x 4429) by locating the three printed rules. `y` for text is
    // the baseline; `y` for the signature is its bottom edge.
    name: {
      x: 0.5,          // centred over the long rule (centre 3070.5 / 6142)
      y: 0.52246,      // baseline sits just above that rule (2314 / 4429)
      size: 0.027,     // ~120px at full size, between body text and title
      weight: '500',
      font: 'google',
      color: '#111111',
      align: 'center',
      maxWidth: 0.55,  // the rule itself is 0.561 of the width
      letterSpacing: 0,
    },
    date: {
      x: 0.18390,      // centred over the left-hand rule (1129.5 / 6142)
      y: 0.84308,      // baseline just above it (3734 / 4429)
      size: 0.0205,    // ~91px at full size
      weight: '400',
      font: 'google',
      color: '#111111',
      align: 'center',
      maxWidth: 0.14,  // the rule is 0.1447 of the width
      letterSpacing: 0,
    },
    signature: {
      x: 0.81594,      // centred over the right-hand rule (5011.5 / 6142)
      y: 0.84533,      // bottom edge just above it (3744 / 4429)
      width: 0.12,     // ~737px at full size, inside the 889px rule
      opacity: 1,
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
