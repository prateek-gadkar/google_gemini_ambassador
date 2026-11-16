# Brand marks

Everything in this folder is served from `/brand/…` by the app itself. There is
no CDN, no icon font and no external request: the page has to render inside a
frame on someone else's site, in a room with bad Wi-Fi, on the day of the event.

| File | Used for | Notes |
| --- | --- | --- |
| `google-g-64.png`, `google-g-128.png` | app bar mark, touch icon | 64 / 128 px, white-backed |
| `google-wordmark.png` | footer, alt-text "Google" | 122×40 |
| `gemini-sparkle.png` | app bar, hero corner | 192 px, transparent |
| `gemini-wordmark.png` | footer, alt-text "Gemini" | 328×120, transparent |
| `favicon-32.png` | browser tab | 32 px |
| `gsa-logo.png` | **optional** program lockup | add the file and it appears in the footer |

## Adding the program lockup

The footer reserves one slot for the official Google Student Ambassador lockup.
Drop the file in as `gsa-logo.png` (PNG, transparent, ~24–32 px tall when scaled)
and it shows up with no code change; if the file is missing, the slot removes
itself instead of leaving a broken image.

The originals live in Drive, folder **All GSA Logos**
(`1MlbJQMgm8CWpp03dKAgHeHCfbMnCMwYB`):

- `Logo 01 (1) (1) (1).png` — `1GxHml3AF8YgN_tw2qUS-AA_ma-wM46sf` (6000×6296)
- `Logo 02 (1).png` — `1JLFVjgTV-dOpO9wbhwt4-_jdsdImVTaD` (9000×2934)
- `Logo 01 (1) (2).png` (wide lockup) — `1DEqbtNYTtSxjE8EPr80Ca7o5qWJRBo` (15000×2104)
- `Gemini Sparkle (1).png` — `1uWcRMPT3lH9sGbMK7nRxHn4Da1OR1Nz8`
- `Google Gemini Logo on White (1).png` — `14HK2w2atYOoV_oMA-Vq7fgl5CgRI-Mkq`
- `Google Logo (1).png` — `16tN46xoTRV1RNEne8o53vfUHoXRoXhFZ`

Those originals are 0.4–4.5 MB and up to 15 000 px wide. Shipping them as-is
would put several megabytes into a serverless bundle for a 24 px mark, so the
copies here are downscaled to the size they are actually drawn at. To swap in an
original, resize it to the height in the table above first.

## Why the marks are inlined or redrawn

The icons on buttons and status pills are inline SVG (`app/public/icons.js`),
drawn in the shape Material Symbols uses. A webfont or an icon CDN would be one
more thing that can fail to load exactly when a student is trying to finish a
task, and it would also mean the page makes a request to a third party.
