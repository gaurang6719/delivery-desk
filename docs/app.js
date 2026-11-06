// Delivery Desk: no account, no AI and no server. Journal and settings stay in this phone's browser.
(function () {
  const STORE = "delivery-desk-v1";
  const ICONS = {
    home: '<path d="M3 11.5 12 4l9 7.5M5.5 10v9.5h13V10"/>',
    stocks: '<path d="M4 19h16M6 15.5l4.5-5 3.5 3 5-6.5"/>',
    trades: '<path d="M6 3.5h12v17H6zM9.5 8.5h5M9.5 12.5h5M9.5 16.5h3"/>',
    money: '<path d="M3.5 7h17v11h-17zM3.5 11h17M16 15h1.5"/>',
    help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.6a2.5 2.5 0 1 1 3.6 2.4c-.8.4-1.2 1-1.2 2M12 17.2h.01"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/>',
  };
  const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
  const TABS = [["home", "Home", "home"], ["stocks", "Plan", "stocks"], ["trades", "My trades", "trades"], ["money", "Money", "money"], ["help", "Help", "help"]];
  const OLD_TABS = { today: "home", watchlist: "stocks", journal: "trades" };
  const RISK = {
    low: { label: "Low", trade: 0.005, book: 0.01, note: "Smaller trades and smaller possible losses." },
    medium: { label: "Medium", trade: 0.01, book: 0.02, note: "The highest level this app offers." },
  };
  const DEFAULT_CHARGES = { pct: 0.001, min: 5, max: 20, stt: 0.001, exch: 0.0000297, sebi: 0.000001, stamp: 0.00015, dp: 20, dpSmall: 3.5, gst: 0.18 };
  const today = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const FRESH = () => ({ deposits: [{ date: today(), amount: 15000 }], riskLevel: "medium", account: "paper", trades: [], theme: "auto", guideSeen: false, basket: null, basketRealized: 0 });

  const state = { planView: "split", planN: 5, planAmt: null, stopArm: false, tab: "home", report: null, prices: null, loaded: false, offline: false, data: load(), prefill: null, showForm: false, closing: null, delArm: null, error: "", backup: "", backupError: "", storageOk: true };

  function load() {
    try { const raw = localStorage.getItem(STORE); if (raw) return Object.assign(FRESH(), JSON.parse(raw)); } catch (e) {}
    return FRESH();
  }
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(state.data)); state.storageOk = true; }
    catch (e) { state.storageOk = false; }
  }

  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
  const inr = (v) => (v < 0 ? "-" : "") + "₹" + Math.abs(Math.round(v)).toLocaleString("en-IN");
  const px = (v) => "₹" + Number(v).toLocaleString("en-IN", { maximumFractionDigits: 2 });
  const signed = (v) => (v > 0 ? "+" : "") + inr(v);
  const cls = (v) => (v > 0 ? "pos" : v < 0 ? "neg" : "");
  const pctText = (v) => (v > 0 ? "+" : "") + v + "%";
  const $ = (id) => document.getElementById(id);
  const mode = () => (state.data.account === "real" ? "real" : "paper");
  const modeName = (m) => (m === "real" ? "real money" : "practice");
  const riskCfg = () => RISK[state.data.riskLevel] || RISK.medium;
  const niceDate = (iso) => { const d = new Date(iso + "T00:00:00"); return isNaN(d) ? iso : d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" }); };

  /* ---------- theme ---------- */
  function resolvedTheme() {
    const t = state.data.theme;
    if (t === "light" || t === "dark") return t;
    return window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  function applyTheme() {
    const t = state.data.theme;
    if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
    else document.documentElement.removeAttribute("data-theme");
    const r = resolvedTheme(), btn = $("themeBtn");
    btn.innerHTML = `<span style="width:22px;height:22px;display:block">${icon(r === "dark" ? "sun" : "moon")}</span>`;
    btn.setAttribute("aria-label", r === "dark" ? "Switch to light mode" : "Switch to dark mode");
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", r === "dark" ? "#071119" : "#edf3f7");
  }

  /* ---------- calculations ---------- */
  function charges(buy, sell, qty) {
    const c = Object.assign({}, DEFAULT_CHARGES, (state.report && state.report.chargeSchedule) || {});
    const bt = buy * qty, st = sell * qty;
    const brk = (t) => Math.max(c.min, Math.min(c.max, t * c.pct));
    const b = brk(bt) + brk(st), ex = (bt + st) * c.exch, se = (bt + st) * c.sebi, dp = st >= 100 ? c.dp : c.dpSmall;
    return b + (bt + st) * c.stt + ex + se + bt * c.stamp + dp + c.gst * (b + ex + se + dp);
  }
  const netOf = (t) => (t.sellPrice == null ? 0 : (t.sellPrice - t.buyPrice) * t.qty - charges(t.buyPrice, t.sellPrice, t.qty));
  const deposited = () => state.data.deposits.reduce((s, d) => s + (num(d.amount) || 0), 0);

  function account(m) {
    const list = state.data.trades.filter((t) => t.mode === m);
    const open = list.filter((t) => t.sellPrice == null), closed = list.filter((t) => t.sellPrice != null);
    const basket = m === "paper" ? state.data.basket : null;
    const realized = closed.reduce((s, t) => s + netOf(t), 0) + (m === "paper" ? state.data.basketRealized || 0 : 0);
    const invested = open.reduce((s, t) => s + t.buyPrice * t.qty, 0) + (basket ? basket.startValue : 0);
    const openRisk = open.reduce((s, t) => s + Math.max(0, (t.buyPrice - t.stop) * t.qty) + charges(t.buyPrice, t.stop, t.qty), 0);
    const capital = deposited() + realized;
    return { open, closed, realized, invested, openRisk, capital, cash: capital - invested };
  }
  function stats(m) {
    const closed = account(m).closed.slice().sort((a, b) => String(a.sellDate).localeCompare(String(b.sellDate)));
    let eq = deposited(), peak = eq, dd = 0, chg = 0, wins = 0, net = 0;
    closed.forEach((t) => { const n = netOf(t); net += n; if (n > 0) wins++; eq += n; chg += charges(t.buyPrice, t.sellPrice, t.qty); peak = Math.max(peak, eq); if (peak > 0) dd = Math.max(dd, (peak - eq) / peak); });
    return { n: closed.length, win: closed.length ? (wins / closed.length) * 100 : 0, net, chg, dd: dd * 100 };
  }
  function plan(c, entryOverride) {
    const entry = entryOverride || c.entry;
    const a = account(mode()), r = riskCfg();
    const limit = Math.min(a.capital * r.trade, a.capital * r.book - a.openRisk);
    const maxQ = Math.floor(Math.max(a.cash, 0) / entry);
    let q = 0;
    for (let k = 1; k <= maxQ; k++) { if ((entry - c.stop) * k + charges(entry, c.stop, k) <= limit) q = k; else break; }
    if (!q) return { q: 0, limit };
    const loss = (entry - c.stop) * q + charges(entry, c.stop, q);
    const n1 = (c.t1 - entry) * q - charges(entry, c.t1, q), n2 = (c.t2 - entry) * q - charges(entry, c.t2, q);
    return { q, limit, invest: entry * q, loss, n1, n2, chg: charges(entry, c.t2, q), rr: n2 / loss, gross: (c.t2 - entry) / (entry - c.stop) };
  }
  function validation() {
    const v = (state.report && state.report.validation) || {}, s = stats("paper"), b = state.data.basket;
    const fair = ["A fair past-data test beats the NIFTY", v.backtestEdge === true, v.backtestEdge === true ? "Yes" : "Not yet: no rule has shown this"];
    if (b && b.firstBuyDate) {
      const r = basketResult(b), months = monthsSince(b.firstBuyDate);
      const checks = [
        ["Practise the monthly plan for 6 months", months >= 6, months + " of 6 months"],
        ["Beat the NIFTY in practice, after charges", months >= 6 && r.niftyPct != null && r.pct > r.niftyPct, r.niftyPct == null ? "Not measured yet" : `Plan ${pctText(+r.pct.toFixed(1))}, NIFTY ${pctText(+r.niftyPct.toFixed(1))}`],
        fair,
      ];
      return { checks, ok: checks.every((c) => c[1]), progress: Math.min(1, months / 6), progressLabel: months + " of 6 practice months" };
    }
    const checks = [
      ["Practise for 20 market days", (v.sessionsTracked || 0) >= 20, (v.sessionsTracked || 0) + " of 20 days"],
      ["Finish 20 practice trades", s.n >= 20, s.n + " of 20 trades"],
      ["Make a profit in practice, after charges", s.n > 0 && s.net > 0, s.n ? signed(s.net) : "No finished trades yet"],
      fair,
    ];
    return { checks, ok: checks.every((c) => c[1]), progress: Math.min(1, (v.sessionsTracked || 0) / 20), progressLabel: (v.sessionsTracked || 0) + " of 20 practice days" };
  }

  /* ---------- monthly plan: hold the strongest companies, review once a month ---------- */
  const monthOf = (iso) => String(iso || "").slice(0, 7);
  const monthsSince = (iso) => { const a = new Date(iso + "T00:00:00"), b = new Date(today() + "T00:00:00"); return Math.max(0, Math.floor((b - a) / (30.44 * 86400000))); };
  const niftyClose = () => { const m = state.report && (state.report.market || []).find((x) => x.name === "NIFTY 50"); return m ? m.close : null; };
  const rankedList = () => { const p = state.report && state.report.monthlyPlan; return p && p.marketOk ? p.ranked || [] : []; };
  function lastPrice(symbol) {
    const p = state.prices && state.prices.prices && state.prices.prices[symbol];
    if (p != null) return p;
    const hit = ((state.report && state.report.monthlyPlan && state.report.monthlyPlan.ranked) || []).find((x) => x.symbol === symbol);
    return hit ? hit.close : null;
  }
  const holdingPrice = (h) => { const p = lastPrice(h.symbol); return p == null ? h.buyPrice : p; };
  function basketResult(b) {
    const value = b.cash + b.holdings.reduce((s, h) => s + h.qty * holdingPrice(h), 0);
    const sellCost = b.holdings.reduce((s, h) => s + charges(h.buyPrice, holdingPrice(h), h.qty), 0);
    const afterCharges = value - sellCost, now = niftyClose();
    return { value, sellCost, afterCharges, pct: b.startValue ? (afterCharges / b.startValue - 1) * 100 : 0, gain: afterCharges - b.startValue, niftyPct: b.startNifty && now ? (now / b.startNifty - 1) * 100 : null };
  }
  function pickBuys(n, heldSymbols, heldCount, cash, equity) {
    const held = new Set(heldSymbols), buys = [];
    let avail = cash, count = heldCount;
    for (const r of rankedList()) {
      if (count >= n) break;
      if (held.has(r.symbol)) continue;
      const q = Math.floor(Math.min(avail, equity / n) / r.close);
      if (q > 0) { buys.push({ symbol: r.symbol, name: r.name, sector: r.sector, qty: q, price: r.close, ret6m: r.ret6m }); avail -= q * r.close; count++; }
    }
    return { buys, left: avail };
  }
  function reviewPlan(b) {
    const keepSet = new Set(rankedList().slice(0, 2 * b.n).map((r) => r.symbol));
    const sells = b.holdings.filter((h) => lastPrice(h.symbol) != null && !keepSet.has(h.symbol));
    const keeps = b.holdings.filter((h) => !sells.includes(h));
    const sellCharges = sells.reduce((s, h) => s + charges(h.buyPrice, holdingPrice(h), h.qty), 0);
    const cash = b.cash + sells.reduce((s, h) => s + h.qty * holdingPrice(h), 0) - sellCharges;
    const equity = cash + keeps.reduce((s, h) => s + h.qty * holdingPrice(h), 0);
    const picked = pickBuys(b.n, keeps.map((h) => h.symbol), keeps.length, cash, equity);
    return { sells, keeps, buys: picked.buys, cash: picked.left, sellCharges };
  }
  const reviewDue = () => { const b = state.data.basket; return !!(b && state.report && monthOf(state.report.asOf) !== b.lastReview); };
  function applyReview() {
    const b = state.data.basket, plan = reviewPlan(b), date = state.report.asOf;
    b.sold = (b.sold || []).concat(plan.sells.map((h) => ({ symbol: h.symbol, qty: h.qty, buyPrice: h.buyPrice, sellPrice: holdingPrice(h), date, net: (holdingPrice(h) - h.buyPrice) * h.qty - charges(h.buyPrice, holdingPrice(h), h.qty) })));
    b.holdings = plan.keeps.concat(plan.buys.map((x) => ({ symbol: x.symbol, name: x.name, qty: x.qty, buyPrice: x.price, buyDate: date })));
    b.cash = plan.cash;
    b.lastReview = monthOf(date);
    if (plan.buys.length && !b.firstBuyDate) { b.firstBuyDate = date; b.startNifty = niftyClose(); }
  }
  function posStatus(t) {
    const p = state.prices && state.prices.prices && state.prices.prices[t.symbol];
    if (p == null) return { label: "No price yet", tone: "", close: null, todo: "This stock isn't in the latest report. Check its price in Groww." };
    if (p <= t.stop) return { label: "Exit now", tone: "bad", close: p, todo: "The price reached your stop-loss. The plan says sell and accept the loss." };
    if (p >= t.target) return { label: "Target reached", tone: "good", close: p, todo: "The price reached your target. The plan says sell and book the profit." };
    if (p <= t.stop * 1.015) return { label: "Close to stop-loss", tone: "warn", close: p, todo: "Keep the plan, and don't move your stop-loss lower." };
    return { label: "Hold", tone: "", close: p, todo: "Nothing to do. The price is between your stop-loss and target." };
  }

  /* ---------- plain-language copy ---------- */
  function plainVerdict(r) {
    const overextended = /overextended/i.test(r.classification || "");
    if (r.verdict === "NO TRADE") return {
      title: "Don't buy today",
      why: overextended ? "The market has climbed very fast, so prices look stretched. Buying after a jump like this can mean paying too much."
        : /bearish/i.test(r.classification || "") ? "The market is weak right now, so buying carries extra risk." : "The market check didn't pass today, so new buys should wait.",
      todo: "Do nothing today. Check again after 7:00 PM on the next market day.",
    };
    if (r.verdict === "PAPER SETUP") return { title: "A practice trade is ready", why: "A stock has reached its buying range. Practise with it, because no rule has reliably beaten the NIFTY.", todo: "Open Plan, then Dip list, check the company's news, and log a practice trade." };
    return { title: "Nothing to buy yet", why: "The market is fine, but no stock has reached a good buying price.", todo: "Do nothing today. Check again after 7:00 PM on the next market day." };
  }
  const mood = (r) => (/overextended/i.test(r.classification || "") ? "Rising fast" : /bullish/i.test(r.classification || "") ? "Rising" : /bearish/i.test(r.classification || "") ? "Falling" : "Flat");
  const stockStatus = (c) => (c.recommendation === "PAPER SETUP" ? ["In buying range", "good"] : c.recommendation === "AVOID" ? ["Avoid", "bad"] : ["Wait for a lower price", "warn"]);
  function distance(c) {
    if (c.close > c.entryHigh) { const d = c.close - c.entryHigh; return `The last price is ${px(d.toFixed(2))} (${((d / c.close) * 100).toFixed(1)}%) above the buying range, so it needs to fall first.`; }
    if (c.close < c.entryLow) return "The last price is below the buying range, so wait until it recovers.";
    return "The last price is inside the buying range.";
  }

  /* ---------- pieces ---------- */
  function priceMap(c) {
    const lo = Math.min(c.stop, c.close), hi = Math.max(c.t2, c.close), pos = (x) => ((x - lo) / (hi - lo)) * 100;
    return `<div class="pmap" role="img" aria-label="Stop-loss ${px(c.stop)}, buying range ${px(c.entryLow)} to ${px(c.entryHigh)}, last price ${px(c.close)}, final target ${px(c.t2)}">
      <div class="pmap-track"><div class="pmap-zone" style="left:${pos(c.entryLow).toFixed(1)}%;width:${(pos(c.entryHigh) - pos(c.entryLow)).toFixed(1)}%"></div><div class="pmap-dot" style="left:${pos(c.close).toFixed(1)}%"></div></div>
      <div class="pmap-labels"><span>Stop-loss<br><strong>${px(c.stop)}</strong></span><span style="text-align:center">Last price (dot)<br><strong>${px(c.close)}</strong></span><span>Final target<br><strong>${px(c.t2)}</strong></span></div></div>`;
  }
  function evidenceBars(r) {
    const rows = r.evidence.rows.filter((x) => x.start === 15000).slice().sort((a, b) => b.end - a.end);
    const max = Math.max(15000, ...rows.map((x) => x.end));
    return `<ul class="bars">${rows.map((x) => `<li><div class="bar-head"><span>${esc(plainRow(x.label))}</span><strong>${inr(x.end)}</strong></div>
      <div class="bar-track"><div class="bar-fill ${x.highlight ? "hi" : ""}" style="width:${((x.end / max) * 100).toFixed(1)}%"></div><span class="bar-start" style="left:${((15000 / max) * 100).toFixed(1)}%"></span></div></li>`).join("")}</ul>
      <p class="faint">The thin line on each bar marks the ₹15,000 starting amount.</p>`;
  }
  const plainRow = (l) => (l === "Hold the NIFTY 50" ? "Just holding the NIFTY 50" : l);

  /* ---------- views ---------- */
  function vHome() {
    const r = state.report;
    if (!r) return `<section class="card"><h1>Welcome</h1><p>${state.offline ? "You're offline and no report is saved yet. Connect once to load it." : "No report has been published yet. It appears after the first daily run."}</p></section>`;
    const days = Math.floor((new Date(today()) - new Date(r.asOf)) / 86400000);
    const v = validation(), m = mode(), a = account(m), due = reviewDue();
    const pv = due ? { title: "Your monthly review is ready", why: "It's a new month, so the plan can update which companies you hold.", todo: "Open Plan and record this month's practice changes." } : plainVerdict(r);
    const nifty = (r.market || []).find((x) => x.name === "NIFTY 50"), vix = (r.market || []).find((x) => x.name === "India VIX");
    const alerts = state.data.trades.filter((t) => t.sellPrice == null).map((t) => [t, posStatus(t)]).filter((x) => x[1].tone);
    return `
    <section class="card hero ${due ? "good" : esc(r.verdictTone)}">
      <span class="kicker">Today's answer · based on the ${esc(niceDate(r.asOf))} close</span>
      <h1>${esc(pv.title)}</h1><p>${esc(pv.why)}</p><div class="do">${esc(pv.todo)}</div>
    </section>
    ${state.data.basket || due ? "" : `<section class="card"><div class="row"><div><h2>Want to split your money?</h2><p class="muted">Practise holding several companies, with one check a month.</p></div><button class="primary" data-tab="stocks">See the plan</button></div></section>`}
    ${state.data.guideSeen ? "" : `<section class="card"><div class="row"><div><h2>New here?</h2><p class="muted">See how this works in one minute.</p></div><div class="btns"><button class="primary" data-tab="help">Show me</button><button data-dismiss="1">Not now</button></div></div></section>`}
    ${days > 4 ? `<div class="notice warn">This report is ${days} days old, so don't rely on its prices.</div>` : ""}
    ${state.offline ? `<div class="notice warn">You're offline, so this is the last saved report.</div>` : ""}
    ${alerts.length ? `<section class="card"><h2>Your trades need attention</h2>${alerts.map(([t, s]) => `<div class="row"><strong>${esc(t.symbol)}</strong><span class="pill ${s.tone}">${esc(s.label)}</span></div><p class="muted">${esc(s.todo)}</p>`).join("")}<button data-tab="trades">Open my trades</button></section>` : ""}
    <div class="tiles">
      <section class="card tile"><span class="label">Market mood</span><span class="value">${esc(mood(r))}</span><span class="hint">${nifty ? `NIFTY 50 ${pctText(nifty.d5)} in 5 days` : ""}</span></section>
      <section class="card tile"><span class="label">NIFTY 50</span><span class="value">${nifty ? Number(nifty.close).toLocaleString("en-IN") : "–"}</span><span class="hint ${nifty ? cls(nifty.d1) : ""}">${nifty ? pctText(nifty.d1) + " that day" : ""}</span></section>
      <section class="card tile"><span class="label">Market fear (VIX)</span><span class="value">${vix ? esc(vix.close) : "–"}</span><span class="hint">${vix ? (vix.d5 > 0 ? "Higher" : "Lower") + " than 5 days ago" : ""}</span></section>
      <section class="card tile"><span class="label">Your ${esc(modeName(m))} money</span><span class="value">${inr(a.capital)}</span><span class="hint">${inr(a.cash)} available</span></section>
    </div>
    <div class="two-col">
      <section class="card"><div class="row"><h2>Ready for real money?</h2><span class="pill ${v.ok ? "good" : "warn"}">${v.ok ? "Checks passed" : "Not yet"}</span></div>
        <div class="progress" role="img" aria-label="${esc(v.progressLabel)}"><i style="width:${(v.progress * 100).toFixed(0)}%"></i></div>
        <ul class="checks">${v.checks.map((c) => `<li class="${c[1] ? "met" : ""}"><span class="mark" aria-hidden="true">${c[1] ? "✓" : "–"}</span><div>${esc(c[0])}<div class="faint">${c[1] ? "Done" : "Not done"} · ${esc(c[2])}</div></div></li>`).join("")}</ul>
        <p class="faint">No app can promise 100% certainty. Your only no-risk choices are cash and practice trades.</p></section>
      ${r.evidence ? `<section class="card"><h2>Do trading rules beat the market?</h2><p class="muted">Not in these tests. Here's what ₹15,000 became from Aug 2017 to Nov 2026, after charges:</p>${evidenceBars(r)}
        <details><summary>More detail on this test</summary><div><p class="muted">${esc(r.evidence.summary)}</p><div class="scroll"><table><thead><tr><th>Approach</th><th>Start</th><th>End</th><th>Worst fall</th></tr></thead><tbody>${r.evidence.rows.map((x) => `<tr><td>${esc(plainRow(x.label))}</td><td>${inr(x.start)}</td><td>${inr(x.end)}</td><td>${esc(x.dd)}%</td></tr>`).join("")}</tbody></table></div><p class="faint">${esc(r.evidence.note)}</p></div></details></section>` : ""}
    </div>
    <details class="card"><summary>See all market numbers</summary><div>
      <div class="scroll"><table><thead><tr><th>Market</th><th>Close</th><th>1 day</th><th>5 days</th><th>RSI</th></tr></thead><tbody>${(r.market || []).filter((x) => !x.missing).map((x) => `<tr><td>${esc(x.name)}</td><td>${Number(x.close).toLocaleString("en-IN")}</td><td class="${cls(x.d1)}">${pctText(x.d1)}</td><td class="${cls(x.d5)}">${pctText(x.d5)}</td><td>${esc(x.rsi)}</td></tr>`).join("")}</tbody></table></div>
      <ul class="muted" style="margin:0;padding-left:18px">${(r.notes || []).concat(r.gaps || []).map((n) => `<li>${esc(n)}</li>`).join("")}</ul><p class="faint">Rule result: ${esc(r.verdict)}. ${esc(r.summary)}</p></div></details>
    <p class="faint">Prices aren't live. This app uses fixed rules, not advice from a SEBI-registered adviser, can't place orders, and never asks for your Groww login.</p>`;
  }

  function vPlan() {
    const seg = `<div class="btns fill" role="group" aria-label="Plan type"><button data-planview="split" aria-pressed="${state.planView === "split"}">Split my money</button><button data-planview="dips" aria-pressed="${state.planView === "dips"}">Dip list</button></div>`;
    return seg + (state.planView === "split" ? vSplit() : vStocks());
  }

  function monthlyEvidence() {
    const e = state.report && state.report.evidence && state.report.evidence.monthly;
    if (!e) return "";
    return `<details class="card"><summary>Has this plan worked before?</summary><div>
      <p class="muted">₹15,000 from Aug 2017 to Nov 2026, after charges, and what ₹100 became in the last ${esc(e.recentYears)} years:</p>
      <div class="scroll"><table><thead><tr><th>Approach</th><th>End</th><th>Worst fall</th><th>Recent ₹100</th></tr></thead><tbody>${e.rows.map((x) => `<tr><td>${esc(x.label)}</td><td>${inr(x.end)}</td><td>${esc(x.dd)}%</td><td>${inr(x.recent)}</td></tr>`).join("")}</tbody></table></div>
      <div class="notice warn">${esc(e.note)}</div></div></details>`;
  }

  function vSplit() {
    const r = state.report, b = state.data.basket;
    if (!r || !r.monthlyPlan) return `<section class="card"><h1>Split my money</h1><p class="muted">The company list appears after the next daily report.</p></section>`;
    const worst = state.planN === 3 ? 44.7 : 36.3;
    if (!b) {
      const a = account("paper"), max = Math.max(0, Math.floor(a.cash));
      const amt = state.planAmt == null ? max : Math.min(state.planAmt, max);
      const pick = pickBuys(state.planN, [], 0, amt, amt);
      const cost = pick.buys.reduce((s, x) => s + x.qty * x.price, 0), chg = pick.buys.reduce((s, x) => s + charges(x.price, x.price, x.qty), 0);
      return `<section class="card"><h1>Split my money</h1><p>Hold several strong companies instead of one, and check once a month, not every day.</p>
        <ol class="steps"><li><div><strong>Pick how many companies</strong><div class="muted">Your money is divided equally between them.</div></div></li><li><div><strong>The app chooses the strongest</strong><div class="muted">It picks the biggest 6-month risers among NIFTY 100 stocks above their long-term trend.</div></div></li><li><div><strong>Review once a month</strong><div class="muted">Companies that fall too far down the list are replaced. If the NIFTY drops below its long-term trend, the plan moves to cash.</div></div></li></ol></section>
      <section class="card"><h2>How many companies?</h2><div class="btns fill">${[3, 5].map((n) => `<button data-plann="${n}" aria-pressed="${state.planN === n}">${n} companies</button>`).join("")}</div>
        <label>Practice money to use (₹)<input id="planAmt" inputmode="numeric" value="${amt}"></label>
        <p class="muted">${state.planN === 5 ? "5 companies spread your risk more, but buying and selling all of them costs more." : "3 companies cost less to trade, but one bad company hurts more."}</p></section>
      <section class="card"><div class="row"><h2>${pick.buys.length ? "If it started today" : "No companies to buy today"}</h2><span class="pill">Example</span></div>
        ${pick.buys.length ? `<div class="scroll"><table><thead><tr><th>Company</th><th>Shares</th><th>Cost</th><th>6 months</th></tr></thead><tbody>${pick.buys.map((x) => `<tr><td>${esc(x.name)}<div class="faint">${esc(x.symbol)} · ${esc(x.sector)}</div></td><td>${x.qty}</td><td>${inr(x.qty * x.price)}</td><td class="pos">${pctText(x.ret6m)}</td></tr>`).join("")}</tbody></table></div>
        <div class="big-facts"><div class="big-fact"><span>Invested / left in cash</span><strong>${inr(cost)} / ${inr(amt - cost)}</strong></div><div class="big-fact"><span>Charges to buy and later sell all</span><strong>${inr(chg)} (${cost ? ((chg / cost) * 100).toFixed(1) : 0}%)</strong></div></div>` : `<p class="muted">The market is below its long-term trend, or your amount is too small, so the plan would stay in cash.</p>`}
        <div class="notice warn">This isn't low risk, and no stop-loss protects each share. The worst fall in testing was ${worst}%, which would be about ${inr((amt * worst) / 100)} on ${inr(amt)}.</div>
        ${state.error ? `<div class="notice bad">${esc(state.error)}</div>` : ""}
        <button class="primary" data-planstart="1">Start practice plan</button>
        <p class="faint">No real money is used. Your first practice buys happen at the first review next month, so you don't chase today's rally. The companies may change by then. A share too expensive for its equal portion is skipped, so some money can stay in cash.</p></section>
      ${monthlyEvidence()}`;
    }
    const res = basketResult(b), due = reviewDue(), avail = Math.floor(account("paper").cash);
    const rp = due ? reviewPlan(b) : null;
    const line = (name, sym, right, tone) => `<div class="row"><div><strong>${esc(name)}</strong><div class="faint">${esc(sym)}</div></div><span class="pill ${tone}">${esc(right)}</span></div>`;
    return `<section class="card"><div class="row"><h1>My monthly plan</h1><span class="pill">Practice</span></div>
        <div class="big-facts"><div class="big-fact"><span>Value after charges</span><strong>${inr(res.afterCharges)}</strong></div><div class="big-fact"><span>Gain or loss</span><strong class="${cls(res.gain)}">${signed(res.gain)}</strong></div>
        <div class="big-fact"><span>Plan since first buy</span><strong class="${cls(res.pct)}">${b.firstBuyDate ? pctText(+res.pct.toFixed(1)) : "Not started"}</strong></div><div class="big-fact"><span>NIFTY in the same time</span><strong class="${res.niftyPct == null ? "" : cls(res.niftyPct)}">${res.niftyPct == null ? "Not started" : pctText(+res.niftyPct.toFixed(1))}</strong></div></div>
        <p class="faint">${b.n} companies. ${due ? "A review is ready now." : b.holdings.length ? "Next review: first market day of next month." : "First practice buys: first market day of next month."} Prices are end-of-day.</p></section>
      ${due ? `<section class="card"><h2>This month's changes</h2>
        ${rp.sells.map((h) => line(h.name || h.symbol, `Sell ${h.qty} shares at about ${px(holdingPrice(h))}`, "Sell", "bad")).join("")}
        ${rp.buys.map((x) => line(x.name, `Buy ${x.qty} shares at about ${px(x.price)}`, "Buy", "good")).join("")}
        ${rp.keeps.map((h) => line(h.name || h.symbol, `Keep ${h.qty} shares`, "Keep", "")).join("")}
        ${!rp.sells.length && !rp.buys.length && !rp.keeps.length ? `<p class="muted">The market is below its long-term trend, so the plan stays in cash this month.</p>` : ""}
        <button class="primary" data-planreview="1">Record this review</button><p class="faint">This updates your practice plan at the latest closing prices. It doesn't touch Groww.</p></section>` : ""}
      ${b.holdings.length ? `<section class="card"><h2>What you hold</h2><div class="scroll"><table><thead><tr><th>Company</th><th>Shares</th><th>Value</th><th>Gain</th></tr></thead><tbody>${b.holdings.map((h) => { const p = holdingPrice(h), g = (p - h.buyPrice) * h.qty; return `<tr><td>${esc(h.name || h.symbol)}<div class="faint">${esc(h.symbol)}</div></td><td>${h.qty}</td><td>${inr(p * h.qty)}</td><td class="${cls(g)}">${signed(g)}</td></tr>`; }).join("")}<tr><td>Cash</td><td></td><td>${inr(b.cash)}</td><td></td></tr></tbody></table></div><p class="faint">Gains are before charges. ${esc("Check each company's news on Screener or NSE.")}</p></section>` : ""}
      ${avail > 0 ? `<section class="card"><h2>Add more money to the plan</h2><p class="muted">You have ${inr(avail)} of practice money outside the plan. It gets invested at the next review.</p><button data-planadd="1">Move ${inr(avail)} into the plan</button></section>` : ""}
      ${monthlyEvidence()}
      <section class="card"><h2>End the plan</h2><p class="muted">This "sells" everything at the latest prices and returns the result to your practice money.</p><button data-planstop="1">${state.stopArm ? "Tap again to end the plan" : "End practice plan"}</button></section>`;
  }

  function vStocks() {
    const r = state.report, cands = (r && r.candidates) || [], m = mode(), a = account(m), risk = riskCfg();
    const head = `<section class="card"><h1>Dip list</h1><p class="muted">Single trades with a stop-loss. Plans are sized for your ${esc(modeName(m))} money: ${inr(a.cash)} available, and a planned loss of up to ${inr(a.capital * risk.trade)} per trade.</p></section>`;
    if (!cands.length) return head + `<section class="card"><p>No stock passes the rules today. Staying in cash is a good decision.</p></section>`;
    return head + `<div class="stock-grid">${cands.map((c) => {
      const [label, tone] = stockStatus(c), inZone = c.recommendation === "PAPER SETUP";
      const p = plan(c, inZone ? c.close : c.entry);
      return `<section class="card">
        <div class="row"><div><h2>${esc(c.name)}</h2><span class="faint">${esc(c.symbol)} · ${esc(c.sector)}</span></div><span class="pill ${tone}">${esc(label)}</span></div>
        ${priceMap(c)}<p class="muted">${esc(distance(c))}</p>
        <dl class="facts"><dt>Buy only between</dt><dd>${px(c.entryLow)} – ${px(c.entryHigh)}</dd><dt>First target / final target</dt><dd>${px(c.t1)} / ${px(c.t2)}</dd>${p.q ? `<dt>Shares you could buy</dt><dd>${p.q} for ${inr(p.invest)}</dd>` : ""}</dl>
        ${p.q ? `<div class="big-facts"><div class="big-fact loss"><span>If it goes wrong, you lose about</span><strong>${inr(p.loss)}</strong></div><div class="big-fact gain"><span>At the targets, you make about</span><strong>${inr(p.n1)} – ${inr(p.n2)}</strong></div></div><p class="faint">Includes about ${inr(p.chg)} in charges. These are plans, not promises, and overnight falls can cost more.</p>`
        : `<div class="notice warn">No share quantity fits your loss limit of ${inr(Math.max(p.limit, 0))}, so skip this stock.</div>`}
        ${inZone && p.q ? `<button class="primary" data-log="${esc(c.symbol)}">Log a practice trade</button>` : inZone ? "" : `<div class="notice info">Nothing to do yet. Wait for the price to reach the buying range.</div>`}
        <details><summary>Check before you act</summary><div>
          <p class="muted">The app doesn't read company results or news, so look at them yourself: <a href="https://www.screener.in/company/${encodeURIComponent(c.symbol)}/consolidated/" target="_blank" rel="noopener">Screener</a> · <a href="https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(c.symbol)}" target="_blank" rel="noopener">NSE</a></p>
          <dl class="facts"><dt>Rule score</dt><dd>${esc(c.score)} of ${esc(c.scoreOf)}</dd><dt>RSI (speed of price rise)</dt><dd>${esc(c.rsi)}</dd><dt>Volume vs normal</dt><dd>${esc(c.volRatio)}×</dd><dt>Delivery</dt><dd>${c.delivery == null ? "Not available" : esc(c.delivery) + "%"}</dd><dt>Against NIFTY, 20 days</dt><dd>${c.rs20 > 0 ? "+" : ""}${esc(c.rs20)} pts</dd></dl>
          <p class="faint">The score ranks the setup. It isn't the chance of making a profit.</p></div></details>
      </section>`;
    }).join("")}</div>`;
  }

  function tradeForm() {
    const f = state.prefill || {};
    return `<form id="tradeForm" class="card"><h2>Add a trade</h2><div class="grid2">
      <label>Stock symbol<input id="fSym" required value="${esc(f.symbol || "")}" autocapitalize="characters" placeholder="PNB"></label>
      <label>Type<select id="fMode"><option value="paper">Practice</option><option value="real">Real money</option></select></label>
      <label>Buy price (₹)<input id="fBuy" required inputmode="decimal" value="${esc(f.buy || "")}"></label><label>Number of shares<input id="fQty" required inputmode="numeric" value="${esc(f.qty || "")}"></label>
      <label>Stop-loss (₹)<input id="fStop" required inputmode="decimal" value="${esc(f.stop || "")}"></label><label>Target (₹)<input id="fTarget" required inputmode="decimal" value="${esc(f.target || "")}"></label>
      <label>Buy date<input id="fDate" type="date" required value="${today()}"></label></div>
      ${state.error && !state.closing ? `<div class="notice bad">${esc(state.error)}</div>` : ""}
      <div class="btns fill"><button class="primary" type="submit">Save trade</button><button type="button" data-hideform="1">Cancel</button></div></form>`;
  }
  function vCard(t) {
    const s = posStatus(t), un = s.close != null ? (s.close - t.buyPrice) * t.qty : null;
    return `<section class="card"><div class="row"><div><h2>${esc(t.symbol)}</h2><span class="faint">${t.mode === "real" ? "Real money" : "Practice"} · bought ${esc(niceDate(t.buyDate))}</span></div><span class="pill ${s.tone}">${esc(s.label)}</span></div>
      <p class="muted">${esc(s.todo)}</p>
      <dl class="facts"><dt>Shares × buy price</dt><dd>${t.qty} × ${px(t.buyPrice)}</dd><dt>Cost</dt><dd>${inr(t.buyPrice * t.qty)}</dd><dt>Stop-loss / target</dt><dd>${px(t.stop)} / ${px(t.target)}</dd>
      ${s.close != null ? `<dt>Last close</dt><dd>${px(s.close)}</dd><dt>Gain or loss so far, before charges</dt><dd class="${cls(un)}">${signed(un)}</dd>` : ""}</dl>
      ${state.closing === t.id ? `<form data-closeform="${esc(t.id)}" class="stack"><div class="grid2"><label>Sell price (₹)<input id="sellPx" required inputmode="decimal"></label><label>Sell date<input id="sellDate" type="date" required value="${today()}"></label></div>
        ${state.error ? `<div class="notice bad">${esc(state.error)}</div>` : ""}<div class="btns fill"><button class="primary" type="submit">Finish trade</button><button type="button" data-cancel="1">Keep open</button></div></form>`
      : `<div class="btns fill"><button data-close="${esc(t.id)}">I sold this</button><button data-del="${esc(t.id)}">${state.delArm === t.id ? "Tap again to delete" : "Delete"}</button></div>`}</section>`;
  }
  function vTrades() {
    const open = state.data.trades.filter((t) => t.sellPrice == null);
    const closed = state.data.trades.filter((t) => t.sellPrice != null).sort((a, b) => String(b.sellDate).localeCompare(String(a.sellDate)));
    const p = stats("paper"), rl = stats("real");
    const row = (l, s) => `<tr><td>${l}</td><td>${s.n}</td><td>${s.n ? s.win.toFixed(0) + "%" : "–"}</td><td class="${cls(s.net)}">${s.n ? signed(s.net) : "–"}</td><td>${s.n ? inr(s.chg) : "–"}</td></tr>`;
    return `<section class="card"><div class="row"><h1>My trades</h1>${state.showForm || state.prefill ? "" : `<button class="primary" data-showform="1">+ Add a trade</button>`}</div>
      <div class="big-facts"><div class="big-fact"><span>Practice result after charges</span><strong class="${cls(p.net)}">${p.n ? signed(p.net) : "No trades yet"}</strong></div><div class="big-fact"><span>Real money result after charges</span><strong class="${cls(rl.net)}">${rl.n ? signed(rl.net) : "No trades yet"}</strong></div></div></section>
      ${state.showForm || state.prefill ? tradeForm() : ""}
      <h2 class="section-title">Open trades (${open.length})</h2>
      ${open.length ? `<div class="stock-grid">${open.map(vCard).join("")}</div>` : `<section class="card"><p class="muted">You have no open trades. When Dip list shows a stock in its buying range, log a practice trade there.</p></section>`}
      <h2 class="section-title">Finished trades (${closed.length})</h2>
      ${closed.length ? `<section class="card"><div class="scroll"><table><thead><tr><th>Stock</th><th>Buy</th><th>Sell</th><th>Shares</th><th>Result</th></tr></thead><tbody>${closed.map((t) => { const n = netOf(t); return `<tr><td>${esc(t.symbol)}<div class="faint">${esc(modeName(t.mode))}, ${esc(t.sellDate)}</div></td><td>${px(t.buyPrice)}</td><td>${px(t.sellPrice)}</td><td>${t.qty}</td><td class="${cls(n)}">${signed(n)}</td></tr>`; }).join("")}</tbody></table></div>
        <details><summary>Full totals</summary><div><div class="scroll"><table><thead><tr><th>Account</th><th>Trades</th><th>Wins</th><th>Result</th><th>Charges</th></tr></thead><tbody>${row("Practice", p)}${row("Real money", rl)}</tbody></table></div></div></details></section>` : `<section class="card"><p class="muted">Finished trades and their results after charges will appear here.</p></section>`}`;
  }
  function vMoney() {
    const m = mode(), a = account(m), r = riskCfg(), d = state.data;
    const preview = [a.capital, 25000, 50000, 100000, 500000].filter((v, i, x) => v > 0 && x.indexOf(v) === i).sort((p, q) => p - q);
    return `<section class="card"><h1>My money</h1><div class="big-facts">
        <div class="big-fact"><span>Total (${esc(modeName(m))})</span><strong>${inr(a.capital)}</strong></div><div class="big-fact"><span>Available to use</span><strong>${inr(a.cash)}</strong></div>
        <div class="big-fact"><span>In open trades</span><strong>${inr(a.invested)}</strong></div><div class="big-fact"><span>Profit or loss so far</span><strong class="${cls(a.realized)}">${signed(a.realized)}</strong></div></div>
        <p class="faint">This is only a number you control here. It isn't linked to your bank or Groww.</p></section>
    <div class="two-col"><form id="depForm" class="card"><h2>Add or take out money</h2><p class="muted">Investing more? Enter it here, and every plan updates automatically.</p>
      <div class="grid2"><label>Amount (₹)<input id="dAmt" required inputmode="numeric" placeholder="10000"></label><label>Date<input id="dDate" type="date" required value="${today()}"></label></div>
      ${state.error ? `<div class="notice bad">${esc(state.error)}</div>` : ""}<div class="btns fill"><button class="primary" type="submit" value="1">Add money</button><button type="submit" value="-1">Take out</button></div>
      <details><summary>History</summary><div><div class="scroll"><table><thead><tr><th>Date</th><th>Amount</th></tr></thead><tbody>${d.deposits.slice().reverse().map((x) => `<tr><td>${esc(x.date)}</td><td class="${cls(x.amount)}">${signed(x.amount)}</td></tr>`).join("")}</tbody></table></div></div></details></form>
    <section class="card"><h2>How much risk?</h2><div class="btns fill">${Object.keys(RISK).map((k) => `<button data-risk="${k}" aria-pressed="${d.riskLevel === k}">${RISK[k].label}</button>`).join("")}</div>
      <p class="muted">${esc(r.note)} You plan to lose at most <strong>${inr(a.capital * r.trade)}</strong> per trade, and <strong>${inr(a.capital * r.book)}</strong> across all open trades. A sudden overnight fall can still cost more.</p>
      <h2>Plan trades for</h2><div class="btns fill"><button data-acct="paper" aria-pressed="${m === "paper"}">Practice</button><button data-acct="real" aria-pressed="${m === "real"}">Real money</button></div>
      ${m === "real" ? `<div class="notice bad">${validation().ok ? "The checks have passed, but this is still your decision." : "The checks on Home haven't passed, and the tested rules lost money. Practice is safer."}</div>` : ""}</section></div>
    <details class="card"><summary>What changes when I invest more?</summary><div><div class="scroll"><table><thead><tr><th>Your money</th><th>Loss limit per trade</th><th>Limit, all trades</th><th>Charges, full trade</th></tr></thead><tbody>${preview.map((c) => { const ch = charges(c, c, 1); return `<tr><td>${inr(c)}${c === a.capital ? ' <span class="faint">(now)</span>' : ""}</td><td>${inr(c * r.trade)}</td><td>${inr(c * r.book)}</td><td>${inr(ch)} (${((ch / c) * 100).toFixed(2)}%)</td></tr>`; }).join("")}</tbody></table></div><p class="muted">More money means charges take a smaller share of each trade. It didn't make the tested rules profitable at ₹50,000 or ₹1,00,000.</p></div></details>
    <section class="card"><h2>Save a backup</h2><p class="muted">Your trades live only in this browser. Clearing browser data or changing phones erases them, so copy a backup into your notes after each trade.</p>
      ${state.storageOk ? "" : `<div class="notice bad">This browser couldn't save your data. Leave private browsing, or copy a backup now.</div>`}
      ${state.backupError ? `<div class="notice bad">${esc(state.backupError)}</div>` : ""}
      <div class="btns fill"><button data-backup="1">Copy backup</button><button data-restore="1">Restore from text</button></div>
      <label for="backupText">Backup text</label><textarea id="backupText" rows="3" placeholder="Your backup appears here. To restore, paste it here first.">${esc(state.backup)}</textarea></section>`;
  }
  function vHelp() {
    const words = [["Stop-loss", "The price where you sell to limit a loss. Decide it before buying, and never move it lower."], ["Target", "The price where you plan to sell for a profit."], ["Buying range", "The price area where the rules allow a buy."], ["Practice trade", "A pretend trade recorded in this app. No real money or shares are involved."], ["Delivery (CNC)", "You buy shares with your own money and keep them for days or weeks. Choose this on Groww."], ["NIFTY 50", "An index of 50 large Indian companies, often used to judge the whole market."], ["RSI", "A 0–100 measure of how fast a price has moved. Above 70 can mean it rose too quickly."], ["Market fear (VIX)", "India's volatility index. Higher means traders expect bigger price swings."], ["Charges", "Brokerage, taxes and fees. The app includes them in its profit and loss estimates."]];
    return `<section class="card"><h1>How it works</h1><p class="muted">A simple evening checklist that takes about two minutes.</p>
      <ol class="steps"><li><div><strong>After 7:00 PM, open Home</strong><div class="muted">The big message tells you what to do. Often it's nothing, and that's fine.</div></div></li>
      <li><div><strong>Open Plan when told</strong><div class="muted">Split my money holds several companies with one review a month. Dip list is for single trades with a stop-loss.</div></div></li>
      <li><div><strong>Follow the label in My trades</strong><div class="muted">Hold means do nothing. Target reached or Exit now means record the sale.</div></div></li>
      <li><div><strong>Save a backup</strong><div class="muted">After any change, go to My money and copy your backup into your notes.</div></div></li></ol></section>
    <div class="two-col"><section class="card"><h2>What the app can't do</h2><ul class="muted" style="margin:0;padding-left:18px;display:grid;gap:6px"><li>Promise profit or 100% certainty</li><li>Show live prices or send alerts</li><li>Read news or company results</li><li>Buy or sell shares for you</li></ul></section>
    <section class="card"><h2>Is the data real?</h2><p class="muted">Yes. Prices are real closing prices from NSE and Yahoo Finance, updated once each market day. Plans, scores and profit figures are estimates based on those prices. Always check the current price in Groww.</p></section></div>
    <section class="card"><h2>Words explained</h2><dl class="words">${words.map((w) => `<div><dt>${esc(w[0])}</dt><dd>${esc(w[1])}</dd></div>`).join("")}</dl></section>
    <section class="card"><h2>Add it to your phone</h2><p class="muted"><strong>Chrome (Android):</strong> tap ⋮, then Add to Home screen.<br><strong>Safari (iPhone):</strong> tap Share, then Add to Home Screen.</p></section>
    <p class="faint">Research support from fixed rules, not advice from a SEBI-registered adviser. Never share your Groww password, PIN or OTP.</p>`;
  }

  /* ---------- render ---------- */
  function render() {
    $("nav").innerHTML = TABS.map(([id, name, ic]) => `<button data-tab="${id}" ${state.tab === id ? 'aria-current="page"' : ""}>${icon(ic)}<span>${name}</span></button>`).join("");
    $("stamp").textContent = state.report ? "Updated for " + niceDate(state.report.asOf) : state.loaded ? "No report yet" : "Loading…";
    if (state.loaded) $("app").innerHTML = { home: vHome, stocks: vPlan, trades: vTrades, money: vMoney, help: vHelp }[state.tab]();
  }
  function setTab(t) {
    t = OLD_TABS[t] || t;
    state.tab = TABS.some((x) => x[0] === t) ? t : "home";
    state.error = ""; state.closing = null; state.delArm = null;
    if (state.tab === "help" && !state.data.guideSeen) { state.data.guideSeen = true; save(); }
    try { location.hash = state.tab; } catch (e) {}
    render(); window.scrollTo(0, 0);
  }
  function commit() { save(); state.error = ""; render(); }

  function readPlanAmt() {
    const el = $("planAmt");
    if (el) { const v = num(el.value); state.planAmt = v == null ? null : Math.floor(v); }
  }
  document.addEventListener("change", (ev) => { if (ev.target && ev.target.id === "planAmt") { readPlanAmt(); state.error = ""; render(); } });

  document.addEventListener("click", (ev) => {
    const b = ev.target.closest("button"); if (!b) return;
    if (b.id === "themeBtn") { state.data.theme = resolvedTheme() === "dark" ? "light" : "dark"; save(); applyTheme(); return; }
    const d = b.dataset;
    state.backupError = "";
    if (!d.planstop) state.stopArm = false;
    if (d.planview) { state.planView = d.planview; state.error = ""; return render(); }
    if (d.plann) { readPlanAmt(); state.planN = +d.plann; return render(); }
    if (d.planstart) {
      readPlanAmt();
      const max = Math.max(0, Math.floor(account("paper").cash)), amt = state.planAmt == null ? max : state.planAmt;
      if (!(amt > 0)) { state.error = "Enter an amount above zero."; return render(); }
      if (amt > max) { state.error = `You have ${inr(max)} of practice money available.`; return render(); }
      state.data.basket = { n: state.planN, startValue: amt, cash: amt, holdings: [], sold: [], startedOn: today(), lastReview: monthOf(state.report.asOf), firstBuyDate: null, startNifty: null };
      state.planAmt = null; return commit();
    }
    if (d.planreview) { applyReview(); window.scrollTo(0, 0); return commit(); }
    if (d.planadd) { const x = Math.floor(account("paper").cash); if (x > 0) { state.data.basket.cash += x; state.data.basket.startValue += x; } return commit(); }
    if (d.planstop) {
      if (!state.stopArm) { state.stopArm = true; return render(); }
      state.stopArm = false; state.data.basketRealized = (state.data.basketRealized || 0) + basketResult(state.data.basket).gain; state.data.basket = null; return commit();
    }
    if (d.tab) return setTab(d.tab);
    if (d.dismiss) { state.data.guideSeen = true; return commit(); }
    if (d.risk) { state.data.riskLevel = d.risk; return commit(); }
    if (d.acct) { state.data.account = d.acct; return commit(); }
    if (d.showform) { state.showForm = true; state.error = ""; return render(); }
    if (d.hideform) { state.showForm = false; state.prefill = null; state.error = ""; return render(); }
    if (d.log) { const c = state.report.candidates.find((x) => x.symbol === d.log), p = plan(c, c.close); state.prefill = { symbol: c.symbol, buy: c.close, qty: p.q, stop: c.stop, target: c.t2 }; return setTab("trades"); }
    if (d.close) { state.closing = d.close; state.error = ""; return render(); }
    if (d.cancel) { state.closing = null; state.error = ""; return render(); }
    if (d.del) {
      if (state.delArm !== d.del) { state.delArm = d.del; return render(); }
      state.delArm = null; state.data.trades = state.data.trades.filter((t) => t.id !== d.del); return commit();
    }
    if (d.backup) { state.backup = JSON.stringify(state.data); state.error = ""; render(); const t = $("backupText"); t.focus(); t.select(); if (navigator.clipboard) navigator.clipboard.writeText(state.backup).catch(() => {}); return; }
    if (d.restore) {
      try {
        const parsed = JSON.parse($("backupText").value);
        if (!Array.isArray(parsed.trades) || !Array.isArray(parsed.deposits)) throw new Error("shape");
        state.data = Object.assign(FRESH(), parsed); state.backup = ""; applyTheme(); return commit();
      } catch (e) { state.backupError = "That text isn't a valid backup, so nothing changed."; return render(); }
    }
  });

  document.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const f = ev.target; state.error = "";
    if (f.id === "tradeForm") {
      const t = { id: "t" + Date.now().toString(36), symbol: $("fSym").value.trim().toUpperCase(), mode: $("fMode").value, buyPrice: num($("fBuy").value), qty: Math.floor(num($("fQty").value) || 0), stop: num($("fStop").value), target: num($("fTarget").value), buyDate: $("fDate").value };
      if (!/^[A-Z0-9&\-]{1,20}$/.test(t.symbol)) state.error = "Enter a valid NSE symbol, such as PNB.";
      else if (!(t.buyPrice > 0) || !(t.qty > 0)) state.error = "Buy price and number of shares must be above zero.";
      else if (!(t.stop > 0) || t.stop >= t.buyPrice) state.error = "The stop-loss must be below the buy price.";
      else if (!(t.target > t.buyPrice)) state.error = "The target must be above the buy price.";
      else if (t.buyPrice * t.qty > account(t.mode).cash) state.error = `This trade costs ${inr(t.buyPrice * t.qty)}, but you have ${inr(account(t.mode).cash)} available. Add money or use fewer shares.`;
      if (state.error) return render();
      state.data.trades.push(t); state.prefill = null; state.showForm = false; commit();
    } else if (f.dataset.closeform) {
      const sp = num($("sellPx").value);
      if (!(sp > 0)) { state.error = "Enter a sell price above zero."; return render(); }
      const t = state.data.trades.find((x) => x.id === f.dataset.closeform);
      t.sellPrice = sp; t.sellDate = $("sellDate").value; state.closing = null; commit();
    } else if (f.id === "depForm") {
      const dir = ev.submitter && ev.submitter.value === "-1" ? -1 : 1, amt = num($("dAmt").value);
      if (!(amt > 0)) { state.error = "Enter an amount above zero."; return render(); }
      if (dir < 0 && amt > account(mode()).cash) { state.error = "You can't take out more than your available money."; return render(); }
      state.data.deposits.push({ date: $("dDate").value, amount: dir * amt }); commit();
    }
  });

  async function getJson(name) {
    const res = await fetch(name + "?t=" + Date.now(), { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
  }
  async function boot() {
    const h = (location.hash || "").replace("#", ""), mapped = OLD_TABS[h] || h;
    if (TABS.some((t) => t[0] === mapped)) state.tab = mapped;
    applyTheme();
    if (window.matchMedia) { const q = matchMedia("(prefers-color-scheme: dark)"); if (q.addEventListener) q.addEventListener("change", applyTheme); }
    render();
    const [r, p] = await Promise.allSettled([getJson("report.json"), getJson("prices.json")]);
    if (r.status === "fulfilled") state.report = r.value;
    if (p.status === "fulfilled") state.prices = p.value;
    state.offline = r.status !== "fulfilled" && navigator.onLine === false;
    state.loaded = true;
    render();
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  window.addEventListener("hashchange", () => { const h = location.hash.replace("#", ""); if (h && h !== state.tab) setTab(h); });
  boot();
})();
