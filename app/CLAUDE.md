# Working on this repo

Read `README.md` first — particularly "How the money works", "Storage keys are
load-bearing", and "Things that have broken before". Most of what's there was
learned by shipping a bug to the user's phone.

## Before you finish anything

```sh
npm test
```

Then say what you verified, not that you were careful. `npm run build`
succeeding is not a test result — a hook reading state declared below it builds
cleanly and crashes on mount.

If you change behaviour, add a check to `server/test.js` that would fail
against the old behaviour. If you fix a bug, the test should reproduce it: put
the bug back, watch the test fail, then fix it again. That's how you know the
test is real.

## What this app is

A personal finance tracker holding real salary and card balances for one
person. Wrong numbers are worse than missing features. A figure that's
plausible but incorrect is the worst outcome of all, because it won't be
questioned.

Two figures on the same screen must never disagree. This has happened twice —
the daily bars showing a full purchase while the category showed the monthly
slice, and a category row summing full amounts while the header used sliced
ones. If you change how a number is computed, find every other place that
number appears.

## Conventions

**Comments explain why, not what.** The code says what it does. A comment earns
its place by recording a decision, a constraint, or a mistake not to repeat:

```js
/* A repayment moves money from bank to card, so it can never be "on the card"
   itself — otherwise it would inflate the balance it pays. */
```

Not `// set src to bank`.

**Write for the user, not about the code.** UI text says "Left to spend", not
"Remaining budget allocation". No jargon, no exclamation marks, no
congratulating them on logging an expense.

**Every number should be able to explain itself.** Tappable figures open a
breakdown showing the arithmetic in the order it was calculated. If you add a
figure to the interface, it needs one.

**Touch first.** The user is on an iPhone. Test drag, hold, swipe and scroll
behaviour — mouse events are not the same thing, and passive listeners will
silently ignore `preventDefault`.

## Shipping

```sh
npm run build          # writes single/index.html and single/sw.js
```

Bump `version` in `package.json` **and** the cache key in `public/sw.js`
together, and add a `CHANGELOG` entry at the top of the array in
`SpendingWallet.jsx`. Those three move as one; miss the cache key and phones
won't see the update.

Only `single/index.html` and `single/sw.js` are deployed. They are copied to
the repo root, which GitHub Pages serves (see `../CLAUDE.md`). Tell the user
plainly what changed and whether it has reached `main` yet.

## Talking to the user

Lead with what changed, then how you verified it. Show real output — a table of
figures, the test result — rather than describing what you did.

When he reports something, believe the observation and investigate the cause.
He's reliably right about what he's seeing and often wrong about why, which is
normal. "Drag and drop drags the page" turned out to be two separate problems
under one symptom.

If you got something wrong, say so plainly and move on. No performance of
contrition, no lengthy apology — fix it and explain what the actual cause was.

Don't claim you tested something you didn't.
