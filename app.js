"use strict";

/* ============================================================
   マンション購入シミュレーター
   - 夫・妻・家庭(共通口座) の3つの財布モデル
   - 状態は単一の state に集約。localStorage 自動保存 / URL(#) で共有
   ============================================================ */

// ---- 既定値 -------------------------------------------------
const DEFAULTS = {
  mode: "couple", // "couple" | "single"

  // 物件・ローン（共通）
  price: 5000, down: 500, feeRate: 7, rate: 1.0, loanYears: 35,

  // 世帯まとめ（single）
  income1: 600, income2: 400, savings: 800,
  nisaInit: 200, nisaMonthly: 100000, nisaGrowth: 4,
  costs: [
    { label: "食費", value: 70000 },
    { label: "生活維持費（光熱・通信・日用品）", value: 80000 },
    { label: "子育て・教育費", value: 50000 },
    { label: "その他・予備費", value: 30000 },
  ],

  // 夫婦別（couple）
  husband: {
    income: 600, savings: 400, contribution: 250000,
    nisaInit: 100, nisaMonthly: 50000, nisaGrowth: 4,
    costs: [{ label: "お小遣い・個人費", value: 40000 }],
  },
  wife: {
    income: 400, savings: 400, contribution: 150000,
    nisaInit: 100, nisaMonthly: 30000, nisaGrowth: 4,
    costs: [{ label: "お小遣い・個人費", value: 30000 }],
  },
  household: {
    savings: 100,
    costs: [
      { label: "食費", value: 70000 },
      { label: "生活維持費（光熱・通信・日用品）", value: 80000 },
      { label: "子育て・教育費", value: 50000 },
      { label: "その他・予備費", value: 30000 },
    ],
  },
};

// ---- フォーマッタ -------------------------------------------
const fmtMan = (v) => v.toLocaleString("ja-JP") + "万円";
const fmtPct = (v) => v + "%";
const fmtYear = (v) => v + "年";
const yen = (n) => "¥" + Math.round(n).toLocaleString("ja-JP");
const signedYen = (n) => (n >= 0 ? "+" : "−") + "¥" + Math.abs(Math.round(n)).toLocaleString("ja-JP");
const man = (n) => Math.round(n).toLocaleString("ja-JP") + "万円";

// ============================================================
//  状態：load / save / share
// ============================================================
function clone(o) { return JSON.parse(JSON.stringify(o)); }
function sum(arr) { return arr.reduce((a, c) => a + (Number(c.value) || 0), 0); }

function sanitizeCosts(raw, fallback) {
  if (!Array.isArray(raw)) return clone(fallback);
  return raw.filter((c) => c && typeof c === "object")
    .map((c) => ({ label: String(c.label ?? "項目"), value: Number(c.value) || 0 }));
}
function sanitizePerson(raw, def) {
  const p = clone(def);
  if (raw && typeof raw === "object") {
    for (const k of ["income", "savings", "contribution", "nisaInit", "nisaMonthly", "nisaGrowth"]) {
      if (typeof raw[k] === "number" && isFinite(raw[k])) p[k] = raw[k];
    }
    p.costs = sanitizeCosts(raw.costs, def.costs);
  }
  return p;
}
function sanitize(raw) {
  const s = clone(DEFAULTS);
  if (raw && typeof raw === "object") {
    if (raw.mode === "single" || raw.mode === "couple") s.mode = raw.mode;
    for (const k of ["price", "down", "feeRate", "rate", "loanYears", "income1", "income2", "savings", "nisaInit", "nisaMonthly", "nisaGrowth"]) {
      if (typeof raw[k] === "number" && isFinite(raw[k])) s[k] = raw[k];
    }
    s.costs = sanitizeCosts(raw.costs, DEFAULTS.costs);
    s.husband = sanitizePerson(raw.husband, DEFAULTS.husband);
    s.wife = sanitizePerson(raw.wife, DEFAULTS.wife);
    s.household = { savings: 0, costs: [] };
    s.household.savings = (raw.household && typeof raw.household.savings === "number") ? raw.household.savings : DEFAULTS.household.savings;
    s.household.costs = sanitizeCosts(raw.household && raw.household.costs, DEFAULTS.household.costs);
  }
  return s;
}

function encodeState(s) { return btoa(unescape(encodeURIComponent(JSON.stringify(s)))); }
function decodeState(str) {
  try { return sanitize(JSON.parse(decodeURIComponent(escape(atob(str))))); }
  catch (e) { return null; }
}

const LS_KEY = "mansion-sim:v3";
function loadState() {
  const hash = location.hash.replace(/^#/, "");
  if (hash) { const h = decodeState(hash); if (h) return h; }
  try {
    const stored = localStorage.getItem(LS_KEY);
    if (stored) { const p = decodeState(stored); if (p) return p; }
  } catch (e) {}
  return clone(DEFAULTS);
}
function saveState() { try { localStorage.setItem(LS_KEY, encodeState(state)); } catch (e) {} }

let state = loadState();

// ============================================================
//  計算
// ============================================================
function loanCalc(s) {
  const fee = s.price * (s.feeRate / 100);
  const loan = Math.max(0, (s.price - s.down + fee) * 10000);
  const r = s.rate / 100 / 12, n = s.loanYears * 12;
  let monthlyLoan = r === 0 ? loan / n : (loan * (r * Math.pow(1 + r, n))) / (Math.pow(1 + r, n) - 1);
  monthlyLoan = Math.round(monthlyLoan) || 0;
  const mgmtFee = Math.round((s.price * 10000 * 0.0025) / 12) + 15000;
  const totalInterest = monthlyLoan * n - loan;
  return { fee, loan, monthlyLoan, mgmtFee, housing: monthlyLoan + mgmtFee, totalInterest };
}

function computeSingle(s) {
  const L = loanCalc(s);
  const netMonthly = Math.round(((s.income1 + s.income2) * 10000 / 12) * 0.78);
  const livingCost = sum(s.costs);
  const totalOut = L.housing + livingCost + (Number(s.nisaMonthly) || 0);
  const balance = netMonthly - totalOut;
  const burdenRate = netMonthly > 0 ? (L.housing / netMonthly) * 100 : 0;
  return { ...L, netMonthly, livingCost, totalOut, balance, burdenRate };
}

function personCalc(p) {
  const net = Math.round((p.income * 10000 / 12) * 0.78);
  const personalCosts = sum(p.costs);
  const contribution = Number(p.contribution) || 0;
  const nisaMonthly = Number(p.nisaMonthly) || 0;
  const out = contribution + personalCosts + nisaMonthly;
  return { net, personalCosts, contribution, nisaMonthly, out, balance: net - out };
}

function computeCouple(s) {
  const L = loanCalc(s);
  const h = personCalc(s.husband);
  const w = personCalc(s.wife);
  const hhIncome = h.contribution + w.contribution;
  const hhCosts = sum(s.household.costs);
  const hhOut = L.housing + hhCosts;
  const hhBalance = hhIncome - hhOut;
  const burdenRate = (h.net + w.net) > 0 ? (L.housing / (h.net + w.net)) * 100 : 0;
  return { ...L, h, w, hhIncome, hhCosts, hhOut, hhBalance, burdenRate };
}

// ---- 推移 ----
function projectSingle(s, c) {
  const r = s.rate / 100 / 12, g = s.nisaGrowth / 100 / 12;
  let bal = c.loan, cash = s.savings * 10000, nisa = s.nisaInit * 10000;
  const data = [];
  for (let y = 0; y <= s.loanYears; y++) {
    data.push({ year: y, loanRemain: Math.max(0, Math.round(bal / 10000)), cash: Math.round(cash / 10000), nisa: Math.round(nisa / 10000) });
    for (let m = 0; m < 12; m++) { bal = Math.max(0, bal * (1 + r) - c.monthlyLoan); cash += c.balance; nisa = nisa * (1 + g) + (Number(s.nisaMonthly) || 0); }
  }
  return data;
}
function projectCouple(s, c) {
  const r = s.rate / 100 / 12;
  const hg = s.husband.nisaGrowth / 100 / 12, wg = s.wife.nisaGrowth / 100 / 12;
  let bal = c.loan;
  let hSav = s.husband.savings * 10000, hNisa = s.husband.nisaInit * 10000;
  let wSav = s.wife.savings * 10000, wNisa = s.wife.nisaInit * 10000;
  let hhSav = s.household.savings * 10000;
  const data = [];
  for (let y = 0; y <= s.loanYears; y++) {
    data.push({
      year: y,
      loanRemain: Math.max(0, Math.round(bal / 10000)),
      hSav: Math.round(hSav / 10000), hNisa: Math.round(hNisa / 10000),
      wSav: Math.round(wSav / 10000), wNisa: Math.round(wNisa / 10000),
      hhSav: Math.round(hhSav / 10000),
    });
    for (let m = 0; m < 12; m++) {
      bal = Math.max(0, bal * (1 + r) - c.monthlyLoan);
      hSav += c.h.balance; hNisa = hNisa * (1 + hg) + c.h.nisaMonthly;
      wSav += c.w.balance; wNisa = wNisa * (1 + wg) + c.w.nisaMonthly;
      hhSav += c.hhBalance;
    }
  }
  return data;
}

// ============================================================
//  DOM ヘルパ
// ============================================================
const $ = (s) => document.querySelector(s);
function elh(tag, cls, html) { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }

const CHEV = '<svg class="chev" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

let liveRefs = []; // [{el, get}] -> 値ラベルの即時更新

function accordion({ title, hint, tag, sub, tint, open }) {
  const acc = elh("div", (sub ? "acc sub" : "acc") + (tint ? " tint-" + tint : "") + (open ? " open" : ""));
  const head = elh("button", "acc-head");
  head.type = "button";
  const tagDot = tag ? `<span class="tag" style="background:${tag}"></span>` : "";
  head.innerHTML = `<span class="acc-title">${tagDot}${title}</span>` + (hint ? `<span class="acc-hint">${hint}</span>` : `<span style="flex:1"></span>`) + CHEV;
  const wrap = elh("div", "acc-wrap");
  const inner = elh("div", "acc-inner");
  const pad = elh("div", "acc-pad");
  inner.append(pad); wrap.append(inner); acc.append(head, wrap);
  head.addEventListener("click", () => acc.classList.toggle("open"));
  return { acc, body: pad };
}

// スライダー生成： path = 値の場所
function slider(def, get, set, tintClass) {
  const wrap = elh("div", "slider");
  const head = elh("div", "slider-head");
  const label = elh("span", "slider-label", def.label);
  const val = elh("span", "slider-val" + (tintClass ? " " + tintClass : ""));
  head.append(label, val);
  const input = document.createElement("input");
  input.type = "range"; input.className = "range" + (def.rangeCls ? " " + def.rangeCls : "");
  input.min = def.min; input.max = def.max; input.step = def.step; input.value = get();
  input.addEventListener("input", () => { set(Number(input.value)); update(); });
  wrap.append(head, input);
  const refresh = () => {
    if (def.dynMax) input.max = def.dynMax();
    const v = get();
    if (Number(input.value) !== v) input.value = v;
    val.textContent = def.fmt(v);
  };
  refresh();
  liveRefs.push({ refresh });
  return wrap;
}

// コスト一覧（編集・追加・削除）
function costList(arr, opts) {
  opts = opts || {};
  const box = elh("div", "cost-list");
  const render = () => {
    box.innerHTML = "";
    arr.forEach((c, i) => {
      const isFixed = opts.fixedFirst && i === 0;
      const row = elh("div", "cost-row" + (isFixed ? " fixed" : ""));
      const label = document.createElement("input");
      label.type = "text"; label.className = "cost-label"; label.value = c.label;
      if (isFixed) label.readOnly = true;
      label.addEventListener("input", () => { arr[i].label = label.value; saveState(); });
      const amount = elh("div", "cost-amount", '<span class="yen">¥</span>');
      const num = document.createElement("input");
      num.type = "number"; num.className = "cost-input"; num.value = c.value; num.min = 0; num.inputMode = "numeric";
      num.addEventListener("input", () => { arr[i].value = num.value === "" ? 0 : Number(num.value); update(); });
      amount.append(num);
      row.append(label, amount);
      if (isFixed) { row.append(elh("span", "cost-fixed-tag", "固定")); }
      else {
        const del = elh("button", "cost-del", "−"); del.type = "button"; del.title = "削除";
        del.addEventListener("click", () => { arr.splice(i, 1); render(); update(); });
        row.append(del);
      }
      box.append(row);
    });
    const add = elh("button", "btn-add", "＋ 項目を追加"); add.type = "button";
    add.addEventListener("click", () => { arr.push({ label: "新しい項目", value: 0 }); render(); update(); });
    box.append(add);
  };
  render();
  return box;
}

function noteEl(getHtml) {
  const p = elh("p", "note");
  const refresh = () => { p.innerHTML = getHtml(); };
  refresh(); liveRefs.push({ refresh });
  return p;
}

// ============================================================
//  詳細設定の描画
// ============================================================
function renderDetails() {
  liveRefs = liveRefs.filter((r) => r.persistent); // 全消去（スライダー等は作り直す）
  liveRefs = [];
  const root = $("#details-root");
  root.innerHTML = "";
  const outer = accordion({ title: "詳細設定", hint: state.mode === "couple" ? "物件・夫・妻・家庭の財布" : "頭金・金利・年収・生活費・NISA", open: true });
  root.append(outer.acc);
  const body = outer.body;

  // 物件とローン（共通）
  const loanSec = accordion({ title: "物件とローン", sub: true, tint: "loan", open: true });
  loanSec.body.append(
    slider({ label: "頭金", min: 0, max: 5000, step: 10, fmt: fmtMan, dynMax: () => Math.min(state.price, 5000) }, () => state.down, (v) => state.down = v),
    slider({ label: "諸費用（物件価格に対する割合）", min: 3, max: 10, step: 0.5, fmt: fmtPct }, () => state.feeRate, (v) => state.feeRate = v),
    slider({ label: "住宅ローン金利（年）", min: 0.3, max: 4, step: 0.1, fmt: fmtPct }, () => state.rate, (v) => state.rate = v),
    slider({ label: "返済年数", min: 10, max: 40, step: 1, fmt: fmtYear }, () => state.loanYears, (v) => state.loanYears = v),
    noteEl(() => { const L = loanCalc(state); return `借入額 <b>${man(L.loan / 10000)}</b>（諸費用込）／ 毎月返済 <b>${yen(L.monthlyLoan)}</b>／ 総利息 <b>${yen(L.totalInterest)}</b>`; })
  );
  body.append(loanSec.acc);

  if (state.mode === "couple") {
    body.append(personSection("husband", "夫", "var(--husband)", "h", "v-wife".replace("wife", "")));
    body.append(personSection("wife", "妻", "var(--wife)", "w", "v-wife", "r-wife"));

    // 家庭（共通口座）
    const hh = accordion({ title: "家庭（共通口座）", tag: "var(--home)", sub: true, tint: "hh", open: false });
    hh.body.append(
      slider({ label: "共通口座の現在残高", min: 0, max: 5000, step: 10, fmt: fmtMan, rangeCls: "r-home" }, () => state.household.savings, (v) => state.household.savings = v, "v-home"),
      elh("p", "note", "下の家庭の生活費に加え、<b>管理費・修繕積立</b>とローン返済が共通口座から出ていきます。"),
      sectionLabel("家庭の生活費（共通）"),
      costList(state.household.costs),
      noteEl(() => { const c = computeCouple(state); return `共通口座 収入 <b>${yen(c.hhIncome)}</b>（夫＋妻の拠出）／ 支出 <b>${yen(c.hhOut)}</b> → 収支 <b style="color:${c.hhBalance >= 0 ? "var(--pos)" : "var(--neg)"}">${signedYen(c.hhBalance)}</b>`; })
    );
    body.append(hh.acc);
  } else {
    // 世帯まとめ
    const inc = accordion({ title: "夫婦の年収（額面）", sub: true, open: false });
    inc.body.append(
      slider({ label: "夫または妻① 年収", min: 0, max: 2000, step: 10, fmt: fmtMan }, () => state.income1, (v) => state.income1 = v),
      slider({ label: "夫または妻② 年収", min: 0, max: 2000, step: 10, fmt: fmtMan }, () => state.income2, (v) => state.income2 = v),
      noteEl(() => `世帯手取り（概算） <b>${yen(computeSingle(state).netMonthly)}</b> / 月`)
    );
    body.append(inc.acc);

    const sav = accordion({ title: "初期貯蓄", sub: true, open: false });
    sav.body.append(slider({ label: "現在の貯蓄額（貯金グラフの起点）", min: 0, max: 8000, step: 10, fmt: fmtMan }, () => state.savings, (v) => state.savings = v));
    body.append(sav.acc);

    const cost = accordion({ title: "毎月の生活コスト", sub: true, open: false });
    cost.body.append(costList(state.costs), noteEl(() => `生活費合計 <b>${yen(computeSingle(state).livingCost)}</b> / 月`));
    body.append(cost.acc);

    const nisa = accordion({ title: "NISA投資（別枠）", sub: true, open: false });
    nisa.body.append(
      slider({ label: "初期投資額（すでに投資済の額）", min: 0, max: 5000, step: 10, fmt: fmtMan }, () => state.nisaInit, (v) => state.nisaInit = v),
      slider({ label: "毎月の積立額", min: 0, max: 300000, step: 5000, fmt: yen }, () => state.nisaMonthly, (v) => state.nisaMonthly = v),
      slider({ label: "想定成長率（年）", min: 0, max: 10, step: 0.5, fmt: fmtPct }, () => state.nisaGrowth, (v) => state.nisaGrowth = v),
      noteEl(() => { const d = projectSingle(state, computeSingle(state)); return `${state.loanYears}年後のNISA資産（予想） <b style="color:var(--nisa)">${man(d[d.length - 1].nisa)}</b>`; })
    );
    body.append(nisa.acc);
  }
}

function sectionLabel(text) { return elh("div", "slider-label", text); }

function personSection(key, name, color, tintSuffix, valCls, rangeCls) {
  const p = state[key];
  const sec = accordion({ title: name, tag: color, sub: true, tint: tintSuffix, open: key === "husband" });
  sec.body.append(
    slider({ label: name + " 年収（額面）", min: 0, max: 2000, step: 10, fmt: fmtMan, rangeCls }, () => p.income, (v) => p.income = v, valCls),
    slider({ label: "現在の貯蓄額", min: 0, max: 8000, step: 10, fmt: fmtMan, rangeCls }, () => p.savings, (v) => p.savings = v, valCls),
    sectionLabel("毎月の生活コスト"),
    elh("p", "note", "一番上の<b>「共通口座へ拠出」</b>は固定項目です。ここからローン・家庭の生活費がまかなわれます。"),
    costListWithFixed(p),
    sectionLabel("NISA投資（個人）"),
    slider({ label: "初期投資額", min: 0, max: 5000, step: 10, fmt: fmtMan, rangeCls }, () => p.nisaInit, (v) => p.nisaInit = v, valCls),
    slider({ label: "毎月の積立額", min: 0, max: 300000, step: 5000, fmt: yen, rangeCls }, () => p.nisaMonthly, (v) => p.nisaMonthly = v, valCls),
    slider({ label: "想定成長率（年）", min: 0, max: 10, step: 0.5, fmt: fmtPct, rangeCls }, () => p.nisaGrowth, (v) => p.nisaGrowth = v, valCls),
    noteEl(() => { const pc = personCalc(p); return `手取り <b>${yen(pc.net)}</b> − 拠出 <b>${yen(pc.contribution)}</b> − 個人支出 <b>${yen(pc.personalCosts)}</b> − NISA <b>${yen(pc.nisaMonthly)}</b> → 収支 <b style="color:${pc.balance >= 0 ? "var(--pos)" : "var(--neg)"}">${signedYen(pc.balance)}</b>`; })
  );
  return sec.acc;
}

// 拠出を固定先頭にしたコスト一覧（personの contribution と costs を結合表示）
function costListWithFixed(p) {
  // 仮想配列：[0]=拠出(固定), 以降=p.costs
  const proxy = [{ label: "共通口座へ拠出", value: p.contribution, _fixed: true }, ...p.costs];
  const box = elh("div", "cost-list");
  const render = () => {
    box.innerHTML = "";
    proxy.forEach((c, i) => {
      const isFixed = i === 0;
      const row = elh("div", "cost-row" + (isFixed ? " fixed" : ""));
      const label = document.createElement("input");
      label.type = "text"; label.className = "cost-label"; label.value = c.label;
      if (isFixed) label.readOnly = true;
      else label.addEventListener("input", () => { p.costs[i - 1].label = label.value; saveState(); });
      const amount = elh("div", "cost-amount", '<span class="yen">¥</span>');
      const num = document.createElement("input");
      num.type = "number"; num.className = "cost-input"; num.value = c.value; num.min = 0; num.inputMode = "numeric";
      num.addEventListener("input", () => {
        const v = num.value === "" ? 0 : Number(num.value);
        if (isFixed) p.contribution = v; else p.costs[i - 1].value = v;
        update();
      });
      amount.append(num); row.append(label, amount);
      if (isFixed) row.append(elh("span", "cost-fixed-tag", "固定"));
      else {
        const del = elh("button", "cost-del", "−"); del.type = "button"; del.title = "削除";
        del.addEventListener("click", () => { p.costs.splice(i - 1, 1); proxy.splice(i, 1); render(); update(); });
        row.append(del);
      }
      box.append(row);
    });
    const add = elh("button", "btn-add", "＋ 項目を追加"); add.type = "button";
    add.addEventListener("click", () => { const item = { label: "新しい項目", value: 0 }; p.costs.push(item); proxy.push(item); render(); update(); });
    box.append(add);
  };
  render();
  return box;
}

// ============================================================
//  サマリー
// ============================================================
function renderSummary() {
  const el = $("#summary");
  if (state.mode === "couple") {
    const c = computeCouple(state);
    const pos = c.hhBalance >= 0;
    el.innerHTML = `
      <div class="summary-top">
        <div>
          <div class="summary-key">家庭（共通口座）の月収支</div>
          <div class="summary-balance ${pos ? "pos" : "neg"}">${signedYen(c.hhBalance)}</div>
        </div>
        <div class="summary-secondary">
          <div class="summary-key">毎月のローン返済</div>
          <div class="summary-loan">${yen(c.monthlyLoan)}</div>
          <div class="summary-sub">＋管理費等 ${yen(c.mgmtFee)}</div>
        </div>
      </div>
      <div class="mini-row">
        <div class="mini h"><div class="mini-label"><i></i>夫</div><div class="mini-val ${c.h.balance >= 0 ? "pos" : "neg"}">${signedYen(c.h.balance)}</div></div>
        <div class="mini w"><div class="mini-label"><i></i>妻</div><div class="mini-val ${c.w.balance >= 0 ? "pos" : "neg"}">${signedYen(c.w.balance)}</div></div>
        <div class="mini hh"><div class="mini-label"><i></i>家庭</div><div class="mini-val ${pos ? "pos" : "neg"}">${signedYen(c.hhBalance)}</div></div>
      </div>
      <div class="summary-foot">
        <span>住居費の負担率 <b class="${c.burdenRate > 30 ? "warn" : "ok"}">${c.burdenRate.toFixed(1)}%</b><span class="muted"> 世帯手取り比・25%以下が目安</span></span>
        <span class="dot">·</span>
        <span>諸費用 <b>${man(c.fee)}</b> 組込</span>
      </div>`;
  } else {
    const c = computeSingle(state);
    const pos = c.balance >= 0;
    el.innerHTML = `
      <div class="summary-top">
        <div>
          <div class="summary-key">毎月の収支<span class="muted"> 手取り − 支出 − NISA</span></div>
          <div class="summary-balance ${pos ? "pos" : "neg"}">${signedYen(c.balance)}</div>
        </div>
        <div class="summary-secondary">
          <div class="summary-key">毎月のローン返済</div>
          <div class="summary-loan">${yen(c.monthlyLoan)}</div>
          <div class="summary-sub">＋管理費等 ${yen(c.mgmtFee)}</div>
        </div>
      </div>
      <div class="summary-foot">
        <span>住居費の負担率 <b class="${c.burdenRate > 30 ? "warn" : "ok"}">${c.burdenRate.toFixed(1)}%</b><span class="muted"> 25%以下が目安・30%超は注意</span></span>
        <span class="dot">·</span>
        <span>諸費用 <b>${man(c.fee)}</b> 組込</span>
      </div>`;
  }
}

// ============================================================
//  支出内訳
// ============================================================
function bdRows(rows) {
  return rows.map((r) => {
    const cls = r.total ? "row total" : (r.income ? "row income" : "row");
    const valCls = r.total ? ("row-val " + (r.val >= 0 ? "pos" : "neg")) : "row-val";
    return `<div class="${cls}"><span>${r.label}</span><span class="${valCls}">${r.signed ? signedYen(r.val) : yen(r.val)}</span></div>`;
  }).join("");
}
function renderBreakdown() {
  const root = $("#breakdown-root");
  root.innerHTML = "";
  if (state.mode === "couple") {
    const c = computeCouple(state);
    const card = elh("section", "card");
    card.innerHTML = `<h2 class="block-title" style="font-size:14px;font-weight:700;margin:0 0 14px">月の収支内訳（3つの財布）</h2>
      <div class="bd-block">
        <div class="bd-head"><i style="background:var(--home)"></i>家庭（共通口座）</div>
        <div class="rows">${bdRows([
          { label: "夫＋妻の拠出", val: c.hhIncome, income: true },
          { label: "ローン返済", val: -c.monthlyLoan },
          { label: "管理費・修繕積立等", val: -c.mgmtFee },
          { label: "家庭の生活費", val: -c.hhCosts },
          { label: "家庭の収支", val: c.hhBalance, total: true, signed: true },
        ])}</div>
      </div>
      <div class="bd-block">
        <div class="bd-head"><i style="background:var(--husband)"></i>夫</div>
        <div class="rows">${bdRows([
          { label: "手取り", val: c.h.net, income: true },
          { label: "共通口座へ拠出", val: -c.h.contribution },
          { label: "個人支出", val: -c.h.personalCosts },
          { label: "NISA積立", val: -c.h.nisaMonthly },
          { label: "夫の収支", val: c.h.balance, total: true, signed: true },
        ])}</div>
      </div>
      <div class="bd-block">
        <div class="bd-head"><i style="background:var(--wife)"></i>妻</div>
        <div class="rows">${bdRows([
          { label: "手取り", val: c.w.net, income: true },
          { label: "共通口座へ拠出", val: -c.w.contribution },
          { label: "個人支出", val: -c.w.personalCosts },
          { label: "NISA積立", val: -c.w.nisaMonthly },
          { label: "妻の収支", val: c.w.balance, total: true, signed: true },
        ])}</div>
      </div>`;
    root.append(card);
  } else {
    const c = computeSingle(state);
    const card = elh("section", "card");
    card.innerHTML = `<h2 class="block-title" style="font-size:14px;font-weight:700;margin:0 0 12px">月の支出内訳</h2>
      <div class="rows">${bdRows([
        { label: "ローン返済", val: c.monthlyLoan },
        { label: "管理費・修繕積立等", val: c.mgmtFee },
        { label: "生活費合計", val: c.livingCost },
        { label: "NISA積立", val: Number(state.nisaMonthly) || 0 },
      ]).replace(/−¥/g, "¥")}
      ${`<div class="row total"><span>支出合計</span><span class="row-val">${yen(c.totalOut)}</span></div>
         <div class="row"><span>世帯手取り</span><span class="row-val">${yen(c.netMonthly)}</span></div>`}</div>`;
    root.append(card);
  }
}

// ============================================================
//  チャート（汎用・複数）
// ============================================================
const SVG_NS = "http://www.w3.org/2000/svg";
const VB_W = 720, VB_H = 240, PAD = { l: 46, r: 14, t: 14, b: 26 };
function svgEl(tag, attrs) { const e = document.createElementNS(SVG_NS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; }
function yLabel(v) {
  const a = Math.abs(v);
  if (a >= 10000) return (v / 10000).toFixed(1) + "億";
  return v.toLocaleString("ja-JP") + "万";
}

let charts = []; // {draw}

function createChart(parent, title, tagColor, series) {
  const card = elh("section", "card chart-card");
  const h = elh("h2", "chart-title", (tagColor ? `<span class="tag" style="background:${tagColor}"></span>` : "") + title);
  const legend = elh("div", "legend", series.map((s) => `<span class="legend-item"><i style="background:${s.color}"></i>${s.name}</span>`).join(""));
  const wrap = elh("div", "chart-wrap");
  const svg = svgEl("svg", { viewBox: `0 0 ${VB_W} ${VB_H}`, preserveAspectRatio: "none", class: "chart-svg", role: "img", "aria-label": title });
  const tip = elh("div", "chart-tip"); tip.hidden = true;
  wrap.append(svg, tip);
  card.append(h, legend, wrap);
  parent.append(card);

  let data = [], geom = null, focus = null;

  function draw(d) {
    data = d; svg.innerHTML = "";
    const years = d.length - 1;
    const vals = d.flatMap((row) => series.map((s) => row[s.key]));
    let yMax = Math.max(1, ...vals), yMin = Math.min(0, ...vals);
    const span = yMax - yMin || 1;
    const pw = Math.pow(10, Math.floor(Math.log10(span)));
    yMax = Math.ceil(yMax / pw) * pw; yMin = Math.floor(yMin / pw) * pw;
    const x = (yr) => PAD.l + (yr / years) * (VB_W - PAD.l - PAD.r);
    const y = (v) => PAD.t + (1 - (v - yMin) / (yMax - yMin)) * (VB_H - PAD.t - PAD.b);
    geom = { x, y, years };

    const ticks = 4;
    for (let i = 0; i <= ticks; i++) {
      const v = yMin + ((yMax - yMin) / ticks) * i, yy = y(v);
      svg.append(svgEl("line", { x1: PAD.l, y1: yy, x2: VB_W - PAD.r, y2: yy, stroke: v === 0 ? "#cfd4dd" : "#eef0f3", "stroke-width": v === 0 ? 1.2 : 1 }));
      const t = svgEl("text", { x: PAD.l - 8, y: yy + 3.5, "text-anchor": "end", "font-size": 10, fill: "#aab0bb" });
      t.textContent = yLabel(Math.round(v)); svg.append(t);
    }
    const xStep = years <= 10 ? 2 : 5;
    for (let yr = 0; yr <= years; yr += xStep) {
      const t = svgEl("text", { x: x(yr), y: VB_H - PAD.b + 16, "text-anchor": "middle", "font-size": 10, fill: "#aab0bb" });
      t.textContent = yr + "年"; svg.append(t);
    }
    for (const s of series) {
      const pts = d.map((row) => `${x(row.year).toFixed(1)},${y(row[s.key]).toFixed(1)}`).join(" ");
      svg.append(svgEl("polyline", { points: pts, fill: "none", stroke: s.color, "stroke-width": 2.4, "stroke-linejoin": "round", "stroke-linecap": "round" }));
    }
    const line = svgEl("line", { y1: PAD.t, y2: VB_H - PAD.b, stroke: "#c7ccd6", "stroke-width": 1, "stroke-dasharray": "3 3", opacity: 0 });
    svg.append(line);
    const dots = series.map((s) => { const c = svgEl("circle", { r: 3.6, fill: "#fff", stroke: s.color, "stroke-width": 2, opacity: 0 }); svg.append(c); return c; });
    focus = { line, dots };
  }

  function move(evt) {
    if (!geom) return;
    const rect = svg.getBoundingClientRect();
    const cx = evt.touches ? evt.touches[0].clientX : evt.clientX;
    const px = ((cx - rect.left) / rect.width) * VB_W;
    let yr = Math.round(((px - PAD.l) / (VB_W - PAD.l - PAD.r)) * geom.years);
    yr = Math.max(0, Math.min(geom.years, yr));
    const row = data[yr]; if (!row) return;
    const fx = geom.x(yr);
    focus.line.setAttribute("x1", fx); focus.line.setAttribute("x2", fx); focus.line.setAttribute("opacity", 1);
    series.forEach((s, i) => { focus.dots[i].setAttribute("cx", fx); focus.dots[i].setAttribute("cy", geom.y(row[s.key])); focus.dots[i].setAttribute("opacity", 1); });
    tip.hidden = false;
    tip.innerHTML = `<div class="tip-year">${yr}年後</div>` + series.map((s) => `<div class="tip-line"><i style="background:${s.color}"></i>${s.name} ${man(row[s.key])}</div>`).join("");
    const wr = wrap.getBoundingClientRect();
    tip.style.left = (fx / VB_W) * wr.width + "px";
    tip.style.top = ((PAD.t / VB_H) * wr.height + 8) + "px";
  }
  function leave() { tip.hidden = true; if (focus) { focus.line.setAttribute("opacity", 0); focus.dots.forEach((d) => d.setAttribute("opacity", 0)); } }
  svg.addEventListener("mousemove", move); svg.addEventListener("mouseleave", leave);
  svg.addEventListener("touchmove", move, { passive: true }); svg.addEventListener("touchend", leave);

  return { draw };
}

function renderCharts() {
  const root = $("#charts-root");
  root.innerHTML = ""; charts = [];
  if (state.mode === "couple") {
    charts.push(createChart(root, "家庭（共通口座）の推移", "var(--home)", [
      { key: "loanRemain", name: "ローン残債", color: "#e5484d" },
      { key: "hhSav", name: "家庭の貯金", color: "var(--home)" },
    ]));
    charts.push(createChart(root, "夫の資産", "var(--husband)", [
      { key: "hSav", name: "貯金", color: "var(--husband)" },
      { key: "hNisa", name: "NISA資産", color: "var(--nisa)" },
    ]));
    charts.push(createChart(root, "妻の資産", "var(--wife)", [
      { key: "wSav", name: "貯金", color: "var(--wife)" },
      { key: "wNisa", name: "NISA資産", color: "var(--nisa)" },
    ]));
  } else {
    charts.push(createChart(root, "資産とローンの推移", null, [
      { key: "loanRemain", name: "ローン残債", color: "#e5484d" },
      { key: "cash", name: "貯金", color: "#3b6ef5" },
      { key: "nisa", name: "NISA資産", color: "#0fa968" },
    ]));
  }
  drawCharts();
}
function drawCharts() {
  const data = state.mode === "couple" ? projectCouple(state, computeCouple(state)) : projectSingle(state, computeSingle(state));
  charts.forEach((c) => c.draw(data));
}

// ============================================================
//  更新（値の即時反映）
// ============================================================
function update() {
  renderSummary();
  renderBreakdown();
  liveRefs.forEach((r) => r.refresh());
  $("#price-value").textContent = fmtMan(state.price);
  drawCharts();
  saveState();
}

// 全再構築（モード切替・リセット時）
function renderAll() {
  // モードトグル状態
  $(".mode-toggle").classList.toggle("single", state.mode === "single");
  $("#mode-couple").classList.toggle("active", state.mode === "couple");
  $("#mode-single").classList.toggle("active", state.mode === "single");
  $("#price").value = state.price;
  renderDetails();
  renderSummary();
  renderBreakdown();
  renderCharts();
  $("#price-value").textContent = fmtMan(state.price);
  saveState();
}

// ============================================================
//  イベント
// ============================================================
$("#price").addEventListener("input", (e) => { state.price = Number(e.target.value); update(); });
$("#mode-couple").addEventListener("click", () => { if (state.mode !== "couple") { state.mode = "couple"; renderAll(); } });
$("#mode-single").addEventListener("click", () => { if (state.mode !== "single") { state.mode = "single"; renderAll(); } });

$("#share-btn").addEventListener("click", async () => {
  const url = location.origin + location.pathname + "#" + encodeState(state);
  const msg = $("#share-msg");
  try { await navigator.clipboard.writeText(url); msg.textContent = "✓ リンクをコピーしました"; }
  catch (e) { location.hash = encodeState(state); msg.textContent = "URLをコピーしてください"; }
  setTimeout(() => { msg.textContent = ""; }, 2600);
});

$("#reset-btn").addEventListener("click", () => {
  state = clone(DEFAULTS);
  history.replaceState(null, "", location.pathname);
  renderAll();
});

// 同じタブのアドレスバーに共有URLを貼られた場合（ハッシュ変更）も反映
window.addEventListener("hashchange", () => {
  const h = location.hash.replace(/^#/, "");
  if (!h) return;
  const s = decodeState(h);
  if (s) { state = s; history.replaceState(null, "", location.pathname); renderAll(); }
});

// ============================================================
//  起動
// ============================================================
renderAll();
if (location.hash) history.replaceState(null, "", location.pathname);
