# SynaptOS Full Overhaul Design

**Date:** 2026-04-17
**Status:** Approved
**Scope:** Three-interface rebuild — Admin Dashboard, POS Electron app, E-ink WebSocket display — on top of the existing v2 backend

---

## 1. Overview

SynaptOS is rebuilt from its current single-component prototype into three distinct, production-grade interfaces that share one Next.js + PostgreSQL backend. The existing backend (aggregation, agent, rules, execution, audit, metrics — 73 completed tasks) is preserved without modification. Only the frontend and the processing pipeline are extended.

**Three interfaces:**
1. **Admin/Manager Dashboard** — chain HQ control tower, campaigns, reports, sample data
2. **POS System** — Electron `.exe`, split product-grid + cart layout
3. **E-ink Display** — full-screen WebSocket price board, compact 6-column grid

**New processing layer:**
- Exa API for external signal crawling
- Five Gemini agents at three effort tiers
- Deterministic guardrails remain the sole execution authority

---

## 2. Decisions Log

| Decision | Choice | Rationale |
|---|---|---|
| POS packaging | Electron `.exe` | Real installable binary for demo |
| Admin frontend | Full rewrite of PrototypeApp + ControlTowerConsole | Current UI is monolithic prototype, not production-grade |
| E-ink transport | WebSocket via socket.io | Matches pitch deck "WebSocket E-ink protocol" claim |
| Design style | Corporate light mode, 4px radius, dark navy accents, top nav + tabs | Boardroom-safe, investor-friendly |
| Campaigns | Flash sales + geo-demographic strategy config | Both types described in business proposal |
| Report format | PDF export | Presentable to auditors and government |
| Admin nav | Top nav with section tabs | More compact, better for wide screens |
| POS layout | Split: product grid left, cart right | Keyboard/mouse desktop POS pattern |
| E-ink grid | Compact 6-column dense grid | Shows 20+ SKUs, better for large inventory |
| External data | Exa API crawl | Live signal ingestion for weather, commodity, demographics |
| AI provider | Gemini (2.0-flash / 2.5-flash / 2.5-pro) | Already configured in project |
| Agent count | 5 agents, 3 effort tiers | Match task complexity to model cost |

---

## 3. Architecture

### 3.1 App Router Structure

```
app/
  (admin)/
    layout.jsx                  ← top nav shell, RBAC: admin + manager
    dashboard/page.jsx          ← chain KPIs, live alerts
    chains/page.jsx             ← per-store monitor
    recommendations/page.jsx    ← run engine, proposals, model runs
    campaigns/page.jsx          ← flash sales + geo-demographic config
    approvals/page.jsx          ← high-risk markdown queue
    tax-writeoff/page.jsx       ← EOL history + PDF export
    sdg-report/page.jsx         ← SDG 12 metrics + PDF export
    settings/page.jsx           ← sample data, thresholds, store profiles
  (pos)/
    layout.jsx                  ← chromeless Electron shell
    page.jsx                    ← POS checkout interface
  (eink)/
    page.jsx                    ← full-screen WebSocket price board
  api/                          ← existing routes, zero changes
  globals.css                   ← extended with new design tokens
  layout.jsx                    ← root layout
server.js                       ← custom Next.js server with socket.io attached
electron/
  main.js                       ← opens /pos in chromeless BrowserWindow
  electron-builder.yml          ← Windows .exe build config
```

### 3.2 New Dependencies

```json
{
  "socket.io": "^4.x",
  "socket.io-client": "^4.x",
  "electron": "^30.x",
  "electron-builder": "^24.x",
  "jspdf": "^2.x",
  "jspdf-autotable": "^3.x",
  "exa-js": "^1.x"
}
```

### 3.3 Existing Backend — Zero Changes

All modules remain untouched:
- `lib/server/aggregation/*` — aggregation runs and snapshot assembly
- `lib/server/agent/*` — provider registry, orchestrator, schemas, validation
- `lib/server/rules/*` — guardrail evaluation, approval request creation
- `lib/server/execution/*` — label, logistics, procurement executors
- `lib/server/prototype-store.js` — all DB tables and repository helpers
- `lib/server/auth.js` — RBAC and session helpers
- `lib/server/events.js` — SSE event bus
- `app/api/*` — all 16 API route groups

---

## 4. Multi-Agent Processing Pipeline

### 4.1 External Data Layer — Exa API

Exa crawls three signal types per aggregation run. Each result is stored as a `SignalObservation` with `simulated: false`.

| Signal | Exa Query Pattern | Fields Extracted |
|---|---|---|
| Weather | `"{district} Ho Chi Minh weather forecast today"` | temperature, humidity, rain probability, forecast_hours |
| Commodity prices | `"Vietnam wholesale {category} price today"` | commodity, unit_price, unit, source_date |
| Demographics | `"{district} HCMC foot traffic spending power"` | district, spending_tier, peak_hours[], profile_type |

Implementation: `lib/server/agent/exa-client.js` — thin wrapper around Exa JS SDK, returns raw text + URL per query.

### 4.2 Five-Agent Pipeline

All agents: `temperature: 0`, strict JSON schema output, no execution authority.

#### Agent 1 — Ingestion Agent
- **File:** `lib/server/agent/agents/ingestion-agent.js`
- **Model:** `gemini-2.0-flash` (low effort)
- **Input:** Raw Exa crawl text per signal type
- **Output:** Structured `SignalObservation` records matching DB schema
- **System prompt:**
  ```
  You receive raw web crawl text for one signal type.
  Extract only the fields listed in the output schema.
  If a field cannot be found in the text, return null for that field.
  Never invent, interpolate, or estimate values.
  If the text contains no usable data, return { "status": "insufficient_data", "reason": "<one sentence>" }.
  Output valid JSON only. No prose.
  ```

#### Agent 2 — Aggregation Agent
- **File:** `lib/server/agent/agents/aggregation-agent.js`
- **Model:** `gemini-2.0-flash` (low effort)
- **Input:** Structured `SignalObservation` records + internal POS/inventory snapshot
- **Output:** `AggregatedSnapshot` with source health scores and freshness flags
- **System prompt:**
  ```
  You receive structured source records from multiple feeds.
  Merge them into the aggregated snapshot schema.
  Mark any source as stale if its timestamp is older than the threshold in the input.
  Flag fields where two sources conflict; do not resolve conflicts automatically.
  Do not add fields that are not in the output schema.
  Output valid JSON only. No prose.
  ```

#### Agent 3 — Risk Scoring Agent
- **File:** `lib/server/agent/agents/risk-scoring-agent.js`
- **Model:** `gemini-2.5-flash` (medium effort)
- **Input:** Lot-level inventory facts from `AggregatedSnapshot`
- **Output:** Per-lot risk scores: `spoilage_risk` (0–1), `sell_through_probability` (0–1), `stockout_risk` (0–1)
- **System prompt:**
  ```
  You receive lot-level inventory facts including quantity, expiry, category, temperature, and demand signals.
  Score each risk dimension on a 0.0–1.0 scale using only the provided data.
  Do not reference market knowledge outside the input.
  For each score, include a one-field citation: the input field name that most influenced the score.
  If a required input field is null, set the affected score to null and explain in the citation.
  Output valid JSON only. No prose.
  ```

#### Agent 4 — Recommendation Agent
- **File:** `lib/server/agent/agents/recommendation-agent.js`
- **Model:** `gemini-2.5-pro` (high effort)
- **Input:** `AggregatedSnapshot` with risk scores attached
- **Output:** Array of `ActionProposal` records (markdown / routing / procurement)
- **System prompt:**
  ```
  You receive a fully aggregated store snapshot with per-lot risk scores.
  Propose actions using only the action types: markdown, logistics_route, procurement_order.
  Every proposal must include a data_citation field naming the exact input field that justifies the action.
  Do not propose actions for lots not present in the input.
  Do not propose discount values. The discount amount is determined by guardrails after your output.
  If no action is warranted for a lot, omit it from the output.
  Output valid JSON array only. No prose.
  ```

#### Agent 5 — Campaign Agent
- **File:** `lib/server/agent/agents/campaign-agent.js`
- **Model:** `gemini-2.5-flash` (medium effort)
- **Input:** Store archetype, district profile, intraday traffic windows, current inventory state
- **Output:** Suggested campaign parameters (timing windows, discount trajectory, target SKU categories)
- **System prompt:**
  ```
  You receive a store archetype (residential, premium_urban, or transit), district profile, and intraday traffic data.
  Suggest campaign timing windows and discount trajectories that match the archetype strategy:
  - residential: progressive volume discounts, target family-pack categories, peak 17:00–19:00
  - premium_urban: defer discounts, prefer cross-dock routing, micro-markdowns at 12:00 on RTE only
  - transit: flat day pricing, aggressive EOD flash clearance at 20:00–22:00
  Output must match the campaign schema exactly. Do not suggest strategies not listed above.
  All timing values must be 24h format strings. Output valid JSON only. No prose.
  ```

### 4.3 Anti-Hallucination Rules

Applied to every agent call:
- `temperature: 0` on every Gemini call
- Strict JSON schema validation via existing `validate-proposals.js` before any output is persisted
- Missing required fields → agent returns `{ status: "insufficient_data", reason: "..." }` — never fabricates
- Every agent's prompt explicitly forbids referencing data not present in the input
- Raw input + output artifacts persisted in `model_input_artifacts` / `model_output_artifacts` tables per run
- Parse failures are persisted and visible in the audit trail

---

## 5. Interface 1 — Admin/Manager Dashboard

### 5.1 Design System

- Background: `#f8fafc` (slate-50)
- Surface: `#ffffff` with `1px solid #e2e8f0` border
- Border radius: `4px` everywhere
- Primary nav/buttons: `#0f172a` (slate-900) background, `#ffffff` text
- Accent / active state: `#3b82f6` (blue-500)
- Destructive: `#ef4444`
- Success: `#16a34a`
- Typography: system-ui stack, no external font dependency
- Nav: top horizontal bar (`#0f172a`) + section sub-tabs (`#ffffff` with blue underline on active)

### 5.2 Screens

#### Dashboard
- Chain KPI cards: Rescued GMV, Waste Rate, Sell-through %, AI Loops run
- Per-store status row: store name, archetype badge, last run time, waste rate, active labels count
- Live alert feed via SSE (label dispatched, approval pending, model run failed)
- "Run Recommendation Engine" button — triggers aggregation + full agent pipeline for selected store

#### Chains
- Store selector tabs (Premium Urban Q1, Transit Q3, Residential Q7)
- Per-store: signal freshness panel (Exa weather, commodity, demographic — green/yellow/red staleness)
- Inventory state table: lot, category, qty, expiry, current price, risk scores
- Aggregation run history with source provenance and simulation badges

#### Recommendations
- Shadow / Live mode toggle (persisted per store)
- "Run Engine" triggers: Exa crawl → Ingestion Agent → Aggregation Agent → Risk Scoring Agent → Recommendation Agent → Guardrails → Execution routing
- Proposal queue: type, SKU, route, risk class, data citation, guardrail outcome, execution status
- Model run detail drawer: provider, model, effort tier, prompt version, token usage, parse status, latency

#### Campaigns
Two tabs:

**Flash Sales tab:**
- Create campaign: select store, select category or SKU, set discount %, set duration (minutes), set start time
- Active campaigns list with countdown timer and live label count
- Campaign history with GMV impact

**Geo-Demographic tab:**
- Store archetype cards (Residential / Premium Urban / Transit)
- Per-archetype: intraday pricing trajectory config (time windows + discount % per window)
- "Suggest with AI" → triggers Campaign Agent with current store state → returns suggested parameters for manager review and approval before saving
- Strategy history log

#### Approvals
- Pending approval cards: product, lot, proposed discount %, hours to expiry, AI rationale, data citation, matched guardrail rule
- Approve / Reject buttons (manager/admin only)
- Review notes input
- Outcome history with timestamps

#### Tax Write-off
- EOL events table: SKU, quantity, original value, write-off value, EOL timestamp, routing destination
- Date range filter
- "Export PDF" → generates formatted report via jspdf with: store details, total items, total write-off value, per-item breakdown, Decision 222/QD-TTg compliance header
- Running total: estimated tax deduction value

#### SDG Report
- SDG 12 metrics panel: waste rate vs baseline, total waste diverted (kg), CO₂ equivalent saved, items routed to EOL vs landfill
- Time range selector (weekly / monthly / quarterly)
- Trend chart (ASCII-style bar chart rendered in CSS — no chart library dependency)
- "Export PDF" → SDG 12 compliance report with UN goal alignment section
- Circular economy routing breakdown (cross-dock, EOL donation, EOL compost)

#### Settings
- **Sample data:** Load CSV button (re-seeds from `SynaptOS_Baseline_Final_v4.csv`), Reset DB button (with confirmation)
- **Thresholds:** Auto-markdown max discount %, approval-required threshold (default 50%), staleness window per signal type
- **Store profiles:** Edit archetype, district, spending tier per store
- **RBAC:** View active sessions, role assignments

---

## 6. Interface 2 — POS System

### 6.1 Electron Setup

`electron/main.js` opens a chromeless `BrowserWindow` pointed at `http://localhost:3000/pos`. `electron-builder.yml` targets `win` for `.exe` output. The Next.js server must be running; the Electron app does not bundle it — it connects to the running server.

### 6.2 Layout

Split view: left 65% product grid, right 35% cart panel. Dark nav bar across top.

**Top bar:** `SYNAPTOS POS` wordmark, store name, WS connection indicator, cashier name, shift time, manager override button.

**Product grid (left):**
- Search input (text + simulated barcode: type SKU code and press Enter)
- SKU cards in responsive grid (3–4 columns depending on window width)
- Each card: product name, weight/unit, expiry indicator, current live price, red SALE badge + discount % if active
- Prices sourced from `/api/labels` — reflect active E-ink prices in real time via socket.io subscription
- Click card to add to cart

**Cart panel (right):**
- Order items list: name, quantity controls (+ / −), line price
- Subtotal, any active campaign discount applied
- CHECKOUT button (dark navy) → shows receipt modal with simulated payment confirmation
- Clear button
- Shrinkage input button (EOD) → opens modal: scan/search item, enter physical count vs system count, submit for calibration

**Manager override flow:** Cashier clicks "Manager Override" → enters manager PIN → can apply manual discount to cart item → creates approval audit record.

---

## 7. Interface 3 — E-ink Display

### 7.1 Layout

Full-screen page at `/eink`. No nav chrome. Dark background (`#1a1a1a`), minimal header bar.

**Header bar:** `SYNAPTOS E-INK · {STORE_NAME}` left, WS connection dot + timestamp right.

**Price grid:** 6-column CSS grid, fills viewport. Each tile:
- White tile (`#ffffff`, `1px solid #d1d5db`): normal price — product name (truncated), price in bold
- Red tile (`#dc2626`): on sale — product name, current price, original price struck through, discount % badge in white

### 7.2 WebSocket Protocol

`server.js` creates a socket.io server alongside Next.js. When a label execution event fires (existing `lib/server/events.js`), it is also emitted on the `price-update` socket.io room.

```js
// Event shape emitted to E-ink clients
{
  type: "price-update",
  sku_id: "string",
  product_name: "string",
  current_price: number,
  original_price: number | null,
  discount_pct: number | null,   // null = not on sale
  expiry_iso: "string"
}
```

E-ink page: on `price-update`, find the tile by `sku_id`, apply a 300ms flash animation, then settle to new state (red if `discount_pct !== null`, white otherwise).

WS connection states: green dot = connected, pulsing yellow = reconnecting (auto-reconnect every 3s), red = failed after 5 retries.

---

## 8. PDF Export Design

Both Tax Write-off and SDG Report PDFs are generated client-side via `jspdf` + `jspdf-autotable`.

**Tax Write-off PDF structure:**
1. Header: SynaptOS logo text, store name, export date, "Prepared for: Decision 222/QD-TTg Circular Economy Compliance"
2. Summary box: total items EOL'd, total original value, total write-off value, period
3. Per-item table: SKU, category, quantity, original price, write-off value, EOL timestamp, routing destination
4. Footer: "Generated by SynaptOS Agentic AI Platform"

**SDG 12 Report PDF structure:**
1. Header: SDG 12 logo text, store/chain name, reporting period
2. Key metrics: waste rate vs baseline, total waste diverted (kg), estimated CO₂ saved, items rescued
3. Action breakdown table: markdown rescue, cross-dock routing, EOL routing, landfill prevented
4. Compliance statement referencing Decision 222/QD-TTg
5. Trend summary paragraph (generated from metric data, no AI)

---

## 9. Data Flow — End to End

```
Manager clicks "Run Engine" (Admin Dashboard)
  → POST /api/aggregation/run
    → Exa API crawl (weather, commodity, demographics)
    → Ingestion Agent (gemini-2.0-flash) → SignalObservations
    → Aggregation Agent (gemini-2.0-flash) → AggregatedSnapshot
    → Risk Scoring Agent (gemini-2.5-flash) → risk scores attached to lots
    → Recommendation Agent (gemini-2.5-pro) → ActionProposals
    → Guardrail evaluation (deterministic) → route each proposal
      → discount ≤ 50% → label-executor → /api/labels
        → socket.io emits price-update
          → E-ink display tile turns red
          → POS product card shows SALE badge
      → discount > 50% → approval queue (Admin Dashboard Approvals tab)
      → unsaleable → logistics-executor → /api/logistics/tasks
      → stockout risk → procurement-executor → /api/procurement/orders
    → Audit records written for every stage
```

---

## 10. Non-Goals

- Physical E-ink hardware integration (WebSocket protocol is the demo)
- Live POS writeback to KiotViet/MISA (simulated, clearly labeled)
- Live supplier submission (procurement tasks are simulated)
- Production database infrastructure changes
- Multi-tenant / multi-chain deployment
- Mobile / responsive layout (desktop-first only)

---

## 11. Success Criteria

- Admin dashboard loads with real data from the seeded CSV within 3 seconds
- "Run Engine" button triggers all 5 agents sequentially, shows progress, and populates the proposal queue within 30 seconds
- A markdown proposal dispatched from the admin dashboard appears as a red tile on the E-ink display within 2 seconds via WebSocket
- The same price change appears on the POS product card without page reload
- A >50% discount proposal routes to the Approvals tab and cannot dispatch until approved
- Flash sale campaign created in admin applies discount to matching SKUs and updates E-ink + POS in real time
- Tax write-off PDF exports and opens with correct EOL data
- SDG 12 PDF exports with waste reduction metrics vs baseline
- POS checkout flow completes with receipt modal
- Shrinkage input submits and creates a calibration audit record
- Electron `.exe` builds and opens `/pos` in a chromeless window on Windows
