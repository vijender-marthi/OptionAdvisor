# OptionAdvisor — Trading Screen Text Improvements

> **Format:** Original text → Improved text → One-line reason  
> **Rules applied:** Precise trading terminology · Specific price levels/metrics · No vague words · Alert format `[URGENCY] — [METRIC] at [LEVEL] — [ACTION by DATE]` · AI Coach: 3 sentences (market context / stock signal / exact action)

---

## 1. TRADE COMMAND CENTER

### 1.1 Page Subtitle

**Original:**
> One decision dashboard for market regime, engine trust, actionable setups, conflicts, alerts, and recent activity.

**Improved:**
> Real-time regime snapshot — engine trust scores, READY/TRADE setups with entry/stop/target, cross-engine conflicts, and smart alerts. Act only when signal quality + execution timing agree.

**Reason:** Tells the trader *what decisions the dashboard drives*, not just what data it contains.

---

### 1.2 Loading State

**Original:**
> Loading Trade Command Center…

**Improved:**
> Fetching regime data and engine signals…

**Reason:** Names what is actually being fetched so the user knows what to wait for.

---

### 1.3 Section Header — Engine Health

**Original:**
> Engine Health / Engine Bias

**Improved:**
> Engine Trust & Directional Bias

**Reason:** "Trust" is the tradeable concept (do I act on this engine's signal?); "Directional Bias" is precise vs. the vague slash construction.

---

### 1.4 Engine Card — Empty Fallback Summary

**Original:**
> No engine summary yet.

**Improved:**
> Engine returned no thesis — wait for next scan cycle before acting.

**Reason:** Passive "yet" gives no action; improved text tells the trader exactly what to do.

---

### 1.5 Engine Snapshots — No Data State

**Original:**
> No engine snapshots from API yet.

**Improved:**
> No engine data loaded — check that the backend is running and the last scan completed successfully.

**Reason:** Surfaces the diagnostic action; removes the vague "yet."

---

### 1.6 Section Header — Actionable Opportunities

**Original:**
> Actionable Trade Opportunities

**Improved:**
> READY / TRADE Setups — Confirmed Edge + Timing

**Reason:** Uses the actual signal vocabulary; signals to the trader that only high-conviction setups appear here.

---

### 1.7 Empty State — Actionable

**Original:**
> No actionable opportunities for the current filters.

**Improved:**
> No READY or TRADE signals match the current filters — widen engine/direction filters or wait for next scan cycle.

**Reason:** Names the exact signal states being filtered and gives the trader a concrete next step.

---

### 1.8 Column Label — Market Bias

**Original:**
> Market Bias

**Improved:**
> Regime Bias

**Reason:** "Regime" is the correct term for the macro tape context an engine uses; "Market Bias" is ambiguous with the individual ticker's bias.

---

### 1.9 Column Label — Execution

**Original:**
> Execution

**Improved:**
> Entry Timing

**Reason:** "Execution" is vague; "Entry Timing" tells the trader what the badge actually answers (OPEN NOW / WAIT / SCALE-IN).

---

### 1.10 Column Label — Confidence

**Original:**
> Confidence

**Improved:**
> Signal Strength

**Reason:** "Signal Strength" maps directly to the underlying score (engine conviction × data quality); avoids conflating it with win-rate confidence.

---

### 1.11 Action Text — Default CTA

**Original:**
> Review details before acting.

**Improved:**
> Verify entry trigger, stop, and target before sizing in.

**Reason:** Specifies the three concrete things to verify (entry/stop/target) instead of the generic "review details."

---

### 1.12 Action Text — Avoid Panel CTA

**Original:**
> Avoid for now.

**Improved:**
> Stand aside — re-evaluate if signal flips to WATCH above key resistance.

**Reason:** Replaces passive avoidance with a conditional re-entry trigger so the trader knows when the stance changes.

---

### 1.13 Action Text — Missing Confirmations (Day Engine)

**Original:**
> Entry conditional: waiting for {list of confirmations}

**Improved:**
> WAIT — confirming: {list of confirmations} before entry is valid.

**Reason:** `WAIT` is the urgency tag; "before entry is valid" frames the conditions as gates, not just a status update.

---

### 1.14 Action Text — Missing Confirmations (Swing/Regular Engine)

**Original:**
> Waiting on: {conditions joined by ·}

**Improved:**
> PENDING — needs: {conditions} to align before acting.

**Reason:** "PENDING" is the signal state; "to align before acting" is directive, not passive.

---

### 1.15 Section Header — Avoid Right Now

**Original:**
> Avoid Right Now

**Improved:**
> AVOID — High-Risk or Conflicting Tickers

**Reason:** States *why* they're in this list (high risk or conflicting signals), giving the trader diagnostic context.

---

### 1.16 Empty State — Avoid Panel

**Original:**
> No avoid list items under the current filters.

**Improved:**
> No AVOID signals under current filters — all scanned tickers are WATCH or better.

**Reason:** Positive framing with signal vocabulary gives the trader meaningful context instead of just an absence.

---

### 1.17 Section Header — Engine Conflict Panel

**Original:**
> Engine Conflict Panel

**Improved:**
> Cross-Engine Signal Conflicts — Do Not Trade Until Resolved

**Reason:** The instruction "Do Not Trade Until Resolved" is the key action; the old label was a description, not a directive.

---

### 1.18 Conflict Card — State Badge

**Original:**
> CONFLICTING_SIGNALS

**Improved:**
> SIGNAL CONFLICT

**Reason:** Human-readable; removes the underscore coding artifact.

---

### 1.19 Conflict Card — Auto-Generated Summary

**Original:**
> {ticker} has conflicting signals across engines.

**Improved:**
> {ticker} — GO signal in {engine A}, AVOID in {engine B}. Timeframe disagreement or liquidity divergence. Do not add size.

**Reason:** Names which engines disagree (adds specificity) and gives an immediate directive.

---

### 1.20 Conflict Card — Resolution Label

**Original:**
> Resolution

**Improved:**
> Root Cause

**Reason:** "Root Cause" matches how traders think about conflicts (what is causing the disagreement) vs. "Resolution" which sounds like it's already been solved.

---

### 1.21 Conflict Card — Resolution Body

**Original:**
> Timeframe or options pricing is creating a disagreement.

**Improved:**
> Likely cause: shorter-timeframe engine sees intraday noise that the swing/regular engine discounts. Check IV rank and daily bias before acting.

**Reason:** Gives an actionable diagnostic path rather than a vague attribution.

---

### 1.22 Conflict Card — Suggested Action

**Original:**
> Suggested action: Prefer smaller size or wait for cleaner agreement before acting.

**Improved:**
> ACTION — Reduce position size by 50% or stand aside until all active engines agree on signal direction.

**Reason:** "ACTION —" is the alert tag; "50%" is specific; "all active engines agree" is a measurable condition.

---

### 1.23 Error Message — Fallback

**Original:**
> Failed to load Trade Command Center

**Improved:**
> Command Center failed to load — verify backend is running on port 9000 and try refreshing.

**Reason:** Includes the diagnostic detail (port 9000) so the developer/user can act immediately.

---

### 1.24 Add-to-Positions Notice

**Original:**
> Opened {ticker} details. Direct add-to-positions from Trade Command Center is not wired yet, so use the ticker advisor flow to confirm and add the trade.

**Improved:**
> {ticker} analysis opened — review entry/stop/target in the Ticker Advisor, then add to Positions from there.

**Reason:** Action-first, removes developer jargon ("not wired yet"), guides the exact workflow step.

---

---

## 2. POSITIONS CENTER — AI GUIDANCE STRINGS

### 2.1 EXIT SOON (DTE ≤ 7)

**Original:**
> Expiry approaching in {dte} days. Consider rolling or closing before theta decay accelerates.

**Improved:**
> EXIT SOON — {dte} DTE remaining. Theta is destroying value daily; close or roll to a later expiry before intrinsic value erodes. If rolling, target ≥ 21 DTE on the new leg.

**Reason:** "Consider" replaced with a directive; theta named as the mechanism; 21 DTE roll target is a specific, standard industry benchmark.

---

### 2.2 WATCH (DTE ≤ 14)

**Original:**
> DTE at {dte}. Set a price alert and review at {dte − 5} DTE for roll decisions.

**Improved:**
> WATCH — {dte} DTE. Set an alert at {dte − 5} DTE. If the position is ≥ 50% of max profit, close now and redeploy. If not, prepare a roll thesis before theta accelerates.

**Reason:** "Set a price alert" is too passive; the 50%-of-max-profit rule is a specific, widely-used exit criterion that replaces the vague "review."

---

### 2.3 CONFLICT (prob_of_profit < 40%)

**Original:**
> Position probability is low ({prob}%). Review thesis and consider reducing size.

**Improved:**
> CONFLICT — P(profit) at {prob}%, below the 40% floor. Original thesis is under stress; cut size by 50% or close if price has moved against your breakeven by more than 1 ATR.

**Reason:** Names the 40% threshold explicitly; "1 ATR" is a specific, measurable exit trigger; "consider reducing" replaced with a binary decision rule.

---

### 2.4 MANAGE — Spread Position

**Original:**
> Spread position active. Monitor the short leg and manage pin risk near expiry.

**Improved:**
> MANAGE — Spread active. Watch the short leg: if it goes ITM with < 7 DTE, buy it back to eliminate pin risk. Set a stop on the spread width at 2× premium paid.

**Reason:** "Monitor" replaced with a specific action trigger (ITM + < 7 DTE); "2× premium paid" is a standard spread stop-loss level.

---

### 2.5 MANAGE — Non-Spread Multi-Leg

**Original:**
> Active management required. Set stop-loss and review position sizing.

**Improved:**
> MANAGE — Multi-leg position requires active oversight. Set a delta-neutral stop: close if net delta exceeds ±0.30 per contract, or if the position loses > 25% of credit received.

**Reason:** "Set stop-loss" is a placeholder; ±0.30 net delta and 25% credit loss are specific, tradeable thresholds.

---

### 2.6 HOLD — Bullish Bias

**Original:**
> Bullish position with {dte} DTE remaining. Trend is your friend — trail stops higher.

**Improved:**
> HOLD — Bullish. {dte} DTE remaining. Trail your stop to just below the last confirmed swing low or VWAP reclaim. Target partial profit at 50% of max, full exit at 80%.

**Reason:** "Trend is your friend" is a cliché with no action; VWAP and swing low are specific stop anchors; 50%/80% are standard profit-taking levels.

---

### 2.7 HOLD — Bearish Bias

**Original:**
> Bearish position with {dte} DTE remaining. Protect against short squeezes with tight stops.

**Improved:**
> HOLD — Bearish. {dte} DTE remaining. Defend against short-squeeze risk: close if price reclaims the prior day's VWAP or breaks above the nearest resistance level with volume confirmation.

**Reason:** Names the specific price event (VWAP reclaim + volume) that signals an invalid thesis; replaces the vague "tight stops."

---

### 2.8 HOLD — Default / Neutral

**Original:**
> Position {dte} DTE out. Monitor thesis and set exit conditions.

**Improved:**
> HOLD — {dte} DTE remaining. Define your exit before the trade moves: set a profit target at 50% of max credit, a stop at 2× the premium paid, and a hard close date at 21 DTE.

**Reason:** "Monitor thesis" has zero instruction; the three explicit conditions (50% profit, 2× stop, 21 DTE close) give the trader a complete management plan.

---

### 2.9 EXIT / Closed Position

**Original:**
> Position closed. Review trade journal for lessons learned.

**Improved:**
> CLOSED — Compare final P&L against your entry thesis: did price reach your target or stop you out? Log entry timing, IV at open, and DTE at close for pattern review.

**Reason:** Specifies *what* to review in the trade journal (entry timing, IV, DTE), converting a generic prompt into a structured debrief.

---

---

## 3. POSITIONS CENTER — POSITION CARD LABELS

### 3.1 "Max profit" label

**Original:**
> Max profit

**Improved:**
> Max Profit (full expiry)

**Reason:** Clarifies this is the theoretical max at expiration, not the recommended exit target (which is 50–80%).

---

### 3.2 "Max loss" label

**Original:**
> Max loss

**Improved:**
> Max Loss / Capital at Risk

**Reason:** "Capital at Risk" is the term traders use when sizing positions; pairing both makes the label immediately actionable for risk managers.

---

### 3.3 "B/E" label

**Original:**
> B/E

**Improved:**
> Breakeven at Expiry

**Reason:** "B/E" is ambiguous; clarifying "at Expiry" prevents confusion with the current P&L breakeven.

---

### 3.4 "Realized $" label

**Original:**
> Realized $

**Improved:**
> Realized P&L ($)

**Reason:** Spells out P&L for clarity; dollar sign after the label keeps it scannable.

---

### 3.5 "Realized %" label

**Original:**
> Realized %

**Improved:**
> Realized P&L (% of cost)

**Reason:** "% of cost" prevents confusion with "% of max profit" — the two different denominators matter for performance benchmarking.

---

### 3.6 "Cur. P&L" label

**Original:**
> Cur. P&L

**Improved:**
> Live P&L (mark-to-market)

**Reason:** "mark-to-market" tells the trader this is based on current mid-price, not the theoretical max — sets correct expectations.

---

### 3.7 "Manual P&L" label (override state)

**Original:**
> Manual P&L

**Improved:**
> P&L Override (manual entry)

**Reason:** "Override" signals that the auto-calculation was bypassed; "(manual entry)" tells the trader where the number came from.

---

### 3.8 DTE display — expiring soon

**Original:**
> {dte} DTE *(highlighted amber)*

**Improved:**
> ⚑ {dte} DTE — EXIT ZONE

**Reason:** The flag glyph and "EXIT ZONE" label communicate urgency at a glance; traders scan cards quickly and need the status to be unambiguous.

---

---

## 4. IMPLEMENTATION NOTES

These are the exact file locations and string keys to update:

| Text | File | Search string |
|---|---|---|
| Page subtitle | `TradeCommandCenter.tsx` | `One decision dashboard for` |
| Section: Engine Health | `TradeCommandCenter.tsx` | `Engine Health / Engine Bias` |
| Section: Actionable | `TradeCommandCenter.tsx` | `Actionable Trade Opportunities` |
| Section: Avoid | `TradeCommandCenter.tsx` | `Avoid Right Now` |
| Section: Conflicts | `TradeCommandCenter.tsx` | `Engine Conflict Panel` |
| Empty: Actionable | `TradeCommandCenter.tsx` | `No actionable opportunities for` |
| Empty: Avoid | `TradeCommandCenter.tsx` | `No avoid list items under` |
| Empty: Conflicts | `TradeCommandCenter.tsx` | `No engine conflicts reported` |
| CTA: default | `TradeCommandCenter.tsx` | `Review details before acting.` |
| CTA: avoid | `TradeCommandCenter.tsx` | `Avoid for now.` |
| CTA: waiting (day) | `TradeCommandCenter.tsx` | `Entry conditional: waiting for` |
| CTA: waiting (swing) | `TradeCommandCenter.tsx` | `Waiting on:` |
| Conflict resolution | `TradeCommandCenter.tsx` | `Timeframe or options pricing` |
| Conflict action | `TradeCommandCenter.tsx` | `Prefer smaller size or wait` |
| Conflict summary | `TradeCommandCenter.tsx` | `has conflicting signals across` |
| AI: EXIT SOON | `PositionsCenter.tsx` | `Expiry approaching in ${dte}` |
| AI: WATCH | `PositionsCenter.tsx` | `DTE at ${dte}. Set a price` |
| AI: CONFLICT | `PositionsCenter.tsx` | `Position probability is low` |
| AI: MANAGE spread | `PositionsCenter.tsx` | `Spread position active.` |
| AI: MANAGE other | `PositionsCenter.tsx` | `Active management required.` |
| AI: HOLD bull | `PositionsCenter.tsx` | `Bullish position with ${dte}` |
| AI: HOLD bear | `PositionsCenter.tsx` | `Bearish position with ${dte}` |
| AI: HOLD default | `PositionsCenter.tsx` | `Position ${dte} DTE out.` |
| AI: closed | `PositionsCenter.tsx` | `Position closed. Review trade` |
| Label: Max profit | `PositionsCenter.tsx` | `>Max profit<` |
| Label: Max loss | `PositionsCenter.tsx` | `>Max loss<` |
| Label: B/E | `PositionsCenter.tsx` | `>B/E<` |
| Label: Realized $ | `PositionsCenter.tsx` | `>Realized $<` |
| Label: Realized % | `PositionsCenter.tsx` | `>Realized %<` |
| Label: Cur. P&L | `PositionsCenter.tsx` | `>Cur. P&L<` |
| Label: Manual P&L | `PositionsCenter.tsx` | `>Manual P&L<` |
