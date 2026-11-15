# Certificate Station

A small website that hands out certificates only to students who finished every
required task. Students register, submit proof for each task, and once the last
required task is in, they can type their name and download a certificate with
their name filled in.

Zero dependencies. One Node process. No database server.

---

## The one rule this was built around

**Nothing about your event is invented.** `app/config.js` ships with the event
title, date, campus and ambassador name left blank, and the certificate download
is *hard-disabled* until a real template image is uploaded and calibrated. The
UI says what is missing rather than filling the gap with a plausible guess.

You will see this until you complete setup:

- Student dashboard: "the certificate artwork has not been loaded yet"
- `POST /api/certificate/issue` returns `409 template_not_ready`
- Admin console: a warning banner naming exactly what is outstanding

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
npm test           # 27 checks, including a 70-student concurrency run
```

---

## Setup, in order

### 1. Fill in your event details

Edit `app/config.js`:

```js
event: {
  title: '',      // exactly as it must print
  date: '',       // exactly as it must print
  campus: '',     // exactly as it must print
  ambassador: '', // if the template has this field
  gid: '13597',   // confirmed
}
```

Leave anything you do not have blank. Blank fields simply are not printed.

Also paste the real survey links into `tasks[].formUrl`, so students get an
"Open the form" link instead of hunting through the portal.

### 2. Upload the certificate artwork

`/admin` → **Upload template image**. JPG or PNG, under 12 MB, as large as you
have. Uploading does **not** enable downloads by itself.

### 3. Calibrate the name position

`/admin` → **Open calibration**. Drag the sample name onto the blank space in the
artwork, set size, font, weight, colour and alignment. The sample name
("Ananya Sharma") is preview only and is never written to a real certificate.

Position is stored as a fraction of the image, so if you later swap in a
higher-resolution template, the placement still lines up.

### 4. Enable downloads

In calibration, press **Save and enable downloads**. Downloads are now live for
unlocked students.

---

## How the gate works

- A task is *required* when `required: true` in `config.js`. Default: pre-survey
  and post-survey, matching what is mandatory for the certificate.
- Submitting a receipt marks it `submitted`. With `autoVerifyReceipts: true`
  (the default) that is enough to unlock — you chose the receipts-then-unlock
  flow. You can still mark any receipt `rejected`, which re-locks the
  certificate **and revokes an already-issued one**.
- The download also requires typing the registered name. Matching ignores case
  and extra spaces, but not spelling: `Ananya Sharmaa` is refused. The name
  printed is always the spelling from registration, never the typed one, so a
  typo cannot end up on a certificate.

## Admin console

`/admin` gives you, per student: name, email, campus, each task's status, the
receipt text, any screenshot, unlock state, and certificate serial. You can
verify, reject or reset any task, and download everything as CSV.

## Students

`/` → register with name, email, optional campus → submit a receipt per task
(paste the confirmation, optionally attach a screenshot) → when unlocked, type
their name and download a PNG rendered in their browser at full template
resolution.

---

## Where the data lives

Everything is in `app/data/` — deliberately git-ignored, because it is student
data:

```
app/data/gsa.json          registrations, receipts, certificate serials, admin key
app/data/proofs/*.jpg      uploaded screenshots
app/public/assets/         uploaded certificate template (also git-ignored)
```

**Back it up** with `cp -r app/data /somewhere/safe` before an event. Delete it
to start the event over.

By default a student's email is their identity — no password. That is fine for a
closed campus session with a room cap of 100, and it is what makes sign-up fast
on a phone. If you would rather have passwords, say so; it is a small change.

## Capacity

Measured locally, not estimated: **70 students registering, submitting both
receipts, and downloading a certificate = 280 requests in ~0.7 s** (~370 req/s),
with every record and unique serial intact afterwards, and the 100-participant
cap enforced rather than merely advertised. The JSON store serialises writes and
writes atomically, so concurrent registrations cannot be lost.

A room of 50–70 on campus Wi-Fi will not stress this. The rate limiter is a
flood guard at 240 requests per 10 minutes per IP, on purpose: a whole campus
usually shares one public IP, and a tighter limit would lock out the room. This
was caught by the load test before shipping, not in production.

## Moving it to real hosting later

`npm start` with `PORT` set is enough for any Node host. A `Dockerfile` is
included:

```bash
docker build -t certificate-station .
docker run -p 8080:8080 -v $PWD/app/data:/app/data -e ADMIN_KEY=choose-something certificate-station
```

Mount `/app/data` as a volume or every restart forgets the registrations.

## What is verified, and what is not

Verified by an automated suite (27 checks) plus a live smoke test:

- the gate: one task is not enough, rejection re-locks and revokes
- name matching, idempotent re-issue, unique serials
- template cannot be enabled without a file; non-images refused
- screenshots are private to their owner
- path traversal refused, unknown routes 404, oversized bodies get a readable 413
- sessions are signed, tamper-proof and expire; admin key compared in constant time
- the whole 70-student burst above

**Not verified visually:** the browser rendering of your actual artwork, because
the template does not exist in this workspace yet. The maths is unit-tested and
the calibration screen exists precisely so you can confirm the placement with
your own eyes in about thirty seconds.
