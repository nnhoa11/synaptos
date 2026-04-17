# SynaptOS Architecture

**Version:** v3 — Full Overhaul
**Date:** 2026-04-17
**Stack:** Next.js 15 · React 19 · PostgreSQL · socket.io · Electron · Gemini · Exa API

---

## 1. System Overview

```mermaid
graph TD
    subgraph INTERFACES["Three Client Interfaces"]
        ADMIN["🖥️ Admin Dashboard\n/admin/*\nNext.js App Router\nCorporate light mode"]
        POS["🛒 POS System\n/pos\nElectron .exe\nSplit product+cart layout"]
        EINK["📺 E-ink Display\n/eink\nFull-screen WebSocket\n6-col price grid"]
    end

    subgraph SERVER["Next.js Custom Server (server.js)"]
        NEXTJS["Next.js App Router\nAPI Routes + React SSR"]
        SOCKETIO["socket.io Server\nStore-scoped rooms\nstore:{storeId}"]
        SCHEDULER["Campaign Scheduler\nsetInterval 60s\nExpiry + activation"]
    end

    subgraph BACKEND["Backend Modules (lib/server/)"]
        PIPELINE["Agent Pipeline\npipeline.js\n5 agents sequential"]
        RULES["Rule Engine\nrules/evaluate-proposal.js\nDeterministic guardrails"]
        EXEC["Executors\nlabel / logistics / procurement"]
        STORE["Prototype Store\nprototype-store.js\nAll DB operations"]
        AUTH["Auth + RBAC\nauth.js\nCookie sessions"]
        EVENTS["SSE Event Bus\nevents.js"]
    end

    subgraph AI["AI Layer"]
        EXA["Exa API\nExternal signal crawl\nWeather · Commodity · Demographics"]
        GEMINI_LOW["Gemini 2.0 Flash\nLow effort\nIngestion · Aggregation"]
        GEMINI_MED["Gemini 2.5 Flash\nMedium effort\nRisk Scoring · Campaign"]
        GEMINI_HIGH["Gemini 2.5 Pro\nHigh effort\nRecommendations"]
    end

    DB[("PostgreSQL\nsynaptos_v2")]
    CSV["📄 Baseline CSV\nSeed data\n3 stores · 500 SKUs"]

    ADMIN -->|HTTP + SSE| NEXTJS
    POS -->|HTTP + socket.io| NEXTJS
    EINK -->|socket.io| SOCKETIO

    NEXTJS --> BACKEND
    SOCKETIO --> EXEC
    SCHEDULER --> EXEC

    PIPELINE --> EXA
    PIPELINE --> GEMINI_LOW
    PIPELINE --> GEMINI_MED
    PIPELINE --> GEMINI_HIGH
    PIPELINE --> RULES
    RULES --> EXEC

    BACKEND --> STORE
    STORE --> DB
    CSV --> STORE

    EXEC -->|emitPriceUpdate| SOCKETIO
    SOCKETIO -->|price-update event| EINK
    SOCKETIO -->|price-update event| POS
```

---

## 2. Multi-Agent Pipeline

```mermaid
flowchart TD
    START(["▶ Run Engine\nPOST /api/aggregation/run"])

    subgraph EXA_LAYER["External Data Layer — Exa API"]
        EXA_W["Weather crawl\ndistrict + forecast"]
        EXA_C["Commodity prices\nwholesale VND rates"]
        EXA_D["Demographics\ndistrict foot traffic"]
        CACHE["TTL Cache\n1-hour in-memory\nkey: storeId:type:YYYY-MM-DD-HH"]
    end

    subgraph AGENTS["Five-Agent Pipeline"]
        A1["Agent 1 — Ingestion\ngemini-2.0-flash\nLOW effort\nParse Exa text → SignalObservation"]
        A2["Agent 2 — Aggregation\ngemini-2.0-flash\nLOW effort\nMerge signals + inventory → AggregatedSnapshot"]
        A3["Agent 3 — Risk Scoring\ngemini-2.5-flash\nMEDIUM effort\nScore spoilage · sell-through · stockout 0–1"]
        A4["Agent 4 — Recommendations\ngemini-2.5-pro\nHIGH effort\nPropose markdown / route / procurement"]
        A5["Agent 5 — Campaign\ngemini-2.5-flash\nMEDIUM effort\nGeo-demographic suggestions only"]
    end

    subgraph GUARD["Deterministic Guardrails"]
        G1{"Confidence\n< 0.6?"}
        G2{"Discount\n> 50%?"}
        G3{"Unsaleable?"}
        G4{"Stockout\nrisk?"}
    end

    subgraph EXEC["Execution Routing"]
        E1["🏷️ Label Executor\nAuto-dispatch\n≤50% markdown"]
        E2["👤 Approval Queue\nHuman review\n>50% or low confidence"]
        E3["🚚 Logistics Executor\nCross-dock / EOL routing"]
        E4["📦 Procurement Executor\nSimulated PO creation"]
    end

    RESULT(["📊 Proposals persisted\nAudit trail written\nSSE + socket.io events emitted"])

    START --> EXA_W & EXA_C & EXA_D
    EXA_W & EXA_C & EXA_D --> CACHE
    CACHE --> A1
    A1 -->|SignalObservations| A2
    A2 -->|AggregatedSnapshot| A3
    A3 -->|Risk scores attached| A4
    A4 -->|ActionProposals| G1
    G1 -->|yes| E2
    G1 -->|no| G2
    G2 -->|yes| E2
    G2 -->|no| E1
    A4 --> G3
    A4 --> G4
    G3 -->|yes| E3
    G4 -->|yes| E4
    E1 & E2 & E3 & E4 --> RESULT
    A5 -.->|Campaign suggestions\nmanager review only| RESULT

    style A1 fill:#dbeafe,stroke:#3b82f6
    style A2 fill:#dbeafe,stroke:#3b82f6
    style A3 fill:#e0f2fe,stroke:#0284c7
    style A4 fill:#ede9fe,stroke:#7c3aed
    style A5 fill:#e0f2fe,stroke:#0284c7
    style E2 fill:#fef3c7,stroke:#f59e0b
    style E1 fill:#dcfce7,stroke:#16a34a
    style E3 fill:#fee2e2,stroke:#ef4444
    style E4 fill:#f3e8ff,stroke:#9333ea
```

---

## 3. Real-Time Price Update Flow

```mermaid
sequenceDiagram
    participant MGR as Manager (Admin Dashboard)
    participant API as Next.js API Routes
    participant PIPE as Pipeline Orchestrator
    participant GEMINI as Gemini 2.5 Pro
    participant RULES as Rule Engine
    participant LEXEC as Label Executor
    participant SEVENTS as server-events.js (singleton)
    participant IO as socket.io Server
    participant EINK as E-ink Display /eink
    participant POS as POS Interface /pos

    MGR->>API: POST /api/aggregation/run
    API->>PIPE: runPipeline(storeId)
    PIPE-->>IO: pipeline { step: 'ingestion', status: 'start' }
    IO-->>MGR: pipeline event (progress bar updates)

    PIPE->>GEMINI: Recommendation Agent (gemini-2.5-pro)
    GEMINI-->>PIPE: ActionProposal { type: 'markdown', confidence: 0.87 }

    PIPE->>RULES: evaluate-proposal.js
    RULES-->>PIPE: { route: 'label', discount_pct: 30 }

    PIPE->>LEXEC: label-executor.js
    LEXEC->>API: persist label record (DB write)
    LEXEC->>SEVENTS: emitPriceUpdate(storeId, payload)
    SEVENTS->>IO: io.to('store:Q7').emit('price-update', payload)

    IO-->>EINK: price-update { sku_id, current_price, discount_pct: 30 }
    IO-->>POS: price-update { sku_id, current_price, discount_pct: 30 }

    Note over EINK: Tile flashes 300ms → turns red
    Note over POS: ProductCard updates → shows SALE -30% badge

    LEXEC-->>API: audit record written
    PIPE-->>IO: pipeline { step: 'done', proposalCount: 12 }
    IO-->>MGR: pipeline done (progress bar completes)
```

---

## 4. Database Schema

```mermaid
erDiagram
    STORES {
        text id PK
        text name
        text archetype
        text district
        text spending_tier
        text rollout_mode
    }

    INVENTORY_LOTS {
        text id PK
        text store_id FK
        text sku_id
        text category
        numeric quantity
        numeric price
        timestamptz expiry_at
        numeric spoilage_risk
        numeric sell_through_probability
        numeric stockout_risk
    }

    AGGREGATION_RUNS {
        text id PK
        text store_id FK
        jsonb snapshot
        jsonb source_health
        text status
        timestamptz created_at
    }

    MODEL_RUNS {
        text id PK
        text store_id FK
        text aggregation_run_id FK
        text provider
        text model
        text tier
        text prompt_version
        numeric confidence
        integer token_usage
        text parse_status
        text rollout_mode
        timestamptz created_at
    }

    MODEL_INPUT_ARTIFACTS {
        text id PK
        text model_run_id FK
        jsonb content
    }

    MODEL_OUTPUT_ARTIFACTS {
        text id PK
        text model_run_id FK
        jsonb content
        text validation_status
    }

    ACTION_PROPOSALS {
        text id PK
        text model_run_id FK
        text store_id FK
        text type
        text lot_id FK
        text route
        text risk_class
        text data_citation
        numeric confidence
        text guardrail_outcome
        text status
        timestamptz created_at
    }

    APPROVAL_REQUESTS {
        text id PK
        text proposal_id FK
        text status
        text reviewer
        text review_notes
        timestamptz reviewed_at
    }

    LABEL_UPDATES {
        text id PK
        text store_id FK
        text sku_id
        numeric price
        numeric original_price
        numeric discount_pct
        text proposal_id FK
        timestamptz published_at
    }

    LOGISTICS_TASKS {
        text id PK
        text proposal_id FK
        text store_id FK
        text lot_id FK
        text route_type
        text destination
        text status
        boolean simulated
        timestamptz created_at
    }

    PROCUREMENT_ORDERS {
        text id PK
        text proposal_id FK
        text store_id FK
        text sku_id
        numeric quantity
        text supplier
        numeric estimated_cost
        text status
        boolean simulated
        timestamptz created_at
    }

    CAMPAIGNS {
        text id PK
        text store_id FK
        text name
        text type
        text target_category
        text target_sku_id
        numeric discount_pct
        timestamptz starts_at
        timestamptz ends_at
        text status
        text created_by
        timestamptz created_at
    }

    SETTINGS {
        text key PK
        jsonb value
        timestamptz updated_at
    }

    POS_TRANSACTIONS {
        text id PK
        text store_id FK
        text cashier
        jsonb items
        numeric total
        timestamptz created_at
    }

    AUDIT_EVENTS {
        text id PK
        text store_id FK
        text event_type
        text entity_id
        jsonb payload
        text actor
        timestamptz created_at
    }

    STORES ||--o{ INVENTORY_LOTS : "has lots"
    STORES ||--o{ AGGREGATION_RUNS : "runs"
    STORES ||--o{ CAMPAIGNS : "runs"
    STORES ||--o{ POS_TRANSACTIONS : "processes"
    AGGREGATION_RUNS ||--o{ MODEL_RUNS : "triggers"
    MODEL_RUNS ||--|| MODEL_INPUT_ARTIFACTS : "has input"
    MODEL_RUNS ||--|| MODEL_OUTPUT_ARTIFACTS : "has output"
    MODEL_RUNS ||--o{ ACTION_PROPOSALS : "generates"
    ACTION_PROPOSALS ||--o| APPROVAL_REQUESTS : "may require"
    ACTION_PROPOSALS ||--o{ LABEL_UPDATES : "dispatches"
    ACTION_PROPOSALS ||--o{ LOGISTICS_TASKS : "creates"
    ACTION_PROPOSALS ||--o{ PROCUREMENT_ORDERS : "creates"
    INVENTORY_LOTS ||--o{ ACTION_PROPOSALS : "targeted by"
```

---

## 5. Interface Architecture

```mermaid
graph LR
    subgraph ADMIN_APP["Admin Dashboard  (app/(admin)/)"]
        ADM_LAYOUT["layout.jsx\nTop nav + RBAC guard"]
        ADM_DASH["dashboard/page.jsx\nKPI cards · Alert feed · Run Engine"]
        ADM_CHAINS["chains/page.jsx\nSignal freshness · Inventory table"]
        ADM_REC["recommendations/page.jsx\nMode toggle · Proposal queue · Model runs"]
        ADM_CAMP["campaigns/page.jsx\nFlash sales · Geo-demographic strategies"]
        ADM_APPR["approvals/page.jsx\nHigh-risk markdown queue"]
        ADM_TAX["tax-writeoff/page.jsx\nEOL history · PDF export"]
        ADM_SDG["sdg-report/page.jsx\nSDG 12 metrics · PDF export"]
        ADM_SET["settings/page.jsx\nSample data · Thresholds · Profiles"]
    end

    subgraph POS_APP["POS System  (app/(pos)/)"]
        POS_LAYOUT["layout.jsx\nChromeless Electron shell"]
        POS_PAGE["page.jsx → POSApp.jsx"]
        POS_HEADER["POSHeader\nStore · WS status · Shift"]
        POS_GRID["ProductGrid\nLive prices · Barcode sim"]
        POS_CART["CartPanel\nCart · Checkout · Receipt"]
        POS_MODS["Modals\nCheckout · Shrinkage · Override"]
    end

    subgraph EINK_APP["E-ink Display  (app/(eink)/)"]
        EINK_LAYOUT["layout.jsx\nFull-viewport dark"]
        EINK_PAGE["page.jsx → EinkDisplay.jsx"]
        EINK_HEADER["EinkHeader\nStore name · WS indicator · Clock"]
        EINK_GRID["PriceGrid\n6-col CSS grid · Flash animation"]
        EINK_TILE["PriceTile\nWhite=normal · Red=sale"]
    end

    subgraph SHARED_UI["components/ui/"]
        BTN["Button\nprimary·secondary·danger·ghost"]
        CARD["Card + Card.Header"]
        BADGE["Badge\ngreen·red·amber·blue·gray"]
        MODAL["Modal\nBackdrop · Escape close"]
        TABLE["Table\nSortable · Filterable"]
        SPIN["Spinner\nsm·md·lg"]
        CHART["CssBarChart\nPure CSS · No library"]
    end

    ADM_LAYOUT --> ADM_DASH & ADM_CHAINS & ADM_REC & ADM_CAMP & ADM_APPR & ADM_TAX & ADM_SDG & ADM_SET
    POS_LAYOUT --> POS_PAGE
    POS_PAGE --> POS_HEADER & POS_GRID & POS_CART & POS_MODS
    EINK_LAYOUT --> EINK_PAGE
    EINK_PAGE --> EINK_HEADER & EINK_GRID
    EINK_GRID --> EINK_TILE

    ADMIN_APP & POS_APP -.->|uses| SHARED_UI
```

---

## 6. Deployment Topology

```mermaid
graph TD
    subgraph DEV["Development"]
        DEVSERVER["node server.js\nport 3000\nNext.js + socket.io"]
        DEVELECTRON["npm run electron:dev\nElectron → localhost:3000/pos"]
        DEVDB["Docker PostgreSQL\nport 5432\nnpm run db:up"]
    end

    subgraph PROD_EXE[".exe Distribution"]
        INSTALLER["SynaptOS POS Setup.exe\nnpm run package:win\nNSIS installer"]
        STANDALONE["next build --standalone\nBundled Node server"]
        ELECTRONPROD["Electron main.js\nSpawns next start\nOpens /pos window"]
    end

    subgraph DEMO["Demo Environment"]
        BROWSER_ADMIN["Browser Tab 1\nlocalhost:3000/admin/dashboard"]
        BROWSER_EINK["Browser Tab 2\nlocalhost:3000/eink?storeId=Q7"]
        POS_WIN["POS Window\nnpm run electron:dev\nor .exe installer"]
    end

    DEVSERVER --> BROWSER_ADMIN & BROWSER_EINK
    DEVELECTRON --> POS_WIN
    DEVDB --> DEVSERVER

    INSTALLER --> ELECTRONPROD
    ELECTRONPROD --> STANDALONE
    STANDALONE -->|http localhost:3000| ELECTRONPROD
```

---

## 7. Data Flow — End to End

```mermaid
flowchart LR
    subgraph SOURCES["Data Sources"]
        CSV["Baseline CSV\n3 stores · 500 SKUs\nhistorical baseline"]
        EXA_W["Exa: Weather\ndistrict temperature\nrain forecast"]
        EXA_C["Exa: Commodity\nwholesale prices\nVietnam market"]
        EXA_D["Exa: Demographics\ndistrict spending\nfoot traffic"]
        POS_T["POS Transactions\nreal-time sales\nfrom cashiers"]
    end

    subgraph COGNITIVE["Cognitive Core"]
        ING["Ingestion Agent\ngemini-2.0-flash\nparse → schema"]
        AGG["Aggregation Agent\ngemini-2.0-flash\nmerge → snapshot"]
        RISK["Risk Scoring Agent\ngemini-2.5-flash\nspoilage 0–1"]
        REC["Recommendation Agent\ngemini-2.5-pro\npropose actions"]
        GUARD["Rule Engine\ndeterministic\nguardrails"]
    end

    subgraph EXECUTION["Execution Layer"]
        LABEL["Label Executor\nauto-dispatch\n≤50%"]
        APPR["Approval Queue\nhuman gate\n>50% or conf<0.6"]
        LOGI["Logistics Executor\nEOL / cross-dock\nrouting tasks"]
        PROC["Procurement Executor\nPO generation\nstockout prevention"]
    end

    subgraph OUTPUTS["Outputs"]
        EINK_OUT["E-ink Display\nred=sale\nwhite=normal"]
        POS_OUT["POS Interface\nSALE badges\nlive prices"]
        AUDIT_OUT["Audit Trail\nevery stage\nreplayable"]
        TAX_OUT["Tax Write-off PDF\nDecision 222\nVND write-off"]
        SDG_OUT["SDG 12 PDF\nwaste diversion\nCO₂ saved"]
    end

    CSV --> AGG
    EXA_W & EXA_C & EXA_D --> ING
    ING --> AGG
    POS_T --> AGG
    AGG --> RISK
    RISK --> REC
    REC --> GUARD
    GUARD --> LABEL & APPR & LOGI & PROC
    LABEL -->|socket.io price-update| EINK_OUT & POS_OUT
    LABEL & APPR & LOGI & PROC --> AUDIT_OUT
    LOGI --> TAX_OUT
    AUDIT_OUT --> SDG_OUT
```

---

## 8. Role-Based Access Control

```mermaid
graph TD
    subgraph ROLES["Operational Hierarchy"]
        ADMIN_ROLE["🔑 Admin / Chain HQ\n'God Mode'\nAll permissions"]
        MANAGER_ROLE["🛡️ Store Manager\n'Gatekeeper'\nApprove · Reject · Calibrate"]
        STAFF_ROLE["👤 Staff / Cashier\n'Execution'\nRead-only + POS checkout"]
        PROC_ROLE["📦 Procurement Planner\nProcurement console access"]
        LOGI_ROLE["🚚 Logistics Coordinator\nLogistics workbench access"]
    end

    subgraph PERMISSIONS["Permissions by Interface"]
        P1["Run Recommendation Engine"]
        P2["Approve / Reject Proposals"]
        P3["Create Campaigns"]
        P4["Export Tax Write-off PDF"]
        P5["Export SDG Report PDF"]
        P6["Reset Sample Data"]
        P7["POS Checkout"]
        P8["Shrinkage Input"]
        P9["Manager PIN Override"]
        P10["View Procurement Console"]
        P11["View Logistics Workbench"]
        P12["Modify Thresholds"]
    end

    ADMIN_ROLE --> P1 & P2 & P3 & P4 & P5 & P6 & P7 & P8 & P9 & P10 & P11 & P12
    MANAGER_ROLE --> P1 & P2 & P3 & P4 & P5 & P7 & P8 & P9
    STAFF_ROLE --> P7 & P8
    PROC_ROLE --> P10
    LOGI_ROLE --> P11
```

---

## 9. File Structure

```
syntaptos/
├── server.js                          ← Custom Next.js + socket.io server
├── next.config.mjs                    ← standalone output for Electron prod
├── package.json                       ← added: socket.io, electron, jspdf, exa-js
├── docker-compose.postgres.yml        ← unchanged
│
├── electron/
│   ├── main.js                        ← BrowserWindow → /pos, dev+prod split
│   ├── preload.js                     ← exposes storeId via contextBridge
│   └── electron-builder.yml          ← NSIS .exe config
│
├── app/
│   ├── (admin)/
│   │   ├── layout.jsx                 ← top nav + RBAC guard
│   │   ├── dashboard/page.jsx
│   │   ├── chains/page.jsx
│   │   ├── recommendations/page.jsx
│   │   ├── campaigns/page.jsx
│   │   ├── approvals/page.jsx
│   │   ├── tax-writeoff/page.jsx
│   │   ├── sdg-report/page.jsx
│   │   └── settings/page.jsx
│   ├── (pos)/
│   │   ├── layout.jsx                 ← chromeless shell
│   │   └── page.jsx
│   ├── (eink)/
│   │   ├── layout.jsx                 ← full-viewport dark
│   │   └── page.jsx
│   └── api/                           ← existing 16 route groups (unchanged)
│       ├── campaigns/route.js         ← NEW
│       ├── campaigns/[id]/route.js    ← NEW
│       ├── campaigns/suggest/route.js ← NEW
│       ├── settings/route.js          ← NEW
│       ├── eol-events/route.js        ← NEW
│       ├── metrics/sdg/route.js       ← NEW
│       └── pos/transaction/route.js   ← NEW
│
├── components/
│   ├── ui/                            ← Button, Card, Badge, Modal, Table, Spinner, CssBarChart
│   ├── admin/                         ← KpiCard, AlertFeed, PipelineProgress, SignalFreshnessPanel
│   │                                     InventoryTable, ProposalTable, ModelRunDrawer
│   │                                     ApprovalCard, CampaignCreateModal, GeoStrategyCard
│   ├── pos/                           ← POSApp, POSHeader, ProductGrid, ProductCard
│   │                                     CartPanel, CheckoutModal, ShrinkageModal, ManagerOverrideModal
│   └── eink/                          ← EinkDisplay, EinkHeader, PriceGrid, PriceTile
│
├── lib/
│   ├── server/
│   │   ├── server-events.js           ← NEW: socket.io singleton emitter
│   │   ├── campaign-scheduler.js      ← NEW: 60s interval expiry + activation
│   │   ├── agent/
│   │   │   ├── exa-client.js          ← NEW: Exa SDK + 1h TTL cache
│   │   │   ├── pipeline.js            ← NEW: 5-agent sequential orchestrator
│   │   │   ├── agents/
│   │   │   │   ├── ingestion-agent.js    ← NEW: gemini-2.0-flash
│   │   │   │   ├── aggregation-agent.js  ← NEW: gemini-2.0-flash
│   │   │   │   ├── risk-scoring-agent.js ← NEW: gemini-2.5-flash
│   │   │   │   ├── recommendation-agent.js ← NEW: gemini-2.5-pro
│   │   │   │   └── campaign-agent.js     ← NEW: gemini-2.5-flash
│   │   │   ├── client.js              ← unchanged
│   │   │   ├── orchestrator.js        ← unchanged
│   │   │   ├── prompt-builder.js      ← unchanged
│   │   │   ├── provider-registry.js   ← EXTENDED: add getModelForTier()
│   │   │   ├── response-parser.js     ← unchanged
│   │   │   ├── schemas.js             ← unchanged
│   │   │   └── validate-proposals.js  ← unchanged
│   │   ├── aggregation/               ← unchanged
│   │   ├── rules/                     ← unchanged
│   │   ├── execution/
│   │   │   ├── label-executor.js      ← EXTENDED: add emitPriceUpdate call
│   │   │   ├── logistics-executor.js  ← unchanged
│   │   │   └── procurement-executor.js ← unchanged
│   │   ├── prototype-store.js         ← EXTENDED: 3 new tables + helpers
│   │   ├── auth.js                    ← unchanged
│   │   └── events.js                  ← EXTENDED: pipeline event types
│   └── client/
│       └── pdf/
│           ├── tax-writeoff-pdf.js    ← NEW: jspdf client-side generator
│           └── sdg-report-pdf.js      ← NEW: jspdf client-side generator
│
└── docs/
    └── superpowers/specs/
        └── 2026-04-17-synaptos-full-overhaul-design.md
```

---

## 10. Key Architectural Principles

| Principle | Implementation |
|---|---|
| **Model output is advisory only** | Gemini proposals pass through `evaluate-proposal.js` before any execution |
| **Deterministic execution authority** | Rule engine is the sole gatekeeper — no agent can dispatch directly |
| **No hallucination** | `temperature: 0` on all calls · strict JSON schema validation · `null` for missing fields |
| **Tiered AI cost** | Low-effort Flash for parsing · Mid-effort Flash for scoring · High-effort Pro for reasoning |
| **Honest runtime states** | SIMULATED / CACHED / LIVE badges on all sources and executors |
| **Additive rollout** | Legacy mode preserved · shadow → assisted → live progression |
| **Full auditability** | Every stage (aggregation → agent → guardrail → execution) writes an audit record |
| **Store-scoped real-time** | socket.io rooms `store:{storeId}` prevent cross-store price bleed |
| **Human in the loop** | >50% discount + low confidence (<0.6) → mandatory human approval |
| **Campaign safety** | Campaign Agent suggestions are never auto-applied · manager must explicitly confirm |
