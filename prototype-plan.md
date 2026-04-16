# SynaptOS Prototype Plan

## Planning Metadata

- Planning workflow: `bb-plan`
- Workspace root: `/Users/nguyenngochoa/Git/gg-hackathon`
- Feature directory: `/Users/nguyenngochoa/Git/gg-hackathon`
- Branch: `NO_GIT_REPOSITORY`
- Source spec inputs:
  - `GDGoC_SynaptOS_Pitch_Deck (1).pdf`
  - `GDGoC_SynaptOS_Business_Proposal_01.pdf`
- Existing plan template: unavailable in workspace
- `constitution.md`: unavailable
- BuildBetter artifacts: unavailable

This plan treats the two PDFs as the authoritative feature brief because the workspace does not contain a git-backed feature branch, copied plan template, or BuildBetter spec folder.

## Source Synthesis

Both PDFs point to the same core product thesis:

- SynaptOS is an agentic operating layer for fresh-food retailers.
- It overlays existing POS systems instead of replacing them.
- Its first commercial wedge is perishable markdown optimization.
- The first credible delivery milestone is a 3-5 store pilot that proves waste reduction and rescued GMV.

The strongest overlap across the proposal and deck reduces to four prototype pillars:

1. Perishable inventory visibility by lot and expiry.
2. Deterministic markdown recommendations using store context.
3. Human-in-the-loop approval for risky price changes.
4. Virtual shelf-label propagation and impact reporting.

## Technical Context

### Product Goal

Build a prototype that demonstrates this closed loop:

1. Ingest mock POS sales and perishable inventory data.
2. Detect lots at risk of spoilage.
3. Recommend markdown actions using expiry, velocity, and store context.
4. Route high-risk discounts through a manager approval queue.
5. Publish approved prices to a virtual shelf-label interface.
6. Measure rescued GMV, waste risk, and operator overrides.

### Technical Decisions

- Frontend: `Next.js` + `TypeScript` + `Tailwind CSS`
- Backend: Next.js route handlers
- Persistence: `SQLite` via `Prisma`
- Realtime transport: Server-Sent Events preferred for simplicity; WebSockets acceptable if already available
- Charts: `Recharts`
- Auth: demo-only role switcher
- Decision engine: deterministic scoring engine first
- AI usage: optional schema-bound explanation layer only, not autonomous execution

### Resolved Clarifications

- Live POS integration: out of scope for prototype, replaced with seeded CSV/JSON imports.
- Virtual E-ink labels: implemented as a UI surface, not physical hardware.
- Procurement and logistics routing: roadmap only, not prototype scope.
- Enterprise billing and partner APIs: out of scope.
- Pilot geography: simulated HCMC store archetypes only.

## Constitution Check

### Pre-Design Check

- `constitution.md` was not found in the project root or a `docs/` directory.
- There are no enforceable project-level constitutional gates available in this workspace.
- Planning therefore uses explicit local constraints instead:
  - keep scope to a hackathon-feasible prototype
  - prefer deterministic logic over opaque AI behavior
  - avoid fake integrations that would imply production readiness
  - preserve auditability of all decisions

### Post-Design Check

The design still satisfies the local constraints:

- Scope remains restricted to a Phase 1 prototype.
- Recommendation logic is transparent and testable.
- All key actions are logged and reviewable.
- External integrations remain mocked rather than overstated.

## BuildBetter Context

No BuildBetter evidence artifacts were present:

- `buildbetter-context.md`: unavailable
- `buildbetter-context.json`: unavailable
- `user-stories.md`: unavailable

As a substitute, the planning evidence comes directly from the two PDFs. Product taxonomy and affected customers are therefore inferred from the source material:

- Product area: retail operations intelligence
- Domain: fresh-food grocery operations
- Primary customer: chain HQ / store operations for modern grocery retailers
- Secondary users: store managers and staff
- Business outcome: reduce spoilage, recover perishable GMV, create audit-ready waste reporting

## Prototype North Star

At the end of the prototype, a judge or pilot retailer should be able to see:

- A store dashboard with expiring lots and current risk.
- A recommendation engine proposing markdown actions.
- A manager approval step for high-risk discounts.
- A live price update reflected in a shelf-label screen.
- A simple report showing waste avoided and revenue recovered in the simulation.

## Prototype Scope

### In Scope

- Multi-store demo dataset with 3 archetypes:
  - Premium urban
  - Transit / walking street
  - Residential / suburban
- Perishable SKU inventory with:
  - SKU
  - lot / batch
  - expiry date-time
  - current stock
  - cost
  - base price
  - active price
  - recent sales velocity
- Mock external signals:
  - weather
  - district profile
  - time-of-day window
- Markdown recommendation engine
- Manager approval workflow
- Virtual shelf-label UI
- Audit log of all recommendation and execution events
- Simple reporting:
  - rescued GMV
  - markdown count
  - waste risk reduced
  - approval rate
- End-of-day shrinkage calibration

### Out of Scope

- Real POS integrations with KiotViet, MISA, or other vendors
- Autonomous procurement execution to suppliers
- Inter-store transfer routing
- Physical E-ink hardware
- Enterprise billing, subscriptions, and partner APIs
- Multi-country deployment
- Full production-grade forecasting

## Research Summary

Detailed Phase 0 findings are captured in [research.md](/Users/nguyenngochoa/Git/gg-hackathon/research.md). The key decisions are:

1. Use a deterministic scoring engine rather than an autonomous LLM core.
2. Simulate POS and external signals using seeded data.
3. Prefer a single-stack web prototype to minimize integration cost.
4. Make manager approval and auditability first-class features.
5. Treat procurement, routing, and partner APIs as future-phase extensions.

## System Architecture

### 1. Ingestion Layer

Inputs:

- POS sales events
- inventory snapshots
- per-lot expiry metadata
- district/store metadata
- weather signal feed

Prototype approach:

- Use CSV or JSON imports instead of live POS integrations.
- Seed the app with 3 stores and 15-30 SKUs.
- Run a scheduled sync every 5 minutes to simulate live operations.

### 2. Decision Engine

Core job:

- score spoilage risk
- estimate sell-through probability
- recommend a markdown band

Inputs:

- hours to expiry
- current stock
- recent sales velocity
- item margin floor
- store archetype
- time-of-day window
- weather condition

Outputs:

- hold price
- mild markdown
- moderate markdown
- aggressive markdown
- manager review required

Guardrails:

- never price below configured floor
- require approval above 50% discount
- block execution if inventory confidence is low
- log all rejected and overridden recommendations

### 3. Execution Layer

Actions:

- apply a new active selling price
- update virtual shelf label
- log action event

Prototype execution:

- No actual POS writeback.
- The system writes to an internal `ActivePrice` record and pushes that to the UI.

### 4. Calibration Layer

End-of-day manager input:

- stolen / damaged units
- spoiled units
- stock discrepancy notes

Purpose:

- reduce phantom inventory
- explain bad recommendations
- improve confidence scoring in the next run

### 5. Reporting Layer

Show:

- lots saved from expiry
- estimated rescued GMV
- markdown effectiveness
- actions by store
- approval and rejection counts

## User Roles

### Staff / Cashier

- Read-only access
- Can view prices and stock status
- Cannot approve or change recommendations

### Store Manager

- Can review recommendations
- Must approve high-risk markdowns
- Can enter shrinkage and spoilage corrections

### HQ Admin

- Can configure thresholds
- Can compare stores
- Can view aggregate impact and audit logs

## Functional Requirements

### A. Inventory and Expiry Tracking

- Store each lot with expiry date-time.
- Show risk color states:
  - green: safe
  - amber: action soon
  - red: urgent
- Surface hours-to-expiry in all operational views.

### B. Dynamic Pricing Recommendations

- Run a recommendation loop on a schedule.
- Generate a markdown recommendation per risky lot.
- Explain the recommendation using structured factors:
  - expiry urgency
  - low sales velocity
  - weather-driven opportunity
  - district strategy

### C. Approval Workflow

- Discounts under threshold can auto-apply in demo mode.
- Discounts over threshold move to a manager queue.
- Manager can approve, reject, or edit the discount.

### D. Virtual Shelf Labels

- Show current and previous price.
- Animate updated labels when a price changes.
- Filter by store and category.

### E. Analytics

- Daily rescued GMV
- units cleared before expiry
- average markdown depth
- decision-to-sale conversion
- number of overridden recommendations

### F. Calibration

- Manager can enter end-of-day discrepancy counts.
- System recalculates confidence score.
- Dashboard highlights low-confidence SKUs in the next cycle.

## Data Model

The detailed entity design is documented in [data-model.md](/Users/nguyenngochoa/Git/gg-hackathon/data-model.md).

Core entities:

- `Store`
- `StoreProfile`
- `User`
- `Sku`
- `InventoryLot`
- `SalesEvent`
- `DemandSignal`
- `RecommendationRun`
- `PriceRecommendation`
- `ApprovalDecision`
- `ActivePrice`
- `ShelfLabelEvent`
- `CalibrationEntry`
- `ImpactMetric`

## Interface Contracts

Prototype interface definitions are documented in:

- [contracts/api-contract.md](/Users/nguyenngochoa/Git/gg-hackathon/contracts/api-contract.md)
- [contracts/ui-contract.md](/Users/nguyenngochoa/Git/gg-hackathon/contracts/ui-contract.md)

These contracts are intentionally lightweight and focused on the internal prototype surface, not external enterprise integrations.

## UI Plan

### Screen 1. HQ Overview

Purpose:

- show health of all stores
- compare waste risk
- show rescued GMV trend

Widgets:

- stores at risk
- total expiring lots today
- recommended actions pending
- rescued GMV trend

### Screen 2. Store Operations Board

Purpose:

- live operational view for one store

Widgets:

- expiring SKUs table
- current active markdowns
- risk by category
- sales velocity sparkline

### Screen 3. Approval Queue

Purpose:

- manager review of risky recommendations

Actions:

- approve
- reject
- edit markdown
- add reason

### Screen 4. Shelf Label Wall

Purpose:

- visual proof of price propagation

Features:

- card grid of labels
- animated change when price updates
- badge showing why the price changed

### Screen 5. Calibration and Audit

Purpose:

- show enterprise control and anti-hallucination story

Features:

- discrepancy form
- decision log
- manual override history

## Demo Storyline

Use one scripted scenario with 3 stores.

### Store A: Premium Urban

- Organic salad with 10 hours left
- Lunch traffic incoming
- Recommend mild markdown only

### Store B: Residential

- Family-pack chicken with high stock and 14 hours left
- Low recent sales
- Recommend earlier, stronger markdown

### Store C: Transit

- Cold beverages on a hot day
- Hold price until late afternoon
- Then trigger flash markdown close to traffic drop-off

This directly reflects the market narrative in the PDFs.

## Implementation Plan

### Phase 0. Research and Scope Lock

Deliverables:

- resolved technical assumptions
- confirmed prototype scope
- research record

Artifacts:

- [research.md](/Users/nguyenngochoa/Git/gg-hackathon/research.md)

Time:

- 0.5 day

### Phase 1. Data Foundation

Deliverables:

- database schema
- seed data for stores, SKUs, lots, and demand signals
- import scripts for CSV/JSON

Artifacts:

- [data-model.md](/Users/nguyenngochoa/Git/gg-hackathon/data-model.md)

Time:

- 1 day

### Phase 2. Decision Engine

Deliverables:

- risk scoring function
- markdown recommendation generator
- config table for thresholds
- test cases for representative scenarios

Time:

- 1 to 1.5 days

### Phase 3. Ops Workflows

Deliverables:

- store dashboard
- approval queue
- recommendation state transitions
- audit log

Time:

- 1.5 days

### Phase 4. Live Demo Layer

Deliverables:

- shelf-label wall
- scheduled job to recompute recommendations
- live update transport
- scenario reset button

Time:

- 1 day

### Phase 5. Metrics and Demo Polish

Deliverables:

- rescued GMV report
- waste avoided report
- calibration workflow
- narrative cleanup

Artifacts:

- [quickstart.md](/Users/nguyenngochoa/Git/gg-hackathon/quickstart.md)

Time:

- 1 day

## Suggested Delivery Order

1. Build schema and seed data.
2. Build recommendation engine in isolation.
3. Add store dashboard and approval queue.
4. Add virtual shelf labels.
5. Add reporting and calibration.
6. Add optional LLM explanation layer last.

The LLM should not be on the critical path for the prototype.

## Acceptance Criteria

The prototype is complete when all of the following are true:

- A seeded dataset loads successfully for 3 stores.
- Each store shows expiring lots and active prices.
- The system can generate recommendations from current inventory and context.
- A manager can approve or reject high-risk recommendations.
- Approved recommendations update the shelf-label screen.
- A report shows impact for at least one simulated trading day.
- Every action is traceable in an audit log.

## Risks and Mitigations

### Risk: Prototype becomes too broad

Mitigation:

- Keep logistics and procurement as mocked roadmap items, not working features.

### Risk: AI appears unreliable

Mitigation:

- Use deterministic rules first.
- If an LLM is added, restrict it to schema-bound explanations or tool-call proposals.

### Risk: No real POS integration

Mitigation:

- Lean into POS-overlay positioning.
- Simulate imports and writebacks clearly in the demo.

### Risk: Weak business proof

Mitigation:

- Show before/after scenario metrics for waste avoided and recovered GMV.

## Open Questions from the PDFs

These do not block the prototype, but they should be cleaned up before investor-facing use:

- Gross margin appears as `90%+` in one source and `77%` in another.
- Revenue projections and MRR/ARR values are not fully consistent across the proposal and pitch deck.
- Some roadmap items imply procurement and routing automation sooner than a Phase 1 MVP can realistically support.

## Recommended Next Step

Build around one narrow promise:

"SynaptOS helps a fresh-food retailer identify expiring stock, recommend the right markdown at the right time, and push that price to the shelf with manager oversight."

That is the smallest believable version of the product described in both PDFs, and it is enough to demonstrate the thesis, the guardrails, and the commercial value.
