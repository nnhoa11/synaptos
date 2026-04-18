# SynaptOS Prototype Improvements Design

**Date:** 2026-04-18  
**Status:** Approved — all 4 sections confirmed  
**Approach:** Story Layer — make the prototype feel like a real place running real decisions

---

## Problem Statement

The current prototype has four gaps that make it feel like a demo rather than a real system:

1. **Generic store names** — `SynaptOS District 1 Premium` reads as placeholder text, not a real chain store
2. **Opaque admin logic** — proposals appear with no visible chain of reasoning; judges ask "how did it decide?"
3. **Disconnected POS and E-ink** — both surfaces exist but there is no visible signal that they share the same live data room
4. **Black-box pipeline** — a single progress bar hides which agent is running, what it found, and what failed

---

## Section 1 — Store Identity

### Goal

Replace generic store IDs and names with real Vietnamese BHX store identities. Every screen that shows a store name or ID pulls from a single source of truth.

### Single Source of Truth

`lib/prototype-core.js` — `storeTypeProfiles` object. Add `address` and `zone` fields alongside existing `storeId` and `name`.

| Profile key | storeId | name | address | zone | archetype |
|---|---|---|---|---|---|
| `Premium_Urban` | `BHX_44NguyenHue_D1` | BHX 44 Nguyễn Huệ | 44 Nguyễn Huệ, Quận 1, TP.HCM | Walking Street | premium |
| `Transit` | `BHX_23CachMangThang8_D3` | BHX 23 Cách Mạng Tháng 8 | 23 Cách Mạng Tháng 8, Quận 3, TP.HCM | Commuter Corridor | transit |
| `Residential` | `BHX_78NguyenHuuTho_D7` | BHX 78 Nguyễn Hữu Thọ | 78 Nguyễn Hữu Thọ, Quận 7, TP.HCM | Phú Mỹ Hưng | residential |

### Surface Propagation

- **Admin Store Selector** (`StoreTabs.jsx`): display `storeId` as eyebrow label, `name` as title, archetype chip + zone as subtitle
- **Admin Top Nav** (`AdminShell.jsx`): show active `storeId` in userbar (replaces generic text)
- **POS Header** (`POSHeader.jsx`): show `SYNAPTOS POS` brand + `storeId · address` below
- **E-ink Header** (`EinkHeader.jsx`): show `SYNAPTOS E-INK` brand + `storeId · address` + connected dot

No new routing or data-fetching changes needed — all components already receive the store profile via context or props. This is a data layer change only.

---

## Section 2 — Decision Audit Trail

### Goal

Every proposal card — auto-dispatched, pending approval, or EOL-routed — shows the 4-step chain that produced it. No more black box.

### Audit Chain Structure

Each proposal card gains an `AuditChain` section rendered inline below the card header, as a 4-column grid:

```
① Signal → ② Risk Score → ③ Guardrail → ④ Execution (or Waiting / EOL)
```

Each step shows:
- Step label (uppercase, muted)
- Step title (bold)
- 1–2 lines of specific data values

**Step 1 — Signal:** The external inputs that triggered scoring (weather + velocity, expiry window + foot traffic, etc.)

**Step 2 — Risk Score:** Spoilage risk value (0.00–1.00) rendered as value + inline mini bar (filled proportionally with red tint for high risk), plus sell-through probability.

**Step 3 — Guardrail:** Which rule evaluated the proposal and its outcome:
- Auto-label: confidence ≥ 0.60 AND discount ≤ 50%
- Human gate: discount > 50% OR confidence < 0.60 → approval queue
- EOL trigger: T−4h + unsaleable → logistics route

**Step 4 — Execution / Waiting / EOL:**
- Auto-dispatched: price change logged, E-ink + POS updated via socket
- Pending approval: AI rationale box (1–2 sentences explaining the recommendation in human terms)
- EOL: tax write-off filed + SDG 12 carbon impact metric

### Approval Card Actions

Pending-approval cards add a 3-button row below the audit chain: `✓ Approve −X%` | `Edit discount` | `✗ Reject`. These map to existing approval queue logic.

### States

| Proposal type | Card border | Audit background | Step 4 |
|---|---|---|---|
| Auto-dispatched | default (#d1d9e6) | #f7f8fa | Label Executor (green success) |
| Pending approval | amber (#fde68a) | #fffbf0 | AI rationale box + action buttons |
| EOL routed | red (#fecaca) | #fff5f5 | Logistics Executor (write-off + CO₂) |

---

## Section 3 — Live Sync Story

### Goal

POS and E-ink make it visually obvious they share a live store room — same socket.io channel, same price events, degrading gracefully when the connection drops.

### Store Room Indicator

A single line rendered in both POS and E-ink headers (below the brand/storeId line):

```
⬡  Store room: BHX_44NguyenHue_D1  ·  socket.io channel active  ·  N clients connected
```

- Green dot when connected, amber when reconnecting
- Client count comes from the server-side socket room membership (`io.in(roomId).fetchSockets()`)

### Price-Update Event Moment

When a `price-update` event fires on the store room:

1. Both POS and E-ink render an **event ticker** at the top of their product area:
   `↓ price-update · [SKU name]  [old price] → [new price VND] · [timestamp]`
2. The updated product card/tile gains a highlighted border (blue, `#1d4ed8`) and a `↑ Just updated` label
3. After 3 seconds the highlight and label are removed (timed `setTimeout` state removal — no CSS animation)

### Reconnecting State

When the socket disconnects:
- Green sync badge in both headers replaced with amber reconnecting badge
- Amber banner appears above content: `Reconnecting to [storeId] store room… Prices shown may be up to Xs old.`
- Product tiles dim to 60% opacity but remain visible — degraded, not broken
- Last-known sync timestamp shown in tile metadata

### Admin Dashboard — Chain-Level Sync Health

Control Tower adds a compact sync status row showing all 3 store rooms:
- Green badge per room: `[storeId] · N clients · last event Xs ago`
- Amber badge for reconnecting rooms
- Judges can see all 3 rooms at a glance without navigating into each store

### Implementation Notes

- Socket.io rooms already exist as `store:{storeId}` — no topology change needed
- Client count: call `io.in(roomId).fetchSockets()` on room join/leave events and emit `room:meta` updates
- The `Just updated` label uses a `useEffect` cleanup timer: set state on `price-update` event, clear after 3000ms

---

## Section 4 — Pipeline Narrative

### Goal

Replace the opaque progress bar with 5 agent step cards that tell a readable story. Each step shows what the agent actually found and decided — not just a spinner.

### Agent Step Card Structure

Each card contains:
- **Icon** (28×28px square): number badge in state color (green=done, blue=running, gray=waiting, red=error)
- **Status indicator**: ✓ checkmark (done), CSS spinner (running), nothing (waiting), ✗ cross (error)
- **Agent name** + model label (right-aligned, muted): e.g., `gemini-2.5-flash`
- **One-line summary**: human-readable sentence of what the agent found/decided
- **Meta row**: token count + elapsed time (shown after completion; `scoring…` while running)

### Step-by-Step Summaries (Example — Premium Urban)

| # | Agent | Model | Done summary |
|---|---|---|---|
| 1 | Ingestion | gemini-2.0-flash | Parsed 3 external signals: 33°C weather (District 1), pork belly wholesale +4.2%, foot traffic index 1.18× baseline. |
| 2 | Aggregation | gemini-2.0-flash | Merged signals with 47 active lots. 8 lots flagged as time-sensitive (T−8h or less). Snapshot key: 2026-04-18T08. |
| 3 | Risk Scoring | gemini-2.5-flash | 3 lots at critical spoilage risk (≥0.85). 2 lots near stockout. 1 lot flagged unsaleable — EOL route triggered. |
| 4 | Recommendations | gemini-2.5-pro | Generated 6 proposals: 4 auto-dispatched (≤50%), 1 sent to approval queue (62% markdown), 1 procurement PO drafted. |
| 5 | Campaign Suggestions | gemini-2.5-flash | 2 geo-demographic suggestions for D1 Walking Street (Friday evening flash sale window). Manager review required. |

### Three Pipeline States

**State A — Mid-pipeline (Agent 3 running):**
- Steps 1–2: done (green icon, ✓, summary + token/time meta)
- Step 3: running (blue icon, spinner, partial summary with `…`, `scoring…` in meta)
- Steps 4–5: waiting (gray icon, no check, `Waiting for risk scores…` / `Waiting…`)
- Progress bar: 52% filled (blue)

**State B — Pipeline complete:**
- All 5 steps: done
- Progress bar: 100% (green)
- Footer strip: `✓ Pipeline complete — 6 proposals generated` + result chips:
  - `4 auto-dispatched` (green), `1 awaiting approval` (amber), `1 EOL routed` (red), `1 PO drafted` (blue), `3,956 tokens · $0.015` (gray)

**State C — Agent error (never silent):**
- Steps 1–3: done
- Step 4: error (red icon, ✗, specific error message in red: e.g., `Response schema validation failed — output missing required confidence field. No proposals written. Safe to retry.`)
- Error meta: `parse_error · 2.1s`
- Progress bar: partial fill in red

### Error Principle

Errors are always named. `parse_error`, `timeout`, `rate_limit`, `context_length_exceeded` — never a generic "something went wrong." Each error message states what failed and whether it is safe to retry.

### Data Requirements

The pipeline runner must emit structured events per agent step:
```json
{
  "step": 3,
  "agentName": "Risk Scoring",
  "model": "gemini-2.5-flash",
  "status": "done",
  "summary": "3 lots at critical spoilage risk...",
  "tokens": 701,
  "elapsedMs": 2800
}
```

The `PipelineProgress` component listens to these events and renders the step cards reactively.

---

## Files to Change

| File | Change |
|---|---|
| `lib/prototype-core.js` | Add `address`, `zone` fields to all 3 storeTypeProfiles; update `storeId` and `name` |
| `components/admin/StoreTabs.jsx` | Display real `storeId`, `name`, archetype chip, zone |
| `components/admin/AdminShell.jsx` | Show active `storeId` in userbar (not generic label) |
| `components/pos/POSHeader.jsx` | Add store room indicator line; connect to socket meta |
| `components/eink/EinkHeader.jsx` | Add store room indicator line; connect to socket meta |
| `components/pos/POSProductGrid.jsx` | Event ticker + `Just updated` highlight with 3s timer |
| `components/eink/EinkPriceTiles.jsx` | Event ticker + `Just updated` highlight with 3s timer |
| `components/admin/ControlTowerOverview.jsx` | Add chain-level sync health badges row |
| `components/admin/PipelineProgress.jsx` | Replace progress bar with agent step cards; consume structured step events |
| `components/admin/ApprovalCard.jsx` | Add inline 4-step audit chain + 3-button action row |
| `components/admin/ProposalTable.jsx` | Add expandable audit chain per row — collapsed by default, expanded on row click (auto-dispatched and EOL states only; approval card uses `ApprovalCard.jsx`) |
| `lib/server/server-events.js` | Emit `room:meta` on socket join/leave; emit structured `pipeline:step` events |

---

## What This Is Not

- No new routes or pages
- No schema migrations
- No changes to the 5-agent pipeline logic itself (only its event output format)
- No changes to the guardrail thresholds or approval rules
- No dark mode or theming changes (stays on the corporate light mode from the prior redesign)
