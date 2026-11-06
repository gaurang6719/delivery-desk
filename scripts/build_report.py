#!/usr/bin/env python3
"""Build docs/report.json and docs/prices.json from end-of-day market data.

Standard library only. No AI service and no API key.
Rules are fixed in this file, so the same data always gives the same report.

Usage: python scripts/build_report.py [--force]
Exit codes: 0 report written or nothing new; 1 essential data unavailable.
"""
import csv
import datetime as dt
import io
import json
import pathlib
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = pathlib.Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
IST = dt.timezone(dt.timedelta(hours=5, minutes=30))
HEADERS = {"User-Agent": "Mozilla/5.0"}
NIFTY100_URL = "https://nsearchives.nseindia.com/content/indices/ind_nifty100list.csv"
BHAV_URL = "https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_{}.csv"
CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{}?range=2y&interval=1d"

# Groww delivery schedule as published at groww.in/pricing. Re-check it periodically.
CHARGES = {"checked": "2026-11-06", "pct": 0.001, "min": 5, "max": 20, "stt": 0.001, "exch": 0.0000297,
           "sebi": 0.000001, "stamp": 0.00015, "dp": 20, "dpSmall": 3.5, "gst": 0.18}
REFERENCE_CAPITAL = 15000
REFERENCE_RISK = 0.01
AVOID_BELOW = 45  # 60% of the 75 points this report can assess

INDICES = [("NIFTY 50", "^NSEI"), ("NIFTY 500", "^CRSLDX"), ("BANK NIFTY", "^NSEBANK"), ("India VIX", "^INDIAVIX"),
           ("NIFTY IT", "^CNXIT"), ("NIFTY Auto", "^CNXAUTO"), ("NIFTY Pharma", "^CNXPHARMA"), ("NIFTY Metal", "^CNXMETAL"),
           ("NIFTY FMCG", "^CNXFMCG"), ("NIFTY Energy", "^CNXENERGY"), ("S&P 500", "^GSPC"), ("Brent crude", "BZ=F"), ("USD/INR", "INR=X")]


def fetch(url, timeout=30):
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def chart(symbol):
    url = CHART_URL.format(urllib.parse.quote(symbol))
    for attempt in range(3):
        try:
            res = json.loads(fetch(url))["chart"]["result"][0]
            q = res["indicators"]["quote"][0]
            return [
                {"t": t, "o": o, "h": h, "l": l, "c": c, "v": v or 0}
                for t, o, h, l, c, v in zip(res["timestamp"], q["open"], q["high"], q["low"], q["close"], q["volume"])
                if None not in (o, h, l, c)
            ]
        except Exception:
            time.sleep(1 + attempt)
    return []


def ema(values, n):
    k, out, e = 2 / (n + 1), [], None
    for i, v in enumerate(values):
        if i < n - 1:
            out.append(None)
            continue
        e = sum(values[:n]) / n if e is None else v * k + e * (1 - k)
        out.append(e)
    return out


def rsi(values, n=14):
    if len(values) <= n:
        return None
    gain = loss = 0.0
    for i in range(1, n + 1):
        d = values[i] - values[i - 1]
        gain += max(d, 0)
        loss += max(-d, 0)
    gain /= n
    loss /= n
    for i in range(n + 1, len(values)):
        d = values[i] - values[i - 1]
        gain = (gain * (n - 1) + max(d, 0)) / n
        loss = (loss * (n - 1) + max(-d, 0)) / n
    return 100.0 if loss == 0 else 100 - 100 / (1 + gain / loss)


def macd_hist(values):
    fast, slow = ema(values, 12), ema(values, 26)
    line = [a - b for a, b in zip(fast, slow) if b is not None]
    signal = ema(line, 9)
    return line[-1] - signal[-1], line[-2] - signal[-2]


def atr(rows, n=14):
    trs = [max(rows[i]["h"] - rows[i]["l"], abs(rows[i]["h"] - rows[i - 1]["c"]), abs(rows[i]["l"] - rows[i - 1]["c"])) for i in range(1, len(rows))]
    return sum(trs[-n:]) / n


def charges(buy, sell, qty):
    c = CHARGES
    bt, st = buy * qty, sell * qty
    brokerage = lambda t: max(c["min"], min(c["max"], t * c["pct"]))
    b = brokerage(bt) + brokerage(st)
    ex, se = (bt + st) * c["exch"], (bt + st) * c["sebi"]
    dp = c["dp"] if st >= 100 else c["dpSmall"]
    return b + (bt + st) * c["stt"] + ex + se + bt * c["stamp"] + dp + c["gst"] * (b + ex + se + dp)


def tick(price):
    return round(round(price / 0.05) * 0.05, 2)


def pivots(rows, side=3):
    highs, lows = [], []
    for i in range(side, len(rows) - side):
        window = rows[i - side: i + side + 1]
        if rows[i]["h"] == max(x["h"] for x in window):
            highs.append(rows[i]["h"])
        if rows[i]["l"] == min(x["l"] for x in window):
            lows.append(rows[i]["l"])
    return highs, lows


def trade_plan(rows, m):
    """A pullback entry near EMA 20, a stop below a real swing low, targets from resistance and risk."""
    low, high = m["ema20"] * 0.995, m["ema20"] * 1.01
    entry = min((low + high) / 2, m["close"])
    highs, lows = pivots(rows[-90:])
    supports = [x for x in lows if x < entry * 0.995]
    if not supports:
        return None
    pivot = max(supports)
    stop = pivot - 0.25 * m["atr"]
    risk = entry - stop
    if risk < m["atr"] or risk > 3 * m["atr"]:
        lower = [x - 0.25 * m["atr"] for x in supports if m["atr"] <= entry - (x - 0.25 * m["atr"]) <= 3 * m["atr"]]
        if not lower:
            return None
        stop = max(lower)
        risk = entry - stop
    resistance = sorted(x for x in highs + [m["high52"]] if x >= entry + risk)
    t1 = resistance[0] if resistance else entry + risk
    t2 = max(entry + 2 * risk, t1 + risk) if t1 >= entry + 2 * risk else entry + 2 * risk
    entry, stop, t1, t2 = tick(entry), tick(stop), tick(t1), tick(t2)
    return {"entryLow": tick(low), "entryHigh": tick(high), "entry": entry, "stop": stop, "t1": t1, "t2": t2,
            "inZone": low <= m["close"] <= high, "supportLevels": [round(x, 1) for x in sorted(set(supports))[-2:][::-1]],
            "resistanceLevels": [round(x, 1) for x in resistance[:2]]}


def metrics(symbol, nifty):
    rows = chart(symbol + ".NS")
    if len(rows) < 210:
        return None
    closes = [r["c"] for r in rows]
    hist, hist_prev = macd_hist(closes)
    avg_vol = sum(r["v"] for r in rows[-21:-1]) / 20
    return {
        "symbol": symbol, "rows": rows, "date": bar_date(rows[-1]), "close": closes[-1], "prev": closes[-2],
        "ema20": ema(closes, 20)[-1], "ema50": ema(closes, 50)[-1], "ema200": ema(closes, 200)[-1],
        "rsi": rsi(closes), "hist": hist, "histPrev": hist_prev, "atr": atr(rows),
        "volRatio": rows[-1]["v"] / avg_vol if avg_vol else 0,
        "rs20": (closes[-1] / closes[-21] - nifty[-1] / nifty[-21]) * 100,
        "rs60": (closes[-1] / closes[-61] - nifty[-1] / nifty[-61]) * 100,
        "high52": max(r["h"] for r in rows[-252:]),
    }


def bar_date(row):
    return dt.datetime.fromtimestamp(row["t"], IST).date().isoformat()


def market_view(nifty, vix):
    closes = [r["c"] for r in nifty]
    e20, e50, e200 = ema(closes, 20)[-1], ema(closes, 50)[-1], ema(closes, 200)[-1]
    r = rsi(closes)
    vix_c = [x["c"] for x in vix] if vix else []
    vix_jump = (vix_c[-1] / vix_c[-6] - 1) * 100 if len(vix_c) > 6 else None
    above200 = closes[-1] > e200
    points = (4 if above200 else 0) + (3 if r < 70 else 0) + (3 if vix_jump is not None and vix_jump < 10 else 0)
    if not above200 and closes[-1] < e50:
        label = "Moderately bearish"
    elif r >= 70:
        label = "Bullish, overextended"
    elif above200 and e20 > e50:
        label = "Moderately bullish"
    else:
        label = "Sideways"
    return {"points": points, "label": label, "rsi": r, "e20gap": (closes[-1] / e20 - 1) * 100, "vixJump": vix_jump, "above200": above200}


def score(m, plan, market, delivery, sector_rs):
    trend = sum(5 for ok in (m["close"] > m["ema20"], m["ema20"] > m["ema50"], m["close"] > m["ema200"], m["hist"] > 0 and m["hist"] > m["histPrev"]) if ok)
    volume = (5 if m["volRatio"] >= 1 else 3 if m["volRatio"] >= 0.8 else 0)
    volume += (0 if delivery is None else 5 if delivery >= 50 else 3 if delivery >= 40 else 0)
    sector = (5 if (sector_rs or 0) > 0 else 0) + (5 if m["rs20"] > 0 else 0)
    levels = 5 + (5 if abs(m["close"] - plan["entry"]) <= 2 * m["atr"] else 0)
    risk_limit = REFERENCE_CAPITAL * REFERENCE_RISK
    qty = 0
    for k in range(1, int(REFERENCE_CAPITAL // plan["entry"]) + 1):
        if (plan["entry"] - plan["stop"]) * k + charges(plan["entry"], plan["stop"], k) <= risk_limit:
            qty = k
        else:
            break
    net_rr = 0.0
    if qty:
        loss = (plan["entry"] - plan["stop"]) * qty + charges(plan["entry"], plan["stop"], qty)
        net_rr = ((plan["t2"] - plan["entry"]) * qty - charges(plan["entry"], plan["t2"], qty)) / loss
    rr = round(min(15, max(0, net_rr) / 2 * 15))
    parts = {"Trend": [trend, 20], "Volume and delivery": [volume, 10], "Sector and strength": [sector, 10],
             "Support and resistance": [levels, 10], "Net risk/reward": [rr, 15], "Market": [market["points"], 10]}
    return sum(p[0] for p in parts.values()), parts


def load_universe():
    raw = fetch(NIFTY100_URL).decode("utf-8", "replace")
    return [(r["Symbol"].strip(), r["Company Name"].strip(), r["Industry"].strip()) for r in csv.DictReader(io.StringIO(raw))]


def load_bhavcopy(date_iso):
    d = dt.date.fromisoformat(date_iso)
    try:
        raw = fetch(BHAV_URL.format(d.strftime("%d%m%Y"))).decode("utf-8", "replace")
    except Exception as exc:
        print("Bhavcopy unavailable:", exc, file=sys.stderr)
        return {}
    out = {}
    for r in csv.DictReader(io.StringIO(raw)):
        r = {k.strip(): (v or "").strip() for k, v in r.items()}
        if r.get("SERIES") != "EQ":
            continue
        try:
            delivery = float(r["DELIV_PER"])
        except ValueError:
            delivery = None
        try:
            out[r["SYMBOL"]] = {"close": float(r["CLOSE_PRICE"]), "vwap": float(r["AVG_PRICE"]), "delivery": delivery}
        except ValueError:
            continue
    return out


def index_rows():
    rows = []
    for name, sym in INDICES:
        d = chart(sym)
        if len(d) < 30:
            rows.append({"name": name, "missing": True})
            continue
        c = [x["c"] for x in d]
        rows.append({"name": name, "close": round(c[-1], 2), "d1": round((c[-1] / c[-2] - 1) * 100, 2),
                     "d5": round((c[-1] / c[-6] - 1) * 100, 2), "rsi": round(rsi(c), 1), "date": bar_date(d[-1])})
    return rows


def session_count(previous, as_of):
    """Sessions since the first report. Rebuilding the same trading day does not add one."""
    if not previous:
        return 0
    count = int(previous.get("validation", {}).get("sessionsTracked", 0))
    return count if previous.get("asOf") == as_of else count + 1


def main():
    force = "--force" in sys.argv
    DOCS.mkdir(exist_ok=True)
    report_path = DOCS / "report.json"
    previous = json.loads(report_path.read_text("utf-8")) if report_path.exists() else {}

    nifty = chart("^NSEI")
    if len(nifty) < 210:
        print("NIFTY data unavailable. Keeping the previous report.", file=sys.stderr)
        return 1
    as_of = bar_date(nifty[-1])
    if previous.get("asOf") == as_of and not force:
        print("Nothing new for", as_of)
        return 0

    try:
        universe = load_universe()
    except Exception as exc:
        print("NSE list unavailable, reusing the saved list:", exc, file=sys.stderr)
        universe = [tuple(x) for x in previous.get("universe", [])]
    if not universe:
        print("No stock list available. Keeping the previous report.", file=sys.stderr)
        return 1

    nifty_close = [r["c"] for r in nifty]
    with ThreadPoolExecutor(6) as pool:
        results = list(pool.map(lambda u: metrics(u[0], nifty_close), universe))
    info = {u[0]: u for u in universe}
    stocks = [m for m in results if m and m["date"] == as_of]
    if len(stocks) < len(universe) * 0.7:
        print(f"Only {len(stocks)} of {len(universe)} stocks have {as_of} data. Keeping the previous report.", file=sys.stderr)
        return 1

    bhav = load_bhavcopy(as_of)
    market = market_view(nifty, chart("^INDIAVIX"))
    by_sector = {}
    for m in stocks:
        by_sector.setdefault(info[m["symbol"]][2], []).append(m["rs20"])
    sector_rs = {k: sum(v) / len(v) for k, v in by_sector.items()}

    ranked = []
    for m in stocks:
        if not (m["close"] > m["ema50"] and m["close"] > m["ema200"] and m["ema20"] > m["ema50"] and 45 <= m["rsi"] <= 72):
            continue
        plan = trade_plan(m["rows"], m)
        if not plan:
            continue
        sector = info[m["symbol"]][2]
        delivery = bhav.get(m["symbol"], {}).get("delivery")
        total, parts = score(m, plan, market, delivery, sector_rs.get(sector))
        ranked.append((total, m, plan, parts, delivery, sector))
    ranked.sort(key=lambda x: (x[0], x[1]["rs20"]), reverse=True)

    candidates, seen = [], set()
    for total, m, plan, parts, delivery, sector in ranked:
        if sector in seen:
            continue
        seen.add(sector)
        rec = "AVOID" if total < AVOID_BELOW else "PAPER SETUP" if plan["inZone"] else "WAIT FOR ENTRY"
        candidates.append({
            "symbol": m["symbol"], "name": info[m["symbol"]][1], "sector": sector, "score": total, "scoreOf": 75, "parts": parts,
            "recommendation": rec, "close": round(m["close"], 2), "vwap": bhav.get(m["symbol"], {}).get("vwap"),
            "rsi": round(m["rsi"], 1), "volRatio": round(m["volRatio"], 2), "delivery": delivery, "rs20": round(m["rs20"], 1),
            "ema20": round(m["ema20"], 1), "ema50": round(m["ema50"], 1), "ema200": round(m["ema200"], 1), **plan,
        })
        if len(candidates) == 5:
            break

    setups = [c for c in candidates if c["recommendation"] == "PAPER SETUP"]
    if market["points"] < 7:
        verdict, tone = "NO TRADE", "warn"
        why = f"The market check scored {market['points']} of 10 (NIFTY RSI {market['rsi']:.1f}), so new entries should wait."
    elif setups:
        verdict, tone = "PAPER SETUP", "good"
        why = f"{setups[0]['symbol']} is in its entry zone. Log it as a paper trade only, because the tested rules lost money after charges."
    else:
        verdict, tone = "WAIT", "warn"
        why = "No candidate is in its entry zone at a score worth acting on."

    # Monthly plan: strongest 6-month performers above their EMA 200. The app applies it once a month.
    momentum = [
        {"symbol": m["symbol"], "name": info[m["symbol"]][1], "sector": info[m["symbol"]][2], "close": round(m["close"], 2),
         "ret6m": round((m["close"] / m["rows"][-127]["c"] - 1) * 100, 1)}
        for m in stocks if m["close"] > m["ema200"]
    ]
    momentum.sort(key=lambda x: x["ret6m"], reverse=True)

    above20 = sum(m["close"] > m["ema20"] for m in stocks)
    hot = sum(m["rsi"] > 70 for m in stocks)
    report = {
        "asOf": as_of, "generatedAt": dt.datetime.now(IST).isoformat(timespec="minutes"), "verdict": verdict, "verdictTone": tone, "summary": why,
        "classification": market["label"], "market": index_rows(),
        "notes": [f"{above20} of {len(stocks)} NIFTY 100 stocks scanned are above EMA 20, and {hot} have an RSI above 70.",
                  f"NIFTY is {market['e20gap']:.1f}% from its EMA 20."],
        "candidates": candidates, "monthlyPlan": {"marketOk": market["above200"], "ranked": momentum[:20]}, "chargeSchedule": CHARGES, "universe": [list(u) for u in universe],
        "validation": {"sessionsTracked": session_count(previous, as_of), "backtestEdge": False},
        "gaps": [] if bhav else ["NSE delivery data was unavailable today, so delivery percentages are missing."],
    }
    evidence = ROOT / "config" / "evidence.json"
    if evidence.exists():
        report["evidence"] = json.loads(evidence.read_text("utf-8"))

    prices = {s: v["close"] for s, v in bhav.items()} or {m["symbol"]: round(m["close"], 2) for m in stocks}
    (DOCS / "prices.json").write_text(json.dumps({"asOf": as_of, "prices": prices}, separators=(",", ":")), "utf-8")
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=1), "utf-8")
    print(f"Report written for {as_of}: {verdict}; {len(candidates)} candidates; {len(prices)} prices")
    return 0


if __name__ == "__main__":
    sys.exit(main())
