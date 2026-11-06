// Delivery Desk: no account, no AI and no server. Journal and settings stay in this phone's browser.
(function () {
  const STORE = "delivery-desk-v1";
  const TABS = [["today", "Today"], ["watchlist", "Watchlist"], ["journal", "Journal"], ["money", "Money"]];
  const RISK = { low: { label: "Low", trade: 0.005, book: 0.01 }, medium: { label: "Medium", trade: 0.01, book: 0.02 } };
  const DEFAULT_CHARGES = { pct: 0.001, min: 5, max: 20, stt: 0.001, exch: 0.0000297, sebi: 0.000001, stamp: 0.00015, dp: 20, dpSmall: 3.5, gst: 0.18 };
  const today = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  const FRESH = () => ({ deposits: [{ date: today(), amount: 15000 }], riskLevel: "medium", account: "paper", trades: [] });

  const state = { tab: "today", report: null, prices: null, loaded: false, offline: false, data: load(), prefill: null, closing: null, delArm: null, error: "", backup: "", storageOk: true };

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
  const $ = (id) => document.getElementById(id);
  const mode = () => (state.data.account === "real" ? "real" : "paper");
  const riskCfg = () => RISK[state.data.riskLevel] || RISK.medium;

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
    const realized = closed.reduce((s, t) => s + netOf(t), 0);
    const invested = open.reduce((s, t) => s + t.buyPrice * t.qty, 0);
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
  function plan(c) {
    const a = account(mode()), r = riskCfg();
    const limit = Math.min(a.capital * r.trade, a.capital * r.book - a.openRisk);
    const maxQ = Math.floor(Math.max(a.cash, 0) / c.entry);
    let q = 0;
    for (let k = 1; k <= maxQ; k++) { if ((c.entry - c.stop) * k + charges(c.entry, c.stop, k) <= limit) q = k; else break; }
    if (!q) return { q: 0, limit };
    const loss = (c.entry - c.stop) * q + charges(c.entry, c.stop, q);
    const n1 = (c.t1 - c.entry) * q - charges(c.entry, c.t1, q), n2 = (c.t2 - c.entry) * q - charges(c.entry, c.t2, q);
    return { q, limit, invest: c.entry * q, loss, n1, n2, chg: charges(c.entry, c.t2, q), rr: n2 / loss, gross: (c.t2 - c.entry) / (c.entry - c.stop) };
  }
  function validation() {
    const v = (state.report && state.report.validation) || {}, s = stats("paper");
    const checks = [
      ["20 paper sessions tracked", (v.sessionsTracked || 0) >= 20, (v.sessionsTracked || 0) + " of 20"],
      ["At least 20 closed paper trades", s.n >= 20, s.n + " closed"],
      ["Paper trades net positive after charges", s.n > 0 && s.net > 0, s.n ? signed(s.net) : "No trades yet"],
      ["Backtest shows an edge after charges", v.backtestEdge === true, v.backtestEdge === true ? "Yes" : "Not found"],
    ];
    return { checks, ok: checks.every((c) => c[1]) };
  }
  function posStatus(t) {
    const p = state.prices && state.prices.prices && state.prices.prices[t.symbol];
    if (p == null) return { label: "No price in report", tone: "", close: null };
    if (p <= t.stop) return { label: "EXIT: stop reached", tone: "bad", close: p };
    if (p >= t.target) return { label: "SELL: target reached", tone: "good", close: p };
    if (p <= t.stop * 1.015) return { label: "Near stop", tone: "warn", close: p };
    return { label: "HOLD", tone: "", close: p };
  }

  function vToday() {
    const r = state.report;
    if (!r) return `<section class="panel"><h1>Delivery Desk</h1><p>${state.offline ? "You're offline and no report is saved yet. Connect once to load it." : "No report has been published yet. It appears after the first daily run."}</p></section>`;
    const days = Math.floor((new Date(today()) - new Date(r.asOf)) / 86400000);
    const v = validation();
    const alerts = state.data.trades.filter((t) => t.sellPrice == null).map((t) => [t, posStatus(t)]).filter((x) => x[1].tone);
    return `<section class="panel">
      <div class="row"><span class="muted">End of day, ${esc(r.asOf)}. Not live.</span><span class="pill ${esc(r.verdictTone)}">${esc(r.classification)}</span></div>
      <div class="verdict">${esc(r.verdict)}</div><p>${esc(r.summary)}</p>
      <p class="muted">Decided by fixed rules, with no AI. Fundamentals and news are not assessed.</p></section>
    ${days > 4 ? `<div class="notice warn">This report is ${days} days old, so treat every level as out of date.</div>` : ""}
    ${state.offline ? `<div class="notice warn">You're offline, so this is the last saved report.</div>` : ""}
    ${alerts.length ? `<section class="panel"><h2>Your trades need attention</h2><ul>${alerts.map(([t, s]) => `<li><strong>${esc(t.symbol)}</strong> (${t.mode}): ${esc(s.label)}, close ${px(s.close)}</li>`).join("")}</ul></section>` : ""}
    <section class="panel"><h2>Can this give you 100% certainty?</h2>
      <p>No. Nothing can do that with shares, and a medium-risk plan can still lose money. Your only no-risk choices are cash and paper trades.</p>
      <div class="notice ${v.ok ? "good" : "warn"}">${v.ok ? "All four checks pass. Real money is still your decision." : "Paper trading only for now: the checks below are not met."}</div>
      <ul>${v.checks.map((c) => `<li>${c[1] ? "Met" : "Not met"}: ${esc(c[0])} <span class="muted">(${esc(c[2])})</span></li>`).join("")}</ul></section>
    ${r.evidence ? `<section class="panel stack"><h2>What the evidence says</h2><p>${esc(r.evidence.summary)}</p>
      <div class="scroll"><table><thead><tr><th>Approach</th><th>Start</th><th>End</th><th>Worst fall</th></tr></thead><tbody>
      ${r.evidence.rows.map((x) => `<tr class="${x.highlight ? "hl" : ""}"><td>${esc(x.label)}</td><td>${inr(x.start)}</td><td>${inr(x.end)}</td><td>${esc(x.dd)}%</td></tr>`).join("")}
      </tbody></table></div><p class="muted">${esc(r.evidence.note)}</p></section>` : ""}
    <section class="panel stack"><h2>Market</h2>
      <div class="scroll"><table><thead><tr><th>Measure</th><th>Close</th><th>1 day</th><th>5 days</th><th>RSI</th></tr></thead><tbody>
      ${(r.market || []).filter((m) => !m.missing).map((m) => `<tr><td>${esc(m.name)}</td><td>${Number(m.close).toLocaleString("en-IN")}</td><td class="${cls(m.d1)}">${m.d1 > 0 ? "+" : ""}${esc(m.d1)}%</td><td class="${cls(m.d5)}">${m.d5 > 0 ? "+" : ""}${esc(m.d5)}%</td><td>${esc(m.rsi)}</td></tr>`).join("")}
      </tbody></table></div><ul>${(r.notes || []).concat(r.gaps || []).map((n) => `<li>${esc(n)}</li>`).join("")}</ul></section>
    <p class="muted">Research support from fixed rules, not advice from a SEBI-registered adviser. Decisions and orders stay with you. This app can't place orders and never asks for your Groww login.</p>`;
  }

  function vWatch() {
    const r = state.report, cands = (r && r.candidates) || [], m = mode(), a = account(m), risk = riskCfg();
    const head = `<section class="panel"><h1>Watchlist</h1>
      <p class="muted">Sized for your ${m} account: ${inr(a.capital)} capital, ${inr(a.cash)} cash, ${risk.label.toLowerCase()} risk of ${inr(a.capital * risk.trade)} per trade including charges.</p></section>`;
    if (!cands.length) return head + `<section class="panel"><p>No stock passes the rules in this report. Staying in cash is a valid decision.</p></section>`;
    return head + cands.map((c) => {
      const p = plan(c), tone = c.recommendation === "AVOID" ? "bad" : c.recommendation === "PAPER SETUP" ? "good" : "warn";
      return `<section class="panel">
        <div class="row"><h2>${esc(c.symbol)}</h2><span class="pill ${tone}">${esc(c.recommendation)} · ${esc(c.score)}/${esc(c.scoreOf)}</span></div>
        <p class="muted">${esc(c.name)} · ${esc(c.sector)} · close ${px(c.close)}</p>
        <dl class="kv"><dt>Entry zone</dt><dd>${px(c.entryLow)}–${px(c.entryHigh)}</dd><dt>Stop-loss</dt><dd>${px(c.stop)}</dd><dt>Target 1 / Target 2</dt><dd>${px(c.t1)} / ${px(c.t2)}</dd>
        ${p.q ? `<dt>Quantity</dt><dd>${p.q} (${inr(p.invest)})</dd><dt>Net loss at stop</dt><dd class="neg">${inr(p.loss)}</dd><dt>Net profit at T1 / T2</dt><dd class="pos">${inr(p.n1)} / ${inr(p.n2)}</dd><dt>Charges</dt><dd>~${inr(p.chg)}</dd><dt>Risk/reward: gross → net</dt><dd>${p.gross.toFixed(2)} → ${p.rr.toFixed(2)}</dd>` : ""}</dl>
        ${p.q ? "" : `<div class="notice warn">No quantity fits your risk limit of ${inr(Math.max(p.limit, 0))} at this stop, so skip this one.</div>`}
        <details><summary>Details and checks to do</summary><div>
          <p class="muted">RSI ${esc(c.rsi)}, volume ${esc(c.volRatio)}x average, delivery ${c.delivery == null ? "not available" : esc(c.delivery) + "%"}, 20-day strength against NIFTY ${esc(c.rs20)} points.</p>
          <p class="muted">EMA 20 ${esc(c.ema20)}, EMA 50 ${esc(c.ema50)}, EMA 200 ${esc(c.ema200)}. Support ${esc((c.supportLevels || []).join(", "))}. Resistance ${esc((c.resistanceLevels || []).join(", "))}.</p>
          <ul>${Object.entries(c.parts || {}).map(([k, v]) => `<li>${esc(k)}: ${v[0]} of ${v[1]}</li>`).join("")}</ul>
          <div class="notice warn">The rules don't read results or news. Check them yourself before any trade: <a href="https://www.screener.in/company/${encodeURIComponent(c.symbol)}/consolidated/" target="_blank" rel="noopener">Screener</a> · <a href="https://www.nseindia.com/get-quotes/equity?symbol=${encodeURIComponent(c.symbol)}" target="_blank" rel="noopener">NSE</a></div>
        </div></details>
        ${p.q ? `<button data-log="${esc(c.symbol)}">Log as paper trade</button>` : ""}</section>`;
    }).join("");
  }

  function vCard(t) {
    const s = posStatus(t), un = s.close != null ? (s.close - t.buyPrice) * t.qty : null;
    return `<section class="panel"><div class="row"><h2>${esc(t.symbol)}</h2><span class="pill ${s.tone}">${esc(s.label)}</span></div>
      <p class="muted">${t.mode === "real" ? "Real money" : "Paper"} · bought ${esc(t.buyDate)}</p>
      <dl class="kv"><dt>Quantity × buy price</dt><dd>${t.qty} × ${px(t.buyPrice)}</dd><dt>Invested</dt><dd>${inr(t.buyPrice * t.qty)}</dd><dt>Stop / target</dt><dd>${px(t.stop)} / ${px(t.target)}</dd>
      ${s.close != null ? `<dt>Close (${esc(state.prices.asOf)})</dt><dd>${px(s.close)}</dd><dt>Unrealized, before charges</dt><dd class="${cls(un)}">${signed(un)}</dd>` : ""}</dl>
      ${state.closing === t.id ? `<form data-closeform="${esc(t.id)}" class="stack"><div class="grid2"><label>Sell price (₹)<input id="sellPx" required inputmode="decimal"></label><label>Sell date<input id="sellDate" type="date" required value="${today()}"></label></div>
        ${state.error ? `<div class="notice bad">${esc(state.error)}</div>` : ""}<div class="btns fill"><button class="primary" type="submit">Close trade</button><button type="button" data-cancel="1">Keep open</button></div></form>`
      : `<div class="btns fill"><button data-close="${esc(t.id)}">Record sale</button><button data-del="${esc(t.id)}">${state.delArm === t.id ? "Tap again to delete" : "Delete"}</button></div>`}</section>`;
  }

  function vJournal() {
    const open = state.data.trades.filter((t) => t.sellPrice == null);
    const closed = state.data.trades.filter((t) => t.sellPrice != null).sort((a, b) => String(b.sellDate).localeCompare(String(a.sellDate)));
    const f = state.prefill || {}, showErr = state.error && !state.closing;
    const line = (l, s) => `<tr><td>${l}</td><td>${s.n}</td><td>${s.n ? s.win.toFixed(0) + "%" : "–"}</td><td class="${cls(s.net)}">${s.n ? signed(s.net) : "–"}</td><td>${s.n ? inr(s.chg) : "–"}</td><td>${s.n ? s.dd.toFixed(1) + "%" : "–"}</td></tr>`;
    return `<section class="panel stack"><h1>Journal</h1><div class="scroll"><table><thead><tr><th>Account</th><th>Closed</th><th>Win</th><th>Net</th><th>Charges</th><th>Drawdown</th></tr></thead><tbody>${line("Paper", stats("paper"))}${line("Real", stats("real"))}</tbody></table></div>
      <p class="muted">Net figures are after estimated charges. Unrealized gains stay out of them.</p></section>
    <form id="tradeForm" class="panel"><h2>Log a trade</h2><div class="grid2">
      <label>Symbol<input id="fSym" required value="${esc(f.symbol || "")}" autocapitalize="characters" placeholder="TECHM"></label>
      <label>Type<select id="fMode"><option value="paper">Paper</option><option value="real">Real money</option></select></label>
      <label>Buy price (₹)<input id="fBuy" required inputmode="decimal" value="${esc(f.buy || "")}"></label><label>Quantity<input id="fQty" required inputmode="numeric" value="${esc(f.qty || "")}"></label>
      <label>Stop-loss (₹)<input id="fStop" required inputmode="decimal" value="${esc(f.stop || "")}"></label><label>Target (₹)<input id="fTarget" required inputmode="decimal" value="${esc(f.target || "")}"></label>
      <label>Buy date<input id="fDate" type="date" required value="${today()}"></label></div>
      ${showErr ? `<div class="notice bad">${esc(state.error)}</div>` : ""}<button class="primary" type="submit">Save trade</button></form>
    <h2>Open (${open.length})</h2>${open.length ? open.map(vCard).join("") : `<section class="panel"><p class="muted">No open trades. Tap "Log as paper trade" on a Watchlist stock, or fill in the form above.</p></section>`}
    <h2>Closed (${closed.length})</h2>${closed.length ? `<section class="panel"><div class="scroll"><table><thead><tr><th>Trade</th><th>Buy</th><th>Sell</th><th>Qty</th><th>Net</th></tr></thead><tbody>${closed.map((t) => { const n = netOf(t); return `<tr><td>${esc(t.symbol)} <span class="muted">${t.mode}, ${esc(t.sellDate)}</span></td><td>${px(t.buyPrice)}</td><td>${px(t.sellPrice)}</td><td>${t.qty}</td><td class="${cls(n)}">${signed(n)}</td></tr>`; }).join("")}</tbody></table></div></section>` : `<section class="panel"><p class="muted">Closed trades and their net results appear here.</p></section>`}`;
  }

  function vMoney() {
    const m = mode(), a = account(m), r = riskCfg(), d = state.data;
    const preview = [a.capital, 25000, 50000, 100000, 500000].filter((v, i, x) => v > 0 && x.indexOf(v) === i).sort((p, q) => p - q);
    return `<section class="panel"><h1>Money</h1><p class="muted">Add money here whenever you invest more. Position sizes, risk limits and charges update on every tab.</p>
      <dl class="kv"><dt>Money added</dt><dd>${inr(deposited())}</dd><dt>Realized net (${m})</dt><dd class="${cls(a.realized)}">${signed(a.realized)}</dd><dt>Capital (${m})</dt><dd>${inr(a.capital)}</dd><dt>Invested</dt><dd>${inr(a.invested)}</dd><dt>Available cash</dt><dd>${inr(a.cash)}</dd><dt>Risk now open</dt><dd>${inr(a.openRisk)}</dd></dl></section>
    <form id="depForm" class="panel"><h2>Add or withdraw</h2><div class="grid2"><label>Amount (₹)<input id="dAmt" required inputmode="numeric" placeholder="10000"></label><label>Date<input id="dDate" type="date" required value="${today()}"></label></div>
      ${state.error ? `<div class="notice bad">${esc(state.error)}</div>` : ""}<div class="btns fill"><button class="primary" type="submit" value="1">Add money</button><button type="submit" value="-1">Withdraw</button></div>
      <div class="scroll"><table><thead><tr><th>Date</th><th>Amount</th></tr></thead><tbody>${d.deposits.slice().reverse().map((x) => `<tr><td>${esc(x.date)}</td><td class="${cls(x.amount)}">${signed(x.amount)}</td></tr>`).join("")}</tbody></table></div></form>
    <section class="panel"><h2>Risk level</h2><div class="btns fill">${Object.keys(RISK).map((k) => `<button data-risk="${k}" aria-pressed="${d.riskLevel === k}">${RISK[k].label}: ${(RISK[k].trade * 100).toFixed(1)}%</button>`).join("")}</div>
      <p class="muted">This is the most you plan to lose per trade, as a share of capital and including charges. Open trades are capped at twice that in total. Overnight gaps can still cause bigger losses.</p></section>
    <section class="panel"><h2>Size plans for</h2><div class="btns fill"><button data-acct="paper" aria-pressed="${m === "paper"}">Paper</button><button data-acct="real" aria-pressed="${m === "real"}">Real money</button></div>
      ${m === "real" ? `<div class="notice bad">Real-money sizing is on, but the checks on Today ${validation().ok ? "pass, so this remains your call" : "have not passed. The tested rules lost money"}.</div>` : ""}</section>
    <section class="panel stack"><h2>What more money changes</h2><div class="scroll"><table><thead><tr><th>Capital</th><th>Risk per trade</th><th>Open-risk cap</th><th>Charges, full position</th></tr></thead><tbody>
      ${preview.map((c) => { const ch = charges(c, c, 1); return `<tr class="${c === a.capital ? "hl" : ""}"><td>${inr(c)}</td><td>${inr(c * r.trade)}</td><td>${inr(c * r.book)}</td><td>${inr(ch)} (${((ch / c) * 100).toFixed(2)}%)</td></tr>`; }).join("")}
      </tbody></table></div><p class="muted">More capital lowers charges as a share of each trade. It did not make the tested rules profitable at ₹50,000 or ₹1,00,000.</p></section>
    <section class="panel"><h2>Back up your journal</h2><p class="muted">Your data lives only in this browser. Clearing browser data or changing phones erases it, so copy a backup to your notes after each trade.</p>
      ${state.storageOk ? "" : `<div class="notice bad">This browser refused to save your data. Leave private browsing, or copy a backup now.</div>`}
      ${state.backupError ? `<div class="notice bad">${esc(state.backupError)}</div>` : ""}
      <div class="btns fill"><button data-backup="1">Show backup</button><button data-restore="1">Restore from text</button></div>
      <label for="backupText">Backup text</label><textarea id="backupText" rows="4">${esc(state.backup)}</textarea></section>`;
  }

  function render() {
    $("nav").innerHTML = TABS.map(([id, name]) => `<button data-tab="${id}" ${state.tab === id ? 'aria-current="page"' : ""}>${name}</button>`).join("");
    if (state.loaded) $("app").innerHTML = { today: vToday, watchlist: vWatch, journal: vJournal, money: vMoney }[state.tab]();
  }
  function setTab(t) {
    state.tab = TABS.some((x) => x[0] === t) ? t : "today";
    state.error = ""; state.closing = null; state.delArm = null;
    try { location.hash = state.tab; } catch (e) {}
    render(); window.scrollTo(0, 0);
  }
  function commit() { save(); state.error = ""; render(); }

  document.addEventListener("click", (ev) => {
    const b = ev.target.closest("button"); if (!b) return;
    const d = b.dataset;
    state.backupError = "";
    if (d.tab) return setTab(d.tab);
    if (d.risk) { state.data.riskLevel = d.risk; return commit(); }
    if (d.acct) { state.data.account = d.acct; return commit(); }
    if (d.log) { const c = state.report.candidates.find((x) => x.symbol === d.log), p = plan(c); state.prefill = { symbol: c.symbol, buy: c.entry, qty: p.q, stop: c.stop, target: c.t2 }; return setTab("journal"); }
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
        state.data = Object.assign(FRESH(), parsed); state.backup = ""; return commit();
      } catch (e) { state.backupError = "That text isn't a valid backup, so nothing changed."; return render(); }
    }
  });

  document.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const f = ev.target; state.error = "";
    if (f.id === "tradeForm") {
      const t = { id: "t" + Date.now().toString(36), symbol: $("fSym").value.trim().toUpperCase(), mode: $("fMode").value, buyPrice: num($("fBuy").value), qty: Math.floor(num($("fQty").value) || 0), stop: num($("fStop").value), target: num($("fTarget").value), buyDate: $("fDate").value };
      if (!/^[A-Z0-9&\-]{1,20}$/.test(t.symbol)) state.error = "Enter a valid NSE symbol.";
      else if (!(t.buyPrice > 0) || !(t.qty > 0)) state.error = "Buy price and quantity must be above zero.";
      else if (!(t.stop > 0) || t.stop >= t.buyPrice) state.error = "The stop-loss must be below the buy price.";
      else if (!(t.target > t.buyPrice)) state.error = "The target must be above the buy price.";
      else if (t.buyPrice * t.qty > account(t.mode).cash) state.error = `That costs ${inr(t.buyPrice * t.qty)}, more than your ${inr(account(t.mode).cash)} ${t.mode} cash. Delivery trades here use your own money only.`;
      if (state.error) return render();
      state.data.trades.push(t); state.prefill = null; commit();
    } else if (f.dataset.closeform) {
      const sp = num($("sellPx").value);
      if (!(sp > 0)) { state.error = "Enter a sell price above zero."; return render(); }
      const t = state.data.trades.find((x) => x.id === f.dataset.closeform);
      t.sellPrice = sp; t.sellDate = $("sellDate").value; state.closing = null; commit();
    } else if (f.id === "depForm") {
      const dir = ev.submitter && ev.submitter.value === "-1" ? -1 : 1, amt = num($("dAmt").value);
      if (!(amt > 0)) { state.error = "Enter an amount above zero."; return render(); }
      if (dir < 0 && amt > account(mode()).cash) { state.error = "You can't withdraw more than your available cash."; return render(); }
      state.data.deposits.push({ date: $("dDate").value, amount: dir * amt }); commit();
    }
  });

  async function getJson(name) {
    const res = await fetch(name + "?t=" + Date.now(), { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
  }
  async function boot() {
    const h = (location.hash || "").replace("#", "");
    if (TABS.some((t) => t[0] === h)) state.tab = h;
    render();
    const [r, p] = await Promise.allSettled([getJson("report.json"), getJson("prices.json")]);
    if (r.status === "fulfilled") state.report = r.value;
    if (p.status === "fulfilled") state.prices = p.value;
    state.offline = r.status !== "fulfilled" && typeof navigator !== "undefined" && navigator.onLine === false;
    state.loaded = true;
    render();
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  window.addEventListener("hashchange", () => { const h = location.hash.replace("#", ""); if (h && h !== state.tab) setTab(h); });
  boot();
})();
