// Vercel entry point (repository root, so a plain git import needs no settings).
//
// The app is a plain Node request handler, so this function just boots the same
// server the CLI runs and forwards to it. Storage comes from SUPABASE_URL /
// SUPABASE_SERVICE_KEY when they are set; without them this falls back to a
// local file, which a serverless host wipes between requests.
import { createServer } from '../app/server.js';

let booting;

function boot() {
  if (!booting) {
    booting = createServer({
      dataDir: process.env.DATA_DIR || '/tmp/gsa-data',
    }).catch((err) => {
      booting = null;
      throw err;
    });
  }
  return booting;
}

export default async function handler(req, res) {
  try {
    const { handle } = await boot();
    return await handle(req, res);
  } catch (err) {
    console.error('boot failed:', err);
    if (res.headersSent) return res.destroy();

    // A student should never meet a JSON blob. The database may simply be waking
    // up, so say that, and keep the technical detail in the logs.
    const wantsHtml = String(req.headers.accept || '').includes('text/html');
    if (wantsHtml) {
      res.writeHead(503, { 'content-type': 'text/html; charset=utf-8', 'retry-after': '30' });
      return res.end(
        '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
          '<title>Trying to reach the certificate site</title>' +
          '<style>body{margin:0;min-height:100vh;display:grid;place-items:center;' +
          'font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;background:#0b1020;color:#e9edf7}' +
          'main{max-width:34rem;padding:2rem}h1{font-size:1.35rem;margin:0 0 .75rem}' +
          'p{margin:.5rem 0;color:#b7c0d8}a{color:#8ab4ff}</style>' +
          '<main><h1>The site is waking up</h1>' +
          '<p>This page could not reach the certificate database just now. That is usually ' +
          'temporary — it happens when the site has been idle.</p>' +
          '<p><strong>Please reload in a minute.</strong> Nothing you entered has been lost; ' +
          'you will not need to repeat anything you already submitted.</p>' +
          '</main>'
      );
    }

    res.writeHead(503, { 'content-type': 'application/json', 'retry-after': '30' });
    res.end(JSON.stringify({ error: 'The site could not reach its database. Try again in a minute.' }));
  }
}
