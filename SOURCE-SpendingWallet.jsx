import React, { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { storage, sync } from "./storage";
import {
  Check, Info, Moon, Sun, Home as HomeIcon, Users, Utensils, Receipt, Sparkles,
  Building2, Baby, Landmark, Package, Car, Heart, Send, Camera, Trash2, Loader2,
  Plus, X, Undo2, Wallet, ScrollText, SlidersHorizontal, TrendingDown,
  AlertTriangle, PiggyBank, ArrowDownLeft, ChevronDown, Pencil, GripVertical,
  CreditCard,
} from "lucide-react";

/* ---------- keys ---------- */

/* These key names are not free to change: they are where the data already
   lives on the phone. Renaming one makes a user's history look erased. */
const TX_KEY = "wallet-transactions";
const CONFIG_KEY = "wallet-config";
const CHAT_KEY = "wallet-chat";
const MISSIONS_KEY = "wallet-onboarding";


/* The AI key lives under a "wallet:" prefix, as it always has. These names are
   load-bearing: the key is on the phone and nowhere else, so reading the wrong
   one makes a configured account look empty. */
const KEY_NAME = "wallet-api-key";
const PROVIDER_NAME = "wallet-api-provider";
const MODEL_NAME = "wallet-api-model";

const device = {
  get(k) { try { return window.localStorage.getItem(`wallet:${k}`) || ""; } catch (e) { return ""; } },
  set(k, v) {
    try {
      if (v) window.localStorage.setItem(`wallet:${k}`, v);
      else window.localStorage.removeItem(`wallet:${k}`);
    } catch (e) { /* nothing we can do */ }
  },
};

const getDeviceKey = () => device.get(KEY_NAME);
const getProvider = () => device.get(PROVIDER_NAME);
const getModel = () => device.get(MODEL_NAME);

/* Providers the app can talk to straight from the browser. The model is
   editable for every one of them — a hardcoded name is exactly what left a
   working key unable to call anything. */
const PROVIDERS = {
  anthropic:  { label: "Anthropic",   model: "claude-sonnet-4-6",       base: "https://api.anthropic.com/v1" },
  openai:     { label: "OpenAI",      model: "gpt-4o-mini",             base: "https://api.openai.com/v1" },
  gemini:     { label: "Gemini",      model: "gemini-2.0-flash",        base: "https://generativelanguage.googleapis.com/v1beta" },
  openrouter: { label: "OpenRouter",  model: "openai/gpt-4o-mini",      base: "https://openrouter.ai/api/v1" },
  groq:       { label: "Groq",        model: "llama-3.3-70b-versatile", base: "https://api.groq.com/openai/v1" },
  deepseek:   { label: "DeepSeek",    model: "deepseek-chat",           base: "https://api.deepseek.com/v1" },
  mistral:    { label: "Mistral",     model: "mistral-small-latest",    base: "https://api.mistral.ai/v1" },
  minimax:    { label: "MiniMax (global)", model: "MiniMax-M3",         base: "https://api.minimax.io/v1" },
  minimax_cn: { label: "MiniMax (China)",  model: "MiniMax-M3",         base: "https://api.minimaxi.com/v1" },
};

/* ---------- money ---------- */

const money = (n) =>
  Math.abs(n) >= 1000
    ? Math.round(n).toLocaleString("en-US")
    : String(Math.round(n * 100) / 100);

/* The dirham mark, drawn rather than typed.
   Unicode 18.0 encodes it in September 2026, but no phone has the font yet,
   so a character would render as an empty box. An inline SVG shows correctly
   on any device today. Swap this for the character once fonts catch up. */
const DH = "\u062f.\u0625";   // for template strings, where an SVG can't go

function Dh({ size = "1em", style }) {
  return (
    <svg viewBox="0 0 22 24" width={size} height={size} aria-label="dirham"
      role="img" focusable="false"
      style={{ display: "inline-block", verticalAlign: "-0.12em",
        marginInlineEnd: ".18em", flex: "none", ...style }}>
      <g fill="none" stroke="currentColor" strokeWidth="2.6"
        strokeLinecap="round" strokeLinejoin="round">
        <path d="M7.5 4.5h3.2c4.4 0 7.3 3.6 7.3 7.5s-2.9 7.5-7.3 7.5H7.5V4.5z" />
        <path d="M2.6 10.2h11.2" />
        <path d="M2.6 14.2h11.2" />
      </g>
    </svg>
  );
}

/* ---------- dates ---------- */

const pad = (n) => String(n).padStart(2, "0");
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                     "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const fmtDay = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTH_SHORT[m - 1]}`;
};

const dayCount = (fromISO, toISO) => {
  const a = new Date(`${fromISO}T00:00:00Z`);
  const b = new Date(`${toISO}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
};

const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/* A cycle runs payday to payday rather than 1st to 31st, so the money on
   screen is the money you actually have. */
function cycleFor(todayIso, startDay) {
  const [y, m, d] = todayIso.split("-").map(Number);
  let sy = y, sm = m;
  if (d < startDay) { sm -= 1; if (sm < 1) { sm = 12; sy -= 1; } }
  const start = `${sy}-${pad(sm)}-${pad(startDay)}`;
  let ey = sy, em = sm + 1;
  if (em > 12) { em = 1; ey += 1; }
  const end = addDays(`${ey}-${pad(em)}-${pad(startDay)}`, -1);
  return { start, end, days: dayCount(start, end) + 1 };
}

function shiftCycle(todayIso, startDay, offset) {
  const base = cycleFor(todayIso, startDay);
  if (!offset) return base;
  const [y, m] = base.start.split("-").map(Number);
  let sy = y, sm = m + offset;
  while (sm > 12) { sm -= 12; sy += 1; }
  while (sm < 1) { sm += 12; sy -= 1; }
  const start = `${sy}-${pad(sm)}-${pad(startDay)}`;
  let ey = sy, em = sm + 1;
  if (em > 12) { em = 1; ey += 1; }
  const end = addDays(`${ey}-${pad(em)}-${pad(startDay)}`, -1);
  return { start, end, days: dayCount(start, end) + 1 };
}

/* ---------- defaults ---------- */

const PALETTE = ["#4E8FB0", "#C07AA0", "#6FAE72", "#8478B5", "#D9A441",
                 "#5E8C8C", "#C9825A", "#7C9AC4", "#B5876B"];

const DEFAULT_CATEGORIES = [
  { id: "living",    name: "Housing",     budget: 0, color: PALETTE[0] },
  { id: "family",    name: "Family",      budget: 0, color: PALETTE[1] },
  { id: "groceries", name: "Food",        budget: 0, color: PALETTE[2] },
  { id: "living2",   name: "Fixed bills", budget: 0, color: PALETTE[3] },
  { id: "fun",       name: "Personal",    budget: 0, color: PALETTE[4] },
  { id: "savings",   name: "Savings",     budget: 0, color: PALETTE[5] },
  { id: "other",     name: "Other",       budget: 0, color: PALETTE[6] },
];

/* ---------- reading what you typed ---------- */

const KEYWORDS = {
  groceries: ["grocery", "groceries", "supermarket", "carrefour", "lulu", "spinneys",
    "union coop", "yas mart", "talabat", "deliveroo", "noon food", "restaurant", "cafe",
    "coffee", "starbucks", "costa", "lunch", "dinner", "breakfast", "shawarma", "bakery",
    "بقالة", "سوبرماركت", "مطعم", "قهوة", "غداء", "عشاء"],
  living2: ["bill", "etisalat", "du ", "dewa", "addc", "sewa", "internet", "electricity",
    "water bill", "salik", "darb", "parking", "mawaqif", "petrol", "adnoc", "enoc", "eppco",
    "fuel", "phone bill", "subscription", "netflix", "spotify", "insurance",
    "فاتورة", "كهرباء", "ماء", "بنزين", "وقود", "اشتراك"],
  living: ["rent", "rashen", "maintenance", "furniture", "ikea", "home centre", "danube",
    "ace hardware", "cleaning", "إيجار", "صيانة", "أثاث"],
  family: ["family", "kids", "school", "nursery", "uniform", "toys", "mother", "father",
    "mum", "dad", "wife", "gift", "eid", "عائلة", "مدرسة", "هدية", "أطفال"],
  fun: ["clothes", "shoes", "barber", "salon", "haircut", "cinema", "game", "gym",
    "pharmacy", "aster", "life pharmacy", "amazon", "noon", "shein", "namshi", "sephora",
    "careem", "uber", "taxi", "travel", "hotel", "flight", "ملابس", "حلاق", "صيدلية", "سينما"],
  savings: ["saving", "invest", "deposit to savings", "توفير", "استثمار"],
};

const INCOME_WORDS = ["salary", "deposited", "deposit", "bonus", "refund", "received",
  "paid me", "came in", "income", "wage", "payout", "rent from", "rental", "allowance",
  "got paid", "transfer in", "credited", "cashback", "reimburse", "dividend", "payday",
  "راتب", "مكافأة", "استرداد", "وصل", "دخل", "إيجار", "حوالة"];

/* Repayment phrasings. Order matters downstream: if any of these match, the
   entry is a repayment and must never be treated as spending on the card. */
const CARDPAY_WORDS = [
  "paid the card", "card payment", "pay the card", "repaid", "card repayment",
  "settle the card", "cover card", "covered card", "paid to card", "paid card",
  "pay card", "paid off the card", "payment to card", "card settlement",
  "credit card payment", "paid my card", "paid visa", "paid tabby", "tabby payment",
  "سداد البطاقة", "دفعت البطاقة", "تسديد البطاقة", "دفعة بطاقة",
];

const CARD_WORDS = ["credit card", "on the card", "by card", "card", "tabby", "tamara",
  "visa", "mastercard", "بالبطاقة", "بطاقة", "تابي"];

const QUESTION_HINTS = ["can i", "should i", "how much", "what's left", "whats left",
  "do i have", "afford", "am i", "?", "كم", "هل", "أقدر"];

const looksLikeQuestion = (raw) => {
  const low = String(raw).toLowerCase();
  return QUESTION_HINTS.some((w) => low.includes(w)) && !/\d/.test(low);
};

export function localParse(raw, config, today) {
  if (looksLikeQuestion(raw)) return null;
  const low = String(raw).toLowerCase();

  /* Strip any income-source name before reading a number, or "Flat 1 rent
     came in" would be read as one dirham. */
  let scanText = low;
  for (const inc of config.incomes || []) {
    const n = String(inc.name || "").toLowerCase().trim();
    if (n.length > 2) scanText = scanText.split(n).join(" ");
  }
  const nums = scanText.match(/\d+(?:[.,]\d+)?/g);

  /* No amount typed? If the words name an income source you've already set up
     in Plan, use the figure from there. "salary came in" is a complete
     sentence to a person, so it should be one to the app. */
  let amount = nums ? Number(nums[0].replace(",", ".")) : 0;
  let fromPlan = null;
  if (!(amount > 0)) {
    const match = (config.incomes || []).find((i) => {
      const n = String(i.name || "").toLowerCase().trim();
      return Number(i.amount) > 0 && n.length > 2 && low.includes(n);
    }) || (/\bsalary\b|راتب/.test(low)
        ? (config.incomes || []).find((i) => Number(i.amount) > 0 && /salary|راتب/i.test(i.name || ""))
        : null);
    if (match) { amount = Number(match.amount); fromPlan = match.name; }
  }
  if (!(amount > 0)) return null;

  const has = (id) => config.categories.some((c) => c.id === id);
  const sourceNames = (config.incomes || [])
    .map((i) => String(i.name || "").toLowerCase().trim())
    .filter((n) => n.length > 2);
  const isIncome = INCOME_WORDS.some((w) => low.includes(w))
    || sourceNames.some((n) => low.includes(n));

  /* Words you've taught it by correcting a past entry beat the built-in list —
     it learns your merchants rather than relying on ones I guessed at. */
  let catId = config.categories[config.categories.length - 1]?.id || "other";
  let matched = false;
  for (const [word, id] of Object.entries(config.learned || {})) {
    if (has(id) && low.includes(word)) { catId = id; matched = true; break; }
  }
  if (!matched) {
    for (const [id, words] of Object.entries(KEYWORDS)) {
      if (has(id) && words.some((w) => low.includes(w))) { catId = id; break; }
    }
  }

  const note = raw
    .replace(/\d+(?:[.,]\d+)?/g, "")
    .replace(/\b(aed|dhs?|dirhams?|درهم|دراهم)\b/gi, "")
    .replace(/\s+/g, " ").trim().slice(0, 40);

  const isCardPay = CARDPAY_WORDS.some((w) => low.includes(w));
  /* A repayment moves money from the bank to the card, so it can never be
     "on the card" itself — otherwise it would inflate the balance it pays. */
  const src = !isCardPay && CARD_WORDS.some((w) => low.includes(w)) ? "card" : "bank";

  return {
    amount, catId, isIncome: isIncome || !!fromPlan, isCardPay, src, fromPlan,
    note: note || fromPlan || (isIncome ? "Income" : isCardPay ? "Credit card payment" : "Expense"),
    date: today,
  };
}

/* Plainly: what did that become? Shown right after logging so a wrong guess
   is caught in the moment, not weeks later in a reconciliation. */
export function describe(entry, config) {
  if (!entry) return null;
  const m0 = (n) => Math.round(n).toLocaleString("en-US");
  if (entry.kind === "income") return { icon: "in", text: `Money in \u00b7 ${m0(entry.amount)}` };
  if (entry.kind === "cardpay") {
    const card = (config.cards || []).find((c) => c.id === entry.cardId);
    return { icon: "pay", text: `Card repayment${card ? ` \u00b7 ${card.name}` : ""} \u00b7 ${m0(entry.amount)}` };
  }
  const cat = config.categories.find((c) => c.id === entry.categoryId);
  const how = entry.src === "card" ? "on card" : "from bank";
  return {
    icon: "out",
    text: `${cat ? cat.name : "Other"} \u00b7 ${how} \u00b7 ${m0(entry.amount)}`,
    color: cat ? cat.color : undefined,
  };
}

/* ---------- what the numbers mean ---------- */

export function computeMetrics({ tx, config, cycle, today, past, future }) {
  const inCycle = tx.filter((t) => t.date >= cycle.start && t.date <= cycle.end);

  const byCat = {};
  let income = 0, plannedIncome = 0, otherIncome = 0;
  let cashOut = 0, cardOut = 0, cardPaid = 0, spent = 0, spentToday = 0;

  for (const t of inCycle) {
    if (t.kind === "income") {
      income += t.amount;
      /* Only money from a source you planned for counts towards the plan.
         A friend repaying a debt is cash in the bank, not salary. */
      const named = (config.incomes || []).some((i) => {
        const n = String(i.name || "").toLowerCase().trim();
        return n.length > 2 && (
          t.sourceId === i.id ||
          (!t.sourceId && String(t.note || "").toLowerCase().includes(n))
        );
      });
      if (named) plannedIncome += t.amount; else otherIncome += t.amount;
      continue;
    }
    if (t.kind === "cardpay") { cardPaid += t.amount; cashOut += t.amount; continue; }

    spent += t.amount;
    byCat[t.categoryId] = (byCat[t.categoryId] || 0) + t.amount;
    if (t.src === "card") cardOut += t.amount;
    else cashOut += t.amount;
    if (t.date === today) spentToday += t.amount;
  }

  const budget = config.categories.reduce((s, c) => s + Number(c.budget || 0), 0);
  const planning = budget > 0;

  /* Someone may budget only their rent and spend freely elsewhere. Comparing
     total spending against a partial budget would call them over budget for
     money they never planned — so only spending in budgeted categories
     counts against the budget. */
  const budgetedSpent = config.categories
    .filter((c) => Number(c.budget) > 0)
    .reduce((sum, c) => sum + (byCat[c.id] || 0), 0);

  // card balances are all-time, not per cycle: a balance doesn't reset on payday
  const cardBalance = tx.reduce((s, t) =>
    s + (t.kind === "cardpay" ? -t.amount : (t.src === "card" ? t.amount : 0)), 0);
  const cardPaidAll = tx.reduce((s, t) => (t.kind === "cardpay" ? s + t.amount : s), 0);
  const bankedAll = tx.reduce((s, t) => (t.kind === "banked" ? s + t.amount : s), 0);

  const dayIndex = past ? cycle.days : future ? 1
    : Math.max(1, Math.min(cycle.days, dayCount(cycle.start, today) + 1));
  const daysLeft = past ? 0 : future ? cycle.days : Math.max(1, cycle.days - dayIndex + 1);
  const through = past ? 1 : future ? 0 : dayIndex / cycle.days;

  const cashLeft = income - cashOut;
  /* Not everyone plans by category. Without budgets the yardstick becomes the
     income that has arrived — otherwise the app declares you over budget on
     your first entry, which is nonsense. */
  const left = planning ? Math.min(budget - budgetedSpent, cashLeft) : cashLeft;

  const cards = (config.cards || []).map((c) => {
    const owed = tx.reduce((s, t) => {
      if (t.cardId !== c.id) return s;
      return s + (t.kind === "cardpay" ? -t.amount : (t.src === "card" ? t.amount : 0));
    }, 0);
    const thisCycle = inCycle.reduce((s, t) =>
      (t.cardId === c.id && t.kind !== "cardpay" && t.src === "card" ? s + t.amount : s), 0);
    const limit = Number(c.limit) || 0;
    return { ...c, owed, thisCycle, limit, used: limit > 0 ? Math.min(1, owed / limit) : 0 };
  });
  const unassignedCard = cardBalance - cards.reduce((s, c) => s + c.owed, 0);

  return {
    byCat, budget, budgetedSpent, spent, spentToday, income, cashOut, cardOut,
    cardPaid, cardBalance, cardPaidAll, bankedAll, cards, unassignedCard,
    plannedIncome, otherIncome, planning,
    cashLeft, left,
    planLeft: planning ? budget - budgetedSpent : income - spent,
    awaited: planning ? Math.max(0, budget - plannedIncome) : 0,
    dayIndex, daysLeft, through, past, future,
    /* Divide what you can actually spend, not what you planned to. Using the
       budget promised a daily figure the bank couldn't cover — and it
       contradicted the headline, which already shows the smaller of the two. */
    perDay: daysLeft > 0 ? Math.max(0, left) / daysLeft : 0,
    unallocated: planning ? income - budget : 0,
    inCycle,
  };
}

/* ---------- instalment plans ---------- */

/* Splitting must not lose or invent dirhams: the first slice absorbs the
   rounding so the parts always sum to the whole. */
export function splitPlan(total, n) {
  const slice = Math.round((total / n) * 100) / 100;
  const first = Math.round((total - slice * (n - 1)) * 100) / 100;
  return { first, slice };
}

/* How many payments of a plan are already recorded. */
export function paymentsMade(tx, plan) {
  if (!plan) return 0;
  return tx.filter((t) => t.kind === "cardpay" && t.planId === plan.id).length;
}


/* What changed, newest first. Shown in Settings so an update is never a
   mystery. The update prompt can't use this — it can only describe the build
   doing the reading, never the one arriving. */
const CHANGELOG = [
  { v: "0.39.1", items: [
    "Fixed the rebuild reading the wrong storage keys \u2014 existing data appeared missing but was never touched",
    "AI settings are back, and the model is editable for every provider",
  ]},
  { v: "0.39.0", items: [
    "Rebuilt from scratch after the source was lost. Same app, cleaner underneath.",
    "The matcher learns: move an entry to another category and it remembers that word",
    "Instalments now ask when the first payment falls due \u2014 today for Tabby, next statement for a credit-card plan",
    "Budgets stay optional, and budgeting only some categories works properly",
  ]},
];

/* ---------- look ---------- */

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=Sofia+Sans:wght@400;500;600;700&display=swap');

:root,.app{--leather:#101314;--card:#191D1E;--card2:#212627;--line:#2E3436;
  --sand:#E8E9E7;--muted:#8B9391;--gold:#4FCB98;--flare:#F0705B;--leaf:#4FCB98;--amber:#E5A93F;}
:root.light,.app.light{--leather:#F2F0EA;--card:#FFFFFF;--card2:#F7F5F0;--line:#E2DED4;
  --sand:#1A2124;--muted:#6E7573;--gold:#1F8F68;--flare:#C0432E;--leaf:#1F8F68;--amber:#A9701A;}

*{box-sizing:border-box;}
.app{min-height:100vh;background:var(--leather);color:var(--sand);
  font-family:'Sofia Sans',ui-sans-serif,system-ui,sans-serif;
  -webkit-user-select:none;user-select:none;-webkit-touch-callout:none;
  transition:background .3s;}
input,textarea,.num,.txt,.empty{-webkit-user-select:text;user-select:text;}
button,.chip,.segBtn,.foldHead,.panelHead,.statCard,label{-webkit-user-select:none;user-select:none;}

.wrap{max-width:520px;margin:0 auto;padding:14px 18px 108px;}
.num{font-family:'IBM Plex Mono',ui-monospace,monospace;font-variant-numeric:tabular-nums;}
.over{color:var(--flare);}
.eyebrow{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted);font-weight:600;}
.empty{color:var(--muted);font-size:14px;padding:14px 0;line-height:1.55;}
.sect{margin-top:20px;}
.sectHead{display:flex;justify-content:space-between;align-items:center;margin-bottom:11px;}
.rowNum{font-size:14px;}

/* hero */
.hero{position:relative;border:1px solid var(--line);border-radius:18px;padding:18px 16px 14px;
  background:var(--card);overflow:hidden;transition:border-color .4s,background .4s;}
.hero.hot{border-color:color-mix(in srgb,var(--amber) 55%,var(--line));}
.hero.over{border-color:color-mix(in srgb,var(--flare) 55%,var(--line));}
.hero.good{border-color:color-mix(in srgb,var(--leaf) 45%,var(--line));}
.big{font-size:46px;font-weight:700;letter-spacing:-.035em;line-height:1.05;display:block;}
.cur{font-size:16px;font-weight:600;color:var(--muted);margin-right:8px;vertical-align:8px;}
.sub{color:var(--muted);font-size:14px;line-height:1.5;margin-top:8px;}

.ringBtn{position:absolute;top:16px;right:16px;width:64px;height:64px;
  background:none;border:none;padding:0;cursor:pointer;
  display:flex;align-items:center;justify-content:center;transition:transform .14s;}
.ringBtn:active{transform:scale(.94);}
.ring{width:64px;height:64px;transform:rotate(-90deg);display:block;}
.ring circle{fill:none;stroke-linecap:round;}
.ringTrack{stroke:var(--line);stroke-width:5;}
.ringFill{stroke:var(--muted);stroke-width:5;}
.ringSpend{stroke-width:5;}
.ringLabel{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;
  font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:15px;font-weight:600;
  line-height:1;pointer-events:none;}

/* the daily bars */
.spark{position:relative;display:flex;align-items:flex-end;gap:2px;height:52px;margin-top:14px;
  touch-action:pan-y;}
.spark::after{content:"";position:absolute;left:0;right:0;top:-16px;bottom:-16px;z-index:0;}
.spark > .tick{position:relative;z-index:1;}
.tick{flex:1;min-width:0;border-radius:2px 2px 0 0;transition:opacity .12s,transform .12s;}
.tick.picked{transform:scaleY(1.06);filter:brightness(1.15);}
.paceline{position:absolute;left:0;right:0;border-top:1px dashed var(--muted);opacity:.6;}
.sparkFoot{display:flex;justify-content:space-between;font-size:11.5px;color:var(--muted);margin-top:7px;}
.scrubLine{position:absolute;top:-4px;bottom:-2px;width:2px;transform:translateX(-50%);
  background:var(--sand);opacity:.35;border-radius:2px;pointer-events:none;z-index:2;}
.scrubBubble{position:absolute;bottom:calc(100% + 8px);transform:translateX(-50%);
  background:var(--card);border:1px solid var(--gold);border-radius:10px;padding:5px 9px;
  display:flex;flex-direction:column;align-items:center;white-space:nowrap;
  pointer-events:none;z-index:3;box-shadow:0 6px 16px rgba(0,0,0,.18);}
.scrubBubble b{font-size:13px;line-height:1.15;color:var(--sand);}
.scrubBubble span{font-size:10px;color:var(--muted);}

/* tiles */
.statCard{display:flex;flex-direction:column;align-items:flex-start;text-align:left;
  background:var(--card);border:1px solid var(--line);border-radius:14px;
  padding:13px 13px 12px;cursor:pointer;color:inherit;font:inherit;min-width:0;
  transition:border-color .15s,transform .1s;}
.statCard:active{transform:scale(.985);border-color:var(--gold);}
.statCard > span{max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}

/* panels */
.panel{border:1px solid var(--line);border-radius:16px;background:var(--card);
  overflow:hidden;margin-top:16px;}
.panelHead{display:flex;align-items:center;gap:8px;width:100%;padding:14px 15px;
  background:transparent;border:none;color:inherit;font:inherit;text-align:left;cursor:pointer;}
.panelHead:active{background:var(--card2);}
.panelBody{padding:13px 15px 15px;border-top:1px solid var(--line);}
.panelBody.tinted{background:var(--card2);}
.noticeCount{font-size:10px;font-weight:700;color:var(--leather);background:var(--muted);
  border-radius:99px;padding:1px 7px;line-height:1.7;}

/* composer */
.composer{position:relative;border:1px solid var(--line);border-radius:16px;
  background:var(--card);overflow:hidden;}
.composer.repay{border-color:var(--amber);}
.repayBar{display:flex;align-items:flex-start;gap:8px;padding:10px 14px;
  background:color-mix(in srgb,var(--amber) 16%,var(--card));
  border-bottom:1px solid var(--line);font-size:12.5px;line-height:1.45;color:var(--sand);}
.repayBar svg{flex:none;margin-top:2px;color:var(--amber);}
.askRow{display:flex;align-items:center;gap:8px;padding:8px 8px 8px 15px;}
.askRow input{flex:1;min-width:0;background:none;border:none;outline:none;
  color:var(--sand);font:inherit;font-size:15px;padding:10px 0;}
.askRow input::placeholder{color:var(--muted);}
.send{width:42px;height:42px;border-radius:11px;border:none;flex:none;cursor:pointer;
  background:var(--gold);color:var(--leather);display:flex;align-items:center;justify-content:center;}
.send:disabled{opacity:.4;}
.composer.repay .send{background:var(--amber);}
.ghostBtn{background:transparent !important;border:1px solid var(--line) !important;color:var(--muted);}
.composerOpts{border-top:1px solid var(--line);padding:11px 11px 12px;background:var(--card2);}
.composerRow{min-height:38px;display:flex;align-items:center;flex-wrap:wrap;row-gap:0;
  margin-top:9px;justify-content:space-between;}
.composerRow .chips{margin:0;flex:1;min-width:0;}
.composerRow > .tipBtn{flex:none;margin-left:8px;align-self:center;}
.composerNote{font-size:12.5px;color:var(--muted);}

/* instalments */
.splitRow{flex:0 0 100%;display:grid;grid-template-columns:92px 1fr 76px;align-items:center;
  gap:11px;margin-top:11px;padding-top:11px;border-top:1px dashed var(--line);}
.splitLabel{font-size:12.5px;font-weight:600;color:var(--sand);white-space:nowrap;}
.splitHint{font-size:11.5px;color:var(--muted);white-space:nowrap;
  font-variant-numeric:tabular-nums;text-align:right;}
.splitSlider{flex:1;min-width:0;-webkit-appearance:none;appearance:none;touch-action:pan-y;
  height:4px;border-radius:99px;background:var(--line);outline:none;}
.splitSlider::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:20px;height:20px;
  border-radius:99px;background:var(--gold);border:2px solid var(--card);
  box-shadow:0 1px 4px rgba(0,0,0,.25);cursor:pointer;}
.splitWhen{flex:0 0 100%;display:flex;align-items:center;gap:8px;margin-top:9px;flex-wrap:wrap;}

/* the confirmation that replaces the input */
.filedRow{display:flex;align-items:center;gap:10px;padding:14px 12px 14px 15px;
  min-height:58px;animation:filedIn .22s ease-out;}
@keyframes filedIn{from{opacity:0;transform:translateY(-3px);}to{opacity:1;transform:none;}}
.filedRow.leaving{animation:filedOut .45s ease-in forwards;}
@keyframes filedOut{from{opacity:1;}to{opacity:0;transform:translateY(-4px);}}
.filedTick{width:20px;height:20px;border-radius:99px;flex:none;display:flex;
  align-items:center;justify-content:center;background:var(--leaf);color:var(--leather);
  animation:tickIn .34s cubic-bezier(.3,1.5,.5,1) backwards;}
@keyframes tickIn{0%{transform:scale(.2);opacity:0;}60%{transform:scale(1.15);opacity:1;}
  100%{transform:scale(1);opacity:1;}}
.filedDot{width:9px;height:9px;border-radius:99px;flex:none;}
.filedText{flex:1;min-width:0;font-size:13.5px;line-height:1.35;display:flex;
  flex-direction:column;gap:2px;}
.filedNote{font-size:11.5px;color:var(--muted);}
.filedUndo{flex:none;background:none;border:1px solid var(--line);border-radius:9px;
  padding:7px 11px;color:var(--gold);font:inherit;font-size:13px;font-weight:600;
  display:flex;align-items:center;gap:5px;cursor:pointer;}

.hint{font-size:12.5px;color:var(--muted);padding:9px 2px 0;line-height:1.5;}
.hintTick{color:var(--leaf);animation:hintTickIn .3s cubic-bezier(.3,1.5,.5,1);}
@keyframes hintTickIn{0%{transform:scale(.3);opacity:0;}60%{transform:scale(1.18);opacity:1;}
  100%{transform:scale(1);opacity:1;}}
.hint.settled{color:var(--leaf);animation:hintFade 1.6s ease forwards;}
@keyframes hintFade{0%,62%{opacity:1;}100%{opacity:0;}}

/* chips and segments */
.chips{display:flex;flex-wrap:wrap;gap:7px;margin-top:8px;}
.chip{display:inline-flex;align-items:center;gap:6px;padding:8px 12px;border-radius:99px;
  border:1px solid var(--line);background:var(--card);color:var(--muted);
  font:inherit;font-size:13px;cursor:pointer;transition:all .15s;}
.chip.on{border-color:var(--gold);color:var(--gold);background:color-mix(in srgb,var(--gold) 10%,transparent);}
.dot{width:9px;height:9px;border-radius:99px;flex:none;}

.seg{display:flex;gap:3px;padding:3px;margin:0 0 18px;background:var(--card2);
  border:1px solid var(--line);border-radius:12px;}
.segBtn{flex:1;padding:10px 8px;border:none;border-radius:9px;cursor:pointer;
  background:transparent;color:var(--muted);font:inherit;font-size:14px;font-weight:600;
  transition:background .16s,color .16s,box-shadow .16s;}
.segBtn.on{background:var(--gold);color:#FFFFFF;box-shadow:0 1px 3px rgba(0,0,0,.18);}
.seg.segSm{margin-bottom:0;padding:2px;border-radius:10px;}
.seg.segSm .segBtn{padding:7px 6px;font-size:12.5px;border-radius:8px;}
.seg.segStack{background:transparent;border:1px dashed var(--line);margin:0 0 12px;}
.seg.segStack .segBtn{display:flex;flex-direction:column;align-items:center;gap:1px;
  padding:8px 4px;line-height:1.25;background:transparent;color:var(--muted);
  border:1px solid transparent;box-shadow:none;}
.seg.segStack .segBtn.on{background:transparent;color:var(--gold);border-color:var(--gold);}
.segLabel{font-size:12px;font-weight:600;letter-spacing:.02em;}
.segAmt{font-size:13px;font-weight:600;opacity:.85;}

/* buttons */
.btn{background:var(--card2);border:1px solid var(--line);border-radius:11px;padding:12px 14px;
  color:var(--sand);font:inherit;font-size:14px;font-weight:600;cursor:pointer;}
.btn.gold{background:var(--gold);border-color:var(--gold);color:var(--leather);}
.btn.gold:disabled{opacity:.45;}
.btn.ghost{background:transparent;border-style:dashed;color:var(--muted);width:100%;}
.btn.danger{background:var(--flare);border-color:var(--flare);color:#fff;}
.mini{background:var(--card2);border:1px solid var(--line);border-radius:9px;padding:7px 11px;
  color:var(--gold);font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;margin-top:8px;}
.mini.ghost{background:transparent;color:var(--muted);}
.icon{background:none;border:none;color:var(--muted);cursor:pointer;padding:6px;
  display:flex;align-items:center;}
.icon:hover{color:var(--flare);background:var(--card2);}

.field{display:flex;align-items:center;gap:9px;padding:9px 0;}
.field label{color:var(--muted);font-size:14px;flex:1;}
.input{background:var(--card2);border:1px solid var(--line);border-radius:9px;padding:9px 11px;
  color:var(--sand);font:inherit;font-size:14px;outline:none;}
.input.wide{flex:1;min-width:0;}

.flag{display:flex;gap:10px;border:1px solid var(--line);border-radius:13px;padding:13px;
  margin-bottom:9px;background:var(--card);}
.flag .txt{flex:1;min-width:0;font-size:13.5px;line-height:1.55;}

.bar{height:4px;background:var(--card2);border-radius:99px;overflow:hidden;margin-top:7px;}
.barIn{height:100%;transform-origin:left center;will-change:transform;}
.rowName{flex:1;font-size:15px;font-weight:500;min-width:0;overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap;}

/* tips */
.tipBtn{width:17px;height:17px;flex:none;border-radius:99px;border:1px solid var(--line);
  background:var(--card2);color:var(--muted);font-size:11px;font-weight:700;line-height:1;
  cursor:pointer;padding:0;display:inline-flex;align-items:center;justify-content:center;}
.tipBtn[aria-expanded="true"]{background:var(--gold);color:var(--leather);border-color:var(--gold);}
.mathsCard{width:100%;max-width:330px;background:var(--card);border:1px solid var(--line);
  border-radius:16px;padding:16px 16px 15px;box-shadow:0 20px 50px rgba(0,0,0,.35);
  font-family:'Sofia Sans',ui-sans-serif,system-ui,sans-serif;color:var(--sand);
  max-height:70vh;overflow-y:auto;animation:pop .16s ease-out;}
@keyframes pop{from{opacity:0;transform:scale(.96);}to{opacity:1;transform:none;}}
.tappableNum{display:inline-flex;align-items:flex-start;gap:6px;background:none;border:none;
  padding:0;margin:0;cursor:pointer;color:inherit;font:inherit;text-align:left;}
.tappableNum svg{color:var(--muted);opacity:.55;margin-top:5px;flex:none;}

/* swipe track */
.swipeView{overflow:hidden;margin:0 -18px;touch-action:pan-y;}
.track{display:flex;width:300%;transform:translate3d(-33.3333%,0,0);}
.swipeView.dragging .track{will-change:transform;}
.pane{width:33.3333%;flex:0 0 33.3333%;padding:0 18px;box-sizing:border-box;min-width:0;
  contain:layout paint style;}
.swipeView:not(.dragging) .pane:first-child,
.swipeView:not(.dragging) .pane:last-child{height:0;overflow:hidden;}

/* nav */
.nav{position:fixed;bottom:0;left:0;right:0;
  background:color-mix(in srgb,var(--leather) 82%,transparent);
  -webkit-backdrop-filter:blur(20px) saturate(150%);backdrop-filter:blur(20px) saturate(150%);
  border-top:1px solid var(--line);}
.navIn{position:relative;max-width:520px;margin:0 auto;display:flex;
  padding:8px 12px calc(8px + env(safe-area-inset-bottom));}
.navPill{position:absolute;top:3px;bottom:3px;width:calc(25% - 8px);border-radius:15px;
  pointer-events:none;z-index:0;
  background:linear-gradient(160deg,rgba(255,255,255,.85) 0%,rgba(255,255,255,.45) 42%,rgba(255,255,255,.22) 100%);
  border:1px solid rgba(255,255,255,.7);
  box-shadow:inset 0 1px 1px rgba(255,255,255,.95),0 4px 12px rgba(0,0,0,.10);
  transition:left .42s cubic-bezier(.34,1.28,.44,1),transform .42s cubic-bezier(.34,1.28,.44,1);}
.navPill.moving{transform:scaleX(1.14) scaleY(.94);}
.app:not(.light) .navPill{
  background:linear-gradient(160deg,rgba(255,255,255,.16) 0%,rgba(255,255,255,.07) 45%,rgba(255,255,255,.03) 100%);
  border-color:rgba(255,255,255,.14);
  box-shadow:inset 0 1px 1px rgba(255,255,255,.20),0 4px 14px rgba(0,0,0,.45);}
.navBtn{flex:1;position:relative;z-index:1;overflow:hidden;background:none;border:none;
  color:var(--muted);display:grid;justify-items:center;gap:3px;padding:7px 0;
  font:600 11px 'Sofia Sans',sans-serif;cursor:pointer;border-radius:10px;
  transition:transform .18s cubic-bezier(.34,1.4,.5,1);}
.navBtn:active{transform:scale(.9);}
.navBtn.on{color:var(--gold);}
.ripple{position:absolute;width:10px;height:10px;border-radius:99px;pointer-events:none;
  transform:translate(-50%,-50%);
  background:radial-gradient(circle at 34% 30%,rgba(255,255,255,.95) 0%,rgba(255,255,255,.45) 38%,transparent 72%);
  animation:bubbleOut .58s cubic-bezier(.18,.72,.3,1) forwards;}
@keyframes bubbleOut{0%{transform:translate(-50%,-50%) scale(.6);opacity:0;}
  22%{opacity:.85;}100%{transform:translate(-50%,-50%) scale(14);opacity:0;}}

/* theme dial */
.themeDial{position:fixed;right:16px;bottom:calc(78px + env(safe-area-inset-bottom));
  width:44px;height:44px;border-radius:99px;z-index:40;display:flex;align-items:center;
  justify-content:center;background:var(--card);color:var(--muted);border:1px solid var(--line);
  cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.18);transition:transform .12s;}
.themeDial:active{transform:scale(.92);color:var(--gold);}

.spin{animation:spin 1s linear infinite;}
@keyframes spin{to{transform:rotate(360deg);}}
.scrollBox{max-height:290px;overflow-y:auto;padding-right:4px;overscroll-behavior:contain;}
.monthBar{display:flex;align-items:baseline;gap:10px;margin:26px 0 4px;padding-bottom:8px;
  border-bottom:2px solid var(--line);}
.monthName{flex:1;font-size:17px;font-weight:600;}
.monthTotal{font-size:13px;color:var(--muted);}
.repayTag{font-size:10px;font-weight:700;color:var(--leaf);
  border:1px solid var(--leaf);border-radius:99px;padding:1px 6px;margin-right:6px;}

@media (prefers-reduced-motion:reduce){
  .navPill,.navPill.moving{transition:none;transform:none;}
  .ripple,.filedTick,.hintTick{animation:none;}
  .filedRow.leaving{animation:none;opacity:0;}
}
`;


/* A colour at low opacity, so a row reads as tinted paper rather than a block. */
function tint(hex, a) {
  const h = String(hex || "#888").replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/* Icons are matched from the category name, so renaming a category updates it. */
function catIcon(name) {
  const n = String(name || "").toLowerCase();
  const p = { size: 17 };
  if (/hous|rent|home|rashen/.test(n)) return <HomeIcon {...p} />;
  if (/family|kid|child|baby/.test(n)) return <Users {...p} />;
  if (/food|groc|eat|restaur/.test(n)) return <Utensils {...p} />;
  if (/bill|fixed|util/.test(n)) return <Receipt {...p} />;
  if (/personal|fun|buffer/.test(n)) return <Sparkles {...p} />;
  if (/flat|invest|propert/.test(n)) return <Building2 {...p} />;
  if (/saving|fund/.test(n)) return <PiggyBank {...p} />;
  if (/car|transp|fuel/.test(n)) return <Car {...p} />;
  if (/health|medic/.test(n)) return <Heart {...p} />;
  if (/bank|loan/.test(n)) return <Landmark {...p} />;
  return <Package {...p} />;
}

/* ---------- small shared pieces ---------- */

function Boundary({ children }) {
  const [err, setErr] = useState(null);
  useEffect(() => {
    const onErr = (e) => setErr(e.message || String(e.error || e));
    window.addEventListener("error", onErr);
    return () => window.removeEventListener("error", onErr);
  }, []);
  if (err) {
    return (
      <div className="flag" style={{ borderColor: "var(--flare)", marginTop: 16 }}>
        <AlertTriangle size={17} color="var(--flare)" style={{ marginTop: 2 }} />
        <div className="txt">
          <b>This screen hit an error.</b> Your data is safe — other tabs still work.
          <div className="empty" style={{ padding: "6px 0 0" }}>{err}</div>
          <button className="mini" onClick={() => setErr(null)}>Try again</button>
        </div>
      </div>
    );
  }
  return children;
}

function SyncBadge() {
  const [s, setS] = useState({ ...sync });
  useEffect(() => sync.subscribe(setS), []);
  const label = s.pending ? "Saving\u2026" : "Saved on this phone";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11,
      color: "var(--gold)", letterSpacing: ".08em", textTransform: "uppercase", fontWeight: 600 }}>
      <span style={{ width: 7, height: 7, borderRadius: 99, background: "var(--gold)", flex: "none" }} />
      {label}
    </div>
  );
}

/* A number should be able to show its own working. Tap one and this opens
   with the arithmetic, line by line, in the same order it was calculated. */
function Maths({ open, onClose, title, rows, note }) {
  if (!open) return null;
  /* A transformed ancestor becomes the containing block for position:fixed,
     so this has to live outside the swipe track or it gets clipped away. */
  return createPortal(
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 70, display: "flex",
        alignItems: "center", justifyContent: "center", padding: 24,
        background: "rgba(0,0,0,.5)", font: "inherit" }}>
      <div onClick={(e) => e.stopPropagation()} className="mathsCard">
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <span className="eyebrow" style={{ flex: 1 }}>{title}</span>
          <button className="icon" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>
        {rows.map((r, i) => (
          <div key={i} style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "9px 0",
            borderTop: r.total ? "1px solid var(--line)" : "none", marginTop: r.total ? 6 : 0 }}>
            <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: r.total ? 600 : 400,
              color: r.total ? "var(--sand)" : "var(--muted)" }}>{r.label}</span>
            <span className="num" style={{ flex: "none", fontSize: 14.5, fontWeight: r.total ? 600 : 500,
              color: r.tone === "in" ? "var(--gold)" : r.tone === "out" ? "var(--flare)" : "var(--sand)" }}>
              {r.value}
            </span>
          </div>
        ))}
        {note && <div className="empty" style={{ padding: "13px 0 0", fontSize: 12.5 }}>{note}</div>}
      </div>
    </div>,
    document.body
  );
}

/* A tip you can ask for rather than one that's always in the way. Opens as a
   dimmed overlay like the figure breakdowns, so it reads as the same gesture. */
function Tip({ children, label = "What's this?", title }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="tipBtn" aria-label={label} aria-expanded={open}
        onClick={() => setOpen(true)}>?</button>
      {open && createPortal(
        <div onClick={() => setOpen(false)}
          style={{ position: "fixed", inset: 0, zIndex: 80, display: "flex",
            alignItems: "center", justifyContent: "center", padding: 24,
            background: "rgba(0,0,0,.5)", font: "inherit" }}>
          <div onClick={(e) => e.stopPropagation()} className="mathsCard">
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span className="eyebrow" style={{ flex: 1 }}>{title || label}</span>
              <button className="icon" onClick={() => setOpen(false)} aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <div style={{ fontSize: 13.5, lineHeight: 1.6, color: "var(--muted)" }}>{children}</div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}

/* One question, asked once. Everything downstream depends on knowing when the
   month starts, and guessing it puts the user inside a cycle they never chose. */
function AskPayday({ onAnswer }) {
  const [day, setDay] = useState("");
  const n = Number(day);
  const valid = n >= 1 && n <= 28;
  const ord = (v) => v % 10 === 1 && v !== 11 ? "st" : v % 10 === 2 && v !== 12 ? "nd"
    : v % 10 === 3 && v !== 13 ? "rd" : "th";
  return (
    <div className="sect" style={{ border: "1px solid var(--line)", borderRadius: 16, padding: 18 }}>
      <div className="eyebrow" style={{ marginBottom: 8 }}>One question first</div>
      <div style={{ fontSize: 19, fontWeight: 600, lineHeight: 1.3, marginBottom: 8 }}>
        What day of the month are you paid?
      </div>
      <div className="empty" style={{ padding: "0 0 16px" }}>
        Your month will run payday to payday instead of from the 1st, so the money
        you're looking at is the money you actually have.
      </div>
      <div style={{ display: "flex", gap: 9, alignItems: "center", marginBottom: 14 }}>
        <input className="input" inputMode="numeric" autoFocus
          style={{ width: 84, fontSize: 20, textAlign: "center" }}
          placeholder="27" value={day}
          onChange={(e) => setDay(e.target.value.replace(/\D/g, "").slice(0, 2))}
          aria-label="Day of the month you are paid" />
        <span className="empty" style={{ padding: 0 }}>
          of each month{valid && <> — so a cycle runs {n} to {n === 1 ? "the end" : n - 1}</>}
        </span>
      </div>
      <button className="btn gold" style={{ width: "100%" }} disabled={!valid}
        onClick={() => onAnswer(n)}>
        {valid ? `Start on the ${n}${ord(n)}` : "Enter a day between 1 and 28"}
      </button>
      <button className="btn ghost" style={{ marginTop: 8 }} onClick={() => onAnswer(1)}>
        I'm not sure \u2014 use the 1st
      </button>
    </div>
  );
}

/* Order matters: money in, then what you pay with, then — only if you want it
   — planning by category. Plenty of people track without budgets. */
function FirstRun({ config, tx, doneFlags, setDoneFlags, onGoPlan, onGoCards }) {
  const missions = [
    { key: "income", title: "Tell it what comes in",
      body: "What lands each month, and when.",
      done: (config.incomes || []).some((i) => Number(i.amount) > 0),
      action: { label: "Open Plan", go: onGoPlan } },
    { key: "cards", title: "Add your cards",
      body: "Credit cards, Tabby, Tamara \u2014 anything you pay with later.",
      done: (config.cards || []).length > 0,
      action: { label: "Open Cards", go: onGoCards } },
    { key: "entry", title: "Log your first spend",
      body: "Type it how you'd say it: \u201c45 groceries\u201d.",
      done: tx.some((t) => t.kind === "expense") },
    { key: "budgets", title: "Set budgets, if you want them",
      body: "Optional. Without them the app tracks against what you earn instead.",
      done: config.categories.some((c) => Number(c.budget) > 0) || !!doneFlags.skippedBudgets,
      action: { label: "Open Plan", go: onGoPlan } },
    { key: "backup", title: "Export a backup",
      body: "The only copy that survives a lost phone.",
      done: !!doneFlags.backup,
      locked: tx.length < 3, lockedNote: "Once you've logged a few entries",
      action: { label: "Open Plan", go: onGoPlan } },
  ];

  const complete = missions.filter((m) => m.done).length;
  if (complete === missions.length) return null;
  const current = missions.findIndex((x) => !x.done && !x.locked);

  return (
    <div className="panel" style={{ marginTop: 14 }}>
      <div style={{ padding: "14px 15px 0" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 10 }}>
          <span className="eyebrow" style={{ flex: 1 }}>Setup</span>
          <span className="num" style={{ fontSize: 12, color: "var(--muted)" }}>
            {complete} of {missions.length}
          </span>
        </div>
        <div className="bar" style={{ marginBottom: 4 }}>
          <div className="barIn" style={{ width: "100%", background: "var(--gold)",
            transform: `scaleX(${complete / missions.length})`, transition: "transform .4s ease" }} />
        </div>
      </div>

      <div style={{ padding: "6px 15px 14px" }}>
        {missions.map((mi, i) => (
          <div key={mi.key} style={{ display: "flex", gap: 11, padding: "11px 0",
            borderTop: i ? "1px solid var(--line)" : "none",
            opacity: mi.done ? .55 : mi.locked ? .45 : 1 }}>
            <span style={{ width: 22, height: 22, borderRadius: 99, flex: "none", marginTop: 2,
              border: `1.5px solid ${mi.done ? "var(--leaf)" : mi.locked ? "var(--line)" : "var(--muted)"}`,
              background: mi.done ? "var(--leaf)" : "transparent",
              color: mi.done ? "var(--leather)" : "var(--muted)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 11, fontWeight: 700 }}>
              {mi.done ? "\u2713" : mi.locked ? "\u00b7" : i + 1}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14.5, fontWeight: 600 }}>{mi.title}</div>
              {!mi.done && mi.locked && (
                <div className="empty" style={{ padding: "3px 0 0" }}>{mi.lockedNote}</div>
              )}
              {!mi.done && !mi.locked && i === current && (
                <>
                  <div className="empty" style={{ padding: "3px 0 0" }}>{mi.body}</div>
                  {mi.key === "budgets" ? (
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button className="mini" onClick={onGoPlan}>Set budgets</button>
                      <button className="mini ghost" onClick={() => {
                        const next = { ...doneFlags, skippedBudgets: true };
                        setDoneFlags(next);
                        storage.set(MISSIONS_KEY, JSON.stringify(next)).catch(() => {});
                      }}>I don't budget by category</button>
                    </div>
                  ) : mi.action ? (
                    <button className="mini" onClick={mi.action.go}>{mi.action.label}</button>
                  ) : null}
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- wallet ---------- */

function Home(props) {
  const {
    config, saveConfig, tx, saveTx, today, cycle, m, flags, setTab,
    cycleOffset, setCycleOffset, cycleLabel, cycleToday,
    draft, setDraft, kind, setKind, payWith, setPayWith, incomeSrc, setIncomeSrc,
    splitN, setSplitN, splitStart, setSplitStart,
    doneFlags, setDoneFlags, aiOn, learn,
  } = props;

  const [maths, setMaths] = useState(null);
  const [scrub, setScrub] = useState(null);
  const [splitOpen, setSplitOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [flagsOpen, setFlagsOpen] = useState(false);
  const [hushed, setHushed] = useState([]);
  const [srcFilter, setSrcFilter] = useState("all");
  const [openCat, setOpenCat] = useState("");
  const [thinking, setThinking] = useState(0);
  const [err, setErr] = useState("");
  const [settled, setSettled] = useState("");
  const [confirmPay, setConfirmPay] = useState(null);

  const text = draft;
  const setText = setDraft;
  const sparkTouch = useRef({ x: 0, y: 0, axis: null });

  useEffect(() => {
    storage.get("wallet-hushed")
      .then((r) => { if (r?.value) setHushed(JSON.parse(r.value)); })
      .catch(() => {});
  }, []);

  const hush = (keys) => {
    setHushed(keys);
    storage.set("wallet-hushed", JSON.stringify(keys)).catch(() => {});
  };

  /* Confirmations fade rather than vanishing. */
  const dismissToast = (after = 4200) => {
    setTimeout(() => setToast((t) => (t ? { ...t, leaving: true } : t)), after);
    setTimeout(() => setToast(null), after + 450);
  };

  /* When a spinner finishes, say so briefly rather than blinking out.
     Declared after every value it reads — a hook that runs before its state
     exists throws, and that shipped once already. */
  const wasBusy = useRef({ thinking: 0 });
  useEffect(() => {
    const prev = wasBusy.current;
    const finished = prev.thinking > 0 && thinking === 0;
    wasBusy.current = { thinking };
    if (!finished || err) return;
    setSettled("Saved");
    const t = setTimeout(() => setSettled(""), 1600);
    return () => clearTimeout(t);
  }, [thinking, err]);

  /* If the selected card is deleted the chip disappears but the choice would
     survive, and entries would be filed against a card that no longer exists. */
  useEffect(() => {
    if (payWith === "bank") return;
    if ((config.cards || []).some((c) => c.id === payWith)) return;
    const next = (config.cards || [])[0]?.id || "bank";
    setPayWith(next);
    storage.set("wallet-pay-with", next).catch(() => {});
  }, [config.cards, payWith, setPayWith]);

  useEffect(() => {
    if (kind === "cardpay" && (config.cards || []).length === 0) {
      setKind("out");
      storage.set("wallet-entry-kind", "out").catch(() => {});
    }
  }, [config.cards, kind, setKind]);

  const spark = useMemo(() => {
    const out = [];
    for (let i = 0; i < cycle.days; i++) {
      const iso = addDays(cycle.start, i);
      const amount = m.inCycle
        .filter((t) => t.date === iso && t.kind === "expense")
        .reduce((s, t) => s + t.amount, 0);
      out.push({ iso, amount, isToday: iso === today, future: iso > today });
    }
    return out;
  }, [m.inCycle, cycle, today]);

  const pace = m.budget > 0 ? m.budget / cycle.days : (m.income > 0 ? m.income / cycle.days : 0);
  const sparkMax = Math.max(pace * 1.6, ...spark.map((s) => s.amount), 1);

  const pickDay = (clientX, el) => {
    const b = el.getBoundingClientRect();
    const n = spark.length;
    if (!n || b.width <= 0) return;
    setScrub(Math.min(n - 1, Math.max(0, Math.floor(((clientX - b.left) / b.width) * n))));
  };

  const mood = m.left < 0 ? "over"
    : m.budget > 0 && m.spent / Math.max(1, m.budget) > m.through + 0.12 ? "hot"
    : m.left > 0 ? "good" : "";
  const moodLabel = mood === "over" ? "Over budget" : mood === "hot" ? "Running hot"
    : mood === "good" ? "On track" : "This cycle";

  const send = async () => {
    const raw = text.trim();
    if (!raw) return;
    setErr("");

    const guess = localParse(raw, config, cycleToday);
    if (!guess) {
      setErr("Couldn't find an amount in that. Try \u201c45 groceries\u201d.");
      return;
    }

    /* A repayment moves a card balance, so it gets one confirmation.
       Purchases don't — a prompt every time would be noise. */
    if (kind === "cardpay" && !confirmPay) { setConfirmPay(guess.amount); return; }
    setConfirmPay(null);

    const prevTx = tx;
    const chosenKind = kind === "in" ? "income" : kind === "cardpay" ? "cardpay" : "expense";
    const onCard = kind === "out" && payWith !== "bank";
    const cardId = (kind === "cardpay" || onCard) ? payWith : "";
    const id = `${Date.now()}`;

    const entry = {
      id, kind: chosenKind, amount: guess.amount,
      categoryId: chosenKind === "income" ? "__income"
        : chosenKind === "cardpay" ? "__cardpay" : guess.catId,
      note: guess.note, date: guess.date,
      src: onCard ? "card" : "bank",
      ...(cardId && cardId !== "bank" ? { cardId } : {}),
      ...(chosenKind === "income" && incomeSrc !== "other" ? { sourceId: incomeSrc } : {}),
    };

    /* An instalment purchase is two facts on one day: you acquired the thing,
       and — sometimes — you paid the first slice. Tabby takes it immediately;
       a credit-card plan bills it on the next statement. So we ask. */
    let extra = [];
    if (splitN > 1 && chosenKind === "expense" && onCard) {
      const { first, slice } = splitPlan(entry.amount, splitN);
      entry.plan = { id, total: splitN, slice, first, cardId, note: entry.note,
        startsNow: splitStart === "now" };
      if (splitStart === "now") {
        extra = [{
          id: `${id}-p1`, kind: "cardpay", amount: first, categoryId: "__cardpay",
          note: `${entry.note} \u2014 payment 1 of ${splitN}`,
          date: entry.date, src: "bank", cardId, planId: id,
        }];
      }
    }

    setText("");
    await saveTx([...extra, entry, ...tx]);

    setToast({ prevTx, prevConfig: config, filed: describe(entry, config),
      note: guess.fromPlan ? `No amount typed \u2014 used ${money(guess.amount)} from your plan` : null });
    dismissToast();

    /* Repayment is a monthly action, so it doesn't stay selected — leaving it
       on is how a later purchase gets logged as a repayment by mistake. */
    if (kind === "cardpay") {
      setKind("out");
      storage.set("wallet-entry-kind", "out").catch(() => {});
    }
    if (splitN > 1) { setSplitN(1); setSplitOpen(false); }
  };

  const undo = async () => {
    if (!toast) return;
    await saveTx(toast.prevTx);
    if (toast.prevConfig) await saveConfig(toast.prevConfig);
    setToast(null);
  };

  const MATHS = {
    left: {
      title: "Left to spend",
      rows: [
        { label: "Planned income received", value: money(m.plannedIncome), tone: "in" },
        ...(m.otherIncome > 0 ? [{ label: "Other money in", value: money(m.otherIncome), tone: "in" }] : []),
        ...(m.awaited > 0 ? [{ label: "Planned income still to arrive", value: money(m.awaited) }] : []),
        { label: "Bought straight from the bank", value: "\u2212" + money(m.spent - m.cardOut), tone: "out" },
        { label: "Paid to your cards", value: "\u2212" + money(m.cardPaid), tone: "out" },
        { label: "Cash still in the bank", value: money(m.cashLeft), total: true },
        ...(m.planning ? [
          { label: "Your budget for the cycle", value: money(m.budget) },
          { label: "Spent against it", value: "\u2212" + money(m.budgetedSpent), tone: "out" },
          { label: "Budget still unspent", value: money(m.planLeft), total: true },
        ] : []),
      ],
      note: <>The headline shows whichever is smaller, so it never promises money that hasn't
        arrived \u2014 right now <b className="num">{money(m.left)}</b>. The daily figure divides
        that same number, not the budget.</>,
    },
    bank: {
      title: "In the bank",
      rows: [
        { label: "Money received this cycle", value: money(m.income), tone: "in" },
        { label: "Bought straight from the bank", value: "\u2212" + money(m.spent - m.cardOut), tone: "out" },
        { label: "Paid to your cards", value: "\u2212" + money(m.cardPaid), tone: "out" },
        { label: "Cash position", value: (m.cashLeft < 0 ? "\u2212" : "") + money(Math.abs(m.cashLeft)), total: true },
      ],
      note: "Card purchases aren't here — they didn't leave your account. Only the repayments did.",
    },
    cards: {
      title: "Owed on cards",
      rows: [
        { label: "Everything ever charged to a card", value: money(m.cardBalance + m.cardPaidAll), tone: "out" },
        { label: "Everything ever repaid", value: "\u2212" + money(m.cardPaidAll), tone: "in" },
        { label: "Still owed", value: money(m.cardBalance), total: true },
        { label: "Of which added this cycle", value: money(m.cardOut) },
        { label: "Paid off this cycle", value: money(m.cardPaid), tone: "in" },
      ],
      note: "This runs across every cycle, not just this one — a card balance doesn't reset on payday.",
    },
    ring: {
      title: "The ring",
      rows: [
        { label: `Day ${m.dayIndex} of ${m.dayIndex + m.daysLeft - 1}`, value: `${m.daysLeft} left` },
        { label: "Outer arc \u2014 how much of the cycle has passed", value: `${Math.round(m.through * 100)}%` },
        { label: "Inner arc \u2014 how much of the budget is gone",
          value: `${m.budget > 0 ? Math.round((m.budgetedSpent / m.budget) * 100) : 0}%`,
          tone: m.budget > 0 && m.budgetedSpent / m.budget > m.through ? "out" : "in" },
      ],
      note: <>The number in the middle is the day of your cycle. When the inner arc overtakes
        the outer one, you're spending faster than the month is passing.</>,
    },
  };

  const R = 26, C = 2 * Math.PI * R;
  const timePct = Math.min(1, m.through);
  const spendPct = m.budget > 0 ? Math.min(1, m.budgetedSpent / m.budget) : 0;
  const spendColor = spendPct > timePct + 0.12 ? "var(--flare)"
    : spendPct > timePct ? "var(--amber)" : "var(--leaf)";

  const cats = config.categories;
  const filtered = (t) => srcFilter === "all" || (t.src || "bank") === srcFilter;
  const shownSpent = srcFilter === "all" ? m.spent
    : srcFilter === "card" ? m.cardOut : m.spent - m.cardOut;

  return (
    <>
      <Maths open={!!maths} onClose={() => setMaths(null)}
        title={maths ? MATHS[maths].title : ""}
        rows={maths ? MATHS[maths].rows : []}
        note={maths ? MATHS[maths].note : null} />

      {confirmPay !== null && createPortal(
        <div onClick={() => setConfirmPay(null)}
          style={{ position: "fixed", inset: 0, zIndex: 85, display: "flex",
            alignItems: "center", justifyContent: "center", padding: 24,
            background: "rgba(0,0,0,.5)", font: "inherit" }}>
          <div onClick={(e) => e.stopPropagation()} className="mathsCard">
            <div className="eyebrow" style={{ marginBottom: 10 }}>Confirm a card repayment</div>
            <div style={{ fontSize: 14, lineHeight: 1.55, marginBottom: 6 }}>
              Paying <b className="num">{money(confirmPay)}</b>
              {(config.cards || []).find((c) => c.id === payWith)
                ? <> to <b>{config.cards.find((c) => c.id === payWith).name}</b></> : null}.
            </div>
            <div className="empty" style={{ padding: "0 0 14px" }}>
              This lowers what you owe and takes the money from your bank. It is not
              a purchase and won't count against any category.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn gold" style={{ flex: 1 }} onClick={send}>
                Yes, it's a repayment
              </button>
              <button className="btn" style={{ flex: 1 }} onClick={() => {
                setConfirmPay(null); setKind("out");
                storage.set("wallet-entry-kind", "out").catch(() => {});
              }}>No, it's spending</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {!config.cycleStartDay && (
        <AskPayday onAnswer={(d) => saveConfig({ ...config, cycleStartDay: d })} />
      )}

      <FirstRun config={config} tx={tx} doneFlags={doneFlags} setDoneFlags={setDoneFlags}
        onGoPlan={() => setTab("setup")} onGoCards={() => setTab("cards")} />

      <div className="sectHead" style={{ marginTop: 16 }}>
        <button className="btn" style={{ padding: "7px 12px" }}
          onClick={() => setCycleOffset(cycleOffset - 1)} aria-label="Previous cycle">‹</button>
        <div style={{ flex: 1, textAlign: "center", fontSize: 13, fontWeight: 600 }}>{cycleLabel}</div>
        <button className="btn" style={{ padding: "7px 12px" }} disabled={cycleOffset >= 0}
          onClick={() => setCycleOffset(cycleOffset + 1)} aria-label="Next cycle">›</button>
      </div>

      <div className={`hero ${mood}`}>
        <button className="ringBtn" onClick={() => setMaths("ring")}
          aria-label="What does this ring mean?">
          <svg className="ring" viewBox="0 0 64 64" aria-hidden="true">
            <circle className="ringTrack" cx="32" cy="32" r={R} fill="none" />
            <circle className="ringFill" cx="32" cy="32" r={R} fill="none"
              strokeDasharray={`${C * timePct} ${C}`} />
            <circle className="ringSpend" cx="32" cy="32" r={R - 8} fill="none"
              stroke={spendColor}
              strokeDasharray={`${(2 * Math.PI * (R - 8)) * spendPct} ${2 * Math.PI * (R - 8)}`} />
          </svg>
          <span className="ringLabel" style={{ color: spendColor }}>{m.dayIndex}</span>
        </button>

        <div className="eyebrow">{moodLabel}</div>
        <button onClick={() => setMaths("left")} className="tappableNum"
          style={{ marginTop: 6 }} aria-label="How is this worked out?">
          <span className={`big num ${m.left < 0 ? "over" : ""}`}>
            <span className="cur"><Dh size="0.62em" /></span>{money(Math.abs(m.left))}
          </span>
          <Info size={13} />
        </button>

        <div className="sub">
          {m.left >= 0
            ? <><b className="num">{money(m.perDay)}</b> a day for the {m.daysLeft} {m.daysLeft === 1 ? "day" : "days"} left</>
            : <>You're <b className="num">{money(-m.left)}</b> past the plan with {m.daysLeft} {m.daysLeft === 1 ? "day" : "days"} to go</>}
        </div>
        <div className="sub" style={{ marginTop: 2 }}>
          {m.income <= 0 ? <>No income logged this cycle yet. Log it when it lands.</>
            : m.awaited > 0 ? <><b className="num">{money(m.awaited)}</b> of your plan hasn't arrived yet</>
            : m.otherIncome > 0 ? <>Includes <b className="num">{money(m.otherIncome)}</b> that isn't regular income</>
            : <>All your planned income has arrived</>}
        </div>

        <div className="spark" data-owns-drag
          onTouchStart={(e) => {
            sparkTouch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, axis: null };
            pickDay(e.touches[0].clientX, e.currentTarget);
          }}
          onTouchMove={(e) => {
            const st = sparkTouch.current;
            const dx = e.touches[0].clientX - st.x, dy = e.touches[0].clientY - st.y;
            /* Decide once: sideways reads the chart, up-down is the page scrolling. */
            if (!st.axis && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
              st.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
              if (st.axis === "y") setScrub(null);
            }
            if (st.axis === "y") return;
            e.preventDefault();
            pickDay(e.touches[0].clientX, e.currentTarget);
          }}
          onTouchEnd={() => setScrub(null)} onTouchCancel={() => setScrub(null)}
        >
          <div className="paceline" style={{ bottom: `${Math.min(96, (pace / sparkMax) * 100)}%` }} />
          {scrub !== null && spark[scrub] && (
            <>
              <div className="scrubLine" style={{ left: `${((scrub + 0.5) / spark.length) * 100}%` }} />
              <div className="scrubBubble" style={{
                left: `${Math.min(88, Math.max(12, ((scrub + 0.5) / spark.length) * 100))}%` }}>
                <b className="num">{spark[scrub].future ? "\u2014" : money(spark[scrub].amount)}</b>
                <span>{fmtDay(spark[scrub].iso)}</span>
              </div>
            </>
          )}
          {spark.map((s, i) => (
            <div key={s.iso} className={`tick ${scrub === i ? "picked" : ""}`}
              style={{ height: s.future ? "3px" : `${Math.max(3, (s.amount / sparkMax) * 100)}%`,
                background: s.future ? "var(--card2)" : s.amount > pace ? "var(--flare)"
                  : s.isToday ? "var(--gold)" : "var(--leaf)",
                opacity: s.future ? 1 : scrub !== null && scrub !== i ? .3 : s.amount === 0 ? .35 : 1 }} />
          ))}
        </div>
        <div className="sparkFoot">
          {scrub !== null && spark[scrub] ? (
            <>
              <span><b style={{ color: "var(--sand)" }}>{fmtDay(spark[scrub].iso)}</b></span>
              <span>{spark[scrub].future ? "hasn't happened yet"
                : <><Dh />{money(spark[scrub].amount)}{spark[scrub].amount > pace
                    ? <span style={{ color: "var(--flare)" }}> · over pace</span>
                    : <span style={{ color: "var(--leaf)" }}> · under pace</span>}</>}</span>
            </>
          ) : (
            <><span>Spent today: <Dh />{money(m.spentToday)}</span><span>Drag across the bars</span></>
          )}
        </div>
      </div>

      <div className="sect" style={{ marginTop: 14, display: "grid",
        gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <button onClick={() => setMaths("bank")} className="statCard" aria-label="In the bank">
          <span className="eyebrow">In the bank</span>
          <span className={`num ${m.cashLeft < 0 ? "over" : ""}`}
            style={{ fontSize: 22, fontWeight: 600, marginTop: 5 }}>
            {m.cashLeft < 0 ? "\u2212" : ""}{money(Math.abs(m.cashLeft))}
          </span>
          {/* "out" hid repayments inside it, which is how money seemed to vanish. */}
          <span style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 3 }}>
            {money(m.income)} in \u00b7 {money(m.spent - m.cardOut)} spent
            {m.cardPaid > 0 && <> · {money(m.cardPaid)} to cards</>}
          </span>
        </button>

        <button onClick={() => setMaths("cards")} className="statCard" aria-label="Owed on cards">
          <span className="eyebrow">Owed on cards</span>
          <span className={`num ${m.cardBalance > 0 ? "over" : ""}`}
            style={{ fontSize: 22, fontWeight: 600, marginTop: 5 }}>
            {money(m.cardBalance)}
          </span>
          <span style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 3 }}>
            {m.cardOut > 0 && m.cardPaid > 0
              ? <>{money(m.cardOut)} added · <b style={{ color: "var(--leaf)" }}>{money(m.cardPaid)} paid off</b></>
              : m.cardPaid > 0 ? <><b style={{ color: "var(--leaf)" }}>{money(m.cardPaid)} paid off</b></>
              : m.cardOut > 0 ? `${money(m.cardOut)} added this cycle` : "nothing new this cycle"}
          </span>
        </button>
      </div>

      {/* One place for everything that isn't a number you act on today. */}
      {(() => {
        const items = [];

        /* Instalments still owed. The app knows the amount and the card, but a
           payment can fail, so it asks instead of recording it for you. */
        tx.filter((t) => t.plan).forEach((t) => {
          const paid = paymentsMade(tx, t.plan);
          if (paid >= t.plan.total) return;
          const card = (config.cards || []).find((c) => c.id === t.plan.cardId);
          const amt = paid === 0 ? t.plan.first : t.plan.slice;
          items.push({ key: `plan:${t.id}:${paid}`, node: (
            <div className="flag" style={{ borderColor: "color-mix(in srgb, var(--amber) 40%, var(--line))" }}>
              <CreditCard size={17} color="var(--amber)" style={{ marginTop: 2 }} />
              <div className="txt">
                <div><b>{t.plan.note}</b> — payment {paid + 1} of {t.plan.total},{" "}
                  <b className="num">{money(amt)}</b>{card ? <> to {card.name}</> : null}.</div>
                <button className="mini" onClick={async () => {
                  const prev = tx;
                  await saveTx([{
                    id: `${Date.now()}-p${paid + 1}`, kind: "cardpay", amount: amt,
                    categoryId: "__cardpay",
                    note: `${t.plan.note} \u2014 payment ${paid + 1} of ${t.plan.total}`,
                    date: today, src: "bank", cardId: t.plan.cardId, planId: t.plan.id,
                  }, ...tx]);
                  setToast({ prevTx: prev, prevConfig: config,
                    filed: { icon: "pay", text: `Card repayment \u00b7 ${money(amt)}` } });
                  dismissToast();
                }}>I've paid this</button>
              </div>
            </div>
          )});
        });

        if (m.income > 0 && Math.abs(m.unallocated) > 1) {
          items.push({ key: `unalloc:${Math.round(m.unallocated)}`, node: (
            <div className="flag" style={{ borderColor: m.unallocated < 0
              ? "color-mix(in srgb, var(--flare) 40%, var(--line))"
              : "color-mix(in srgb, var(--leaf) 40%, var(--line))" }}>
              <ArrowDownLeft size={17} color={m.unallocated < 0 ? "var(--flare)" : "var(--leaf)"}
                style={{ marginTop: 2 }} />
              <div className="txt">
                {m.unallocated >= 0
                  ? <>Your income is <b className="num">{money(m.unallocated)}</b> more than your plan spends.</>
                  : <>Your plan spends <b className="num">{money(-m.unallocated)}</b> more than came in this cycle.</>}
              </div>
            </div>
          )});
        }

        flags.slice(0, 4).forEach((f) => items.push({
          key: `${f.c.id}:${f.level}:${Math.round(f.over || f.spent || 0)}`, node: (
          <div className="flag" style={{ borderColor: f.level === "over"
            ? "color-mix(in srgb, var(--flare) 40%, var(--line))"
            : "color-mix(in srgb, var(--amber) 40%, var(--line))" }}>
            {f.level === "over" ? <AlertTriangle size={17} color="var(--flare)" style={{ marginTop: 2 }} />
              : <TrendingDown size={17} color="var(--amber)" style={{ marginTop: 2 }} />}
            <div className="txt">
              {f.level === "over"
                ? <><b>{f.c.name}</b> is <b className="num over">{money(f.over)}</b> over budget with {m.daysLeft} {m.daysLeft === 1 ? "day" : "days"} left.</>
                : <><b>{f.c.name}</b> is running hot — <b className="num">{money(f.spent)}</b> spent {Math.round(m.through * 100)}% of the way in.</>}
            </div>
          </div>
        )}));

        /* Clearing hides what you've read. If the figure behind a notice moves,
           its key changes and it speaks up again. */
        const live = items.filter((it) => !hushed.includes(it.key));
        if (!live.length && !hushed.length) return null;

        return (
          <div className="panel">
            <button className="panelHead" aria-expanded={flagsOpen}
              onClick={() => {
                const v = !flagsOpen; setFlagsOpen(v);
                storage.set("wallet-flags-open", v ? "1" : "0").catch(() => {});
              }}>
              <span className="eyebrow" style={{ margin: 0 }}>Worth knowing</span>
              <span className="noticeCount">{live.length}</span>
              <ChevronDown size={15} style={{ marginLeft: "auto", color: "var(--muted)", flex: "none",
                transform: flagsOpen ? "rotate(180deg)" : "none", transition: "transform .18s" }} />
            </button>
            {flagsOpen && (
              <div className="panelBody tinted">
                {live.map((it) => <div key={it.key}>{it.node}</div>)}
                {live.length > 0 && (
                  <button className="btn" style={{ marginTop: 4, width: "100%" }}
                    onClick={() => hush(items.map((it) => it.key))}>Clear these</button>
                )}
                {live.length === 0 && (
                  <div className="empty" style={{ padding: "4px 0" }}>
                    Cleared. They'll come back if the numbers change.
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}

      <div className="sect">
        <div className={`composer ${kind === "cardpay" ? "repay" : ""}`}>
          {kind === "cardpay" && (
            <div className="repayBar">
              <AlertTriangle size={13} />
              <span>Card repayment — this reduces what you owe
                {payWith !== "bank" && (config.cards || []).find((c) => c.id === payWith)
                  ? <> on <b>{config.cards.find((c) => c.id === payWith).name}</b></> : null}, not a purchase.</span>
            </div>
          )}

          {/* The answer appears where the question was asked. A floating bar at
              the bottom sat inside the transformed swipe track and drifted off. */}
          {toast && toast.filed ? (
            <div className={`filedRow ${toast.leaving ? "leaving" : ""}`}>
              <span className="filedTick" aria-hidden="true"><Check size={13} /></span>
              <span className="filedDot" style={{
                background: toast.filed.icon === "in" ? "var(--leaf)"
                  : toast.filed.icon === "pay" ? "var(--amber)"
                  : (toast.filed.color || "var(--muted)") }} />
              <span className="filedText">
                {toast.filed.text}
                {toast.note && <span className="filedNote">{toast.note}</span>}
              </span>
              <button className="filedUndo" onClick={undo}><Undo2 size={14} />Undo</button>
            </div>
          ) : (
            <div className="askRow">
              <input value={text} onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
                placeholder="45 groceries, salary came in\u2026"
                aria-label="Tell your wallet what happened" />
              <button className="send" onClick={send} disabled={!text.trim()} aria-label="Send">
                <Send size={17} />
              </button>
            </div>
          )}

          <div className="composerOpts">
            <div className="seg segSm" role="tablist" aria-label="Entry type">
              {[["out", "Money out"], ["in", "Money in"], ["cardpay", "Card payment"]].map(([id, label]) => (
                <button key={id} role="tab" aria-selected={kind === id}
                  className={`segBtn ${kind === id ? "on" : ""}`}
                  onClick={() => { setKind(id); storage.set("wallet-entry-kind", id).catch(() => {}); }}>
                  {label}
                </button>
              ))}
            </div>

            {/* Reserved height, so choosing a type never shifts the page. */}
            <div className="composerRow">
              {kind === "in" ? (
                <div className="chips">
                  {(config.incomes || []).filter((i) => Number(i.amount) > 0).map((i) => (
                    <button key={i.id} className={`chip ${incomeSrc === i.id ? "on" : ""}`}
                      onClick={() => { setIncomeSrc(i.id); storage.set("wallet-income-src", i.id).catch(() => {}); }}>
                      <span className="dot" style={{ background: "var(--leaf)" }} />{i.name}
                    </button>
                  ))}
                  <button className={`chip ${incomeSrc === "other" ? "on" : ""}`}
                    onClick={() => { setIncomeSrc("other"); storage.set("wallet-income-src", "other").catch(() => {}); }}>
                    Something else
                  </button>
                </div>
              ) : (
                <div className="chips">
                  {kind === "out" && (
                    <button className={`chip ${payWith === "bank" ? "on" : ""}`}
                      onClick={() => { setPayWith("bank"); setSplitN(1); storage.set("wallet-pay-with", "bank").catch(() => {}); }}>
                      Cash / bank
                    </button>
                  )}
                  {(config.cards || []).map((c) => (
                    <button key={c.id} className={`chip ${payWith === c.id ? "on" : ""}`}
                      onClick={() => { setPayWith(c.id); storage.set("wallet-pay-with", c.id).catch(() => {}); }}>
                      <span className="dot" style={{ background: c.color }} />{c.name}
                    </button>
                  ))}
                  {kind === "cardpay" && (config.cards || []).length === 0 && (
                    <span className="composerNote">Add a card in the Cards tab first.</span>
                  )}
                </div>
              )}

              <Tip label="How to log something" title="Logging an entry">
                Type it the way you'd say it \u2014 \u201c45 groceries\u201d. Pick the type above,
                and which card if you used one. Works in English or Arabic.
                {!aiOn && " Add an API key in Plan for advice."}
              </Tip>

              {kind === "out" && payWith !== "bank" && (
                <div className="splitRow">
                  <span className="splitLabel">{splitN === 1 ? "Pay in full" : `Split into ${splitN}`}</span>
                  <input className="splitSlider" data-owns-drag type="range" min="1" max="12" step="1"
                    value={splitN} aria-label="Number of payments"
                    onChange={(e) => { const v = Number(e.target.value); setSplitN(v); setSplitOpen(v > 1); }} />
                  <span className="splitHint">{splitN === 1 ? "one payment" : `${splitN} payments`}</span>
                </div>
              )}

              {/* Tabby takes the first slice today; a credit-card plan bills it
                  on the next statement. Assuming either one is wrong. */}
              {kind === "out" && payWith !== "bank" && splitN > 1 && (
                <div className="splitWhen">
                  <span className="composerNote" style={{ flex: "0 0 100%" }}>First payment</span>
                  <button className={`chip ${splitStart === "now" ? "on" : ""}`}
                    onClick={() => setSplitStart("now")}>Taken today</button>
                  <button className={`chip ${splitStart === "later" ? "on" : ""}`}
                    onClick={() => setSplitStart("later")}>On my next statement</button>
                </div>
              )}
            </div>
          </div>
        </div>

        {(err || thinking > 0 || settled) && (
          <div className={`hint ${settled ? "settled" : ""}`}
            style={err ? { color: "var(--flare)" } : undefined}>
            {err ? err
              : thinking > 0 ? <><Loader2 size={11} className="spin" style={{ verticalAlign: -1, marginRight: 5 }} />Saved. Working out the advice…</>
              : <><Check size={12} className="hintTick" style={{ verticalAlign: -2, marginRight: 5 }} />{settled}</>}
          </div>
        )}
      </div>

      <div className="panel">
        <div className="panelHead" style={{ cursor: "default", paddingBottom: 0 }}>
          <div className="eyebrow" style={{ flex: 1 }}>Spent by category</div>
          <div className="rowNum num" style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span>{money(shownSpent)}{srcFilter === "all" && m.budget > 0 && <> / {money(m.budget)}</>}</span>
            <Tip label="Spent by category" title="Spent by category">
              <b style={{ color: "var(--sand)" }}>All</b> — everything you spent, however you paid.
              <br /><br />
              <b style={{ color: "var(--sand)" }}>Bank</b> — bought straight from your account. The money has gone.
              <br /><br />
              <b style={{ color: "var(--sand)" }}>Card</b> — bought on a card. Still yours to pay, in a later month.
              <br /><br />
              Card repayments aren't here: the purchase was counted when you made it, so
              counting the payment too would count it twice.
            </Tip>
          </div>
        </div>

        <div className="panelBody" style={{ borderTop: "none", paddingTop: 11 }}>
          <div className="seg segStack" role="tablist" aria-label="Filter by how you paid">
            {[["all", "All", m.spent], ["bank", "Bank", m.spent - m.cardOut], ["card", "Card", m.cardOut]]
              .map(([id, label, amount]) => (
                <button key={id} role="tab" aria-selected={srcFilter === id}
                  className={`segBtn ${srcFilter === id ? "on" : ""}`}
                  onClick={() => setSrcFilter(id)}>
                  <span className="segLabel">{label}</span>
                  <span className="segAmt num">{money(amount)}</span>
                </button>
              ))}
          </div>

          {cats.map((c) => {
            const spent = m.inCycle
              .filter((t) => t.kind === "expense" && t.categoryId === c.id && filtered(t))
              .reduce((s, t) => s + t.amount, 0);
            const budget = Number(c.budget) || 0;
            const over = budget > 0 && spent > budget;
            const open = openCat === c.id;
            const items = m.inCycle
              .filter((t) => t.kind === "expense" && t.categoryId === c.id && filtered(t))
              .sort((a, b) => b.date.localeCompare(a.date));

            return (
              <div key={c.id} style={{
                padding: "15px 14px", marginBottom: 9, borderRadius: 14,
                background: tint(c.color, open ? .12 : .06),
                border: `1px solid ${tint(c.color, open ? .5 : .3)}`,
                transition: "background .15s, border-color .15s",
              }}>
                <button onClick={() => setOpenCat(open ? "" : c.id)}
                  style={{ display: "flex", alignItems: "center", gap: 11, width: "100%",
                    background: "none", border: "none", padding: 0, cursor: "pointer",
                    color: "inherit", font: "inherit", textAlign: "left" }}>
                  <span style={{ width: 34, height: 34, borderRadius: 10, flex: "none",
                    background: tint(c.color, .22), border: `1px solid ${tint(c.color, .4)}`,
                    color: c.color, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {catIcon(c.name)}
                  </span>
                  <span className="rowName" style={{ color: "var(--sand)" }}>{c.name}</span>
                  <span className={`rowNum num ${over ? "over" : ""}`}>
                    <b>{money(spent)}</b>{budget > 0 && <> / {money(budget)}</>}
                  </span>
                  <ChevronDown size={15} style={{ color: "var(--muted)", flex: "none",
                    transform: open ? "rotate(180deg)" : "none", transition: "transform .18s" }} />
                </button>

                <div className="bar" style={{ background: tint(c.color, .16) }}>
                  <div className="barIn" style={{ width: "100%",
                    transform: `scaleX(${budget > 0 ? Math.min(1, spent / budget) : 0})`,
                    background: over ? "var(--flare)" : c.color,
                    transition: "transform .3s ease" }} />
                </div>

                {open && (
                  <div style={{ marginTop: 10 }}>
                    {items.length === 0
                      ? <div className="empty" style={{ padding: "4px 0 0" }}>
                          Nothing logged here this cycle.
                        </div>
                      : items.map((t) => (
                          <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 9,
                            padding: "7px 0", borderTop: "1px solid var(--line)", fontSize: 13 }}>
                            <span style={{ color: "var(--muted)", flex: "none", width: 46 }}>{fmtDay(t.date)}</span>
                            {t.src === "card" && <CreditCard size={12} style={{ color: "var(--muted)", flex: "none" }} />}
                            <span style={{ flex: 1, minWidth: 0, overflow: "hidden",
                              textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.note}</span>
                            <span className="num">{money(t.amount)}</span>
                          </div>
                        ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

/* ---------- cards ---------- */

function Cards({ config, saveConfig, tx, saveTx, m }) {
  const [draftName, setDraftName] = useState("");

  const addCard = () => {
    const name = draftName.trim() || "New card";
    saveConfig({ ...config, cards: [...(config.cards || []),
      { id: `card${Date.now()}`, name, limit: 0,
        color: PALETTE[(config.cards || []).length % PALETTE.length] }] });
    setDraftName("");
  };

  const patch = (id, key, val) => saveConfig({ ...config,
    cards: config.cards.map((c) => (c.id === id ? { ...c, [key]: val } : c)) });

  const removeCard = (id) => {
    // keep the transactions, just detach them, so history stays honest
    saveTx(tx.map((t) => (t.cardId === id ? { ...t, cardId: "" } : t)));
    saveConfig({ ...config, cards: config.cards.filter((c) => c.id !== id) });
  };

  return (
    <>
      <div className="eyebrow" style={{ marginBottom: 6 }}>Cards</div>
      <div style={{ fontSize: 21, fontWeight: 600, marginBottom: 4 }}>
        <Dh size="0.8em" />{money(m.cardBalance)}
      </div>
      <div className="empty" style={{ padding: "0 0 14px" }}>
        Owed across all cards. This is money already spent that hasn't left your
        account yet.
      </div>

      {(m.cards || []).map((c) => (
        <div key={c.id} className="panel" style={{ marginTop: 12 }}>
          <div style={{ padding: "14px 15px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 10 }}>
              <span className="dot" style={{ background: c.color, width: 11, height: 11 }} />
              <input className="input wide" style={{ background: "none", border: "none", padding: 0,
                fontSize: 15, fontWeight: 600 }}
                value={c.name} onChange={(e) => patch(c.id, "name", e.target.value)}
                aria-label="Card name" />
              <span className={`num ${c.owed > 0 ? "over" : ""}`} style={{ fontWeight: 600 }}>
                {money(c.owed)}
              </span>
            </div>

            {c.limit > 0 && (
              <>
                <div className="bar">
                  <div className="barIn" style={{ width: "100%", transformOrigin: "left center",
                    transform: `scaleX(${c.used})`,
                    background: c.used >= 0.8 ? "var(--flare)" : c.used >= 0.5 ? "var(--amber)" : c.color,
                    transition: "transform .3s ease" }} />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5,
                  color: "var(--muted)", marginTop: 6 }}>
                  <span>{Math.round(c.used * 100)}% used</span>
                  <span><Dh />{money(Math.max(0, c.limit - c.owed))} available</span>
                </div>
              </>
            )}

            <div className="field" style={{ marginTop: 8 }}>
              <label>Limit</label>
              <input className="input" style={{ width: 110 }} inputMode="decimal"
                value={c.limit || ""} placeholder="0"
                onChange={(e) => patch(c.id, "limit", Number(e.target.value.replace(/[^\d.]/g, "")) || 0)}
                aria-label="Card limit" />
            </div>

            <div className="empty" style={{ padding: "6px 0 0" }}>
              {c.thisCycle > 0
                ? <><Dh />{money(c.thisCycle)} added this cycle</>
                : "Nothing new on this card this cycle."}
            </div>

            <button className="btn" style={{ marginTop: 10 }} onClick={() => removeCard(c.id)}>
              Remove
            </button>
          </div>
        </div>
      ))}

      {m.unassignedCard > 1 && (
        <div className="flag" style={{ marginTop: 12 }}>
          <AlertTriangle size={17} color="var(--amber)" style={{ marginTop: 2 }} />
          <div className="txt">
            <b className="num">{money(m.unassignedCard)}</b> is owed on card spending that
            isn't assigned to a card. Edit those entries in History to attach them.
          </div>
        </div>
      )}

      <div className="panel" style={{ marginTop: 14 }}>
        <div style={{ padding: "14px 15px" }}>
          <div className="eyebrow" style={{ marginBottom: 8 }}>Add a card</div>
          <div className="field">
            <input className="input wide" placeholder="ADIB, Tabby, Tamara\u2026"
              value={draftName} onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addCard()}
              aria-label="New card name" />
            <button className="btn gold" onClick={addCard}>Add</button>
          </div>
          <div className="empty" style={{ padding: "6px 0 0" }}>
            Anything you pay with later: a credit card, a covered card, Tabby or Tamara.
          </div>
        </div>
      </div>
    </>
  );
}

/* ---------- history ---------- */

function History({ tx, config, saveTx, learn }) {
  const [editTx, setEditTx] = useState(null);
  const catOf = (id) => config.categories.find((c) => c.id === id) || { name: "Other", color: "#5E8C8C" };

  const groups = useMemo(() => {
    const by = {};
    for (const t of tx) (by[t.date] = by[t.date] || []).push(t);
    return Object.entries(by).sort((a, b) => b[0].localeCompare(a[0]));
  }, [tx]);

  return (
    <>
      <div className="eyebrow" style={{ marginBottom: 6 }}>Everything you've logged</div>
      <div className="empty" style={{ padding: "0 0 6px" }}>
        Tap any entry to fix the note, amount, date, category \u2014 or what it is.
      </div>

      {!groups.length && (
        <div className="empty">Nothing here yet. Tell your wallet what you spent and it'll show up.</div>
      )}

      {groups.map(([date, items], gi) => {
        /* A month header whenever the month changes, with that month's total. */
        const prevDate = gi > 0 ? groups[gi - 1][0] : null;
        const newMonth = !prevDate || date.slice(0, 7) !== prevDate.slice(0, 7);
        const monthTotal = newMonth
          ? groups.filter(([d]) => d.slice(0, 7) === date.slice(0, 7))
              .reduce((sum, [, its]) => sum + its.reduce((n, t) =>
                n + (t.kind === "expense" ? t.amount : 0), 0), 0)
          : 0;
        const monthName = new Date(`${date}T00:00:00Z`)
          .toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

        // repayments move a balance rather than being new spending
        const net = items.reduce((s, t) =>
          s + (t.kind === "income" || t.kind === "cardpay" ? 0 : t.amount), 0);

        return (
          <React.Fragment key={date}>
            {newMonth && (
              <div className="monthBar">
                <span className="monthName">{monthName}</span>
                <span className="num monthTotal"><Dh />{money(monthTotal)}</span>
              </div>
            )}
            <div className="sect" style={{ marginTop: newMonth ? 10 : 18 }}>
              <div className="sectHead">
                <div className="eyebrow">{fmtDay(date)}</div>
                <div className="num" style={{ fontSize: 12, color: "var(--muted)" }}>
                  <Dh />{money(net)}
                </div>
              </div>

              {items.map((t) => (
                <button key={t.id} onClick={() => setEditTx(t)}
                  style={{ display: "flex", alignItems: "center", gap: 11, width: "100%",
                    padding: "10px 0", borderBottom: "1px solid var(--line)",
                    background: "none", border: "none", borderBottomStyle: "solid",
                    cursor: "pointer", color: "inherit", font: "inherit", textAlign: "left" }}>
                  <span className="dot" style={{ background: t.kind === "income" ? "var(--gold)"
                    : t.kind === "cardpay" ? "var(--leaf)" : catOf(t.categoryId).color }} />
                  {t.src === "card" && t.kind === "expense" &&
                    <CreditCard size={13} style={{ color: "var(--muted)", flex: "none" }} />}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {t.kind === "cardpay" && <span className="repayTag">repayment</span>}
                      {t.note}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>
                      {t.kind === "income" ? "Money in"
                        : t.kind === "cardpay" ? "Card repayment"
                        : catOf(t.categoryId).name}
                    </div>
                  </div>
                  <span className="num" style={{ fontSize: 15, fontWeight: 500,
                    color: t.kind === "income" ? "var(--gold)"
                      : t.kind === "cardpay" ? "var(--leaf)" : undefined }}>
                    {t.kind === "income" ? "+" : t.kind === "cardpay" ? "\u21a9 " : ""}{money(t.amount)}
                  </span>
                  <Pencil size={13} style={{ color: "var(--muted)", flex: "none" }} />
                </button>
              ))}
            </div>
          </React.Fragment>
        );
      })}

      {editTx && (
        <EditSheet tx={editTx} config={config} learn={learn}
          onClose={() => setEditTx(null)}
          onSave={async (next) => {
            await saveTx(tx.map((t) => (t.id === next.id ? next : t)));
            setEditTx(null);
          }}
          onDelete={async () => {
            await saveTx(tx.filter((t) => t.id !== editTx.id));
            setEditTx(null);
          }} />
      )}
    </>
  );
}

function EditSheet({ tx, config, onClose, onSave, onDelete, learn }) {
  /* The kind was fixed at logging time and couldn't be corrected here, so an
     entry filed as a purchase instead of a repayment was stuck that way. */
  const [kind, setKind] = useState(tx.kind || "expense");
  const [amount, setAmount] = useState(String(tx.amount));
  const [note, setNote] = useState(tx.note || "");
  const [date, setDate] = useState(tx.date);
  const [cat, setCat] = useState(tx.categoryId);
  const [src, setSrc] = useState(tx.src || "bank");
  const [cardId, setCardId] = useState(tx.cardId || "");
  const [confirmDel, setConfirmDel] = useState(false);

  const isIncome = kind === "income";
  const isCardPay = kind === "cardpay";

  return createPortal(
    <div onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", zIndex: 60,
        display: "flex", alignItems: "flex-end", justifyContent: "center", padding: 14 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 18,
          padding: 18, width: "100%", maxWidth: 520, maxHeight: "86vh", overflowY: "auto",
          marginBottom: 78 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
          marginBottom: 14 }}>
          <div className="eyebrow">Edit entry</div>
          <button className="icon" onClick={onClose} aria-label="Close"><X size={17} /></button>
        </div>

        <div className="field">
          <label>Amount <Dh size="0.9em" /></label>
          <input className="input" style={{ width: 130 }} inputMode="decimal" value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} />
        </div>
        <div className="field">
          <label>Note</label>
          <input className="input wide" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div className="field">
          <label>Date</label>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>

        <div className="eyebrow" style={{ marginTop: 14, marginBottom: 2 }}>This entry is</div>
        <div className="seg segSm" role="tablist" aria-label="Entry type">
          {[["expense", "Money out"], ["income", "Money in"], ["cardpay", "Card payment"]].map(([id, label]) => (
            <button key={id} role="tab" aria-selected={kind === id}
              className={`segBtn ${kind === id ? "on" : ""}`}
              onClick={() => {
                setKind(id);
                // a repayment leaves the bank; income has no card at all
                if (id === "cardpay") { setSrc("bank"); if (!cardId) setCardId((config.cards || [])[0]?.id || ""); }
                if (id === "income") { setSrc("bank"); setCardId(""); }
              }}>{label}</button>
          ))}
        </div>

        {isCardPay && (config.cards || []).length > 0 && (
          <>
            <div className="eyebrow" style={{ marginTop: 14, marginBottom: 2 }}>Paid to which card</div>
            <div className="chips">
              {config.cards.map((c) => (
                <button key={c.id} className={`chip ${cardId === c.id ? "on" : ""}`}
                  onClick={() => setCardId(c.id)}>
                  <span className="dot" style={{ background: c.color }} />{c.name}
                </button>
              ))}
            </div>
          </>
        )}

        {!isIncome && !isCardPay && (
          <>
            <div className="eyebrow" style={{ marginTop: 14, marginBottom: 2 }}>Paid with</div>
            <div className="chips">
              <button className={`chip ${src === "bank" ? "on" : ""}`}
                onClick={() => { setSrc("bank"); setCardId(""); }}>
                <Wallet size={13} />Cash / bank
              </button>
              {(config.cards || []).map((c) => (
                <button key={c.id} className={`chip ${src === "card" && cardId === c.id ? "on" : ""}`}
                  onClick={() => { setSrc("card"); setCardId(c.id); }}>
                  <span className="dot" style={{ background: c.color }} />{c.name}
                </button>
              ))}
            </div>

            <div className="eyebrow" style={{ marginTop: 14, marginBottom: 2 }}>Move to category</div>
            <div className="chips">
              {config.categories.map((c) => (
                <button key={c.id} className={`chip ${cat === c.id ? "on" : ""}`}
                  onClick={() => setCat(c.id)}>
                  <span className="dot" style={{ background: c.color }} />{c.name}
                </button>
              ))}
            </div>
          </>
        )}

        <button className="btn gold" style={{ width: "100%", marginTop: 16 }}
          onClick={() => {
            /* Moving an entry teaches the word, so the next one goes to the
               right place without a list I had to guess at. */
            if (kind === "expense" && cat !== tx.categoryId) learn(note, cat);
            onSave({
              ...tx, kind, amount: Number(amount) || 0, note, date,
              categoryId: isIncome ? "__income" : isCardPay ? "__cardpay" : cat,
              src: isCardPay || isIncome ? "bank" : src,
              cardId: isCardPay ? cardId : (src === "card" ? cardId : ""),
            });
          }}>
          Save changes
        </button>

        {!confirmDel
          ? <button className="btn" style={{ width: "100%", marginTop: 8 }}
              onClick={() => setConfirmDel(true)}>
              <Trash2 size={14} style={{ verticalAlign: -2, marginRight: 6 }} />Delete this entry
            </button>
          : <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button className="btn danger" style={{ flex: 1 }} onClick={onDelete}>Yes, delete it</button>
              <button className="btn" style={{ flex: 1 }} onClick={() => setConfirmDel(false)}>Keep it</button>
            </div>}
      </div>
    </div>,
    document.body
  );
}

/* ---------- plan ---------- */

function Fold({ title, hint, defaultOpen, children }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="panel" data-open={open ? "1" : "0"}
      style={{ borderColor: open ? "var(--gold)" : "var(--line)" }}>
      <button className="panelHead" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span className="eyebrow" style={{ flex: 1 }}>{title}</span>
        <ChevronDown size={15} style={{ color: "var(--muted)", flex: "none",
          transform: open ? "rotate(180deg)" : "none", transition: "transform .18s" }} />
      </button>
      {hint && !open && <div className="empty" style={{ padding: "0 15px 13px" }}>{hint}</div>}
      {open && <div className="panelBody">{children}</div>}
    </div>
  );
}

function Setup(props) {
  const { config, saveConfig, tx, saveTx, theme, setTheme, doneFlags, setDoneFlags } = props;
  const [group, setGroup] = useState("money");
  const [slice, setSlice] = useState("");
  const [importMsg, setImportMsg] = useState("");
  const [provDraft, setProvDraft] = useState(() => getProvider() || "openai");
  const [modelDraft, setModelDraft] = useState(() => getModel() || PROVIDERS[getProvider() || "openai"].model);
  const [keyDraft, setKeyDraft] = useState("");
  const [keyMsg, setKeyMsg] = useState("");
  const [confirmWipe, setConfirmWipe] = useState(false);

  const total = config.categories.reduce((s, c) => s + Number(c.budget || 0), 0);
  const expected = (config.incomes || []).reduce((s, i) => s + (Number(i.amount) || 0), 0);
  const gap = total - expected;

  const patch = (id, key, val) => saveConfig({ ...config,
    categories: config.categories.map((c) => (c.id === id ? { ...c, [key]: val } : c)) });
  const patchIncome = (id, key, val) => saveConfig({ ...config,
    incomes: (config.incomes || []).map((i) => (i.id === id ? { ...i, [key]: val } : i)) });

  const exportBackup = () => {
    const blob = new Blob([JSON.stringify({ version: __APP_VERSION__, config, tx }, null, 2)],
      { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `wallet-backup-${todayISO()}-v${__APP_VERSION__}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    const next = { ...doneFlags, backup: true };
    setDoneFlags(next);
    storage.set(MISSIONS_KEY, JSON.stringify(next)).catch(() => {});
  };

  return (
    <>
      <div className="eyebrow" style={{ marginBottom: 6 }}>Plan</div>
      <div className="empty" style={{ padding: "0 0 10px", fontSize: 13 }}>
        <span style={{ color: "var(--gold)" }}>●</span> v{__APP_VERSION__} · works offline
        \u00b7 {tx.length} entries
      </div>

      <div style={{ fontSize: 21, fontWeight: 600, margin: "2px 0 14px" }}>
        {group === "money" ? "Your money" : "Settings"}
      </div>

      <div className="seg" role="tablist" aria-label="Plan sections">
        {[["money", "Money"], ["data", "Settings"]].map(([id, label]) => (
          <button key={id} role="tab" aria-selected={group === id}
            className={`segBtn ${group === id ? "on" : ""}`}
            onClick={() => setGroup(id)}>{label}</button>
        ))}
      </div>

      {group === "money" && <>
        {total > 0 && (() => {
          const parts = config.categories.filter((c) => Number(c.budget) > 0)
            .sort((a, b) => Number(b.budget) - Number(a.budget));
          const R = 52, C = 2 * Math.PI * R;

          /* A category worth a fraction of a percent would draw a hairline no
             screen can show. Give every arc a visible minimum and take the
             difference off the largest, so the ring still closes exactly. */
          const MIN = 1.6;
          const raw = parts.map((c) => ({ c, len: C * (Number(c.budget) / total) }));
          const short = raw.filter((a) => a.len < MIN);
          if (short.length && raw.length > short.length) {
            const owed = short.reduce((s, a) => s + (MIN - a.len), 0);
            short.forEach((a) => { a.len = MIN; });
            const big = raw.filter((a) => a.len >= MIN).sort((a, b) => b.len - a.len)[0];
            if (big) big.len = Math.max(MIN, big.len - owed);
          }
          let cursor = 0;
          const arcs = raw.map((a) => {
            const arc = { c: a.c, len: a.len, off: -cursor };
            cursor += a.len;
            return arc;
          });

          const picked = parts.find((c) => c.id === slice) || null;
          const shown = picked || { name: "Everything", budget: total };

          return (
            <div style={{ border: "1px solid var(--line)", borderRadius: 14,
              padding: "18px 16px 16px", marginBottom: 12 }}>
              <div className="eyebrow" style={{ marginBottom: 14 }}>Where it goes</div>

              <div style={{ display: "flex", justifyContent: "center", position: "relative",
                marginBottom: 16 }}>
                {/* Lesson learned twice: never animate a property that also
                    defines the shape. One fade, on a wrapper, on opacity alone. */}
                <svg width="150" height="150" viewBox="0 0 140 140" className="ringWrap"
                  role="img" aria-label="Budget split by category">
                  <g transform="rotate(-90 70 70)">
                    <circle cx="70" cy="70" r={R} fill="none" stroke="var(--card2)" strokeWidth={22} />
                    {arcs.map(({ c, len, off }, i) => {
                      const dim = slice && slice !== c.id;
                      return (
                        <circle key={c.id} cx="70" cy="70" r={R} fill="none"
                          stroke={c.color} strokeWidth={slice === c.id ? 27 : 22}
                          strokeDasharray={`${len} ${C - len}`} strokeDashoffset={off}
                          opacity={dim ? .28 : 1} className="seg-in"
                          style={{ cursor: "pointer", transition: "stroke-width .18s",
                            animationDelay: `${0.12 + i * Math.min(0.075, 0.85 / Math.max(1, arcs.length))}s` }}
                          onClick={() => setSlice(slice === c.id ? "" : c.id)} />
                      );
                    })}
                  </g>
                </svg>

                <div className="donutCentre" style={{ position: "absolute", inset: 0, display: "flex",
                  flexDirection: "column", alignItems: "center", justifyContent: "center",
                  pointerEvents: "none", textAlign: "center", padding: "0 34px" }}>
                  <div className="num" style={{ fontSize: 21, fontWeight: 600,
                    color: picked ? picked.color : "var(--sand)" }}>{money(Number(shown.budget))}</div>
                  <div style={{ fontSize: String(shown.name).length > 16 ? 9.5 : 11,
                    color: "var(--muted)", marginTop: 2, lineHeight: 1.25, maxWidth: 84,
                    display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                    overflow: "hidden" }}>{shown.name}</div>
                  {picked && (
                    <div className="num" style={{ fontSize: 11, color: "var(--muted)", marginTop: 1 }}>
                      {Math.round((Number(picked.budget) / total) * 100)}%
                    </div>
                  )}
                </div>
              </div>

              <div style={{ display: "grid", gap: 2 }}>
                {parts.map((c, i) => {
                  const on = slice === c.id;
                  return (
                    <button key={c.id} className="legendRow"
                      onClick={() => setSlice(on ? "" : c.id)}
                      style={{ animationDelay: `${0.5 + i * 0.045}s`,
                        display: "flex", alignItems: "center", gap: 9, width: "100%",
                        background: on ? tint(c.color, .14) : "transparent", border: "none",
                        borderRadius: 9, padding: "8px 9px", cursor: "pointer", color: "inherit",
                        font: "inherit", textAlign: "left", opacity: slice && !on ? .5 : 1,
                        transition: "background .15s, opacity .15s" }}>
                      <span className="dot" style={{ background: c.color }} />
                      <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, overflow: "hidden",
                        textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                      <span className="num" style={{ fontSize: 13, color: "var(--muted)" }}>{money(Number(c.budget))}</span>
                      <span className="num" style={{ fontSize: 13, fontWeight: 600, minWidth: 36,
                        textAlign: "right" }}>{Math.round((Number(c.budget) / total) * 100)}%</span>
                    </button>
                  );
                })}
              </div>

              {picked && (
                <div className="empty" style={{ padding: "12px 2px 0" }}>
                  {picked.name} takes {money(Number(picked.budget))} of every {money(total)}
                  {expected > 0 && <> — about {Math.round((Number(picked.budget) / expected) * 100)}% of what comes in</>}.
                </div>
              )}
            </div>
          );
        })()}

        <Fold title="Income" defaultOpen
          hint={expected > 0 ? `${DH} ${money(expected)} expected each cycle` : "Nothing set up yet"}>
          <div style={{ paddingBottom: 10 }}>
            <Tip label="What income is for" title="Income">
              What you expect to come in each cycle. Only used to check your budgets \u2014
              nothing counts until you log it arriving.
            </Tip>
          </div>

          {(config.incomes || []).length > 0 && (
            <div style={{ display: "flex", gap: 8, alignItems: "baseline", padding: "0 0 4px 20px",
              fontSize: 11, color: "var(--muted)", letterSpacing: ".06em", textTransform: "uppercase" }}>
              <span style={{ flex: 1 }}>Source</span>
              <span style={{ width: 46, textAlign: "center" }}>Day</span>
              <span style={{ width: 92, textAlign: "right" }}>Amount</span>
              <span style={{ width: 28 }} />
            </div>
          )}

          {(config.incomes || []).map((inc) => (
            <div key={inc.id} className="field" style={{ borderBottom: "1px solid var(--line)" }}>
              <span className="dot" style={{ background: "var(--leaf)" }} />
              <input className="input wide" style={{ background: "none", border: "none", padding: "9px 0" }}
                value={inc.name} placeholder="Source"
                onChange={(e) => patchIncome(inc.id, "name", e.target.value)} aria-label="Income name" />
              <input className="input" style={{ width: 46, textAlign: "center" }} inputMode="numeric"
                value={inc.day} placeholder="1"
                onChange={(e) => patchIncome(inc.id, "day", e.target.value.replace(/\D/g, "").slice(0, 2))}
                aria-label="Day of the month it arrives" title="Day of the month it arrives" />
              <input className="input" style={{ width: 92 }} inputMode="decimal" value={inc.amount}
                onChange={(e) => patchIncome(inc.id, "amount", e.target.value.replace(/[^\d.]/g, ""))}
                aria-label="Amount" />
              <button className="icon" aria-label="Remove income"
                onClick={() => saveConfig({ ...config, incomes: config.incomes.filter((x) => x.id !== inc.id) })}>
                <X size={15} />
              </button>
            </div>
          ))}

          <button className="btn ghost" style={{ marginTop: 14 }}
            onClick={() => saveConfig({ ...config, incomes: [...(config.incomes || []),
              { id: `inc${Date.now()}`, name: "New source", day: String(config.cycleStartDay || 1), amount: 0 }] })}>
            <Plus size={14} style={{ verticalAlign: -2 }} /> Add an income source
          </button>

          {expected > 0 && total > 0 && (
            <div className="flag" style={{ marginTop: 14, borderColor: gap > 0
              ? "color-mix(in srgb, var(--flare) 40%, var(--line))"
              : "color-mix(in srgb, var(--leaf) 40%, var(--line))" }}>
              {gap > 0 ? <AlertTriangle size={17} color="var(--flare)" style={{ marginTop: 2 }} />
                : <PiggyBank size={17} color="var(--leaf)" style={{ marginTop: 2 }} />}
              <div className="txt">
                {gap > 0
                  ? <>Budgets total <b className="num">{money(total)}</b> against <b className="num">{money(expected)}</b> expected — <b className="num over">{money(gap)}</b> more than comes in.</>
                  : <>Budgets come to <b className="num">{money(total)}</b> of <b className="num">{money(expected)}</b>, leaving <b className="num">{money(-gap)}</b> unallocated.</>}
              </div>
            </div>
          )}
        </Fold>

        <Fold title="Not sure what to put here?" hint="Budgets are optional \u2014 here's how to start">
          <div className="empty" style={{ padding: "0 0 10px" }}>
            You don't have to budget by category. Without any budgets the app tracks
            what you spend against what you earn, which is enough for most people.
            <br /><br />
            If you do want them, a simple way to start: look at last month, round each
            category up a little, and adjust after a cycle of real numbers.
          </div>
        </Fold>

        <Fold title="Budgets" defaultOpen hint={total > 0 ? `${DH} ${money(total)} allocated` : "None set \u2014 tracking against income"}>
          <div style={{ paddingBottom: 10 }}>
            <Tip label="What budgets are" title="Budgets">
              What you plan to spend per category each cycle. Targets, not money in hand.
              Leave one at 0 and it simply isn't budgeted \u2014 spending there won't count
              against anything.
            </Tip>
          </div>
          {config.categories.map((c) => (
            <div key={c.id} className="field" style={{ borderBottom: "1px solid var(--line)" }}>
              <span className="dot" style={{ background: c.color }} />
              <input className="input wide" style={{ background: "none", border: "none", padding: "9px 0" }}
                value={c.name} onChange={(e) => patch(c.id, "name", e.target.value)}
                aria-label="Category name" />
              <input className="input" style={{ width: 100 }} inputMode="decimal" value={c.budget}
                onChange={(e) => patch(c.id, "budget", e.target.value.replace(/[^\d.]/g, ""))}
                aria-label="Budget amount" />
              <button className="icon" aria-label="Remove category"
                onClick={() => saveConfig({ ...config, categories: config.categories.filter((x) => x.id !== c.id) })}>
                <X size={15} />
              </button>
            </div>
          ))}
          <button className="btn ghost" style={{ marginTop: 14 }}
            onClick={() => saveConfig({ ...config, categories: [...config.categories,
              { id: `cat${Date.now()}`, name: "New category", budget: 0,
                color: PALETTE[config.categories.length % PALETTE.length] }] })}>
            <Plus size={14} style={{ verticalAlign: -2 }} /> Add a category
          </button>
        </Fold>

        <Fold title="Cycle" hint={`Starts on day ${config.cycleStartDay || 1} of each month`}>
          <div className="field">
            <label>Set this to your salary date so the cycle follows your pay.</label>
            <input className="input" style={{ width: 70 }} inputMode="numeric"
              value={config.cycleStartDay || 1}
              onChange={(e) => saveConfig({ ...config,
                cycleStartDay: Math.min(28, Math.max(1, Number(e.target.value) || 1)) })} />
          </div>
        </Fold>
      </>}

      {group === "data" && <>
        <Fold title="Appearance" defaultOpen
          hint={theme === "auto" ? "Following your phone" : theme === "light" ? "Light" : "Dark"}>
          <div className="chips">
            {[["light", "Light"], ["dark", "Dark"], ["auto", "Follow phone"]].map(([id, label]) => (
              <button key={id} className={`chip ${theme === id ? "on" : ""}`}
                onClick={() => { setTheme(id); storage.set("wallet-theme", id).catch(() => {}); }}>
                {label}
              </button>
            ))}
          </div>
          <div className="empty" style={{ padding: "10px 0 0" }}>
            The dial above the tab bar switches straight between light and dark.
          </div>
        </Fold>

        <Fold title="AI" hint={getDeviceKey() ? `On \u00b7 ${getProvider() || "openai"}` : "Off \u2014 using the offline matcher"}>
          <div className="empty" style={{ padding: "0 0 12px" }}>
            Your key stays on this phone and is sent straight to the provider you pick.
            Without one the app still works \u2014 it matches on words instead.
          </div>

          <div className="field">
            <label>Provider</label>
            <select className="input" value={provDraft}
              onChange={(e) => { setProvDraft(e.target.value); setModelDraft(PROVIDERS[e.target.value].model); }}>
              {Object.entries(PROVIDERS).map(([id, p]) => (
                <option key={id} value={id}>{p.label}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Model</label>
            <input className="input wide" value={modelDraft}
              placeholder={PROVIDERS[provDraft]?.model}
              onChange={(e) => setModelDraft(e.target.value)} aria-label="Model name" />
          </div>
          <div className="empty" style={{ padding: "0 0 8px", fontSize: 12 }}>
            Change this if your account uses a different model. A name your key can't
            call makes every request fail silently.
          </div>

          <div className="field">
            <label>API key</label>
            <input className="input wide" type="password" value={keyDraft}
              placeholder={getDeviceKey() ? "\u2022\u2022\u2022\u2022 saved" : "sk-\u2026"}
              onChange={(e) => setKeyDraft(e.target.value)} aria-label="API key" />
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
            <button className="btn gold" onClick={() => {
              if (keyDraft.trim()) device.set(KEY_NAME, keyDraft.trim());
              device.set(PROVIDER_NAME, provDraft);
              device.set(MODEL_NAME, modelDraft.trim());
              setKeyDraft("");
              setKeyMsg("Saved on this phone.");
            }}>Save</button>
            <button className="btn" onClick={() => {
              device.set(KEY_NAME, ""); setKeyDraft(""); setKeyMsg("Key removed.");
            }}>Remove key</button>
          </div>
          {keyMsg && <div className="empty" style={{ padding: "10px 0 0", color: "var(--leaf)" }}>{keyMsg}</div>}
        </Fold>

        <Fold title="Backup" defaultOpen hint="Export regularly \u2014 it's the only copy you control">
          <div className="empty" style={{ padding: "0 0 12px" }}>
            {tx.length} entries on this phone. Importing replaces everything, so export
            first if you're unsure.
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn gold" onClick={exportBackup}>Export backup</button>
            <label className="btn" style={{ cursor: "pointer" }}>
              Import backup
              <input type="file" accept="application/json" style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files && e.target.files[0];
                  e.target.value = "";
                  if (!f) return;
                  const r = new FileReader();
                  r.onload = async () => {
                    try {
                      const data = JSON.parse(String(r.result));
                      if (!data.config || !Array.isArray(data.tx)) throw new Error("not a wallet backup");
                      await saveConfig(data.config);
                      await saveTx(data.tx);
                      setImportMsg(`Restored ${data.tx.length} entries.`);
                    } catch (err) {
                      setImportMsg(`Couldn't read that file \u2014 ${err.message}`);
                    }
                  };
                  r.readAsText(f);
                }} />
            </label>
          </div>
          {importMsg && <div className="empty" style={{ padding: "10px 0 0", color: "var(--leaf)" }}>{importMsg}</div>}
        </Fold>

        <Fold title="What's new" hint={`You're on v${__APP_VERSION__}`}>
          <div className="scrollBox">
            {CHANGELOG.map((rel, n) => (
              <div key={rel.v} style={{ paddingBottom: 13, marginBottom: 13,
                borderBottom: n < CHANGELOG.length - 1 ? "1px solid var(--line)" : "none" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span className="num" style={{ fontSize: 13, fontWeight: 600 }}>v{rel.v}</span>
                  {rel.v === __APP_VERSION__ && (
                    <span style={{ fontSize: 10, fontWeight: 700, color: "var(--leather)",
                      background: "var(--gold)", borderRadius: 99, padding: "1px 7px" }}>NOW</span>
                  )}
                </div>
                {rel.items.map((it, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, padding: "2px 0",
                    fontSize: 13, lineHeight: 1.5, color: "var(--muted)" }}>
                    <span style={{ flex: "none" }}>·</span><span>{it}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="empty" style={{ padding: "10px 2px 0", fontSize: 12 }}>
            {CHANGELOG.length} releases \u00b7 scroll for older
          </div>
        </Fold>

        <Fold title="Danger zone" hint="Erase everything on this phone">
          {!confirmWipe
            ? <button className="btn" onClick={() => setConfirmWipe(true)}>Erase everything</button>
            : <>
                <div className="empty" style={{ padding: "0 0 10px" }}>
                  This deletes every entry and setting on this phone. It cannot be undone.
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button className="btn danger" style={{ flex: 1 }}
                    onClick={async () => {
                      await saveTx([]);
                      await saveConfig({ categories: DEFAULT_CATEGORIES, cards: [], incomes: [],
                        cycleStartDay: null, learned: {} });
                      setConfirmWipe(false);
                    }}>Yes, erase it all</button>
                  <button className="btn" style={{ flex: 1 }} onClick={() => setConfirmWipe(false)}>Keep it</button>
                </div>
              </>}
        </Fold>
      </>}

      <div className="empty" style={{ padding: "20px 2px 0", fontSize: 11.5, textAlign: "center" }}>
        Wallet v{__APP_VERSION__} \u00b7 in development
      </div>
    </>
  );
}

/* ---------- update prompt ---------- */

function UpdateBanner() {
  const [waiting, setWaiting] = useState(() => typeof window !== "undefined" && !!window.__updateWaiting);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [nextVer, setNextVer] = useState("");

  useEffect(() => {
    const f = () => setWaiting(true);
    window.addEventListener("update-waiting", f);
    return () => window.removeEventListener("update-waiting", f);
  }, []);

  /* Every earlier attempt was a one-shot: a message port, then a push from the
     installing worker. If the page wasn't listening at that instant the version
     was lost with no way to recover. So: ask, repeatedly, by two independent
     routes, until one answers. */
  useEffect(() => {
    if (!waiting) return;
    let stop = false, tries = 0;

    const readFile = () => {
      if (stop || tries > 12) return;
      tries += 1;
      fetch(`sw.js?v=${Date.now()}`, { cache: "no-store" })
        .then((r) => (r.ok ? r.text() : ""))
        .then((txt) => {
          const mm = txt.match(/BUILD_VERSION\s*=\s*"([^"]+)"/);
          const v = mm && mm[1];
          if (stop) return;
          if (v && v !== "__VERSION__" && v !== __APP_VERSION__) setNextVer(v);
          else setTimeout(readFile, 500);
        })
        .catch(() => { if (!stop) setTimeout(readFile, 800); });
    };

    /* A waiting worker can't answer fetches — only the active one can — but it
       can answer messages, and it replies from memory so no cache interferes. */
    const askWorker = () => {
      if (stop || !navigator.serviceWorker) return;
      navigator.serviceWorker.getRegistration().then((reg) => {
        const sw = reg && (reg.waiting || reg.installing);
        if (!sw || stop) return;
        const ch = new MessageChannel();
        ch.port1.onmessage = (e) => {
          const v = e.data && e.data.version;
          if (!stop && v && v !== "__VERSION__" && v !== __APP_VERSION__) setNextVer(v);
        };
        sw.postMessage({ type: "WHICH_VERSION" }, [ch.port2]);
      }).catch(() => {});
    };

    readFile();
    askWorker();
    const again = setInterval(askWorker, 900);
    const stopAsking = setTimeout(() => clearInterval(again), 9000);
    return () => { stop = true; clearInterval(again); clearTimeout(stopAsking); };
  }, [waiting]);

  useEffect(() => {
    if (!navigator.serviceWorker) return;
    const onMsg = (e) => {
      const d = e.data || {};
      if (d.type === "VERSION_WAITING" && d.version
          && d.version !== "__VERSION__" && d.version !== __APP_VERSION__) {
        setNextVer(d.version);
        setWaiting(true);
      }
    };
    navigator.serviceWorker.addEventListener("message", onMsg);
    return () => navigator.serviceWorker.removeEventListener("message", onMsg);
  }, []);

  if (!waiting || dismissed) return null;

  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 90, display: "flex",
      alignItems: "center", justifyContent: "center", padding: 24,
      background: "rgba(0,0,0,.55)", backdropFilter: "blur(3px)" }}>
      <div className="mathsCard">
        <div style={{ display: "flex", gap: 11, alignItems: "flex-start", marginBottom: 12 }}>
          <span style={{ width: 34, height: 34, borderRadius: 10, flex: "none",
            background: "color-mix(in srgb, var(--gold) 18%, transparent)", color: "var(--gold)",
            display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Undo2 size={17} />
          </span>
          <div>
            <div style={{ fontSize: 16, fontWeight: 600 }}>
              {nextVer ? `Update to v${nextVer}` : "A new version is ready"}
            </div>
            <div className="empty" style={{ padding: 0, fontSize: 11 }}>you're on v{__APP_VERSION__}</div>
          </div>
        </div>

        <div className="empty" style={{ padding: "0 0 16px" }}>
          Your entries, budgets and cards stay exactly as they are.
          {/* This build can only describe itself, never the one arriving. */}
          {nextVer && <> What changed is listed in <b>Plan → Settings → What's new</b> once you update.</>}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn gold" style={{ flex: 1 }} disabled={busy}
            onClick={() => {
              setBusy(true);
              navigator.serviceWorker.getRegistration().then((reg) => {
                if (reg && reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
                else window.location.reload();
              }).catch(() => window.location.reload());
            }}>
            {busy ? "Updating\u2026" : "Update now"}
          </button>
          <button className="btn" style={{ flex: 1 }} onClick={() => setDismissed(true)}>Later</button>
        </div>
        <div className="empty" style={{ padding: "12px 0 0", fontSize: 11.5, textAlign: "center" }}>
          Choosing Later will ask again next time you open the app.
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ---------- app ---------- */

const TABS = ["home", "cards", "history", "setup"];

export default function SpendingWallet() {
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState("home");
  const [tx, setTx] = useState([]);
  const [config, setConfig] = useState({
    categories: DEFAULT_CATEGORIES, cards: [], incomes: [],
    /* cycleStartDay stays null until asked. A number here would put the user
       inside a pay cycle they never chose. */
    cycleStartDay: null, learned: {},
  });
  const [cycleOffset, setCycleOffset] = useState(0);
  const [doneFlags, setDoneFlags] = useState({});
  const [theme, setTheme] = useState("light");

  /* Kept above the tabs: the panes are keyed, so React unmounts them on a
     swipe and anything typed inside would be lost. */
  const [draft, setDraft] = useState("");
  const [kind, setKind] = useState("out");
  const [payWith, setPayWith] = useState("bank");
  const [incomeSrc, setIncomeSrc] = useState("other");
  const [splitN, setSplitN] = useState(1);
  const [splitStart, setSplitStart] = useState("now");

  const today = todayISO();

  useEffect(() => {
    (async () => {
      try {
        const r = await storage.get(TX_KEY);
        if (r?.value) setTx(JSON.parse(r.value));
      } catch (e) { /* first run */ }

      try {
        const r = await storage.get(CONFIG_KEY);
        if (r?.value) {
          const c = JSON.parse(r.value);
          // older data can arrive without colours; give each one by position
          const cats = (c.categories || DEFAULT_CATEGORIES).map((x, i) =>
            x.color ? x : { ...x, color: PALETTE[i % PALETTE.length] });
          setConfig({ cards: [], incomes: [], learned: {}, ...c, categories: cats });
        }
      } catch (e) { /* first run */ }

      try {
        const r = await storage.get(MISSIONS_KEY);
        if (r?.value) setDoneFlags(JSON.parse(r.value));
      } catch (e) { /* none yet */ }

      for (const [key, set] of [["wallet-theme", setTheme], ["wallet-entry-kind", setKind],
        ["wallet-pay-with", setPayWith], ["wallet-income-src", setIncomeSrc]]) {
        try { const r = await storage.get(key); if (r?.value) set(r.value); } catch (e) { /* default */ }
      }

      setReady(true);
    })();
  }, []);

  const saveTx = async (next) => {
    setTx(next);
    await storage.set(TX_KEY, JSON.stringify(next)).catch(() => {});
  };
  const saveConfig = async (next) => {
    setConfig(next);
    await storage.set(CONFIG_KEY, JSON.stringify(next)).catch(() => {});
  };

  /* Correcting an entry teaches the word, so the matcher learns your merchants
     rather than relying on a list someone else guessed at. */
  const learn = (note, catId) => {
    const words = String(note || "").toLowerCase()
      .replace(/[^a-z\u0600-\u06ff\s]/g, " ").split(/\s+/)
      .filter((w) => w.length > 3);
    if (!words.length || !catId) return;
    const learned = { ...(config.learned || {}) };
    words.forEach((w) => { learned[w] = catId; });
    saveConfig({ ...config, learned });
  };

  const prefersLight = typeof window !== "undefined" && window.matchMedia
    && window.matchMedia("(prefers-color-scheme: light)").matches;
  const isLight = theme === "light" || (theme === "auto" && prefersLight);

  /* Portalled sheets render outside .app, so the theme has to live on <html>
     or they come out unstyled. */
  useEffect(() => {
    const el = document.documentElement;
    el.classList.toggle("light", isLight);
    return () => el.classList.remove("light");
  }, [isLight]);

  const startDay = config.cycleStartDay || 1;
  const cycle = useMemo(() => shiftCycle(today, startDay, cycleOffset),
    [today, startDay, cycleOffset]);
  const past = cycle.end < today;
  const future = cycle.start > today;
  const cycleToday = past ? cycle.end : future ? cycle.start : today;

  const m = useMemo(() => computeMetrics({ tx, config, cycle, today, past, future }),
    [tx, config, cycle, today, past, future]);

  const flags = useMemo(() => {
    const out = [];
    for (const c of config.categories) {
      const budget = Number(c.budget) || 0;
      if (budget <= 0) continue;
      const spent = m.byCat[c.id] || 0;
      if (spent > budget) { out.push({ c, level: "over", over: spent - budget }); continue; }
      if (m.through > 0.15 && spent / budget > m.through + 0.2) {
        out.push({ c, level: "warn", spent });
      }
    }
    return out.sort((a, b) => (a.level === "over" ? -1 : 1));
  }, [config.categories, m]);

  const cycleLabel = cycleOffset === 0 ? "This cycle"
    : `${fmtDay(cycle.start)} \u2013 ${fmtDay(cycle.end)}`;

  /* The panes ride with your finger rather than animating after it. */
  const trackRef = useRef(null);
  const swipe = useRef({ x: 0, y: 0, live: false, axis: null, w: 0 });
  const [dragging, setDragging] = useState(false);
  const frame = useRef(0);
  const tabIndex = TABS.indexOf(tab);

  const [pillMoving, setPillMoving] = useState(false);
  useEffect(() => {
    setPillMoving(true);
    const t = setTimeout(() => setPillMoving(false), 200);
    return () => clearTimeout(t);
  }, [tab]);

  const setTrack = (px, animate) => {
    const el = trackRef.current;
    if (!el) return;
    if (animate) {
      cancelAnimationFrame(frame.current);
      el.style.transition = "transform .26s cubic-bezier(.22,.61,.36,1)";
      el.style.transform = `translate3d(calc(-33.3333% + ${px}px), 0, 0)`;
      return;
    }
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      el.style.transition = "none";
      el.style.transform = `translate3d(calc(-33.3333% + ${px}px), 0, 0)`;
    });
  };

  const onTouchStart = (e) => {
    if (e.touches.length !== 1) return;
    /* Anything marked as owning its own horizontal drag keeps it — otherwise
       the tab swipe swallows the gesture before the chart ever sees it. */
    if (e.target && e.target.closest && e.target.closest("[data-owns-drag]")) {
      swipe.current = { live: false };
      return;
    }
    swipe.current = { x: e.touches[0].clientX, y: e.touches[0].clientY,
      live: true, axis: null, w: window.innerWidth };
    if (!dragging) setDragging(true);
  };

  const onTouchMove = (e) => {
    const st = swipe.current;
    if (!st.live || e.touches.length !== 1) return;
    if (st.axis === "y") return;
    const dx = e.touches[0].clientX - st.x;
    const dy = e.touches[0].clientY - st.y;
    if (!st.axis) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      st.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? "x" : "y";
    }
    if (st.axis !== "x") return;
    // resist at the ends so it's obvious there's nothing beyond
    let move = dx;
    if ((tabIndex === 0 && dx > 0) || (tabIndex === TABS.length - 1 && dx < 0)) move = dx * 0.28;
    setTrack(move, false);
  };

  const finish = (e) => {
    const st = swipe.current;
    if (!st.live) return;
    st.live = false;
    if (st.axis !== "x") { setDragging(false); return; }
    const t = (e.changedTouches && e.changedTouches[0]) || null;
    const dx = t ? t.clientX - st.x : 0;
    const far = Math.abs(dx) > Math.min(90, st.w * 0.22);
    const target = dx < 0 ? tabIndex + 1 : tabIndex - 1;
    if (!(far && target >= 0 && target < TABS.length)) {
      setTrack(0, true);
      setTimeout(() => setDragging(false), 260);
      return;
    }
    setTrack(dx < 0 ? -st.w : st.w, true);
    setTimeout(() => { setTab(TABS[target]); setDragging(false); setTrack(0, false); }, 260);
  };

  const shared = { config, saveConfig, tx, saveTx, today, cycle, m, flags, setTab,
    cycleOffset, setCycleOffset, cycleLabel, cycleToday, theme, setTheme,
    draft, setDraft, kind, setKind, payWith, setPayWith, incomeSrc, setIncomeSrc,
    splitN, setSplitN, splitStart, setSplitStart, doneFlags, setDoneFlags,
    aiOn: !!getDeviceKey(), learn };

  const renderTab = (id) =>
    id === "home" ? <Home {...shared} />
      : id === "history" ? <History {...shared} />
      : id === "cards" ? <Cards {...shared} />
      : <Setup {...shared} />;

  return (
    <div className={`app ${isLight ? "light" : ""}`}>
      <style>{CSS}</style>
      <UpdateBanner />

      <button className="themeDial"
        aria-label={isLight ? "Switch to dark" : "Switch to light"}
        onClick={() => {
          const next = isLight ? "dark" : "light";
          setTheme(next);
          storage.set("wallet-theme", next).catch(() => {});
        }}>
        {isLight ? <Moon size={17} /> : <Sun size={17} />}
      </button>

      <div className="wrap" onTouchStart={onTouchStart} onTouchMove={onTouchMove}
        onTouchEnd={finish} onTouchCancel={finish}>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
          <SyncBadge />
        </div>

        {!ready
          ? <div className="empty" style={{ textAlign: "center", paddingTop: 60 }}>
              <Loader2 size={20} className="spin" /><div>Opening your wallet…</div>
            </div>
          : (
            <div className={`swipeView ${dragging ? "dragging" : ""}`}>
              <div className="track" ref={trackRef}>
                <div className="pane" aria-hidden={dragging ? undefined : "true"}>
                  {dragging && tabIndex > 0 && (
                    <Boundary key={`prev-${TABS[tabIndex - 1]}`}>{renderTab(TABS[tabIndex - 1])}</Boundary>
                  )}
                </div>
                <div className="pane">
                  <Boundary key={tab}>{renderTab(tab)}</Boundary>
                </div>
                <div className="pane" aria-hidden={dragging ? undefined : "true"}>
                  {dragging && tabIndex < TABS.length - 1 && (
                    <Boundary key={`next-${TABS[tabIndex + 1]}`}>{renderTab(TABS[tabIndex + 1])}</Boundary>
                  )}
                </div>
              </div>
            </div>
          )}
      </div>

      <nav className="nav"><div className="navIn">
        {/* A pill that slides to whatever you picked. Colour alone doesn't say
            "this moved" — something has to travel. */}
        <span className={`navPill ${pillMoving ? "moving" : ""}`}
          style={{ left: `calc(${tabIndex} * 25% + 4px)` }} />
        {[["home", Wallet, "Wallet"], ["cards", CreditCard, "Cards"],
          ["history", ScrollText, "History"], ["setup", SlidersHorizontal, "Plan"]].map(([id, Icon, label]) => (
          <button key={id} className={`navBtn ${tab === id ? "on" : ""}`}
            onClick={(e) => {
              const b = e.currentTarget.getBoundingClientRect();
              const dot = document.createElement("span");
              dot.className = "ripple";
              dot.style.left = `${e.clientX - b.left}px`;
              dot.style.top = `${e.clientY - b.top}px`;
              e.currentTarget.appendChild(dot);
              setTimeout(() => dot.remove(), 620);
              setTab(id);
            }}>
            <Icon size={19} />{label}
          </button>
        ))}
      </div></nav>
    </div>
  );
}
