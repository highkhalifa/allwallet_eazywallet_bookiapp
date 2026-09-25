# Wallet

A personal spending tracker for one person, in the UAE. Runs as a web app
installed to the iPhone home screen. No account, no server, no analytics — the
data lives in the browser on the phone and nowhere else.

Live at `https://highkhalifa.github.io/allwallet_eazywallet_bookiapp/`

## Running it

```sh
npm install
npm run dev     # local dev server
npm test        # the suite below — run this before shipping anything
npm run build   # produces single/index.html and single/sw.js
```

**Deploying is manual.** `npm run build` writes two files to `single/`. Those
two get uploaded to the GitHub Pages repo by hand. Nothing else is deployed —
no `dist/`, no assets folder. The whole app is one self-contained HTML file so
it can be hosted anywhere static with no build step at the far end.

Bump `version` in `package.json` and the cache key in `public/sw.js` together
for every release, or phones won't detect the update.

## Layout

```
src/SpendingWallet.jsx   the entire app — ~3,700 lines, one file
src/storage.js           localStorage wrapper
src/main.jsx             mount + service worker registration
public/sw.js             offline cache and update announcement
server/bundle-single.js  inlines everything into one HTML file
server/test.js           the suite
```

One file is deliberate. It started as a Claude.ai artifact, which only supports
a single file, and staying that way keeps the build trivial. Splitting it is
reasonable now that it's a real repo — but see "storage keys" first.

## How the money works

This is the part worth understanding before changing anything.

**The cycle runs payday to payday**, not 1st to 31st. `cycleStartDay` is asked
on first run and never guessed, because putting someone inside a pay cycle they
didn't choose makes every figure wrong in a way that's hard to spot.

**Accounting is a deliberate hybrid:**

- **Categories are cash basis** — an instalment purchase is charged one slice
  per cycle, as you pay it. A 6,000 fee split over 3 months shows 2,000/month.
- **Card balances are accrual basis** — the full 6,000 is owed from the day of
  purchase and only falls as you repay.

Formal accounting would recognise the whole expense at purchase. This doesn't,
because households run on cash flow, and showing 6,000 against 15,000 income
when only 2,000 will actually leave the account distorts the decision being
made. The cost of that choice is that commitments become invisible, so there's
a **"promised" figure** on the Owed-on-cards tile showing total future
instalments, with a warning when they exceed 25% of expected income.

**Card repayments are not spending.** They reduce the card balance and the bank
balance, and must never enter a category — the purchase was already counted.
A repayment can also never have `src: "card"`, which would inflate the balance
it pays off.

**Budgets are optional, and partial budgeting works.** Someone who budgets only
rent shouldn't be permanently "over budget". Only spending in budgeted
categories counts against the budget; with no budgets at all the comparison is
against income.

**Instalment timing is asked, not assumed.** Tabby takes the first payment
immediately; a credit-card plan bills it on the next statement. `plan.startsNow`
shifts the whole schedule by a cycle.

## Storage keys are load-bearing

Every key is prefixed `wallet:` — so transactions live at
`wallet:wallet-transactions`. **Changing a key name makes a user's data look
permanently erased.** This happened once: a rebuild used `wallet-tx` instead of
`wallet-transactions` and the app opened empty on a phone holding months of
entries. Nothing was deleted, but that isn't obvious to the person looking at it.

Keys that carry data:

```
wallet-transactions  wallet-config      wallet-onboarding  wallet-theme
wallet-entry-kind    wallet-pay-with    wallet-income-src  wallet-flags-open
wallet-hushed        wallet-api-key     wallet-api-provider  wallet-api-model
```

The mount test loads data under the real keys and asserts it appears. Keep that
test honest and this can't happen again.

## Things that have broken before

Each of these shipped to the user's phone at least once.

**`position: fixed` inside a transformed ancestor** is positioned relative to
that ancestor, not the viewport. The tab-swipe track has a transform on it, so
anything meant to sit over the whole screen — sheets, the drag ghost, the
figure breakdowns — must be `createPortal`ed to `document.body`. Bit us three
times.

**Never animate `transform` or `stroke-dasharray` on the donut arcs.** Both
define the shape in SVG; a CSS transform replaces the `transform` attribute
outright and the ring vanishes. Animate opacity on a wrapper only. Bit us twice.

**Hooks must be declared before any effect that reads them.** A hook reading
state declared below it compiles cleanly and throws
`Cannot access 'X' before initialization` on mount. Shipped in 0.38.0, nearly
again in 0.40.1. This is what the mount test exists for.

**React attaches touch listeners passively**, so `preventDefault` inside
`onTouchMove` is ignored and the page scrolls during a drag. A non-passive
listener has to be added by hand on `document`.

**The tab swipe swallows horizontal gestures.** Anything that needs its own
horizontal drag — the daily bars, the instalment slider, draggable rows —
carries `data-owns-drag`, which the swipe handler checks and stands down for.

**Escape sequences render as literal text.** `\u2014` written in JSX text shows
as those six characters on the phone. `server/bundle-single.js` refuses to build
if any UI string contains one. The check is scoped to displayed strings because
React's own bundled regexes legitimately contain such sequences.

## The update prompt

Getting a running build to name the version that's arriving took several
attempts, because the old build can only learn about the new one through
channels the old build controls. The working design uses three independent,
retried routes:

1. The arriving worker announces itself via `clients.postMessage` on install
2. The page asks `reg.waiting` over a `MessageChannel`, retried for 9s
3. The page fetches `sw.js` with `cache: "no-store"` — and the worker
   **excludes `sw.js` from its own cache**, or a stale copy reports a stale
   version

The prompt names the incoming version but not its release notes: the running
build genuinely cannot know them, so it points at Settings instead.

## Testing

`npm test` is not exhaustive. Every check in it exists because that specific
thing broke and reached the phone. The mount test is the important one — it's
the only test that executes the app, and a successful build proves nothing
about whether it runs.

**Before shipping anything: run the tests, then say what you actually
verified.** A build succeeding is not a test result.

## Known gaps

- **AI reasoning on typed entries has never worked reliably.** There's an
  optional API key (MiniMax, OpenAI, Anthropic and others) for categorising
  entries and reading screenshots. The failure has never been diagnosed because
  the error text under the input box has never been captured. Start there.
- **Reading pictures** (the camera button, 0.50.0) runs Tesseract on the phone,
  loaded from jsdelivr at pinned versions on first use. It reads bank messages
  and bank-app lists well in tests; odd layouts may pair a shop with the wrong
  amount, which is why every row goes through review. `server/test-picture.js`
  reads real screenshots through the app and needs Playwright's Chromium.
- **"The year ahead"** — seasonal planning for National Day, Ramadan, summer —
  existed in an earlier version and was not rebuilt.
- **Category structure.** The user's categories mix "what did I buy" with "who
  was it for", so outings with family match two rules and land inconsistently.
  A one-axis structure was proposed but not applied.

## Context on the user

One user, in Abu Dhabi. Cycle starts on the 27th. Income arrives in three
tranches on different days. Two cards: an ADIB covered card and Tabby. Uses the
app almost entirely from an iPhone, so **touch behaviour matters more than mouse
behaviour** — test drags and gestures, not just clicks.

He'll tell you plainly when something is wrong, and he's usually right about
what he's seeing even when wrong about the cause. Test claims before making
them.
