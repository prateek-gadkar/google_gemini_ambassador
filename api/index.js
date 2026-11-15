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
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'The site could not start. Check the server logs.' }));
  }
}
