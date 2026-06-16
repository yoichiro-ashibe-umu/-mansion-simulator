"use strict";

/* ============================================================
   マンション購入シミュレーター
   - 状態は単一の state オブジェクトに集約
   - localStorage に自動保存／URL(#...) で相方へ共有
   ============================================================ */

// ---- 既定値 -------------------------------------------------
const DEFAULTS = {
  price: 5000,        // 万円
  down: 500,          // 万円
  feeRate: 7,         // %
  rate: 1.0,          // %
  loanYears: 35,      // 年
  income1: 500,       // 万円
  income2: 350,       // 万円
  savings: 800,       // 万円
  nisaInit: 200,      // 万円
  nisaMonthly: 100000,// 円
  nisaGrowth: 4,      // %
  costs: [
    { label: "食費", value: 70000 },
    { label: "生活維持費（光熱・通信・日用品）", value: 80000 },
    { label: "子育て・教育費", value: 50000 },
    { label: "その他・予備費", value: 30000 },
  ],
};

// ---- スライダー定義（詳細設定内で生成） --------------------
const fmtMan = (v) => v.toLocaleString("ja-JP") + "万円";
const fmtPct = (v) => v + "%";
const fmtYear = (v) => v + "年";
const yen = (n) => "¥" + Math.round(n).toLocaleString("ja-JP");
const man = (n) => Math.round(n).toLocaleString("ja-JP") + "万円";

const SLIDERS = {
  loan: [
    { key: "down", label: "頭金", min: 0, max: 3000, step: 10, fmt: fmtMan, dynMax: (s) => Math.min(s.price, 3000) },
    { key: "feeRate", label: "諸費用（物件価格に対する割合）", min: 3, max: 10, step: 0.5, fmt: fmtPct },
    { key: "rate", label: "住宅ローン金利（年）", min: 0.3, max: 4, step: 0.1, fmt: fmtPct },
    { key: "loanYears", label: "返済年数", min: 10, max: 40, step: 1, fmt: fmtYear },
  ],
  income: [
    { key: "income1", label: "夫または妻① 年収", min: 0, max: 1500, step: 10, fmt: fmtMan },
    { key: "income2", label: "夫または妻② 年収", min: 0, max: 1500, step: 10, fmt: fmtMan },
  ],
  savings: [
    { key: "savings", label: "現在の貯蓄額（貯金グラフの起点）", min: 0, max: 5000, step: 10, fmt: fmtMan },
  ],
  nisa: [
    { key: "nisaInit", label: "初期投資額（すでに投資済の額）", min: 0, max: 3000, step: 10, fmt: fmtMan },
    { key: "nisaMonthly", label: "毎月の積立額", min: 0, max: 300000, step: 5000, fmt: yen },
    { key: "nisaGrowth", label: "想定成長率（年）", min: 0, max: 10, step: 0.5, fmt: fmtPct },
  ],
};

// ============================================================
//  状態管理：load / save / share
// ============================================================
function clone(o) { return JSON.parse(JSON.stringify(o)); }

function sanitize(raw) {
  // 既定値をベースに、既知のキーだけ安全に取り込む
  const s = clone(DEFAULTS);
  if (raw && typeof raw === "object") {
    for (const k of Object.keys(DEFAULTS)) {
      if (k === "costs") continue;
      if (typeof raw[k] === "number" && isFinite(raw[k])) s[k] = raw[k];
    }
    if (Array.isArray(raw.costs)) {
      s.costs = raw.costs
        .filter((c) => c && typeof c === "object")
        .map((c) => ({ label: String(c.label ?? "項目"), value: Number(c.value) || 0 }));
    }
  }
  return s;
}

function encodeState(s) {
  // JSON → UTF-8安全な base64（URLハッシュ用）
  const json = JSON.stringify(s);
  return btoa(unescape(encodeURIComponent(json)));
}
function decodeState(str) {
  try {
    const json = decodeURIComponent(escape(atob(str)));
    return sanitize(JSON.parse(json));
  } catch (e) {
    return null;
  }
}

const LS_KEY = "mansion-sim:v2";

function loadState() {
  // 優先順位: URLハッシュ > localStorage > 既定値
  const hash = location.hash.replace(/^#/, "");
  if (hash) {
    const fromHash = decodeState(hash);
    if (fromHash) return fromHash;
  }
  try {
    const stored = localStorage.getItem(LS_KEY);
    if (stored) {
      const parsed = decodeState(stored) || sanitize(JSON.parse(stored));
      if (parsed) return parsed;
    }
  } catch (e) { /* ignore */ }
  return clone(DEFAULTS);
}

function saveState() {
  try { localStorage.setItem(LS_KEY, encodeState(state)); } catch (e) { /* ignore */ }
}

let state = loadState();

// ============================================================
//  計算
// ============================================================
function compute(s) {
  const fee = s.price * (s.feeRate / 100);                 // 諸費用 万円
  const loan = Math.max(0, (s.price - s.down + fee) * 10000); // 借入 円
  const r = s.rate / 100 / 12;
  const n = s.loanYears * 12;
  let monthlyLoan = r === 0 ? loan / n : (loan * (r * Math.pow(1 + r, n))) / (Math.pow(1 + r, n) - 1);
  monthlyLoan = Math.round(monthlyLoan) || 0;

  const mgmtFee = Math.round((s.price * 10000 * 0.0025) / 12) + 15000;
  const housingTotal = monthlyLoan + mgmtFee;

  const grossMonthly = ((s.income1 + s.income2) * 10000) / 12;
  const netMonthly = Math.round(grossMonthly * 0.78);

  const livingCost = s.costs.reduce((acc, c) => acc + (Number(c.value) || 0), 0);
  const totalOut = housingTotal + livingCost + (Number(s.nisaMonthly) || 0);
  const balance = netMonthly - totalOut;

  const totalPayment = monthlyLoan * n;
  const totalInterest = totalPayment - loan;
  const burdenRate = netMonthly > 0 ? (housingTotal / netMonthly) * 100 : 0;

  return { fee, loan, monthlyLoan, mgmtFee, housingTotal, netMonthly, livingCost, totalOut, balance, totalInterest, burdenRate };
}

function projection(s, calc) {
  const r = s.rate / 100 / 12;
  const g = s.nisaGrowth / 100 / 12;
  let bal = calc.loan;
  let cash = s.savings * 10000;
  let nisa = s.nisaInit * 10000;
  const data = [];
  for (let y = 0; y <= s.loanYears; y++) {
    data.push({
      year: y,
      loanRemain: Math.max(0, Math.round(bal / 10000)),
      cash: Math.round(cash / 10000),
      nisa: Math.round(nisa / 10000),
    });
    for (let m = 0; m < 12; m++) {
      bal = Math.max(0, bal * (1 + r) - calc.monthlyLoan);
      cash += calc.balance;
      nisa = nisa * (1 + g) + (Number(s.nisaMonthly) || 0);
    }
  }
  return data;
}

// ============================================================
//  DOM 構築：スライダー
// ============================================================
const $ = (sel) => document.querySelector(sel);
const sliderRefs = {}; // key -> { input, val, def }

function buildSliders() {
  for (const group of Object.keys(SLIDERS)) {
    const container = document.querySelector(`.sliders[data-group="${group}"]`);
    container.innerHTML = "";
    for (const def of SLIDERS[group]) {
      const wrap = document.createElement("div");
      wrap.className = "slider";

      const head = document.createElement("div");
      head.className = "slider-head";
      const label = document.createElement("span");
      label.className = "slider-label";
      label.textContent = def.label;
      const val = document.createElement("span");
      val.className = "slider-val";
      head.append(label, val);

      const input = document.createElement("input");
      input.type = "range";
      input.className = "range";
      input.min = def.min; input.max = def.max; input.step = def.step;
      input.value = state[def.key];

      input.addEventListener("input", () => {
        state[def.key] = Number(input.value);
        update();
      });

      wrap.append(head, input);
      container.append(wrap);
      sliderRefs[def.key] = { input, val, def };
    }
  }
}

function refreshSliders() {
  for (const key of Object.keys(sliderRefs)) {
    const { input, val, def } = sliderRefs[key];
    // 動的な上限（頭金は価格に追従）
    if (def.dynMax) input.max = def.dynMax(state);
    if (Number(input.value) !== state[key]) input.value = state[key];
    val.textContent = def.fmt(state[key]);
  }
  // 価格スライダー（ヒーロー）
  priceInput.value = state.price;
  priceValue.textContent = fmtMan(state.price);
}

// ============================================================
//  DOM 構築：生活コスト
// ============================================================
const costList = $("#cost-list");

function renderCosts() {
  costList.innerHTML = "";
  state.costs.forEach((c, i) => {
    const row = document.createElement("div");
    row.className = "cost-row";

    const label = document.createElement("input");
    label.type = "text"; label.className = "cost-label"; label.value = c.label;
    label.addEventListener("input", () => { state.costs[i].label = label.value; saveState(); });

    const amount = document.createElement("div");
    amount.className = "cost-amount";
    const yenMark = document.createElement("span");
    yenMark.className = "yen"; yenMark.textContent = "¥";
    const num = document.createElement("input");
    num.type = "number"; num.className = "cost-input"; num.value = c.value; num.min = 0;
    num.addEventListener("input", () => {
      state.costs[i].value = num.value === "" ? 0 : Number(num.value);
      update();
    });
    amount.append(yenMark, num);

    const del = document.createElement("button");
    del.type = "button"; del.className = "cost-del"; del.textContent = "−"; del.title = "削除";
    del.addEventListener("click", () => { state.costs.splice(i, 1); renderCosts(); update(); });

    row.append(label, amount, del);
    costList.append(row);
  });
}

$("#add-cost").addEventListener("click", () => {
  state.costs.push({ label: "新しい項目", value: 0 });
  renderCosts();
  update();
});

// ============================================================
//  価格スライダー（ヒーロー）
// ============================================================
const priceInput = $("#price");
const priceValue = $("#price-value");
priceInput.addEventListener("input", () => { state.price = Number(priceInput.value); update(); });

// ============================================================
//  グラフ（自作SVG）
// ============================================================
const SVG_NS = "http://www.w3.org/2000/svg";
const chartEl = $("#chart");
const chartWrap = $("#chart-wrap");
const chartTip = $("#chart-tip");
const VB_W = 720, VB_H = 280;
const PAD = { l: 46, r: 14, t: 14, b: 26 };
const SERIES = [
  { key: "loanRemain", name: "ローン残債", color: "#e5484d" },
  { key: "cash", name: "貯金", color: "#3b6ef5" },
  { key: "nisa", name: "NISA資産", color: "#0fa968" },
];
let chartData = [];
let chartGeom = null;

function el(tag, attrs) {
  const e = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}
function yLabel(v) { return Math.abs(v) >= 10000 ? (v / 10000).toFixed(1) + "億" : v.toLocaleString("ja-JP") + "万"; }

function drawChart() {
  chartEl.innerHTML = "";
  const data = chartData;
  const years = data.length - 1;
  const allVals = data.flatMap((d) => SERIES.map((s) => d[s.key]));
  const rawMax = Math.max(1, ...allVals);
  // きりの良い上限
  const pow = Math.pow(10, Math.floor(Math.log10(rawMax)));
  const yMax = Math.ceil(rawMax / pow) * pow;

  const x = (yr) => PAD.l + (yr / years) * (VB_W - PAD.l - PAD.r);
  const y = (v) => PAD.t + (1 - v / yMax) * (VB_H - PAD.t - PAD.b);
  chartGeom = { x, y, years, yMax };

  // 横グリッド + Y軸ラベル
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const v = (yMax / ticks) * i;
    const yy = y(v);
    chartEl.append(el("line", { x1: PAD.l, y1: yy, x2: VB_W - PAD.r, y2: yy, stroke: "#eef0f3", "stroke-width": 1 }));
    const t = el("text", { x: PAD.l - 8, y: yy + 3.5, "text-anchor": "end", "font-size": 10, fill: "#aab0bb" });
    t.textContent = yLabel(Math.round(v));
    chartEl.append(t);
  }

  // X軸ラベル
  const xStep = years <= 10 ? 2 : years <= 20 ? 5 : 5;
  for (let yr = 0; yr <= years; yr += xStep) {
    const t = el("text", { x: x(yr), y: VB_H - PAD.b + 16, "text-anchor": "middle", "font-size": 10, fill: "#aab0bb" });
    t.textContent = yr + "年";
    chartEl.append(t);
  }

  // ライン
  for (const s of SERIES) {
    const pts = data.map((d) => `${x(d.year).toFixed(1)},${y(d[s.key]).toFixed(1)}`).join(" ");
    chartEl.append(el("polyline", { points: pts, fill: "none", stroke: s.color, "stroke-width": 2.4, "stroke-linejoin": "round", "stroke-linecap": "round" }));
  }

  // フォーカス用（hoverで動かす）
  const focusLine = el("line", { id: "focus-line", x1: 0, y1: PAD.t, x2: 0, y2: VB_H - PAD.b, stroke: "#c7ccd6", "stroke-width": 1, "stroke-dasharray": "3 3", opacity: 0 });
  chartEl.append(focusLine);
  const dots = SERIES.map((s) => {
    const c = el("circle", { r: 3.6, fill: "#fff", stroke: s.color, "stroke-width": 2, opacity: 0 });
    chartEl.append(c);
    return c;
  });
  chartEl._focus = { line: focusLine, dots };
}

function handleChartMove(evt) {
  if (!chartGeom) return;
  const rect = chartEl.getBoundingClientRect();
  const clientX = (evt.touches ? evt.touches[0].clientX : evt.clientX);
  const px = ((clientX - rect.left) / rect.width) * VB_W;
  const ratio = (px - PAD.l) / (VB_W - PAD.l - PAD.r);
  let yr = Math.round(ratio * chartGeom.years);
  yr = Math.max(0, Math.min(chartGeom.years, yr));
  const d = chartData[yr];
  if (!d) return;

  const fx = chartGeom.x(yr);
  chartEl._focus.line.setAttribute("x1", fx);
  chartEl._focus.line.setAttribute("x2", fx);
  chartEl._focus.line.setAttribute("opacity", 1);
  SERIES.forEach((s, i) => {
    const dot = chartEl._focus.dots[i];
    dot.setAttribute("cx", fx);
    dot.setAttribute("cy", chartGeom.y(d[s.key]));
    dot.setAttribute("opacity", 1);
  });

  chartTip.hidden = false;
  chartTip.innerHTML =
    `<div class="tip-year">${yr}年後</div>` +
    SERIES.map((s) => `<div class="tip-line"><i style="background:${s.color}"></i>${s.name} ${man(d[s.key])}</div>`).join("");
  const wrapRect = chartWrap.getBoundingClientRect();
  const left = (fx / VB_W) * wrapRect.width;
  chartTip.style.left = left + "px";
  chartTip.style.top = ((PAD.t / VB_H) * wrapRect.height + 8) + "px";
}
function hideChartFocus() {
  chartTip.hidden = true;
  if (chartEl._focus) {
    chartEl._focus.line.setAttribute("opacity", 0);
    chartEl._focus.dots.forEach((d) => d.setAttribute("opacity", 0));
  }
}
chartEl.addEventListener("mousemove", handleChartMove);
chartEl.addEventListener("mouseleave", hideChartFocus);
chartEl.addEventListener("touchmove", handleChartMove, { passive: true });
chartEl.addEventListener("touchend", hideChartFocus);

// ============================================================
//  支出内訳
// ============================================================
function renderBreakdown(calc) {
  const rows = [
    ["ローン返済", yen(calc.monthlyLoan)],
    ["管理費・修繕積立等", yen(calc.mgmtFee)],
    ["生活費合計", yen(calc.livingCost)],
    ["NISA積立", yen(Number(state.nisaMonthly) || 0)],
  ];
  let html = rows.map(([l, v]) => `<div class="row"><span>${l}</span><span class="row-val">${v}</span></div>`).join("");
  html += `<div class="row total"><span>支出合計</span><span class="row-val">${yen(calc.totalOut)}</span></div>`;
  html += `<div class="row"><span>世帯手取り</span><span class="row-val">${yen(calc.netMonthly)}</span></div>`;
  $("#breakdown-rows").innerHTML = html;
}

// ============================================================
//  全体更新
// ============================================================
function update() {
  const calc = compute(state);
  chartData = projection(state, calc);

  // サマリー
  const positive = calc.balance >= 0;
  const balEl = $("#balance");
  balEl.textContent = (positive ? "+" : "") + yen(calc.balance);
  balEl.className = "summary-balance " + (positive ? "pos" : "neg");
  $("#monthly-loan").textContent = yen(calc.monthlyLoan);
  $("#mgmt-note").textContent = "＋管理費等 " + yen(calc.mgmtFee);

  const burdenEl = $("#burden");
  burdenEl.textContent = calc.burdenRate.toFixed(1) + "%";
  burdenEl.className = calc.burdenRate > 30 ? "warn" : "ok";
  $("#fee").textContent = man(calc.fee);

  // ノート
  $("#loan-note").innerHTML = `借入額 <b>${man(calc.loan / 10000)}</b>（諸費用込）／ 総利息 <b>${yen(calc.totalInterest)}</b>`;
  $("#income-note").innerHTML = `世帯手取り（概算） <b>${yen(calc.netMonthly)}</b> / 月`;
  $("#cost-note").innerHTML = `生活費合計 <b>${yen(calc.livingCost)}</b> / 月`;
  const last = chartData[chartData.length - 1];
  $("#nisa-note").innerHTML = `${state.loanYears}年後のNISA資産（予想） <b style="color:var(--pos)">${man(last.nisa)}</b>`;

  renderBreakdown(calc);
  refreshSliders();
  drawChart();
  saveState();
}

// ============================================================
//  共有 / リセット
// ============================================================
$("#share-btn").addEventListener("click", async () => {
  const url = location.origin + location.pathname + "#" + encodeState(state);
  const msg = $("#share-msg");
  try {
    await navigator.clipboard.writeText(url);
    msg.textContent = "✓ リンクをコピーしました";
  } catch (e) {
    // クリップボード不可時はハッシュを更新して手動コピーを促す
    location.hash = encodeState(state);
    msg.textContent = "URLをコピーしてください（アドレスバー）";
  }
  setTimeout(() => { msg.textContent = ""; }, 2600);
});

$("#reset-btn").addEventListener("click", () => {
  state = clone(DEFAULTS);
  history.replaceState(null, "", location.pathname);
  renderCosts();
  buildSliders(); // 価格以外も初期化
  update();
});

// ============================================================
//  起動
// ============================================================
buildSliders();
renderCosts();
update();
// URLハッシュが共有リンクだった場合、読み込み後はクリーンにしておく
if (location.hash) history.replaceState(null, "", location.pathname);
