# November 2026 — Ambassador Command Center

Everything you need to clear November's mandatory tasks and get the welcome kit, in one place.

**The situation:** 3 mandatory tasks + 1 booster. Deadline **30 November 2026**. Today is **15 Nov** — that's 16 days, and it's enough, if the two events get booked in the next 48 hours.

---

## Open this first

👉 **[`dashboard/index.html`](dashboard/index.html)** — the interactive command center.

It holds your live checklist, your point count, the run-of-show, every prompt, and captions that fill themselves in from your GID and region. Progress saves in the browser, so close it and come back.

To run it locally:

```bash
python3 -m http.server 8000 --bind 0.0.0.0 --directory dashboard
# then open http://localhost:8000
```

No build step, no dependencies, works offline from `file://` too.

---

## What November actually requires

| # | Task | Pillar | Rate | Cap | Proof you must submit |
|---|------|--------|------|-----|----------------------|
| 1 | **Game On Night: Imagine the Impossible** | Product Trials | 12 pts / participant | 10–100 | Gemini chat link + Google Doc + Nano Banana poster, per participant, plus the recorded Meet |
| 2 | **Squad Up** reel | Content Creation | Verified on required elements | — | The live post(s), with the mandatory caption |
| 3 | **Study Notebooks: One Student. Three Steps.** | Product Understanding | 15 pts / verified participant | 10–50 | Pre-survey **and** post-survey per participant + submission form |
| B | **Monthly Highlights** post | Booster | Bonus | — | Live post on LinkedIn + Instagram |

Clear all three mandatory tasks and verified → **Tier 1, +250 points**.

The portal is the source of truth for scoring. Everything here is a convenience layer on top of the official guides.

---

## The 15-day plan

Dates are suggestions — but the events do have to be booked at least **24 hours** ahead, and they must run **exactly** at the submitted time. Unannounced changes score zero.

Morning slots, as you asked. All of this is **already on your Google Calendar** — 6 events, 11 sessions.

| Date | Time | Move |
|------|------|------|
| **15 Nov** | Sun | Set up. Fill your GID / campus / region into the dashboard. Read the **Void rules** tab once, properly. |
| **16 Nov** | Mon 10:00 | **Book the Game On Night slot** and start promo. Form must be in by **Tue 17 Nov, 10:00** for a Wed morning event. |
| **17 Nov** | Tue 19:00 | **Film and post the Squad Up reel.** One task locked before the events even start. |
| **18 Nov** | Wed 10:00 | **GAME ON NIGHT** — 60 minutes, morning. Record before anyone joins. |
| **18 Nov** | Wed 11:45 | Collect all three links per participant + fill **Nominate Best Entry** while it's fresh. |
| **20–24 Nov** | 11:00–13:00 | **Study Notebooks interviews**, 3 a day, 13 total. 15–20 min each, both forms every time. |
| **25 Nov** | Wed 18:00 | Log every interview with both receipts. Post **Monthly Highlights**. |
| **26 Nov** | Thu | Buffer — chase anyone who only filled one form. |
| **27–29 Nov** | Fri–Sun | Buffer. Top up interviews if verified count is under 10. |
| **30 Nov** | Mon 09:00 | **Deadline.** Final submission + screenshot everything. |

**Why this order:** the reel takes one evening and locks a whole task before the events even start. The events carry the points so they go first, and the last five days stay empty on purpose — verification problems are normal and you want room to fix them.

### On morning slots

Nothing in the rules restricts the time of day — a morning Game On Night is fine. Two things are enforced though:

1. **The booking form goes in at least 24 hours before** the slot. That's why the booking task sits on Mon 16 for a Wed 18 event.
2. **The event runs at exactly the submitted time.** Shifting it later, even by an hour, scores zero.

A weekday morning is genuinely the stronger choice: students are already on campus, so show-up is far better than asking them to return for an evening call. Make it concrete — a room, a projector, a sanctioned slot with faculty if you can get one — and it stops competing with lectures.

**If 10:00 clashes with a lab or a lecture**, move it to **9:00** or to **Sat 21 Nov, 11:00** instead and push the Study Notebooks block to 22–26 Nov. Both still leave buffer. Say the word and I'll re-time everything.

---

## The three things that most often kill an entry

1. **No recording, or cameras off.** Nothing counts without it. Hit record first, stop it last.
2. **Fewer than 10 real people.** Registration lists get cross-checked against faces on the recording. Recruit 15 to land 10.
3. **A caption missing one required element.** GID, all three tags, all three hashtags, plus your region hashtag. The dashboard has a checker — paste before you post.

The full list is in the **🚫 Void rules** tab. Worth five minutes.

---

## Repo layout

```
dashboard/index.html          the command center — open this
dashboard/timer.html          full-screen 60-minute session timer
app/                          the Certificate Station website — see app/README.md
playbooks/01-game-on-night.md  host sheet, printable, run it live from this
playbooks/02-squad-up-reel.md  shot list + captions for your phone
playbooks/03-study-notebooks.md full interview script + participant log
playbooks/04-crib-sheet.md     what to say on each slide of the official deck
promo/promo-pack.md           invites, Hinglish variants, faculty email, nudges
WHATS-POSSIBLE.md             everything else I can build, and what I can't do
```

Your GID (**13597**) is already loaded, so captions and prompts come out ready to paste. Campus name is still blank — add it in the dashboard, or send it over.

## The Certificate Station website

`app/` is a working multi-user site: students register, submit a receipt for each
required task, and the certificate unlocks only when every required task is in.
They then type their name and download it.

```bash
cd app
npm start        # http://localhost:8080 — prints the admin key on boot
npm test         # 27 checks incl. a 70-student concurrency run
```

Three things about it are deliberate:

1. **It will not print anything you have not given it.** Event title, date and
   campus are blank in `app/config.js`, and downloads stay disabled until a real
   certificate template is uploaded and calibrated. There is no placeholder
   artwork pretending to be official.
2. **The gate is enforced server-side**, not hidden in the page. Submitting one
   of two tasks still returns `403`. Rejecting a task re-locks the certificate
   and revokes an issued one.
3. **Setup is where you decide the wording.** Upload the artwork, drag the name
   field into place on the calibration screen, press enable. Two minutes.

Full setup and operations: [`app/README.md`](app/README.md).

### Don't miss this one

**Google Play Arena registrations close 29 November** — a day before the task deadline. A Best Entry only counts if that participant is registered, so the room has to sign up on the call, not "later". Register at `goo.gle/GooglePlayArena-StudentAmbassadors`. There's a check on your calendar for 27 Nov.

---

## Source documents

- [November Task Guide](https://docs.google.com/presentation/d/1Idqwz3OWeleKz4BHtiBbhM5BhUiSYQVVeIyftM8_RAc/edit) — the month's brief
- [Program Guide Semester 2](https://docs.google.com/presentation/d/1O2jgE2THR9uXMqGszCgda98Akl7TYlKFpvCH4i2393Y/edit) — rules, scoring, rewards
- [Study Notebooks task deck](https://docs.google.com/presentation/d/1gODelJeLUrXF5a9jLZNxoX92CThoWEtSSR7jSXyAITY/edit) — official interview script
- [November Assets folder](https://drive.google.com/drive/folders/1-XTgKk9aRUTXyCpktKnEzP5Y4QQggCBu) — decks, posters, logos, certificates
- [Task Guide Session recording](https://drive.google.com/file/d/1bsfK_WiEeRkX3HSo76_y6zQV42SBUVpH/view) — if you want the walkthrough in full

The booking form, pre-surveys, feedback forms and Best Entry form live in your **ambassador portal** and the official channel — they aren't in Drive.
