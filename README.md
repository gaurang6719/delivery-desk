# Delivery Desk

A free, phone-friendly research and paper-trading desk for NSE equity delivery trades. It uses fixed rules, with no AI, subscription or API key.

- **Daily report:** GitHub Actions runs `scripts/build_report.py` at about 7:00 PM IST, Monday to Friday, and saves the results to `docs/`.
- **App:** GitHub Pages serves `docs/`. Open it on your phone and add it to your home screen.
- **Your data:** your journal and capital stay in your phone's browser. Nothing about your trades goes to GitHub.

It can't place orders and never needs a broker login.

## Limits

- Prices are end-of-day. There are no live prices or alerts.
- The rules don't read results, news or valuation, so check those yourself using the links in the Watchlist.
- The tested rules lost money after charges, so the app stays in paper mode until its checks pass.
- It is not advice from a SEBI-registered adviser, and no result is guaranteed.

## Maintenance

- **Charges:** compare `CHARGES` in `scripts/build_report.py` with groww.in/pricing every few months.
- **Run it now:** in GitHub, open Actions, then Daily report, then Run workflow.
- **Backup:** Money tab, then Show backup. Paste the text into your notes.
