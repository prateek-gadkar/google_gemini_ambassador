# Certificate Station

A small website that hands out certificates only to students who finished every
required task. Students register, submit proof for each task, and once the last
required task is in, they type their name and download a certificate with their
name and today's date filled in.

Zero dependencies. One Node process. No database server.

---

## The look

It is meant to feel like a Google product rather than a side project: a
`#f8f9fa` page, white cards on a single hairline, `#1a73e8` for the one action
that matters, and the four brand colours used only where they carry meaning —
green approved, amber waiting, red rejected. The official Google and Gemini
marks sit in the app bar, the footer and the tab icon; the icons on buttons and
status pills are inline SVG, so nothing depends on a CDN or a webfont.

| Where | What |
| --- | --- |
| App bar | Google G, then the Gemini sparkle, then the page name |
| Footer | Google wordmark, Gemini wordmark, and a slot for the programme lockup |
| Status | `check_circle` approved · `schedule` waiting · `cancel` rejected |
| `app/public/brand/` | every image, plus the Drive IDs and how to swap one in |

Brand assets are served from `/brand/…` by the app itself. `brand/README.md`
lists each file and where the original lives in Drive.

---

## The one rule this was built around

**Nothing on the certificate is invented.** The official artwork carries every
word of the official wording — the title, the paragraph, the Google mark, the
GSA mark and the field labels. This app writes only the three blanks the
template leaves open, and it refuses to issue anything at all until the artwork
*and* your signature are both in place:

| Missing | What happens |
| --- | --- |
| Artwork | Download disabled, `409` |
| Signature | Download disabled, `409` |
| Both present, not enabled | Download disabled, `409` |
| All set | Download enabled |

An unsigned certificate is not a certificate, so the app will not produce one.

---

## The three blanks

Measured off the official JPG (6142 × 4429) by locating the three printed grey
rules, not by eye:

| Field | Rule position | What is printed |
| --- | --- | --- |
| Name | y=2354, x=1348–4793 | Student's name, centred, baseline just above |
| Date | y=3774, x=685–1574 | Today's date, centred, above the word "Date" |
| Signature | y=3774, x=4567–5456 | Your static signature image, above "Signature" |

Positions are stored as fractions of the artwork, so replacing the template with
a larger copy does not break the alignment. The defaults are guarded by a test
that fails if the name drifts onto the rule or collides with "This is to certify
that".

If it ever looks off, `/calibrate` lets you drag all three with a live preview
of the real certificate.

---

## Run it

```bash
cd app
npm start          # http://localhost:8080
```

On first start the server prints an **admin key**. Open `/admin`, paste it, and
keep it to yourself — it is stored in the data file, so it survives restarts.
Set `ADMIN_KEY` in the environment to choose your own.

Run the tests:

```bash
npm test           # 48 checks, including a 70-student concurrency run
```

---

## Setup

The certificate artwork ships with the app and is picked up automatically on
first boot. Two things remain, both yours:

### 1. Upload your signature

`/admin` → **Upload signature**. A PNG with a transparent background works
best. This is printed on every certificate, so it is the one asset that is never
committed to the repository.

### 2. Set the date format (optional)

`app/config.js`:

```js
dateFormat: {
  locale: 'en-GB',
  options: { day: 'numeric', month: 'long', year: 'numeric' },  // 15 November 2026
}
```

Change `options` for a different style — `{ day: '2-digit', month: '2-digit',
year: 'numeric' }` gives `15/11/2026`, `{ month: 'short' }` gives `15 Nov 2026`.
The date always comes from the student's own clock at download time.

### 3. Check the placement, then enable

`/admin` → **Open calibration**. Drag the name and date onto their rules, size
the signature, then **Save and enable downloads**. Use **Download preview PNG**
to check it at full resolution before students ever see it.

The two real survey links are already in `tasks[].formUrl` in `config.js`
(pre-survey and post-survey/feedback), and the button text comes from the task
label, so every card opens its own form in a new tab — above the paste box,
because filling the form in is the task and the box is only for its receipt.

---

## How the gate works

- A task is *required* when `required: true` in `config.js`. Default: pre-survey
  and post-survey.
- Submitting a receipt marks it `submitted`. That is a claim, not a pass: with
  `autoVerifyReceipts: false` (the default) the student sees "submitted,
  waiting for the organiser" and the entry only counts once you press
  **Verify** in `/admin`. Flip the setting to `true` if you would rather trust
  every submission automatically.
- Marking a receipt `rejected` re-locks the certificate **and revokes an
  already-issued one**.
- The download requires typing the registered name. Matching ignores case and
  extra spaces, but not spelling: `Ananya Sharmaa` is refused. The name printed
  is always the spelling from registration, never the typed one, so a typo
  cannot end up on a certificate.

## Admin console

`/admin` gives you, per student: name, email, campus, each task's status, the
receipt text, any screenshot, unlock state, and certificate serial. You can
verify, reject or reset any task, and download everything as CSV.

Because approval is now a decision rather than a formality, the page works as a
work queue: a pill at the top counts how many entries are **awaiting your
approval**, and rows with something waiting sort to the top. Verify is the whole
job — the certificate unlocks the moment the last required entry is approved.

## Where the data lives

Everything runtime is under `app/data/`, deliberately git-ignored because it is
student data:

```
app/data/gsa.json          registrations, receipts, certificate serials, admin key
app/data/proofs/*.jpg      uploaded screenshots
```

**Back it up** with `cp -r app/data /somewhere/safe` before an event.

By default a student's email is their identity — no password. That is fine for a
closed campus session with a room cap of 100, and it keeps sign-up fast on a
phone. Say the word if you want passwords instead.

### Sessions do not rely on cookies

Sign-in returns a signed token as well as a cookie. The browser keeps the token
in memory and sends it as `Authorization: Bearer …`; the cookie is only a
convenience so a reload does not sign anyone out.

This is not over-engineering: when the site is shown inside a frame on another
site — which is exactly what a preview pane is — browsers treat the session
cookie as third-party and silently drop it. The symptom is a login that
"succeeds" and then never advances. The token path avoids that entirely, and
also covers students who have cookies disabled. The cookie is sent with
`SameSite=None; Secure` when the request arrives over HTTPS so it is at least
usable in the frame, and plain `Lax` on a local HTTP server.

## Capacity

Measured locally, not estimated: **70 students registering, submitting both
receipts, and downloading a certificate = 280 requests in ~0.7 s** (~370 req/s),
with every record and unique serial intact afterwards, and the 100-participant
cap enforced rather than merely advertised.

The rate limiter is a flood guard at 240 requests per 10 minutes per IP, on
purpose: a whole campus usually shares one public IP, and a tighter limit would
lock out the room. This was caught by the load test before shipping.

## Putting it on the real internet

See [`../DEPLOY.md`](../DEPLOY.md) for the full walkthrough. The hosted,
always-on setup is **Vercel + a free Supabase Postgres**, which costs nothing and
needs no card — that is the recommended path.

```bash
docker run -p 8080:8080 -v $PWD/data:/var/data \
  -e DATA_DIR=/var/data -e ADMIN_KEY=choose-something certificate-station
```

Deployment configs are in the repo already: `api/index.js` + `vercel.json` at the
repository root (Vercel), `render.yaml` (blueprint), `app/fly.toml`
(volume-based), and `docker-compose.yml` (any VPS).

Environment variables:

| Variable | Why |
| --- | --- |
| `DATA_DIR` | Where registrations and uploads live on a host with a disk. Point it at the mounted disk or data is lost on every deploy. On Vercel set it to `/tmp/gsa-data`; nothing durable belongs there. |
| `ADMIN_KEY` | Your `/admin` key. If unset, one is generated and printed in the logs. |
| `SUPABASE_URL` | The Supabase project URL. Setting this switches storage from a JSON file to the hosted database. |
| `SUPABASE_SERVICE_KEY` | The `service_role` key — **not** the `anon` key. It crosses the row-level-security policy the schema installs. |
| `SUPABASE_TABLE` | Optional. The table holding the document. Defaults to `state`. |

Run `app/db/schema.sql` in Supabase's SQL editor first; it creates the one row
the site keeps everything in. Without `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` the
app falls back to a local JSON file, which is right for a laptop or a VPS and
wrong for a serverless host, where the filesystem is wiped between requests.

`/healthz` returns `{"ok":true}` for the host's health check.

## What is verified, and what is not

Verified by an automated suite (48 checks), a full pipeline run against the real
6142 × 4429 artwork, and visual proof renders:

- the gate: one task of two is not enough, a typo is refused, rejection re-locks
  and revokes
- artwork and signature gating, including that enabling without a signature is
  refused rather than silently accepted
- the measured defaults land on the blank rules, and a long name shrinks to fit
- screenshots are private to their owner; path traversal refused; oversized
  bodies get a readable 413
- sessions are signed, tamper-proof and expire; admin key compared in constant time
- the 70-student burst above

**Not verified:** the browser canvas itself has not been run — there is no
browser in this environment. The geometry was verified by rendering the same
coordinates with an independent image library against the real artwork, and the
drawing logic is unit-tested against a stub context. The one remaining
unknown is typography: the certificate's own text is set in **Google Sans**,
which is not in this workspace, so the name currently falls back to Roboto or
the system sans-serif. Drop the Google Sans file into `app/public/assets/` and
the renderer picks it up by name with no other change.
