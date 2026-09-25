/* Run with: npm test

   These are not exhaustive unit tests. Each one exists because the thing it
   checks actually broke at some point and reached the user's phone. Keep them
   passing and the same mistakes can't ship twice.

   The mount test matters most: it is the only one that executes the app, and
   it catches the "Cannot access X before initialization" class of crash that
   a successful build will happily hide. */

import { JSDOM } from "jsdom";
import esbuild from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

let failures = 0;
const ok = (name, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "  ok   " : "  FAIL "}${name}${detail ? "  " + detail : ""}`);
};

/* Load the app's pure functions without a DOM. */
const bundle = esbuild.buildSync({
  entryPoints: [path.join(root, "src/SpendingWallet.jsx")],
  bundle: true, format: "esm", write: false, platform: "node",
  define: { __APP_VERSION__: '"test"', __BUILD_TIME__: '"test"' },
  loader: { ".jsx": "jsx" },
}).outputFiles[0].text;

const mod = await import("data:text/javascript;base64," + Buffer.from(bundle).toString("base64"));
const { localParse, computeMetrics, splitPlan, parseAlerts, parsePicture, USD_AED } = mod;

const config = {
  cycleStartDay: 27,
  categories: [
    { id: "living", name: "Housing", budget: 1000, color: "#4E8FB0" },
    { id: "family", name: "Family", budget: 3300, color: "#C07AA0" },
    { id: "groceries", name: "Food", budget: 1900, color: "#6FAE72" },
    { id: "fun", name: "Personal", budget: 3200, color: "#D9A441" },
    { id: "kid", name: "Kid investment", budget: 600, color: "#C9825A" },
    { id: "other", name: "Other", budget: 0, color: "#B5876B" },
  ],
  cards: [{ id: "adib", name: "ADIB", limit: 20000, color: "#4E8FB0" },
          { id: "tabby", name: "Tabby", limit: 15000, color: "#6FAE72" }],
  incomes: [{ id: "i1", name: "Salary", amount: 15000, day: 27 }],
  learned: { barber: "fun" },
};
const cycle = { start: "2026-08-27", end: "2026-09-26", days: 31 };

console.log("\nREADING WHAT YOU TYPED");
ok("a category name wins", localParse("600 kid investment", config, "2026-09-02")?.catId === "kid");
ok("part of a name is enough", localParse("600 kid", config, "2026-09-02")?.catId === "kid");
ok("a taught word is used", localParse("60 barber", config, "2026-09-02")?.catId === "fun");
ok("the built-in list still works", localParse("45 carrefour", config, "2026-09-02")?.catId === "groceries");
ok("a question is not an entry", localParse("can i afford dinner", config, "2026-09-02") === null);
ok("income with no amount uses the plan",
  localParse("salary came in", config, "2026-09-02")?.amount === 15000);
{
  const r = localParse("10000 paid to cover card", config, "2026-09-02");
  // a repayment that is also "on the card" would inflate the balance it pays
  ok("a repayment is never card spending", r?.isCardPay === true && r?.src === "bank");
}

console.log("\nSPLITTING AN INSTALMENT");
for (const [total, n] of [[6000, 3], [1397, 3], [100, 3], [3000, 4]]) {
  const { first, slice } = splitPlan(total, n);
  const sum = Math.round((first + slice * (n - 1)) * 100) / 100;
  ok(`${total} over ${n} sums back exactly`, sum === total, `${first} + ${slice}×${n - 1}`);
}

console.log("\nWHAT THE NUMBERS MEAN");
{
  const tx = [
    { id: "1", kind: "income", amount: 15000, date: "2026-08-27", note: "Salary", sourceId: "i1" },
    { id: "2", kind: "income", amount: 10000, date: "2026-08-30", note: "friend repaid a loan" },
    { id: "3", kind: "expense", amount: 45, categoryId: "groceries", src: "bank", date: "2026-08-28" },
    { id: "4", kind: "expense", amount: 1397, categoryId: "fun", src: "card", cardId: "tabby", date: "2026-08-28" },
    { id: "5", kind: "cardpay", amount: 1000, cardId: "tabby", date: "2026-08-30" },
  ];
  const m = computeMetrics({ tx, config, cycle, today: "2026-09-02", past: false, future: false });
  ok("unplanned money is kept separate", m.plannedIncome === 15000 && m.otherIncome === 10000);
  ok("a card purchase doesn't leave the bank", m.cashOut === 45 + 1000);
  ok("a repayment reduces the balance", m.cardBalance === 397);
  ok("only budgeted categories count against the budget", m.budgetedSpent === 45 + 1397);
  ok("the daily figure divides available cash",
    Math.abs(m.perDay * m.daysLeft - Math.max(0, m.left)) < 0.5);
}

console.log("\nINSTALMENTS ACROSS CYCLES");
{
  // a credit-card plan: nothing is due in the month you buy it
  const tx = [{ id: "buy", kind: "expense", amount: 6000, date: "2026-08-28",
    categoryId: "kid", src: "card", cardId: "adib", note: "university fees",
    plan: { id: "buy", total: 3, slice: 2000, first: 2000, cardId: "adib",
            note: "university fees", startsNow: false } }];
  const cycles = [["2026-08-27", "2026-09-26", 31], ["2026-09-27", "2026-10-26", 30],
                  ["2026-10-27", "2026-11-26", 31], ["2026-11-27", "2026-12-26", 30],
                  ["2026-12-27", "2027-01-26", 31]];
  const charged = cycles.map(([start, end, days]) =>
    computeMetrics({ tx, config, cycle: { start, end, days }, today: start,
      past: false, future: false }).spent);
  ok("nothing charged in the month of purchase", charged[0] === 0);
  ok("charged once per cycle after that", charged[1] === 2000 && charged[2] === 2000 && charged[3] === 2000);
  ok("stops when the plan ends", charged[4] === 0);
  ok("totals exactly the purchase price",
    charged.reduce((s, v) => s + v, 0) === 6000, charged.join(" + "));
  const m0 = computeMetrics({ tx, config, cycle, today: "2026-09-02", past: false, future: false });
  ok("the whole amount is owed from day one", m0.cardBalance === 6000);
  ok("and shown as promised", m0.committed === 6000);
}

console.log("\nREADING PASTED BANK ALERTS");
{
  const incoming = [
    "Your salary of AED 9,500.00 has been credited to account ending 3391 on 01/09/2026.",
    "AED 6,100.00 deposited to your account ending 3391.",
    "AED 3,538.50 received from AHMED TENANT on 30/08/2026.",
    "Inward remittance of AED 1,200.00 credited on 02/09/2026.",
  ];
  const outgoing = [
    "AED 137.55 has been spent on your ADIB Credit Card ending 4412 at AZAYAM RESTAURANT on 25/08/2026.",
    "AED 408.45 paid to ETISALAT INTERNET on 29/08/2026 from account ending 3391.",
  ];
  incoming.forEach((t, i) =>
    ok(`money in #${i + 1}`, parseAlerts(t, config, "2026-09-02")[0]?.kind === "income"));
  outgoing.forEach((t, i) =>
    ok(`money out #${i + 1}`, parseAlerts(t, config, "2026-09-02")[0]?.kind === "expense"));
  const r = parseAlerts(outgoing[0], config, "2026-09-02")[0];
  ok("merchant read without the sentence around it", r?.note === "AZAYAM RESTAURANT", r?.note);
  ok("date read from the message", r?.date === "2026-08-25", r?.date);
  ok("attached to a card", r?.src === "card" && !!r?.cardId);
}

console.log("\nREADING TEXT FROM A PICTURE");
/* What the text reader actually returned for screenshots, copied from a real
   run. server/test-picture.js reads the pictures themselves. */
{
  const messages = "AED 137.55 has been spent on your\nADIB Credit Card ending 4412 at\nAZAYAM RESTAURANT on\n25/08/2026. Avl limit AED 18,412.45\nAED 408.45 paid to ETISALAT\nINTERNET on 29/08/2026 from\naccount ending 3391. Available\nbalance is AED 12,400.00\n\nYour salary of AED 9,500.00 has been\ncredited to account ending 3391 on\n01/09/2026.\n";
  const m = parsePicture(messages, config, "2026-09-02");
  ok("messages with no gap between them still split", m.length === 3, `${m.length} rows`);
  ok("balances and limits are not entries", m.map((r) => r.amount).join() === "137.55,408.45,9500",
    m.map((r) => r.amount).join());
  ok("a wrapped line of a message isn't taken for a name", m[2]?.note === "Money in" || m[2]?.note === "Salary", m[2]?.note);
  ok("wording still decides direction", m.map((r) => r.kind).join() === "expense,expense,income");

  const bankApp = "30 Aug 2026\n\nCARREFOUR MARINA - AED 212.30\nCard purchase\n\nADNOC STATION 112 - AED 95.00\nCard purchase\n\n28 Aug 2026\n\nTRANSFER FROM AHMED + AED 3,538.50\nIncoming transfer\n\nLULU HYPERMARKET - AED 64.75\nCard purchase\n";
  const b = parsePicture(bankApp, config, "2026-09-02");
  ok("a day heading dates the rows under it", b.map((r) => r.date).join() ===
    "2026-08-30,2026-08-30,2026-08-28,2026-08-28", b.map((r) => r.date).join());
  ok("a + sign is money in", b[2]?.kind === "income" && b[2]?.categoryId === "__income");
  ok("a - sign is money out", b[0]?.kind === "expense");
  ok("the amount isn't left in the shop name", b[0]?.note === "CARREFOUR MARINA", b[0]?.note);

  /* Bank apps write names in normal case, which the message reader never
     recognised: every one of these came out as "Bank alert" in 0.50.0. */
  const names = (t) => parsePicture(t, config, "2026-09-02").map((r) => r.note).join(" | ");
  ok("name above its amount", names("Carrefour Hypermarket\nPOS Purchase\n-45.00 AED\nStarbucks Dubai Mall\n-22.50 AED")
    === "Carrefour Hypermarket | Starbucks Dubai Mall", names("Carrefour Hypermarket\nPOS Purchase\n-45.00 AED\nStarbucks Dubai Mall\n-22.50 AED"));
  ok("name beside its amount", names("Carrefour Hypermarket -AED 45.00\nStarbucks Coffee -AED 22.50")
    === "Carrefour Hypermarket | Starbucks Coffee");
  ok("name below its amount", names("AED 45.00\nCarrefour Hypermarket\nAED 22.50\nTalabat")
    === "Carrefour Hypermarket | Talabat");
  ok("a name after \"for\" in a message", names("Your card ending 1234 was debited AED 45.00 for Talabat on 25/08/2026") === "Talabat");
  ok("the category is guessed from the name", parsePicture("Carrefour Hypermarket\n-45.00 AED", config, "2026-09-02")[0]?.categoryId === "groceries");

  /* Wallet notifications on a lock screen, as the reader returned them —
     the status bar, icon marks and run-together words included. Names and
     amounts changed from the real screenshot; the layout and noise are not.
     0.50.1 named every row after the bank, dated them all today, and would
     have kept a figure that lost its decimal point. */
  const lock = "“073594 ET RE 71 Ls\n‘ First Abu Dhabi Bank Sun 13:40\nZiina *sample name 5\n& AED 50.00 -\ny\nFirst Abu Dhabi Bank Fri 23:03\n& AED 100.00 LE\ny\n| First Abu Dhabi Bank Fri 22:38\nThe Falafel Corner\n& AED 90.99 L\n~~\nFirst Abu Dhabi Bank Fri 21:03\nAuh National Exhibitio\n& AED 40.00 L\ny\n| First Abu Dhabi Bank Fri 20:31\nCapital Catering Servi\n5 AED 60.00\npr . .\nPe grist Abu Dhabi Bank Fri 20:20\nahoaibsldy 2 Se 1\nNorthwind Kiosk\nAED 7150\n& WwFirstvAbu Dhabi Bank Fri 20:00\nFg Northwind Kiosk\n\\ AED 26.00 oy |\n= First Abu Dhabi Bank Frif19:18\nNorthwind Kiosk\n& AED 90.00\n. J\n";
  const L = parsePicture(lock, config, "2026-09-28");   // a Monday
  ok("notifications: the shop, not the bank", L.map((r) => r.note).join(" | ") ===
    "Ziina *sample name 5 |  | The Falafel Corner | Auh National Exhibitio | Capital Catering Servi | Northwind Kiosk | Northwind Kiosk | Northwind Kiosk",
    L.map((r) => r.note).join(" | "));
  ok("notifications: Sun and Fri become dates", L[0]?.date === "2026-09-27" && L[1]?.date === "2026-09-25",
    `${L[0]?.date} ${L[1]?.date}`);
  ok("a figure missing its fils is held back", L[5]?.amount === 7150 && L[5]?.doubt && !L[5]?.keep);
  ok("figures with fils are kept", L.filter((r) => r.keep).length === 7);

  const slips = parsePicture("AED 1O5.5O spent at NOON on 03/09/2026", config, "2026-09-05");
  ok("O read for 0 inside a figure is fixed", slips[0]?.amount === 105.5, String(slips[0]?.amount));
  const dotted = parsePicture("AED 45.00 spent at LULU\non 03.09.2026", config, "2026-09-05");
  ok("a dotted date is not a second amount", dotted.length === 1, `${dotted.length} rows`);
  const jan = parsePicture("Dec 30\nNOON - AED 20.00", config, "2027-01-04");
  ok("a heading with no year in January is last December", jan[0]?.date === "2026-12-30", jan[0]?.date);
}

console.log("\nPAID IN DOLLARS");
/* Stored in dirhams at the peg, with the dollar price kept alongside. A
   dollar figure counted as dirhams would understate the spend by 73%. */
{
  ok("the rate is the peg", USD_AED === 3.6725);
  const a = localParse("$45 lunch", config, "2026-09-02");
  ok("$45 is 165.26 dirhams", a?.amount === 165.26 && a?.usd === 45, `${a?.amount} ${a?.usd}`);
  ok("and the note is just the thing", a?.note === "lunch", a?.note);
  const b = localParse("45 usd lunch", config, "2026-09-02");
  ok("45 usd works too", b?.amount === 165.26 && b?.usd === 45);
  ok("so does 20 dollars", localParse("20 dollars netflix", config, "2026-09-02")?.amount === 73.45);
  const c = localParse("45 lunch", config, "2026-09-02");
  ok("no currency means dirhams", c?.amount === 45 && !c?.usd);
  const d = parseAlerts("USD 45.00 has been spent on your card ending 4412 at AMAZON US on 03/09/2026.", config, "2026-09-05")[0];
  ok("a dollar alert is converted", d?.amount === 165.26 && d?.usd === 45, `${d?.amount}`);
  const e = parseAlerts("Purchase of USD 45.00 (AED 168.10) at STEAM GAMES on 03/09/2026.", config, "2026-09-05")[0];
  ok("the dirham charge wins when the bank gives it", e?.amount === 168.1 && e?.usd === 45, `${e?.amount}`);
  const f = parsePicture("Amazon Web Services\nUSD 12.00", config, "2026-09-05")[0];
  ok("dollars in a picture", f?.amount === 44.07 && f?.usd === 12, `${f?.amount}`);
}

console.log("\nDOES IT ACTUALLY RUN");
/* The one test that executes the app. A build succeeding proves only that the
   syntax is valid — a hook reading state declared below it compiles fine and
   then throws on mount. That shipped in 0.38.0. */
{
  const app = esbuild.buildSync({
    entryPoints: [path.join(root, "src/main.jsx")],
    bundle: true, format: "iife", write: false,
    define: { __APP_VERSION__: '"test"', __BUILD_TIME__: '"test"',
              "process.env.NODE_ENV": '"production"' },
    loader: { ".jsx": "jsx" },
  }).outputFiles[0].text;

  const errs = [];
  const dom = new JSDOM(`<!doctype html><html><body><div id="root"></div></body></html>`,
    { runScripts: "outside-only", pretendToBeVisual: true, url: "https://example.com/" });
  const w = dom.window;
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {},
    addListener() {}, removeListener() {} });
  w.scrollTo = () => {};
  w.addEventListener("error", (e) => errs.push(e.message));

  // data written the way the app on the phone writes it, prefix and all
  w.localStorage.setItem("wallet:wallet-transactions", JSON.stringify([
    { id: "a", kind: "income", amount: 15000, date: "2026-08-27", note: "Salary", sourceId: "i1" },
    { id: "b", kind: "expense", amount: 45, date: "2026-08-28", note: "carrefour",
      categoryId: "groceries", src: "bank" },
  ]));
  w.localStorage.setItem("wallet:wallet-config", JSON.stringify(config));

  try { w.eval(app); } catch (e) { errs.push(e.message); }

  await new Promise((r) => setTimeout(r, 900));
  const root_ = w.document.getElementById("root");
  const text = (root_?.textContent || "").replace(/@import[^}]*}/g, "");
  ok("the app mounts", (root_?.children.length || 0) > 0);
  ok("nothing thrown", errs.length === 0, errs[0] || "");
  ok("existing data is found", text.includes("15,000") || text.includes("Food"));
  ok("doesn't ask for the pay date again", !text.includes("What day of the month"));
  dom.window.close();
}

console.log(failures ? `\n${failures} FAILING\n` : "\nall pass\n");
process.exit(failures ? 1 : 0);
