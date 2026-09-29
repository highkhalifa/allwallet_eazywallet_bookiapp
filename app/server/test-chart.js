/* Run with: npm test (after server/test.js)

   The daily bars in the browser, with a month of spending on a fixed clock:
   the control chart's limits against an independent calculation, where the
   lines sit, which bars are flagged, what a drag says, both themes, and that
   the budget view and the donut still work. Screenshots go to
   node_modules/.cache/chart-*.png for a look by eye.

   Needs Playwright's Chromium; says SKIPPED loudly without it. */

import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const out = path.join(root, "node_modules", ".cache");
fs.mkdirSync(out, { recursive: true });

let chromium;
try { ({ chromium } = await import("playwright")); } catch (e) { /* reported below */ }
let browser;
try { browser = chromium && await chromium.launch(); } catch (e) { /* reported below */ }
if (!browser) {
  console.log("\nTHE DAILY CHART\n  SKIPPED  no Chromium here, so the chart was not tested\n");
  process.exit(0);
}

let failures = 0;
const ok = (name, cond, detail = "") => {
  if (!cond) failures++;
  console.log(`${cond ? "  ok   " : "  FAIL "}${name}${detail ? "  " + detail : ""}`);
};

const app = esbuild.buildSync({
  entryPoints: [path.join(root, "src/main.jsx")],
  bundle: true, format: "iife", write: false,
  define: { __APP_VERSION__: '"test"', __BUILD_TIME__: '"test"', "process.env.NODE_ENV": '"production"' },
  loader: { ".jsx": "jsx" },
}).outputFiles[0].text;

/* September, cycle from the 1st, today the 29th. Ordinary days wobble around
   100, the 15th is a 600 spike, today is 40 so far, and a 5,000 purchase is
   dated tomorrow — it must not move the limits. Budget 3,000 → 100 a day. */
const TODAY = "2026-09-29";
const base = [90, 110, 100, 95, 105, 120, 80, 100, 115, 85, 100, 95, 105, 110,
  600, 90, 100, 105, 95, 100, 110, 90, 100, 95, 105, 100, 90, 110];
const tx = base.map((amount, i) => ({ id: `d${i}`, kind: "expense", amount,
  date: `2026-09-${String(i + 1).padStart(2, "0")}`, note: `day ${i + 1}`, categoryId: "food", src: "bank" }));
tx.push({ id: "today", kind: "expense", amount: 40, date: TODAY, note: "today", categoryId: "food", src: "bank" });
tx.push({ id: "later", kind: "expense", amount: 5000, date: "2026-09-30", note: "tomorrow", categoryId: "fun", src: "bank" });
tx.push({ id: "pay", kind: "income", amount: 15000, date: "2026-09-01", note: "Salary", sourceId: "i1" });
const config = {
  cycleStartDay: 1,
  categories: [
    { id: "food", name: "Food", budget: 2000, color: "#6FAE72" },
    { id: "fun", name: "Personal", budget: 1000, color: "#D9A441" },
  ],
  cards: [], incomes: [{ id: "i1", name: "Salary", amount: 15000, day: 1 }], learned: {},
};

// the same arithmetic written out again, not imported, so it checks the app
const mean = base.reduce((a, v) => a + v, 0) / base.length;
const mrBar = base.slice(1).reduce((a, v, i) => a + Math.abs(v - base[i]), 0) / (base.length - 1);
const expect = { mean, mrBar, ucl: mean + 2.66 * mrBar, lcl: Math.max(0, mean - 2.66 * mrBar) };
const aboveDays = base.map((v, i) => (v > expect.ucl ? i + 1 : 0)).filter(Boolean);
console.log(`\nTHE DAILY CHART\n         expected: average ${expect.mean.toFixed(2)}, moving range ${expect.mrBar.toFixed(2)}, ` +
  `upper ${expect.ucl.toFixed(2)}, lower ${expect.lcl.toFixed(2)}, above on ${aboveDays.join(",")} Sep`);

const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
await context.route("**/*", (route) => {
  const url = route.request().url();
  if (url.endsWith("/app.js")) return route.fulfill({ body: app, contentType: "text/javascript" });
  if (url === "https://wallet.test/") return route.fulfill({ contentType: "text/html",
    body: '<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script src="/app.js"></script></body></html>' });
  return route.abort();
});
const page = await context.newPage();
await page.clock.setFixedTime(new Date(`${TODAY}T12:00:00`));
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("https://wallet.test/");
await page.evaluate(({ tx, config }) => {
  localStorage.setItem("wallet:wallet-config", JSON.stringify(config));
  localStorage.setItem("wallet:wallet-transactions", JSON.stringify(tx));
  localStorage.setItem("wallet:wallet-theme", "dark");
}, { tx, config });
await page.reload();
await page.waitForSelector(".spark");

const snap = async (name) => page.locator(".spark").locator("xpath=..").screenshot({ path: path.join(out, name) });

// budget view: exactly as before
{
  const s = await page.evaluate(() => ({
    ctl: document.querySelectorAll(".ctlLine").length,
    pace: !!document.querySelector(".paceline"),
    bars: document.querySelectorAll(".spark .tick").length,
    red: [...document.querySelectorAll(".spark .tick")].filter((t) => /flare/.test(t.getAttribute("style"))).length,
  }));
  ok("budget view: no control lines", s.ctl === 0);
  ok("budget view: budget line still there", s.pace);
  ok("budget view: one bar a day", s.bars === 30, `${s.bars}`);
  // days over 100/day pace: 110,105,120,115,105,110,600,105,110,105,110 → 11
  const overPace = base.filter((v) => v > 100).length;
  ok("budget view: over-pace days still red", s.red === overPace, `${s.red} of ${overPace}`);
  await snap("chart-budget-dark.png");
}

await page.click('.sparkHead button:has-text("Control chart")');
await page.waitForSelector(".ctlKey");

// the limits, read off the key the user sees, against the independent sums
const key = await page.$$eval(".ctlKey b", (bs) => bs.map((b) => Number(b.textContent.replace(/,/g, ""))));
ok("upper limit matches", Math.abs(key[0] - expect.ucl) < 0.01, `${key[0]}`);
ok("average matches", Math.abs(key[1] - expect.mean) < 0.01, `${key[1]}`);
ok("lower limit matches (floored at 0)", Math.abs(key[2] - expect.lcl) < 0.01, `${key[2]}`);
ok("budget labelled in the key", Math.abs(key[3] - 100) < 0.01, `${key[3]}`);
ok("tomorrow's 5,000 and today's 40 didn't count", Math.abs(key[1] - expect.mean) < 0.01);

// where the lines sit: each at its value on the same scale as the bars
{
  const g = await page.evaluate(() => {
    const spark = document.querySelector(".spark");
    const h = spark.getBoundingClientRect().height;
    const bottom = spark.getBoundingClientRect().bottom;
    const y = (el) => (bottom - el.getBoundingClientRect().top) / h;
    const lines = [...document.querySelectorAll(".ctlLine")].map((el) => ({
      cls: el.className, at: y(el), style: getComputedStyle(el).borderTopStyle, color: getComputedStyle(el).borderTopColor }));
    const pace = document.querySelector(".paceline");
    const bars = [...document.querySelectorAll(".spark .tick")];
    return { lines, pace: { at: y(pace), style: getComputedStyle(pace).borderTopStyle, color: getComputedStyle(pace).borderTopColor },
      bar1: bars[0].getBoundingClientRect().height / h, marks: bars.map((b) => b.querySelector(".specialMark")?.textContent || "") };
  });
  const scale = g.bar1 / base[0];                          // fraction of height per dirham
  const mean = g.lines.find((l) => /mean/.test(l.cls));
  const limit = g.lines.filter((l) => /limit/.test(l.cls));
  ok("average line at the average", Math.abs(mean.at - expect.mean * scale) < 0.02, `${mean.at.toFixed(3)} vs ${(expect.mean * scale).toFixed(3)}`);
  ok("upper line at the upper limit", Math.abs(limit[0].at - expect.ucl * scale) < 0.02, `${limit[0].at.toFixed(3)} vs ${(expect.ucl * scale).toFixed(3)}`);
  ok("no lower line when it's 0 (it would be the baseline)", limit.length === (expect.lcl > 0 ? 2 : 1));
  ok("budget line at 100", Math.abs(g.pace.at - 100 * scale) < 0.02);
  ok("budget line dashed, control lines not", g.pace.style === "dashed" && mean.style === "solid" && limit[0].style === "dotted",
    `${g.pace.style} / ${mean.style} / ${limit[0].style}`);
  ok("budget line a different colour from the control lines", g.pace.color !== mean.color, `${g.pace.color} vs ${mean.color}`);
  const marked = g.marks.map((m, i) => (m ? i + 1 : 0)).filter(Boolean);
  ok("a purchase dated tomorrow doesn't flatten the bars", g.bar1 > 0.1, `first bar ${(g.bar1 * 100).toFixed(1)}% tall`);
  ok("special-cause days marked", JSON.stringify(marked) === JSON.stringify(aboveDays), `marked ${marked.join(",")}`);
  ok("marked upwards", g.marks[14] === "▲");
  await snap("chart-control-dark.png");
}

// a finger dragging across the bars
const dragTo = async (day) => {
  const b = await page.locator(".spark").boundingBox();
  const x = b.x + ((day - 0.5) / 30) * b.width, y = b.y + b.height / 2;
  const cdp = await context.newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: b.x + 4, y }] });
  for (let i = 1; i <= 8; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: b.x + 4 + ((x - b.x - 4) * i) / 8, y }] });
  }
  await page.waitForTimeout(80);
  const said = { bubble: await page.textContent(".scrubBubble"), foot: await page.textContent(".sparkFoot") };
  if (day === 15) await page.locator(".spark").locator("xpath=..").screenshot({ path: path.join(out, "chart-drag-dark.png") });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  return said;
};
{
  const spike = await dragTo(15);
  ok("drag on the spike: amount and above the limit", /600/.test(spike.bubble) && /Above upper limit/.test(spike.bubble), spike.bubble);
  const normal = await dragTo(10);
  ok("drag on an ordinary day: normal", /85/.test(normal.bubble) && /Normal/.test(normal.bubble) && /within normal range/.test(normal.foot), normal.bubble);
  const today = await dragTo(29);
  ok("today is judged but says so far", /Normal so far/.test(today.bubble), today.bubble);
  const later = await dragTo(30);
  ok("tomorrow isn't judged", /hasn't happened/.test(later.foot) && !/Normal|limit/.test(later.bubble), later.bubble);
  ok("dragging didn't change tab", await page.isVisible(".ctlKey"));
}

// the key opens the arithmetic
{
  await page.click(".ctlKey");
  await page.waitForTimeout(300);
  const t = await page.textContent("body");
  ok("tapping the key shows the working", /Control limits/.test(t) && /2\.66 ×/.test(t) && /Days counted/.test(t));
  await page.keyboard.press("Escape");
  await page.mouse.click(5, 5);
}

// light mode, and the choice survives a reload
{
  await page.evaluate(() => localStorage.setItem("wallet:wallet-theme", "light"));
  await page.reload();
  await page.waitForSelector(".ctlKey");
  ok("control view remembered after reopening", await page.isVisible(".ctlLine.mean"));
  const c = await page.evaluate(() => ({
    line: getComputedStyle(document.querySelector(".ctlLine.mean")).borderTopColor,
    light: document.documentElement.classList.contains("light") || !!document.querySelector(".app.light"),
  }));
  ok("light mode uses the light line colour", c.light && c.line === "rgb(47, 100, 179)", c.line);
  await snap("chart-control-light.png");
  await page.click('.sparkHead button:has-text("Budget")');
  await snap("chart-budget-light.png");
}

// the donut on Plan and the ring on Wallet
{
  ok("the Wallet ring still draws", (await page.$$(".ringSpend")).length === 1);
  await page.getByRole("button", { name: "Plan", exact: true }).click();
  await page.waitForTimeout(700);
  const arcs = await page.$$eval("svg.ringWrap circle.seg-in", (c) => c.length);
  ok("the donut still draws its slices", arcs === 2, `${arcs}`);
  await page.locator("svg.ringWrap").screenshot({ path: path.join(out, "chart-donut-light.png") });
}

ok("nothing thrown", errors.length === 0, errors[0] || "");
await browser.close();
console.log(failures ? `\n${failures} FAILING\n` : "\nall pass\n");
process.exit(failures ? 1 : 0);
