# Changelog

Personal spending tracker. Pre-release: the leading `0` means it isn't
finished, and things can still change.

**How to read the numbers** — `0.14.3`

- `0` — pre-release. Becomes `1` when it's stable enough to stop changing.
- `14` — features. Goes up when something new appears.
- `3` — fixes. Goes up when something broken gets mended.

**When deploying:** put the version in the commit message, e.g. `v0.14.3`.
The commit list then reads as a deployment history.

---

## 0.14.3

- Animation moved onto the GPU: progress bars scale rather than resize, so
  they can run at the display's full refresh rate
- Neighbouring tabs prepare as your finger lands, not when it starts moving
- Removed a blur that forced a full repaint during swipes

## 0.14.2

- Fixed the breakdown popup rendering unstyled (it sits outside the app
  element, so the theme had to move to the document root)
- Breakdowns are a compact card now, not a full-height sheet
- Update notes appear before you accept an update; full history in Settings

## 0.14.1

- Works when served from a folder, so GitHub Pages can host it
- Nothing visible changed — needed for the move off Netlify

## 0.14.0

- Seasonal background: a drifting sea in summer, its own mood the rest of
  the year. Switch it off in Settings → Appearance

## 0.13.1

- Fixed "Add one by hand" crashing the Wallet tab

## 0.13.0

- Removed the Look tab; two sections now, Money and Settings
- Categories get distinct colours even when the data has none
- Smoother swiping between tabs

## 0.12.0

- Tap any headline number to see how it was worked out
- Marked as pre-release

## 0.11.0

- Interactive donut for where the plan goes — tap a slice
- Cash and card figures reconcile properly

## 0.10.0

- Setup missions that stay until each is actually done
- A copyable prompt for getting an AI to suggest categories from statements
- Feedback section

## 0.9.0

- Category icons and colour
- Filter spending by paid-from-bank vs paid-by-card

## 0.8.0

- Swipe between tabs
- Version stamp

## Earlier

Cards with limits and balances, screenshot scanning, the AI provider layer,
month navigation, offline support, export and import.

---

## Setup

Two files: `index.html` (the whole app) and `sw.js` (offline support).
Upload both to the repo root; GitHub Pages serves them.

Data lives in the browser on each device. It does not sync. Export a backup
from Plan → Settings → Backup, regularly.
