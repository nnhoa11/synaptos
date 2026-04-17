# SynaptOS Full Overhaul — Implementation Plan

**Date:** 2026-04-17
**Spec:** `docs/superpowers/specs/2026-04-17-synaptos-full-overhaul-design.md`
**Branch:** `main`
**Workspace:** `C:\Users\power\Desktop\syntaptos`

---

## Recommended Improvements (incorporated below)

Beyond the approved spec, the following improvements are included:

1. **Pipeline Orchestrator** — `lib/server/agent/pipeline.js` runs all 5 agents in sequence with per-agent error handling, partial failure recovery, and live SSE progress events so the dashboard shows which agent is currently running.
2. **Exa TTL Cache** — in-memory 1-hour cache in `exa-client.js` prevents redundant crawls within the same run window and cuts API cost.
3. **Agent Confidence Scores** — every agent returns a `confidence` (0–1) alongside its output; guardrails use it as an additional gating signal (low confidence → human review regardless of discount %).
4. **Campaign Scheduler** — `lib/server/campaign-scheduler.js` runs every 60 seconds, expires timed campaigns, reverts prices, and emits socket.io events so E-ink + POS update automatically.
5. **Store-scoped Socket.io Rooms** — E-ink and POS clients join a `store:{storeId}` room so price-update events are scoped and don't cross-contaminate between stores.
6. **Pipeline Progress SSE** — emits `pipeline:agent:start`, `pipeline:agent:done`, `pipeline:failed` events; the Recommendations page shows a live step-by-step progress bar.
7. **Barcode Simulation** — POS search input treats a 6+ digit string followed by Enter as a barcode scan, auto-adds matched SKU to cart.
8. **Electron Dev/Prod Split** — in dev, Electron points to `http://localhost:3000/pos`; in prod, it launches `next start` as a child process before opening the window.

---

## Architecture Additions Summary

```
lib/server/agent/
  exa-client.js              ← Exa JS SDK wrapper + 1h TTL cache
  pipeline.js                ← 5-agent sequential orchestrator + progress events
  agents/
    ingestion-agent.js       ← gemini-2.0-flash, low effort
    aggregation-agent.js     ← gemini-2.0-flash, low effort
    risk-scoring-agent.js    ← gemini-2.5-flash, medium effort
    recommendation-agent.js  ← gemini-2.5-pro, high effort
    campaign-agent.js        ← gemini-2.5-flash, medium effort
lib/server/
  campaign-scheduler.js      ← setInterval campaign expiry + price revert
  server-events.js           ← singleton io instance for cross-module emission
server.js                    ← custom Next.js server + socket.io attachment
electron/
  main.js                    ← BrowserWindow targeting /pos
  preload.js                 ← context bridge (minimal)
  electron-builder.yml       ← Windows .exe config
app/
  (admin)/layout.jsx
  (admin)/dashboard/page.jsx
  (admin)/chains/page.jsx
  (admin)/recommendations/page.jsx
  (admin)/campaigns/page.jsx
  (admin)/approvals/page.jsx
  (admin)/tax-writeoff/page.jsx
  (admin)/sdg-report/page.jsx
  (admin)/settings/page.jsx
  (pos)/layout.jsx
  (pos)/page.jsx
  (eink)/page.jsx
components/
  admin/                     ← admin-specific components
  pos/                       ← POS-specific components
  eink/                      ← E-ink display components
  ui/                        ← shared: Button, Card, Badge, Modal, Table, Spinner
```

---

## Phase Dependencies

```
Phase 0 (Foundation) → must complete first
Phase 1 (Pipeline)   → depends on Phase 0
Phase 2 (Admin Core) → depends on Phase 0, Phase 1
Phase 3 (Admin Ops)  → depends on Phase 2
Phase 4 (Reports)    → depends on Phase 2
Phase 5 (POS)        → depends on Phase 0
Phase 6 (E-ink)      → depends on Phase 0
Phase 7 (Integration)→ depends on Phase 1, 5, 6
Phase 8 (Packaging)  → depends on Phase 7
```

Phases 3, 4, 5, 6 can run in parallel after their prerequisites.

---

## Phase 0 — Foundation

**Goal:** Install dependencies, create custom server, Electron scaffold, shared UI components, design tokens, and route group layouts.

### Tasks

- [ ] **P0-T01** Add new dependencies to `package.json`
  ```json
  "socket.io": "^4.8.0",
  "socket.io-client": "^4.8.0",
  "electron": "^30.0.0",
  "electron-builder": "^24.13.0",
  "jspdf": "^2.5.1",
  "jspdf-autotable": "^3.8.0",
  "exa-js": "^1.0.0"
  ```
  Add scripts: `"electron:dev": "electron electron/main.js"`, `"package:win": "electron-builder --win"`

- [ ] **P0-T02** Create `server.js` — custom Next.js HTTP server with socket.io
  - Attach socket.io to the Next.js HTTP server
  - On client connect: join `store:{storeId}` room (storeId from query param)
  - Import and call `setIO(io)` from `lib/server/server-events.js`
  - Start campaign scheduler

- [ ] **P0-T03** Update `next.config.mjs` — set `output: 'standalone'` for Electron prod build compatibility

- [ ] **P0-T04** Create `lib/server/server-events.js` — singleton socket.io io instance
  ```js
  let _io = null
  export function setIO(io) { _io = io }
  export function emitPriceUpdate(storeId, payload) {
    _io?.to(`store:${storeId}`).emit('price-update', payload)
  }
  export function emitPipelineEvent(storeId, event) {
    _io?.to(`store:${storeId}`).emit('pipeline', event)
  }
  ```

- [ ] **P0-T05** Create `electron/main.js`
  - Dev: open `http://localhost:3000/pos?storeId=Q7` in chromeless `BrowserWindow` (1280×800, no frame, no menu)
  - Prod: spawn `node .next/standalone/server.js`, wait for port 3000, then open window

- [ ] **P0-T06** Create `electron/preload.js` — expose `storeId` env var via context bridge

- [ ] **P0-T07** Create `electron/electron-builder.yml`
  ```yaml
  appId: com.synaptos.pos
  productName: SynaptOS POS
  win:
    target: nsis
    icon: electron/icon.ico
  files:
    - "**/*"
    - "!.superpowers"
    - "!docs"
    - "!electron"
  ```

- [ ] **P0-T08** Extend `app/globals.css` with design tokens
  ```css
  :root {
    --bg: #f8fafc; --surface: #ffffff; --border: #e2e8f0;
    --navy: #0f172a; --navy-mid: #1e293b; --blue: #3b82f6;
    --red: #ef4444; --green: #16a34a; --amber: #f59e0b;
    --text: #0f172a; --muted: #64748b; --radius: 4px;
    --font: system-ui, -apple-system, sans-serif;
  }
  ```

- [ ] **P0-T09** Create shared UI primitives in `components/ui/`
  - `Button.jsx` — variants: primary (navy bg), secondary (outline), danger (red), ghost
  - `Card.jsx` — white surface, border, 4px radius, optional `<Card.Header>`
  - `Badge.jsx` — variants: green, red, amber, blue, gray; sizes: sm, md
  - `Modal.jsx` — backdrop overlay, centered panel, close on Escape/backdrop click
  - `Table.jsx` — striped rows, sortable columns, empty state slot
  - `Spinner.jsx` — animated ring, sizes: sm/md/lg

- [ ] **P0-T10** Create `app/(admin)/layout.jsx`
  - Dark navy top bar: `SYNAPTOS` wordmark + section nav links + role badge + logout button
  - Active link: blue underline via `usePathname`
  - RBAC guard: redirect to `/` if session role is not admin or manager

- [ ] **P0-T11** Create `app/(pos)/layout.jsx`
  - No nav chrome, `height: 100vh`, `overflow: hidden`
  - Injects socket.io client script

- [ ] **P0-T12** Create `app/(eink)/layout.jsx`
  - Full viewport, `overflow: hidden`, dark `#1a1a1a` background

---

## Phase 1 — Multi-Agent Pipeline

**Goal:** Exa client, all 5 agents, pipeline orchestrator, wired into aggregation run endpoint.

### Tasks

- [ ] **P1-T01** Create `lib/server/agent/exa-client.js`
  - `crawlSignals(storeContext)` — 3 parallel Exa searches: weather, commodity prices, demographics
  - In-memory TTL cache: key = `{storeId}:{signalType}:{YYYY-MM-DD-HH}`, TTL = 60 minutes
  - Cache hit: attach `{ cached: true, cached_at }` to observation
  - Reads `EXA_API_KEY` from `process.env`

- [ ] **P1-T02** Extend `lib/server/agent/provider-registry.js`
  - Add `getModelForTier(tier)`:
    - `'low'` → `'gemini-2.0-flash'`
    - `'medium'` → `'gemini-2.5-flash'`
    - `'high'` → `'gemini-2.5-pro'`

- [ ] **P1-T03** Create `lib/server/agent/agents/ingestion-agent.js`
  - Model: `gemini-2.0-flash` (low)
  - Input: raw Exa crawl text per signal type
  - Output: `SignalObservation[]` + `confidence` (0–1)
  - System prompt (exact):
    ```
    You receive raw web crawl text for one signal type.
    Extract only the fields listed in the output schema.
    If a field cannot be found in the text, return null for that field.
    Never invent, interpolate, or estimate values.
    If the text contains no usable data, return {"status":"insufficient_data","reason":"<one sentence>"}.
    Output valid JSON only. No prose.
    ```
  - Validates output against `SignalObservation` schema before returning
  - On schema failure: returns `{ status: 'parse_error', raw: <output> }`

- [ ] **P1-T04** Create `lib/server/agent/agents/aggregation-agent.js`
  - Model: `gemini-2.0-flash` (low)
  - Input: `SignalObservation[]` + internal inventory snapshot
  - Output: `AggregatedSnapshot` with source health scores + `confidence`
  - System prompt (exact):
    ```
    You receive structured source records from multiple feeds.
    Merge them into the aggregated snapshot schema.
    Mark any source as stale if its timestamp is older than the threshold in the input.
    Flag fields where two sources conflict; do not resolve conflicts automatically.
    Do not add fields that are not in the output schema.
    Output valid JSON only. No prose.
    ```

- [ ] **P1-T05** Create `lib/server/agent/agents/risk-scoring-agent.js`
  - Model: `gemini-2.5-flash` (medium)
  - Input: lot-level inventory facts from `AggregatedSnapshot`
  - Output: `[{ lot_id, spoilage_risk, sell_through_probability, stockout_risk, citations, confidence }]`
  - System prompt (exact):
    ```
    You receive lot-level inventory facts including quantity, expiry, category, temperature, and demand signals.
    Score each risk dimension on a 0.0-1.0 scale using only the provided data.
    Do not reference market knowledge outside the input.
    For each score, include a one-field citation: the input field name that most influenced the score.
    If a required input field is null, set the affected score to null and explain in the citation.
    Output valid JSON only. No prose.
    ```

- [ ] **P1-T06** Create `lib/server/agent/agents/recommendation-agent.js`
  - Model: `gemini-2.5-pro` (high)
  - Input: `AggregatedSnapshot` with risk scores
  - Output: `ActionProposal[]` each with `type`, `lot_id`, `data_citation`, `confidence`
  - System prompt (exact):
    ```
    You receive a fully aggregated store snapshot with per-lot risk scores.
    Propose actions using only these action types: markdown, logistics_route, procurement_order.
    Every proposal must include a data_citation field naming the exact input field that justifies the action.
    Do not propose discount values. Guardrails determine discount amounts after your output.
    Do not propose actions for lots not present in the input.
    If no action is warranted for a lot, omit it from the output.
    Output valid JSON array only. No prose.
    ```

- [ ] **P1-T07** Create `lib/server/agent/agents/campaign-agent.js`
  - Model: `gemini-2.5-flash` (medium)
  - Input: store archetype, district profile, traffic windows, current inventory state
  - Output: campaign parameter suggestions matching campaign schema
  - System prompt (exact):
    ```
    You receive a store archetype (residential, premium_urban, or transit), district profile, and intraday traffic data.
    Suggest campaign timing windows and discount trajectories that match the archetype strategy:
    - residential: progressive volume discounts, target family-pack categories, peak 17:00-19:00
    - premium_urban: defer discounts, prefer cross-dock routing, micro-markdowns at 12:00 on RTE only
    - transit: flat day pricing, aggressive EOD flash clearance at 20:00-22:00
    Output must match the campaign schema exactly. Do not suggest strategies not listed above.
    All timing values must be 24h format strings. Output valid JSON only. No prose.
    ```

- [ ] **P1-T08** Create `lib/server/agent/pipeline.js` — sequential orchestrator
  ```
  runPipeline(storeId, options):
    1. Exa crawl  → emitPipelineEvent(storeId, { step: 'ingestion', status: 'start' })
    2. Ingestion Agent  → emit done / failed
    3. Aggregation Agent  → emit done / failed
    4. Risk Scoring Agent  → emit done / failed
    5. Recommendation Agent  → emit done / failed
    6. Guardrail evaluation (existing evaluate-proposal.js)
    7. Execution routing (existing executors)
    8. emitPipelineEvent(storeId, { step: 'done', proposalCount, routeSummary })

  Error handling:
    - Agent fails: persist failure artifact, continue with partial data if downstream can proceed
    - Aggregation fails (no snapshot): abort, emit pipeline:failed
    - Low confidence (< 0.6) proposals: override route to approval regardless of discount %
  ```

- [ ] **P1-T09** Extend `app/api/aggregation/run/route.js`
  - When `mode !== 'legacy'`: call `runPipeline(storeId, options)` instead of deterministic-only path
  - Return pipeline run ID and initial status; client polls or listens to SSE for completion

- [ ] **P1-T10** Add `pipeline:*` event types to `lib/server/events.js` SSE bus

- [ ] **P1-T11** Add `EXA_API_KEY` and `GEMINI_API_KEY` to `.env.example`

---

## Phase 2 — Admin Dashboard Core

**Goal:** Dashboard, Chains, and Recommendations screens with live pipeline progress.

### Tasks

- [ ] **P2-T01** Create `components/ui/CssBarChart.jsx` — pure-CSS horizontal bar chart, no library
  - Props: `data: [{ label, value, max, color }]`
  - Used in SDG report, campaign impact, and risk breakdowns

- [ ] **P2-T02** Create `components/admin/KpiCard.jsx`
  - Props: `{ label, value, trend, trendDirection, color }`
  - Corporate card: white surface, border, 4px radius, small uppercase label, large value, trend line

- [ ] **P2-T03** Create `components/admin/AlertFeed.jsx`
  - SSE-connected to `/api/events`
  - Last 10 events, each with type icon + color, message, timestamp
  - Types mapped: label_dispatched (green), approval_pending (amber), model_failed (red), pipeline_done (blue)

- [ ] **P2-T04** Create `components/admin/PipelineProgress.jsx`
  - Subscribes to `pipeline:*` socket.io events from the admin socket connection
  - 5-step horizontal stepper: Ingestion → Aggregation → Risk Scoring → Recommendations → Guardrails
  - Step states: pending (gray) / running (blue pulse animation) / done (green check) / failed (red ✕)
  - Shows as modal overlay while pipeline is running; auto-dismisses 2s after completion

- [ ] **P2-T05** Create `app/(admin)/dashboard/page.jsx`
  - KPI row: Rescued GMV, Waste Rate, Sell-through %, AI Loops (using `KpiCard`)
  - Per-store status table: name, archetype badge, last run, waste rate, active labels, WS status, "Run Engine" button
  - Live alert feed (`AlertFeed`)
  - "Run Engine" → `POST /api/aggregation/run` → shows `PipelineProgress` overlay

- [ ] **P2-T06** Create `components/admin/SignalFreshnessPanel.jsx`
  - Three signal rows: Weather, Commodity Prices, Demographics
  - Each: source badge (LIVE/SIMULATED/CACHED), last crawled timestamp, freshness color (green < 1h, amber 1–4h, red > 4h)

- [ ] **P2-T07** Create `components/admin/InventoryTable.jsx`
  - Columns: lot ID, category, qty, expiry (countdown + color), current price, spoilage risk (progress bar), sell-through prob (progress bar), stockout risk
  - Row colors: red bg for expiry < 4h, amber for < 12h
  - Sortable columns, category filter dropdown

- [ ] **P2-T08** Create `app/(admin)/chains/page.jsx`
  - Store selector: 3 tab buttons (Premium Urban Q1, Transit Q3, Residential Q7)
  - `SignalFreshnessPanel` for selected store
  - Source provenance badges: LIVE (Exa) vs SIMULATED vs CSV SEED
  - `InventoryTable` for selected store
  - Aggregation run history accordion: timestamp, agent confidence scores, source health summary

- [ ] **P2-T09** Create `components/admin/ProposalTable.jsx`
  - Columns: type badge, SKU name, route badge, risk class, confidence bar, guardrail outcome, execution status
  - Click row → opens `ModelRunDrawer`
  - Filter bar: route type select, guardrail outcome select, min confidence slider

- [ ] **P2-T10** Create `components/admin/ModelRunDrawer.jsx`
  - Slide-in panel from right
  - Sections: Provider + model tier + prompt version + token usage + latency + parse status + retry count
  - Collapsible raw input JSON
  - Collapsible raw output JSON
  - Data citation highlight

- [ ] **P2-T11** Create `app/(admin)/recommendations/page.jsx`
  - Mode toggle (Legacy / Shadow / Live) — reads/writes store `rollout_mode` via `PUT /api/stores/:storeId`
  - "Run Engine" button → triggers pipeline → shows `PipelineProgress`
  - `ProposalTable` with `ModelRunDrawer`
  - Last run summary: timestamp, agent confidence scores, route breakdown counts

---

## Phase 3 — Admin Dashboard Operations

**Goal:** Campaigns and Approvals.

### Tasks

- [ ] **P3-T01** Add `campaigns` table to `lib/server/prototype-store.js`
  ```sql
  CREATE TABLE IF NOT EXISTS campaigns (
    id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL,
    name TEXT,
    type TEXT NOT NULL,
    target_category TEXT,
    target_sku_id TEXT,
    discount_pct NUMERIC,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    status TEXT DEFAULT 'scheduled',
    created_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  );
  ```
  Add repository helpers: `createCampaign`, `listCampaigns`, `updateCampaignStatus`, `getActiveCampaigns`

- [ ] **P3-T02** Add `app/api/campaigns/route.js` — `GET` list, `POST` create
  Add `app/api/campaigns/[id]/route.js` — `DELETE` stop early
  Add `app/api/campaigns/suggest/route.js` — `POST` calls Campaign Agent, returns suggestions

- [ ] **P3-T03** Create `lib/server/campaign-scheduler.js`
  - Export `startCampaignScheduler()` — starts `setInterval` every 60s
  - Each tick:
    1. Expire: find `status='active' AND ends_at <= NOW()` → revert label prices → emit `price-update` → set `status='expired'`
    2. Activate: find `status='scheduled' AND starts_at <= NOW()` → apply label discounts → emit `price-update` → set `status='active'`
  - All mutations go through existing `label-executor.js`

- [ ] **P3-T04** Create `components/admin/CampaignCreateModal.jsx`
  - Fields: store select, type (flash_sale), category dropdown or SKU search, discount % slider (5–50), duration select (15/30/60/120/240 min), start (now / pick time)
  - Submit → `POST /api/campaigns`

- [ ] **P3-T05** Create `components/admin/GeoStrategyCard.jsx`
  - Archetype header (Residential / Premium Urban / Transit) with strategy description
  - Editable time-window table: rows of { start_time, end_time, discount_pct, target_category }
  - Add/remove row buttons
  - "Suggest with AI" button → `POST /api/campaigns/suggest` → shows diff modal

- [ ] **P3-T06** Create `app/(admin)/campaigns/page.jsx`
  - Two tabs: Flash Sales | Geo-Demographic Strategies
  - Flash Sales: "Create Campaign" button → `CampaignCreateModal`, active campaigns list with countdown + "Stop Early", history table
  - Geo-Demographic: Three `GeoStrategyCard` components, one per archetype

- [ ] **P3-T07** Create `components/admin/ApprovalCard.jsx`
  - Product name, SKU, lot, proposed discount % (large prominent number), hours-to-expiry countdown
  - Original price → proposed price with arrow
  - AI rationale paragraph + data citation field
  - Matched guardrail rule badge
  - Confidence score bar
  - Notes textarea
  - Approve (green) + Reject (red) buttons — role-gated

- [ ] **P3-T08** Create `app/(admin)/approvals/page.jsx`
  - Pending list: `ApprovalCard` per pending proposal
  - Auto-refreshes every 10s via `setInterval` fetch (or SSE event)
  - Resolved history table below
  - Empty state: "No pending approvals"

---

## Phase 4 — Reports & Settings

**Goal:** Tax write-off PDF, SDG report PDF, settings and sample data control.

### Tasks

- [ ] **P4-T01** Add `app/api/eol-events/route.js`
  - `GET` with `?storeId=&from=&to=` query params
  - Returns EOL routing records from audit table where action type is `eol_route`

- [ ] **P4-T02** Create `lib/client/pdf/tax-writeoff-pdf.js`
  ```js
  // generateTaxWriteoffPDF(events, storeName, period)
  // Page 1:
  //   Header block: SYNAPTOS | storeName | exportDate
  //   Compliance line: "Prepared under Decision 222/QD-TTg Circular Economy Plan"
  //   Summary box: total items, total original value (VND), total write-off value (VND)
  // Table (autotable):
  //   SKU | Category | Qty | Original Price | Write-off Value | EOL Time | Routing
  // Footer: "Generated by SynaptOS Agentic AI Platform"
  // Triggers: doc.save(`tax-writeoff-${period}.pdf`)
  ```

- [ ] **P4-T03** Create `app/(admin)/tax-writeoff/page.jsx`
  - Date range picker: last 7d / 30d / custom (two date inputs)
  - Fetches from `/api/eol-events`
  - EOL events table using `Table` component
  - Running totals footer row
  - "Export PDF" button → calls `generateTaxWriteoffPDF`

- [ ] **P4-T04** Add `app/api/metrics/sdg/route.js`
  - Aggregates from audit + execution tables:
    - waste rate vs CSV baseline
    - total kg diverted (estimated from lot quantities + avg weight per category)
    - CO₂ equivalent (0.6 kg CO₂ per kg food waste prevented, UNEP standard)
    - breakdown: markdown_rescue, cross_dock, eol_donation, eol_compost counts

- [ ] **P4-T05** Create `lib/client/pdf/sdg-report-pdf.js`
  ```js
  // generateSDGReportPDF(metrics, storeName, period)
  // Page 1:
  //   SDG 12 header: "Responsible Consumption and Production"
  //   Store + period
  //   Key metrics: waste rate, kg diverted, CO₂ saved, items rescued
  //   Action breakdown table: type | count | % of total
  //   Compliance paragraph: Decision 222/QD-TTg alignment statement
  //   Trend summary: period-over-period waste rate change
  // Triggers: doc.save(`sdg-report-${period}.pdf`)
  ```

- [ ] **P4-T06** Create `app/(admin)/sdg-report/page.jsx`
  - Period selector: last 7d / 30d / 90d
  - SDG 12 metrics panel: 4 KPI cards
  - Action breakdown: `CssBarChart` (markdown rescue, cross-dock, EOL donation, EOL compost)
  - Waste rate trend: `CssBarChart` over selected period (weekly buckets)
  - "Export PDF" button → calls `generateSDGReportPDF`

- [ ] **P4-T07** Add `settings` table to `lib/server/prototype-store.js`
  ```sql
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
  ```
  Add helpers: `getSetting(key)`, `setSetting(key, value)`

- [ ] **P4-T08** Add `app/api/settings/route.js` — `GET`/`PUT` for threshold and profile settings

- [ ] **P4-T09** Create `app/(admin)/settings/page.jsx`
  - **Sample Data:** "Load CSV" → `POST /api/imports`, "Reset Database" → `DELETE /api/imports` with typed confirmation modal
  - **Thresholds:** auto-markdown max %, approval threshold (default 50%), low-confidence threshold (default 0.6), signal staleness windows
  - **Store Profiles:** per-store archetype, district name, spending tier selects
  - **Pipeline:** default rollout mode per store, Exa cache TTL, manager PIN

---

## Phase 5 — POS Interface

**Goal:** Full Electron-targeted POS checkout interface.

### Tasks

- [ ] **P5-T01** Add `app/api/pos/transaction/route.js`
  - `POST` body: `{ storeId, items: [{ sku_id, qty, unit_price }], cashier, total }`
  - Persists transaction record
  - Decrements lot quantities in DB
  - Returns `{ transaction_id, receipt_data }`

- [ ] **P5-T02** Create `components/pos/POSHeader.jsx`
  - Dark navy bar: `SYNAPTOS POS` | store name | WS dot indicator | cashier | shift time
  - "Manager Override" button → opens `ManagerOverrideModal`
  - "End Shift" button → shows shift summary modal

- [ ] **P5-T03** Create `components/pos/ProductCard.jsx`
  - Props: `{ sku_id, product_name, unit, weight, expiry_iso, current_price, original_price, discount_pct }`
  - White card, 4px radius, dark navy price text
  - Red SALE badge + discount % if `discount_pct !== null`
  - Expiry countdown: red text if < 4h, amber < 12h
  - onClick → calls `onAddToCart(sku_id)`

- [ ] **P5-T04** Create `components/pos/ProductGrid.jsx`
  - Fetches `/api/labels?storeId=` on mount → initial product list
  - Subscribes to socket.io `price-update` events → updates individual `ProductCard` prices without full re-render
  - Search input: text filter by name; 6+ digit entry + Enter → barcode scan (auto-adds to cart)
  - Responsive grid: 3–4 columns depending on window width

- [ ] **P5-T05** Create `components/pos/CartPanel.jsx`
  - Order items: name, qty `+`/`−`/`✕` controls, line price
  - Campaign discount line (green, if active campaign applies)
  - Subtotal + Total (large)
  - "CHECKOUT" button (full-width navy)
  - "Clear Order" ghost button
  - "Shrinkage Input" link at bottom

- [ ] **P5-T06** Create `components/pos/CheckoutModal.jsx`
  - Order summary with all items + prices
  - Payment method: Cash | Card | QR (all simulated)
  - On confirm: `POST /api/pos/transaction`
  - Receipt view: store name, date/time, items, total, "Thank you" footer
  - "Print Receipt" → `window.print()` scoped to receipt div
  - "New Order" → clear cart + close

- [ ] **P5-T07** Create `components/pos/ShrinkageModal.jsx`
  - SKU search/select
  - System count (read-only), physical count input, reason dropdown
  - Submit → `POST /api/calibration` (existing)
  - Shows last 5 shrinkage entries for shift

- [ ] **P5-T08** Create `components/pos/ManagerOverrideModal.jsx`
  - 4-digit PIN input
  - On correct PIN (from settings): show discount input for selected cart item
  - Discount ≤ 50%: applies immediately, creates audit record
  - Discount > 50%: creates approval request, shows "Pending manager approval" state

- [ ] **P5-T09** Create `components/pos/POSApp.jsx`
  - Connects socket.io client to `store:{storeId}` on mount
  - Manages cart state, price cache, modal state
  - Renders `POSHeader` + split layout: `ProductGrid` (65%) + `CartPanel` (35%)

- [ ] **P5-T10** Create `app/(pos)/page.jsx` — mounts `<POSApp storeId={storeId} />`
  - `storeId` from URL query param or Electron preload context bridge

---

## Phase 6 — E-ink Display

**Goal:** Full-screen WebSocket price board.

### Tasks

- [ ] **P6-T01** Create `components/eink/PriceTile.jsx`
  - White tile: product name (2-line clamp), price bold, unit
  - Red tile (`#dc2626`): name, current price (white), struck-through original price (light red), discount % badge
  - Flash animation on price change: `opacity 0→1` over 300ms via CSS keyframe
  - Props: `{ sku_id, product_name, current_price, original_price, discount_pct, unit }`

- [ ] **P6-T02** Create `components/eink/PriceGrid.jsx`
  - CSS grid, 6 columns, `calc(100vh - 40px)` height, fills viewport
  - `Map<sku_id, tileState>` updated on `price-update` socket.io event
  - Triggers flash state on changed tile: `flashing: true` → clears after 600ms

- [ ] **P6-T03** Create `components/eink/EinkHeader.jsx`
  - `#111` background, 40px height
  - Left: `SYNAPTOS E-INK · {STORE_NAME}` in white, letter-spaced
  - Right: WS connection dot + label + live clock (1s interval)
  - WS states: green "CONNECTED" / pulsing yellow "RECONNECTING..." / red "DISCONNECTED"

- [ ] **P6-T04** Create `components/eink/EinkDisplay.jsx`
  - Fetches `/api/labels?storeId=` on mount → initial tile states
  - Connects socket.io client to `store:{storeId}` room
  - Subscribes to `price-update` → updates tile state in `PriceGrid`
  - Auto-reconnect every 3s on disconnect (socket.io built-in)

- [ ] **P6-T05** Create `app/(eink)/page.jsx`
  - Reads `?storeId=` from URL
  - Mounts `<EinkDisplay storeId={storeId} />`
  - `<title>SynaptOS E-ink · {storeId}</title>`

---

## Phase 7 — Integration

**Goal:** Wire all three interfaces together through socket.io, validate end-to-end flow.

### Tasks

- [ ] **P7-T01** Update `lib/server/execution/label-executor.js`
  - After persisting label update, call `emitPriceUpdate(storeId, { sku_id, product_name, current_price, original_price, discount_pct, expiry_iso })`
  - Import `emitPriceUpdate` from `lib/server/server-events.js`

- [ ] **P7-T02** Update `lib/server/campaign-scheduler.js` — use same `emitPriceUpdate` after campaign activations and expirations

- [ ] **P7-T03** Validate end-to-end: pipeline → proposal → label → E-ink
  - Seed CSV, run pipeline in Live mode
  - Verify 5 agents complete in sequence (check pipeline events in dashboard)
  - Verify low-risk markdown dispatches label → E-ink tile turns red within 2s
  - Verify POS product card updates SALE badge without reload
  - Verify high-risk proposal routes to Approvals tab; approve it; verify label dispatches

- [ ] **P7-T04** Validate campaigns end-to-end
  - Create flash sale → verify E-ink tiles turn red, POS shows SALE badge
  - Wait or manually expire → verify tiles revert to white
  - Test "Suggest with AI" → verify suggestion shown, not auto-applied

- [ ] **P7-T05** Validate POS flow
  - Open `/pos`, search and add items, checkout → verify transaction persisted
  - Submit shrinkage → verify calibration record created
  - Manager override ≤50% → verify applied; >50% → verify approval record created

- [ ] **P7-T06** Validate PDF exports
  - Tax write-off: trigger EOL routing, export PDF, verify data correctness
  - SDG report: verify metrics vs CSV baseline, export PDF

---

## Phase 8 — Packaging & Polish

**Goal:** Electron `.exe` build, scripts, env docs, gitignore.

### Tasks

- [ ] **P8-T01** Add `electron/icon.ico` — 256×256 placeholder (can use any `.ico`)

- [ ] **P8-T02** Test Electron dev mode: `npm install && npm run dev` then `npm run electron:dev`
  - Verify POS window opens chromeless at 1280×800
  - Verify socket.io connects, product grid loads, prices update

- [ ] **P8-T03** Run `npm run build && npm run package:win`
  - Verify `.exe` appears in `dist/`
  - Verify installer runs and opens POS window

- [ ] **P8-T04** Update `.env.example`
  ```
  DATABASE_URL=postgresql://synaptos:synaptos@localhost:5432/synaptos_v2
  GEMINI_API_KEY=your_gemini_api_key_here
  EXA_API_KEY=your_exa_api_key_here
  STORE_ID=Q7
  MANAGER_PIN=1234
  ```

- [ ] **P8-T05** Update `.gitignore`
  ```
  .superpowers/
  dist/
  out/
  .env
  ```

- [ ] **P8-T06** Update `quickstart.md`
  - Startup: `npm run db:up && npm run dev` (uses `server.js`)
  - Admin dashboard: `http://localhost:3000/admin/dashboard`
  - E-ink display: `http://localhost:3000/eink?storeId=Q7`
  - POS browser: `http://localhost:3000/pos?storeId=Q7`
  - POS Electron: `npm run electron:dev`
  - Build .exe: `npm run package:win`
  - Required env: `GEMINI_API_KEY`, `EXA_API_KEY`

- [ ] **P8-T07** Update `README.md` — document 3 interfaces, Electron usage, pipeline overview

---

## Delivery Order

1. Phase 0 — foundation
2. Phase 1 — multi-agent pipeline
3. Phase 2 — admin dashboard core
4. (Parallel) Phase 3, Phase 4, Phase 5, Phase 6
5. Phase 7 — integration
6. Phase 8 — packaging

---

## Minimum Demo Cut Line

If time is constrained, the minimum credible demo requires:

| Phase | Tasks |
|---|---|
| Phase 0 | All tasks |
| Phase 1 | All tasks |
| Phase 2 | P2-T01 through P2-T11 |
| Phase 6 | All tasks |
| Phase 7 | P7-T01 through P7-T03 |

This proves: **Exa crawl → 5 agents → proposals → guardrails → E-ink label update in real time**.

Campaigns, PDFs, POS, and Electron can be shown as "in progress" without weakening the core narrative.

---

## Risk Register

| Risk | Mitigation |
|---|---|
| Gemini 2.5-pro rate limits during demo | Keep mock provider fallback in shadow mode |
| Exa returns no usable data | TTL cache fallback to last good crawl; UI shows CACHED badge |
| Electron build fails on Windows | Test build in Phase 8 early; have `/pos` browser URL as fallback |
| Campaign scheduler mis-fires | Log every tick; dry-run mode in settings |
| Socket.io disconnects during demo | Auto-reconnect every 3s; connection indicator visible to audience |
| jspdf layout breaks on long tables | Test PDF generation early in Phase 4; paginate if needed |
| next.config.mjs standalone output breaks existing dev | Keep `output: 'standalone'` conditional on `ELECTRON_BUILD=1` env var |
