# Certificate Station

A small website that hands out certificates only to students who finished every
required task. Students register, submit proof for each task, and once the last
required task is in, they type their name and download a certificate with their
name and today's date filled in.

Zero dependencies. One Node process. No database server.

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
npm test           # 32 checks, including a 70-student concurrency run
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

Also paste the real survey links into `tasks[].formUrl` in `config.js`, so
students get an "Open the form" link instead of hunting through the portal.

---

## How the gate works

- A task is *required* when `required: true` in `config.js`. Default: pre-survey
  and post-survey.
- Submitting a receipt marks it `submitted`. With `autoVerifyReceipts: true`
  (the default) that is enough to unlock. You can still mark any receipt
  `rejected`, which re-locks the certificate **and revokes an already-issued
  one**.
- The download requires typing the registered name. Matching ignores case and
  extra spaces, but not spelling: `Ananya Sharmaa` is refused. The name printed
  is always the spelling from registration, never the typed one, so a typo
  cannot end up on a certificate.

## Admin console

`/admin` gives you, per student: name, email, campus, each task's status, the
receipt text, any screenshot, unlock state, and certificate serial. You can
verify, reject or reset any task, and download everything as CSV.

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

See [`../DEPLOY.md`](../DEPLOY.md) for the full walkthrough. In short, this is a
long-running Node process that keeps state on disk, so it needs a host with a
persistent disk — not a serverless platform.

```bash
docker run -p 8080:8080 -v $PWD/data:/var/data \
  -e DATA_DIR=/var/data -e ADMIN_KEY=choose-something certificate-station
```

Deployment configs are in the repo already: `render.yaml` (blueprint),
`app/fly.toml` (volume-based), and `docker-compose.yml` (any VPS).

Two environment variables matter:

| Variable | Why |
| --- | --- |
| `DATA_DIR` | Where registrations and uploads live. Point it at the mounted disk or data is lost on every deploy. |
| `ADMIN_KEY` | Your `/admin` key. If unset, one is generated and printed in the logs. |

`/healthz` returns `{"ok":true}` for the host's health check.

## What is verified, and what is not

Verified by an automated suite (32 checks), a full pipeline run against the real
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
