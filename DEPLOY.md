# Getting it on the real internet — for free

**You do not need to pay anything.** The $7 Render instance was one option, not a
requirement.

You told me the site has to be reachable **the whole day of 18 November**, not
just for the hour of the session. A tunnel from your laptop cannot promise that,
so I built the always-on path that costs ₹0: **Path B, Vercel + a free Supabase
database.** It preserves self-registration and the admin console, which the
unlock-code path would have removed.

| Path | Cost | Always on? | Status |
| --- | --- | --- | --- |
| **B. Vercel + free Supabase** | ₹0 | **Yes** | **Built and tested. Needs one free account from you.** |
| A. Share from your own machine | ₹0 | No | Working. Rehearse with it; keep it as the fallback |
| C. Vercel + unlock codes | ₹0 | Yes | Sketch only. Costs you self-registration |
| D. Render + a disk | ~$7/mo | Yes | Ruled out — card on file |

---

## Path B — what happens on 18 November

Vercel's Hobby plan is free, needs no card, and serves a stable URL that answers
requests all day. Its one limitation is that it has no disk: the filesystem is
wiped between requests and two requests can land on two different instances.

So the registration list can no longer live in a file. It now lives in one row
of a free hosted Postgres — Supabase's free tier, email sign-in only, no card —
and the site reaches it over HTTP. Everything else is unchanged: the same gate,
the same certificate renderer, the same admin console, the same 42 checks.

**What I already changed** (committed, and the full suite passes):

- `app/lib/rest-store.js` — storage that talks to Postgres over its REST API. No
  driver, no dependencies, nothing to install.
- Writes are conditional on a version number, so two instances cannot silently
  overwrite each other. A losing writer reloads, re-runs its change, retries.
- The document is re-read once per request, so a warm instance never serves a
  stale registration list.
- Your signature is stored inside the document, because a hosted filesystem is
  wiped on every deploy.
- `api/index.js` + `vercel.json` at the repository root, so importing this repo
  needs no framework, build or root-directory settings at all.

### Step 1 — the free database (about 5 minutes, only you can do this)

1. Go to **supabase.com** → *Start your project* → sign in with Google. Choose
   the **Free** plan. No card is asked for. Name the project `gsa-certificate`.
   Pick the region closest to you — **Mumbai (`ap-south-1`)** if it is offered;
   otherwise *Southeast Asia (Singapore)* is the next best for a campus in India.
   Set a database password when it asks (you will not need it for this site).
2. Wait for the project to finish provisioning (a minute or two).
3. Left sidebar → **SQL Editor** → *New query*. Open
   **`app/db/schema.sql`** from this repo, paste the whole file in, click **Run**.
   You should see *Success. No rows returned.* That created the one table the
   site uses and locked it so the public key can read nothing.
4. Left sidebar → **Project Settings** → **API** (in some versions it is called
   **Data API**). Copy two values:
   - **Project URL** — looks like `https://abcdefghijkl.supabase.co`
   - **`service_role`** secret, under *Project API keys*, revealed with the eye
     icon. It is the long one. **Not the `anon` key** — `anon` is deliberately
     locked out by the schema above.
5. Send me both. That is the whole of your part.

> The `service_role` key can read and write your database, which is exactly what
> the server needs. Do not paste it into the group chat, and do not put it in the
> website's own code. It belongs only in Vercel's environment settings.

### Step 2 — what I do with them

I set four environment variables on the Vercel project and deploy:

| Variable | Value | Why |
| --- | --- | --- |
| `SUPABASE_URL` | your Project URL | where the database lives |
| `SUPABASE_SERVICE_KEY` | your `service_role` key | writes are authenticated with it |
| `ADMIN_KEY` | a key I generate and give you | your `/admin` login, fixed rather than random |
| `DATA_DIR` | `/tmp/gsa-data` | scratch space for the artwork; nothing durable lives here |

Then I run the real thing end to end on the live URL: register a test student,
submit both receipts, confirm it is still locked after one, unlock after two,
confirm a wrong name gives `403`, download the certificate with the right name,
and confirm the registration shows up in `/admin`. Then I delete the test
student.

### Step 3 — one honest caveat

The storage code is tested against a mock that speaks the same HTTP contract as
Supabase, including two instances writing at once and a forced conflict — but a
mock is not Supabase. **The first real deploy is the test that counts**, and I
will run it as soon as you send the two values. Do not send the link to 70
students before I have done that.

If Vercel's API refuses the very first deployment for this project, the fix is
one click for you: **vercel.com → Add New → Project → Import** this GitHub repo
→ *Deploy*. No settings to change, still ₹0. I will tell you if it comes to that.

### What "always on" means here, precisely

- **The URL never changes.** `gsa-certificate-site.vercel.app` is yours and
  answers all day.
- **The server may sleep between requests.** On the free plan an idle function is
  suspended and started again on the next request — about a second of extra
  delay on the first click after a quiet spell. Nothing is lost, because the data
  is in Supabase, not in the function.
- **Supabase's free tier pauses a project after a week with no activity.** The
  session is three days away, and the site reading and writing on the day keeps
  it active. If it ever does pause, one button in the dashboard resumes it.
- **No uptime promise.** Free tiers do not come with 99.9%. This path has two
  services that could hiccup instead of one laptop that could sleep. It is still
  far more reliable than a tunnel — and if you want belt and braces, both paths
  can run at once: the tunnel as a mirror link, the Vercel URL as the one you
  print.

---

## Path A — share from your own machine (₹0, today)

Useful for **rehearsing** before the event, and as a fallback on the day if the
hosted site ever misbehaves. It runs only while your machine is awake.

```bash
cd app
./scripts/share.sh
```

It starts the site, opens a public HTTPS tunnel, and prints two things: your
admin key, and a URL like `https://brave-tiger-mango.trycloudflare.com`. Send
students that URL.

Verified working end to end: the script starts the server, waits until it
answers, keeps the admin key you already have (it reads it back from
`data/gsa.json` rather than inventing a new one), extracts the public URL, and
shuts everything down cleanly on Ctrl-C.

**Install a tunnel program first.** The script tells you how if it can't find
one:

- `cloudflared` — no account needed, but **the URL changes every restart**
- `ngrok` — free account, and you can claim **one free static domain**, so the
  URL is the same every time

Use ngrok if you rely on this. A URL that changes on restart means re-sending it
to 70 people.

If you use it on the day: keep the machine plugged in, turn off sleep, and **do
not close the terminal**.

## Path C — Vercel with unlock codes (₹0, always on, no database)

Only if you decide you would rather not create a database account. The app holds
**no state at all**: after you verify a student's receipts, you generate a
one-time unlock code for them, signed with a secret in Vercel's environment
settings so it cannot be forged.

Fully free, always on, no database anywhere. The cost is a change in workflow:
**no self-registration**, and you send one code per student (scriptable — a
throwaway page can generate all 70 at once and give you a list). I have not built
this, because it removes something you asked for.

## Path D — why the paid option existed

Render with a 1 GB disk is the boring, always-on, no-extra-accounts option. It
needs a card on file even to start, which you told me you cannot do. Nothing else
in this file depends on it. `render.yaml` stays in the repo in case that ever
changes.

---

## A custom domain

Optional, and it does **not** need to be a portfolio domain — this site does not
need to share a name with anything.

There is no free .com. If you ever buy one (~₹900/yr at Cloudflare Registrar or
Namecheap), point it at whichever host you chose: add a CNAME where the host
tells you, and TLS is issued automatically. I cannot buy or pay for it.

Skipping it costs you nothing: `gsa-certificate-site.vercel.app` or
`xyz.ngrok-free.app` works fine for 70 students.

## Before the event

- **Rehearse on a real phone, on mobile data**, not just your laptop. Register,
  complete both tasks, download a certificate.
- **Back up** the registration list. On Path B: Supabase → *Table editor* →
  `state` → the `doc` cell, or *Database* → *Backups*. On Path A: copy
  `app/data/gsa.json`. `/admin` → **Download CSV** is a second copy of every
  registration either way.
- **Keep the admin key out of the group chat.** Anyone with it can mark tasks
  verified.

## What the gate does, and what it does not

Worth knowing before you promise anyone anything.

It stops a student downloading a certificate **before** they finish the tasks.
That is the procedural control you asked for, and it is enforced on the server:
one of two tasks is still `403`.

It does not stop a determined person who has already unlocked from taking the
artwork and signature and making their own certificate — the download is rendered
in the browser, so the images have to be reachable by the browser. Treat the
gate as "no shortcuts", not as "forgery-proof". If that matters for how you
verify entries, tell me and I will harden it.
