# Getting it on the real internet — for free

**You do not need to pay anything.** The $7 Render instance was one option, not a
requirement. Here are the paths that cost ₹0, in the order I would try them.

| Path | Cost | Always on? | Setup | Catch |
| --- | --- | --- | --- | --- |
| **A. Share from your own machine** | ₹0 | No | 2 min | Runs only while your machine is awake |
| **B. Vercel + free Postgres** | ₹0 | Yes | ~30 min, one free account | Needs a storage rewrite, which I would do |
| **C. Vercel + unlock codes** | ₹0 | Yes | ~30 min | Different flow: you issue a code per student |
| D. Render + disk | ~$7/mo | Yes | 5 min | The only option that costs money |

**My recommendation for 18 November: Path A.** It is the app exactly as it has
been tested, it costs nothing, and the session is a one-hour window — your
machine is going to be on anyway while you host. Decide on always-on only if the
surveys need to trickle in across several days.

---

## Path A — share from your own machine (₹0, today)

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

Use ngrok for the event. A URL that changes on restart means re-sending it to 70
people.

**Then, the important part:**

1. Keep the machine plugged in, and turn off sleep.
2. **Do not close the terminal.** Closing it takes the site down.
3. If it dies mid-session, run the script again and resend the URL.

Good for: the session itself, and rehearsing today. Not good for: a survey link
that must stay alive for three days unattended.

## Path B — Vercel + free Postgres (₹0, always on)

Vercel's free Hobby plan needs no card, and I can deploy to it directly — the
Vercel connection is already working on your account.

**But Vercel alone cannot run this app.** It is serverless: each request may land
on a different instance, and the filesystem is wiped. This app keeps
registrations in a file, so on Vercel they would vanish at random.

The fix is a free hosted database (Neon or Supabase — both free, email only, no
card), plus a rewrite of the storage layer from "read a JSON file" to "talk to
the database". That is a contained change: everything else — the gate, the
certificate renderer, the admin console — stays as it is.

What I would need from you: a free Neon or Supabase account, and the connection
string. Then I deploy and verify it myself.

## Path C — Vercel with unlock codes (₹0, always on, no database)

If you would rather not create a database account: the app can hold **no state
at all**. After you verify a student's receipts, you generate a one-time unlock
code for them; they enter it on the site and the certificate unlocks. The code is
signed with a secret kept in Vercel's environment settings, so it cannot be
forged.

Fully free, always on, no database anywhere. The cost is a change in workflow:
no self-registration, and you send one code per student (scriptable — a throwaway
page can generate all 70 at once and give you a list).

## Path D — why the paid option existed

Render with a 1 GB disk is the boring, always-on, no-extra-accounts option. It is
worth $7 only if you want to think about none of the above. Nothing else in this
file depends on it.

`render.yaml` is in the repo if you ever go that way.

---

## A custom domain

Optional, and it does **not** need to be a portfolio domain — this site does not
need to share a name with anything.

There is no free .com. If you ever buy one (~₹900/yr at Cloudflare Registrar or
Namecheap), point it at whichever host you chose: add a CNAME where the host
tells you, and TLS is issued automatically. I cannot buy or pay for it.

Skipping it costs you nothing: `xyz.ngrok-free.app` or
`certificate-station.vercel.app` works fine for 70 students.

## Before the event

- **Rehearse on a real phone, on mobile data**, not just your laptop. Register,
  complete both tasks, download a certificate.
- **Back up** `app/data/gsa.json` (or `/var/data/gsa.json` on a host) before and
  after. `/admin` → **Download CSV** is a second copy of every registration.
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
