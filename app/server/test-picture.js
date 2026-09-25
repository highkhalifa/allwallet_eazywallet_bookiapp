/* Run with: npm test (it runs after server/test.js)

   Reads real pictures with the real text reader, in a real browser, through
   the app's own button. The reader is served from node_modules in place of
   the CDN, at the exact pinned URLs the app asks for, so a changed URL fails
   here rather than on the phone.

   Needs Playwright's Chromium. Without it this says SKIPPED loudly rather
   than passing, because a picture feature nobody has watched read a picture
   is not tested. */

import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const nm = path.join(root, "node_modules");

let chromium;
try { ({ chromium } = await import("playwright")); } catch (e) { /* reported below */ }
let browser;
try { browser = chromium && await chromium.launch(); } catch (e) { /* reported below */ }
if (!browser) {
  console.log("\nREADING A PICTURE\n  SKIPPED  no Chromium here, so pictures were not tested\n");
  process.exit(0);
}

let failures = 0;
const ok = (name, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "  ok   " : "  FAIL "}${name}${detail ? "  " + detail : ""}`);
};

const config = {
  cycleStartDay: 27,
  categories: [
    { id: "living", name: "Housing", budget: 1000, color: "#4E8FB0" },
    { id: "groceries", name: "Food", budget: 1900, color: "#6FAE72" },
    { id: "fun", name: "Personal", budget: 3200, color: "#D9A441" },
    { id: "other", name: "Other", budget: 0, color: "#B5876B" },
  ],
  cards: [{ id: "adib", name: "ADIB", limit: 20000, color: "#4E8FB0" }],
  incomes: [{ id: "i1", name: "Salary", amount: 15000, day: 27 }],
  learned: {},
};

const app = esbuild.buildSync({
  entryPoints: [path.join(root, "src/main.jsx")],
  bundle: true, format: "iife", write: false,
  define: { __APP_VERSION__: '"test"', __BUILD_TIME__: '"test"',
            "process.env.NODE_ENV": '"production"' },
  loader: { ".jsx": "jsx" },
}).outputFiles[0].text;

/* The CDN, from disk. Anything else off-site is refused, so the test can't
   quietly depend on the network. */
const CDN = {
  "https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js": "tesseract.js/dist/tesseract.min.js",
  "https://cdn.jsdelivr.net/npm/tesseract.js@v7.0.0/dist/worker.min.js": "tesseract.js/dist/worker.min.js",
  "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0_best_int/eng.traineddata.gz":
    "@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz",
};
const asked = [];
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
await context.route("**/*", (route) => {
  const url = route.request().url();
  if (url.startsWith("https://wallet.test/")) {
    if (url.endsWith("/app.js")) return route.fulfill({ body: app, contentType: "text/javascript" });
    if (url === "https://wallet.test/") {
      return route.fulfill({ contentType: "text/html",
        body: `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script src="/app.js"></script></body></html>` });
    }
    return route.fulfill({ status: 404, body: "" });
  }
  asked.push(url);
  const core = url.match(/^https:\/\/cdn\.jsdelivr\.net\/npm\/tesseract\.js-core@v7\.0\.0\/([\w.-]+)$/);
  const file = CDN[url] || (core && `tesseract.js-core/${core[1]}`);
  if (file && fs.existsSync(path.join(nm, file))) {
    return route.fulfill({ body: fs.readFileSync(path.join(nm, file)),
      contentType: file.endsWith(".js") ? "text/javascript" : "application/octet-stream" });
  }
  return route.abort();
});

/* Pictures drawn the way the phone shows them, then screenshotted, so the
   reader gets pixels, not text. */
const shot = async (html, name, dark) => {
  const p = await context.newPage();
  await p.setContent(`<!doctype html><html><body style="margin:0;background:${dark ? "#000" : "#fff"};
    font:17px -apple-system,Helvetica,Arial,sans-serif;color:${dark ? "#fff" : "#000"}">${html}</body></html>`);
  const file = path.join(root, "node_modules", ".cache", name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await p.screenshot({ path: file, fullPage: true });
  await p.close();
  return file;
};
const bubble = (t, dark) => `<div style="margin:10px 60px 10px 12px;padding:9px 13px;border-radius:18px;
  background:${dark ? "#262628" : "#e9e9eb"}">${t}</div>`;

const MESSAGES = [
  "AED 137.55 has been spent on your ADIB Credit Card ending 4412 at AZAYAM RESTAURANT on 25/08/2026. Avl limit AED 18,412.45",
  "AED 408.45 paid to ETISALAT INTERNET on 29/08/2026 from account ending 3391. Available balance is AED 12,400.00",
  "Your salary of AED 9,500.00 has been credited to account ending 3391 on 01/09/2026.",
];
const messagesLight = await shot(`<div style="padding:30px 0">${MESSAGES.map((m) => bubble(m)).join("")}</div>`,
  "messages-light.png");
const messagesDark = await shot(`<div style="padding:30px 0">${MESSAGES.map((m) => bubble(m, true)).join("")}</div>`,
  "messages-dark.png", true);

const rowHtml = (name, sub, amt) => `<div style="display:flex;justify-content:space-between;
  padding:12px 18px;border-bottom:1px solid #eee"><div><div style="font-weight:600">${name}</div>
  <div style="color:#666;font-size:14px">${sub}</div></div><div style="font-weight:600">${amt}</div></div>`;
const bankApp = await shot(`<div style="padding:20px 0">
  <div style="padding:6px 18px;color:#555;font-size:15px">30 Aug 2026</div>
  ${rowHtml("CARREFOUR MARINA", "Card purchase", "- AED 212.30")}
  ${rowHtml("ADNOC STATION 112", "Card purchase", "- AED 95.00")}
  <div style="padding:6px 18px;color:#555;font-size:15px">28 Aug 2026</div>
  ${rowHtml("TRANSFER FROM AHMED", "Incoming transfer", "+ AED 3,538.50")}
  ${rowHtml("LULU HYPERMARKET", "Card purchase", "- AED 64.75")}
</div>`, "bank-app.png");

const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("https://wallet.test/");
await page.evaluate((c) => {
  localStorage.setItem("wallet:wallet-config", JSON.stringify(c));
  localStorage.setItem("wallet:wallet-transactions", "[]");
}, config);
await page.reload();
await page.waitForSelector('input[type=file][accept="image/*"]', { state: "attached" });

const read = async (file) => {
  await page.setInputFiles('input[type=file][accept="image/*"]', file);
  await page.waitForSelector(".reviewBox, .hint", { timeout: 120000 });
  await page.waitForFunction(() => document.querySelector(".reviewBox")
    || [...document.querySelectorAll(".hint")].some((h) => /Couldn't/.test(h.textContent)), null, { timeout: 120000 });
  const rows = await page.$$eval(".reviewRow", (els) => els.map((el) => ({
    note: el.querySelector('input[aria-label="What it was"]').value,
    amount: Number(el.querySelector('input[aria-label="Amount"]').value.replace(/,/g, "")),
    kind: el.querySelector(".miniTag").textContent.trim(),
    date: [...el.querySelectorAll("span")].map((s) => s.textContent.trim())
      .find((t) => /^\d{1,2} [A-Z][a-z]{2}$/.test(t)),
  })));
  const msg = await page.$$eval(".hint", (h) => h.map((x) => x.textContent).join(" | "));
  if (await page.$(".reviewBox")) await page.click('button[aria-label="Discard"]');
  return { rows, msg };
};

const show = (rows) => rows.map((r) => `${r.kind === "money in" ? "+" : "-"}${r.amount} ${r.note} (${r.date})`).join("; ");

console.log("\nREADING A PICTURE");
{
  const { rows, msg } = await read(messagesLight);
  console.log(`         read: ${show(rows) || msg}`);
  ok("bank messages: one row each", rows.length === 3, `${rows.length} rows`);
  ok("bank messages: amounts exact", JSON.stringify(rows.map((r) => r.amount)) === "[137.55,408.45,9500]");
  ok("bank messages: balances are not entries", !rows.some((r) => r.amount === 12400 || r.amount === 18412.45));
  ok("bank messages: salary is money in", rows[2]?.kind === "money in");
  ok("bank messages: merchant read", rows[0]?.note === "AZAYAM RESTAURANT", rows[0]?.note);
  ok("bank messages: date read", rows[0]?.date === "25 Aug", rows[0]?.date);
}
{
  const { rows, msg } = await read(messagesDark);
  console.log(`         read: ${show(rows) || msg}`);
  ok("dark mode screenshot: same amounts", JSON.stringify(rows.map((r) => r.amount)) === "[137.55,408.45,9500]");
}
{
  const { rows, msg } = await read(bankApp);
  console.log(`         read: ${show(rows) || msg}`);
  ok("bank app list: one row each", rows.length === 4, `${rows.length} rows`);
  ok("bank app list: amounts exact", JSON.stringify(rows.map((r) => r.amount)) === "[212.3,95,3538.5,64.75]");
  ok("bank app list: + is money in, - is money out",
    rows.map((r) => r.kind).join() === "money out,money out,money in,money out");
  ok("bank app list: day heading carried down", rows[1]?.date === "30 Aug" && rows[3]?.date === "28 Aug",
    rows.map((r) => r.date).join());
  ok("bank app list: shop kept with its amount", rows[0]?.note === "CARREFOUR MARINA", rows[0]?.note);
}
{
  const pinned = (u) => CDN[u] || /tesseract\.js-core@v7\.0\.0\//.test(u);
  const reader = asked.filter((u) => /jsdelivr/.test(u));
  ok("reader fetched only from the pinned addresses",
    reader.length > 0 && reader.every(pinned), reader.filter((u) => !pinned(u)).join(" "));
}
ok("nothing thrown", errors.length === 0, errors[0] || "");

await browser.close();
console.log(failures ? `\n${failures} FAILING\n` : "\nall pass\n");
process.exit(failures ? 1 : 0);
