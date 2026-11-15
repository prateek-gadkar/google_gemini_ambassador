# Getting it on the real internet

The site runs. It needs one thing the sandbox cannot give it: a host that stays
up, with a disk that keeps the registrations.

## Read this first

I cannot press the deploy button, and it is not a matter of trying harder. My
network from this session reaches **GitHub and package registries only** —
`github.com`, `api.github.com`, `registry.npmjs.org`, `pypi.org`. Render, Fly,
Cloudflare and Vercel's control planes are not reachable from here. I checked for
connectors: there is no Render or Fly connector, and the Vercel one exists but is
disconnected *and* is the wrong shape for this app (below).

So the division of labour is: **I make it a three-click job, you click.** That
part is done — the repo now has a Render blueprint, a Fly config and a compose
file.

## Which host

| | Cost | Time | Good for |
| --- | --- | --- | --- |
| **Render** + 1 GB disk | ~$7/mo | 5 min | The real event. Recommended. |
| **Fly.io** + volume | ~$3–5/mo | 15 min | Cheapest reliable option, needs their CLI |
| **Your laptop** + Cloudflare tunnel | free | 2 min | Testing with friends *today* |
| Vercel | — | — | **No.** See the note at the end |

Check current pricing yourself; these move.

## Path A — Render (recommended)

1. Push is already done; the repo is on GitHub.
2. [dashboard.render.com](https://dashboard.render.com) → **New +** → **Blueprint**.
3. Pick `prateek-gadkar/google_gemini_ambassador`.
4. Render reads `render.yaml` and shows you what it will create. Click **Apply**.
5. Wait ~3 minutes. You get `https://certificate-station.onrender.com`.
6. **Environment** tab → copy `ADMIN_KEY`. That is your `/admin` key.

**Why it must be the paid instance, not free:** the free plan has no persistent
disk and sleeps after 15 minutes idle. Every registration lives in a JSON file
on disk — on free, the file disappears on each deploy and every restart. Starter
plus a 1 GB disk is the smallest setup where student data survives. Do not
"save $7" here; that is the whole event.

Then finish setup: open `/admin` → upload your signature → `/calibrate` → position
the name and date → **Save and enable downloads**.

## Path B — Fly.io (cheapest)

Needs their CLI and a card. From `app/`:

```bash
fly launch --no-deploy --copy-config          # accept the existing fly.toml
fly volumes create data --size 1 --region bom # the volume is the point
fly secrets set ADMIN_KEY="$(openssl rand -base64 18)"
fly deploy
```

`fly status` shows the URL. `fly secrets list` reminds you of the key name; if
you lose the value, set it again with the command above and use the new one.

## Path C — your laptop, free, right now

For checking that 70 phones can actually reach it before you pay anyone:

```bash
# terminal 1
cd app && ADMIN_KEY="test-key-123" npm start

# terminal 2
cloudflared tunnel --url http://localhost:8080
```

You get a public `https://something.trycloudflare.com` URL that anyone can open.
No account needed.

Two honest caveats: the URL changes every time you restart it, and the site dies
if your laptop sleeps or closes. Fine for a rehearsal, not for 18 November.

## A custom domain

Optional. Your host already gives you a working HTTPS URL, and students will not
care. If you want one:

1. Buy it — Cloudflare Registrar sells at cost (~₹900/yr for a `.com`), Namecheap
   is similar. A `.in` is cheaper. **I cannot buy or pay for this.**
2. In your host's dashboard, add the custom domain (Render: Settings → Custom
   Domains).
3. At the registrar, add the CNAME record your host shows you.
4. Wait for DNS, and the host issues the TLS certificate automatically.

Skip the portfolio-domain idea unless you want one anyway — this app does not
need to share a domain with anything.

## After it is live

- **Back up before the event and after it:** `cp -r <disk>/gsa.json ~/backup`.
  On Render: Shell tab → `cat /var/data/gsa.json > /tmp/b && download`. Simpler:
  `/admin` → **Download CSV** gets you every registration and certificate serial.
- **Do a rehearsal before 18 November:** register on your phone using the real
  URL, complete both tasks, download a certificate. That tests the exact path a
  student takes, on a real network, through the same TLS.
- **Keep the admin key out of the group chat.** Anyone with it can mark tasks
  verified.

## Why not Vercel

Vercel is serverless: each request may run on a different instance, and the
filesystem is read-only apart from a temporary directory that is wiped. This app
keeps state in a file, so on Vercel registrations would vanish seemingly at
random. Making it work there means moving to a hosted database (Neon/Postgres)
and rewriting the storage layer — more moving parts, more ways to fail, days
before your event.

If you specifically want a Vercel deployment, connect the Vercel app and I will
do that rewrite. I would just rather you did not need it.

## Running it in VS Code

Not needed for deployment — GitHub is already the source of truth, and any host
builds from it. If you want to run or edit it locally, open the folder and:

```bash
cd app && npm start      # http://localhost:8080
cd app && npm test       # 35 checks
```

A local server is useful for trying changes. It is not a way to give 70 students
a URL.
