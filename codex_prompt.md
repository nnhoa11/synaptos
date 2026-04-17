# Codex Execution Prompt — SynaptOS Full Overhaul

## Your Role

You are a senior full-stack engineer implementing a production-grade overhaul of SynaptOS, an agentic AI platform for fresh-food retail inventory management in Vietnam. You have full autonomy to write, create, and modify files. Execute the implementation plan phase by phase, completing every task before moving to the next phase.

---

## Project Location

```
C:\Users\power\Desktop\syntaptos
```

Read `implementation_plan.md` for the full task list. Read `docs/superpowers/specs/2026-04-17-synaptos-full-overhaul-design.md` for the full design spec. Read `spec.md`, `plan.md`, `tasks.md`, `hackathon-architecture.md`, and `constitution.md` for full project context before writing any code.

---

## What This Project Is

SynaptOS is a Next.js 15 + React 19 + PostgreSQL application. It already has a complete backend:
- Multi-source data aggregation (`lib/server/aggregation/`)
- LLM agent layer with Gemini/OpenAI/mock providers (`lib/server/agent/`)
- Deterministic rule engine and guardrails (`lib/server/rules/`)
- Label, logistics, and procurement executors (`lib/server/execution/`)
- Full audit trail and SSE event bus (`lib/server/events.js`)
- RBAC and session management (`lib/server/auth.js`)
- PostgreSQL persistence (`lib/server/prototype-store.js`)
- 16 API route groups under `app/api/`

**The backend is complete and must not be modified except where the implementation plan explicitly instructs you to extend it.** All new work is additive.

The current frontend (`components/PrototypeApp.jsx`, `components/ControlTowerConsole.jsx`) will be replaced entirely by three new interfaces.

---

## Three Interfaces to Build

### 1. Admin/Manager Dashboard (`/admin`)
- Next.js App Router route group `app/(admin)/`
- Top nav + section tabs, corporate light mode
- Sections: Dashboard, Chains, Recommendations, Campaigns, Approvals, Tax Write-off, SDG Report, Settings

### 2. POS System (`/pos` → Electron `.exe`)
- Next.js App Router route group `app/(pos)/`
- Electron wraps `/pos` in a chromeless window
- Split layout: product grid (left 65%) + cart panel (right 35%)

### 3. E-ink Display (`/eink`)
- Full-screen WebSocket price board
- 6-column compact grid
- Red tile = on sale, White tile = normal price
- Real-time updates via socket.io

---

## Design System (apply everywhere)

```css
:root {
  --bg: #f8fafc;
  --surface: #ffffff;
  --border: #e2e8f0;
  --navy: #0f172a;
  --navy-mid: #1e293b;
  --blue: #3b82f6;
  --red: #ef4444;
  --green: #16a34a;
  --amber: #f59e0b;
  --text: #0f172a;
  --muted: #64748b;
  --radius: 4px;
  --font: system-ui, -apple-system, sans-serif;
}
```

- Border radius: **4px everywhere** — no rounded-xl, no pill shapes except badges
- Light mode background (`#f8fafc`), white surfaces
- Buttons and nav: dark navy (`#0f172a`) background, white text
- Active/accent: blue (`#3b82f6`)
- No external UI libraries (no shadcn, no MUI, no Ant Design)
- No Tailwind — use plain CSS modules or inline styles consistent with existing `app/globals.css`
- No chart libraries — use pure CSS bar charts

---

## Multi-Agent Pipeline (critical — implement exactly as specified)

The pipeline runs 5 Gemini agents in sequence. **Do not deviate from the system prompts or model tiers below.**

### Agent 1 — Ingestion Agent
- File: `lib/server/agent/agents/ingestion-agent.js`
- Model: `gemini-2.0-flash` (low effort)
- System prompt (use verbatim):
```
You receive raw web crawl text for one signal type.
Extract only the fields listed in the output schema.
If a field cannot be found in the text, return null for that field.
Never invent, interpolate, or estimate values.
If the text contains no usable data, return {"status":"insufficient_data","reason":"<one sentence>"}.
Output valid JSON only. No prose.
```

### Agent 2 — Aggregation Agent
- File: `lib/server/agent/agents/aggregation-agent.js`
- Model: `gemini-2.0-flash` (low effort)
- System prompt (use verbatim):
```
You receive structured source records from multiple feeds.
Merge them into the aggregated snapshot schema.
Mark any source as stale if its timestamp is older than the threshold in the input.
Flag fields where two sources conflict; do not resolve conflicts automatically.
Do not add fields that are not in the output schema.
Output valid JSON only. No prose.
```

### Agent 3 — Risk Scoring Agent
- File: `lib/server/agent/agents/risk-scoring-agent.js`
- Model: `gemini-2.5-flash` (medium effort)
- System prompt (use verbatim):
```
You receive lot-level inventory facts including quantity, expiry, category, temperature, and demand signals.
Score each risk dimension on a 0.0-1.0 scale using only the provided data.
Do not reference market knowledge outside the input.
For each score, include a one-field citation: the input field name that most influenced the score.
If a required input field is null, set the affected score to null and explain in the citation.
Output valid JSON only. No prose.
```

### Agent 4 — Recommendation Agent
- File: `lib/server/agent/agents/recommendation-agent.js`
- Model: `gemini-2.5-pro` (high effort)
- System prompt (use verbatim):
```
You receive a fully aggregated store snapshot with per-lot risk scores.
Propose actions using only these action types: markdown, logistics_route, procurement_order.
Every proposal must include a data_citation field naming the exact input field that justifies the action.
Do not propose discount values. Guardrails determine discount amounts after your output.
Do not propose actions for lots not present in the input.
If no action is warranted for a lot, omit it from the output.
Output valid JSON array only. No prose.
```

### Agent 5 — Campaign Agent
- File: `lib/server/agent/agents/campaign-agent.js`
- Model: `gemini-2.5-flash` (medium effort)
- System prompt (use verbatim):
```
You receive a store archetype (residential, premium_urban, or transit), district profile, and intraday traffic data.
Suggest campaign timing windows and discount trajectories that match the archetype strategy:
- residential: progressive volume discounts, target family-pack categories, peak 17:00-19:00
- premium_urban: defer discounts, prefer cross-dock routing, micro-markdowns at 12:00 on RTE only
- transit: flat day pricing, aggressive EOD flash clearance at 20:00-22:00
Output must match the campaign schema exactly. Do not suggest strategies not listed above.
All timing values must be 24h format strings. Output valid JSON only. No prose.
```

### Anti-Hallucination Rules (apply to all agents)
- `temperature: 0` on every Gemini call — no exceptions
- Validate every agent output against its schema before persisting
- On schema validation failure: persist the raw output as a failed artifact, do not crash the pipeline
- Agents that return `{ status: "insufficient_data" }` are treated as partial failures — pipeline continues
- Confidence score < 0.6 on any proposal → override route to human approval regardless of discount %

### Model Tier Resolution
Add `getModelForTier(tier)` to `lib/server/agent/provider-registry.js`:
- `'low'` → `'gemini-2.0-flash'`
- `'medium'` → `'gemini-2.5-flash-preview-04-17'`
- `'high'` → `'gemini-2.5-pro-preview-03-25'`

---

## Socket.io Architecture (critical wiring)

### server.js (new custom server)
```js
import { createServer } from 'http'
import { parse } from 'url'
import next from 'next'
import { Server } from 'socket.io'
import { setIO } from './lib/server/server-events.js'
import { startCampaignScheduler } from './lib/server/campaign-scheduler.js'

const dev = process.env.NODE_ENV !== 'production'
const app = next({ dev })
const handle = app.getRequestHandler()

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url, true)
    handle(req, res, parsedUrl)
  })

  const io = new Server(httpServer, {
    cors: { origin: '*' }
  })

  io.on('connection', (socket) => {
    const storeId = socket.handshake.query.storeId
    if (storeId) socket.join(`store:${storeId}`)
  })

  setIO(io)
  startCampaignScheduler()

  httpServer.listen(3000, () => {
    console.log('> Ready on http://localhost:3000')
  })
})
```

### lib/server/server-events.js (singleton)
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

### Socket.io client connection pattern (use in POSApp, EinkDisplay, PipelineProgress)
```js
import { io } from 'socket.io-client'

const socket = io({ query: { storeId } })
socket.on('price-update', (payload) => { /* update tile/card */ })
socket.on('pipeline', (event) => { /* update progress bar */ })
return () => socket.disconnect()
```

---

## New Database Tables

Add these to `lib/server/prototype-store.js` inside the existing bootstrap function:

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

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pos_transactions (
  id TEXT PRIMARY KEY,
  store_id TEXT NOT NULL,
  cashier TEXT,
  items JSONB NOT NULL,
  total NUMERIC NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## New API Routes to Create

| Route | Method | Purpose |
|---|---|---|
| `app/api/campaigns/route.js` | GET, POST | List and create campaigns |
| `app/api/campaigns/[id]/route.js` | DELETE | Stop campaign early |
| `app/api/campaigns/suggest/route.js` | POST | Campaign Agent suggestions |
| `app/api/settings/route.js` | GET, PUT | Read/write settings |
| `app/api/eol-events/route.js` | GET | EOL routing records for tax write-off |
| `app/api/metrics/sdg/route.js` | GET | SDG 12 aggregated metrics |
| `app/api/pos/transaction/route.js` | POST | Persist POS sale transaction |

All API routes must check RBAC using existing `lib/server/auth.js` helpers.

---

## Existing API Routes — Do Not Modify

```
app/api/stores/         app/api/snapshots/      app/api/recommendations/
app/api/agent/          app/api/aggregation/    app/api/proposals/
app/api/audit/          app/api/auth/           app/api/calibration/
app/api/events/         app/api/execution/      app/api/imports/
app/api/labels/         app/api/logistics/      app/api/metrics/
app/api/procurement/
```

---

## Exa API Integration

```js
// lib/server/agent/exa-client.js
import Exa from 'exa-js'

const exa = new Exa(process.env.EXA_API_KEY)

// In-memory TTL cache
const cache = new Map()
const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

export async function crawlSignals(storeContext) {
  const { storeId, district, category } = storeContext
  const hourKey = new Date().toISOString().slice(0, 13)

  const signals = await Promise.all([
    crawlWithCache(`${storeId}:weather:${hourKey}`,
      `${district} Ho Chi Minh City weather forecast today temperature humidity`),
    crawlWithCache(`${storeId}:commodity:${hourKey}`,
      `Vietnam wholesale ${category} fresh food price today VND`),
    crawlWithCache(`${storeId}:demographic:${hourKey}`,
      `${district} HCMC district spending power foot traffic peak hours`),
  ])

  return { weather: signals[0], commodity: signals[1], demographic: signals[2] }
}

async function crawlWithCache(key, query) {
  const cached = cache.get(key)
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return { ...cached.data, cached: true, cached_at: cached.ts }
  }
  const result = await exa.search(query, { numResults: 3, useAutoprompt: true })
  const text = result.results.map(r => r.text || r.highlights?.join(' ') || '').join('\n\n')
  const data = { text, url: result.results[0]?.url }
  cache.set(key, { data, ts: Date.now() })
  return data
}
```

---

## PDF Export Pattern

Use `jspdf` + `jspdf-autotable`. Both PDFs are generated client-side (browser).

```js
// lib/client/pdf/tax-writeoff-pdf.js
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

export function generateTaxWriteoffPDF(events, storeName, period) {
  const doc = new jsPDF()

  // Header
  doc.setFontSize(16).setFont(undefined, 'bold')
  doc.text('SynaptOS — Tax Write-off Report', 14, 20)
  doc.setFontSize(10).setFont(undefined, 'normal')
  doc.text(`Store: ${storeName}`, 14, 30)
  doc.text(`Period: ${period}`, 14, 36)
  doc.text(`Prepared under: Decision 222/QD-TTg Circular Economy Plan`, 14, 42)

  // Summary
  const totalItems = events.length
  const totalOriginal = events.reduce((s, e) => s + e.original_value, 0)
  const totalWriteoff = events.reduce((s, e) => s + e.writeoff_value, 0)
  doc.setFontSize(11).setFont(undefined, 'bold')
  doc.text(`Total items: ${totalItems}   Original value: ${totalOriginal.toLocaleString()}₫   Write-off: ${totalWriteoff.toLocaleString()}₫`, 14, 52)

  // Table
  autoTable(doc, {
    startY: 60,
    head: [['SKU', 'Category', 'Qty', 'Original (₫)', 'Write-off (₫)', 'EOL Time', 'Routing']],
    body: events.map(e => [e.sku_id, e.category, e.quantity, e.original_value.toLocaleString(), e.writeoff_value.toLocaleString(), new Date(e.eol_at).toLocaleString(), e.routing_destination]),
  })

  doc.save(`tax-writeoff-${period}.pdf`)
}
```

Follow the same pattern for `lib/client/pdf/sdg-report-pdf.js`.

---

## Campaign Scheduler Pattern

```js
// lib/server/campaign-scheduler.js
import { getCampaignsToActivate, getCampaignsToExpire, updateCampaignStatus } from './prototype-store.js'
import { emitPriceUpdate } from './server-events.js'
// Import label executor to revert/apply prices

export function startCampaignScheduler() {
  setInterval(async () => {
    try {
      // Expire active campaigns
      const toExpire = await getCampaignsToExpire()
      for (const campaign of toExpire) {
        await revertCampaignPrices(campaign)
        await updateCampaignStatus(campaign.id, 'expired')
        emitPriceUpdate(campaign.store_id, { type: 'campaign_expired', campaign_id: campaign.id })
      }
      // Activate scheduled campaigns
      const toActivate = await getCampaignsToActivate()
      for (const campaign of toActivate) {
        await applyCampaignPrices(campaign)
        await updateCampaignStatus(campaign.id, 'active')
        emitPriceUpdate(campaign.store_id, { type: 'campaign_activated', campaign_id: campaign.id })
      }
    } catch (err) {
      console.error('[campaign-scheduler]', err)
    }
  }, 60_000)
}
```

---

## Electron Configuration

### electron/main.js
```js
const { app, BrowserWindow } = require('electron')
const { spawn } = require('child_process')
const path = require('path')

const isDev = process.env.NODE_ENV !== 'production'

function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 800,
    frame: false, menuBarVisible: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
    }
  })
  win.loadURL('http://localhost:3000/pos?storeId=Q7')
}

if (isDev) {
  app.whenReady().then(createWindow)
} else {
  const server = spawn('node', ['.next/standalone/server.js'], {
    env: { ...process.env, PORT: '3000' }
  })
  server.stdout.on('data', (data) => {
    if (data.toString().includes('Ready')) {
      app.whenReady().then(createWindow)
    }
  })
}

app.on('window-all-closed', () => app.quit())
```

### electron/preload.js
```js
const { contextBridge } = require('electron')
contextBridge.exposeInMainWorld('synaptos', {
  storeId: process.env.STORE_ID || 'Q7'
})
```

---

## E-ink Price Tile CSS

```css
/* White tile — normal price */
.price-tile {
  background: #ffffff;
  border: 1px solid #d1d5db;
  border-radius: 4px;
  padding: 8px 6px;
  text-align: center;
  transition: background 0.3s;
}

/* Red tile — on sale */
.price-tile.on-sale {
  background: #dc2626;
  border-color: #dc2626;
}

/* Flash animation on price change */
.price-tile.flashing {
  animation: tileFlash 0.6s ease-in-out;
}

@keyframes tileFlash {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.25; }
}

.price-tile .product-name {
  font-size: 9px; font-weight: 700; letter-spacing: 0.5px;
  color: #374151; overflow: hidden;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
}
.price-tile.on-sale .product-name { color: #ffffff; }

.price-tile .current-price {
  font-size: 16px; font-weight: 900; color: #111827; margin: 4px 0 2px;
}
.price-tile.on-sale .current-price { color: #ffffff; }

.price-tile .original-price {
  font-size: 9px; color: #9ca3af; text-decoration: line-through;
}
.price-tile.on-sale .original-price { color: #fca5a5; }

.price-tile .discount-badge {
  display: inline-block; background: #ffffff; color: #dc2626;
  font-size: 8px; font-weight: 900; padding: 1px 5px;
  border-radius: 2px; margin-top: 3px;
}
```

---

## POS Split Layout CSS

```css
.pos-layout {
  display: flex;
  height: calc(100vh - 48px); /* subtract header */
  overflow: hidden;
}

.pos-product-grid {
  flex: 0 0 65%;
  border-right: 1px solid var(--border);
  overflow-y: auto;
  padding: 12px;
  background: var(--bg);
}

.pos-cart-panel {
  flex: 0 0 35%;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  padding: 12px;
}

.pos-cart-items {
  flex: 1;
  overflow-y: auto;
}

.pos-cart-footer {
  border-top: 1px solid var(--border);
  padding-top: 12px;
  margin-top: 12px;
}
```

---

## Admin Top Nav Pattern

```jsx
// app/(admin)/layout.jsx
'use client'
import { usePathname, useRouter } from 'next/navigation'

const NAV_ITEMS = [
  { label: 'Dashboard', href: '/admin/dashboard' },
  { label: 'Chains', href: '/admin/chains' },
  { label: 'Recommendations', href: '/admin/recommendations' },
  { label: 'Campaigns', href: '/admin/campaigns' },
  { label: 'Approvals', href: '/admin/approvals' },
  { label: 'Reports', href: '/admin/tax-writeoff' },
  { label: 'Settings', href: '/admin/settings' },
]

export default function AdminLayout({ children }) {
  const pathname = usePathname()
  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', fontFamily: 'var(--font)' }}>
      <nav style={{ background: 'var(--navy)', padding: '0 24px', display: 'flex', alignItems: 'center', height: 48 }}>
        <span style={{ color: '#fff', fontWeight: 700, letterSpacing: 2, fontSize: 13, marginRight: 32 }}>SYNAPTOS</span>
        {NAV_ITEMS.map(item => (
          <a key={item.href} href={item.href} style={{
            color: pathname.startsWith(item.href) ? '#fff' : '#94a3b8',
            fontSize: 13, padding: '0 12px', height: 48, display: 'flex', alignItems: 'center',
            borderBottom: pathname.startsWith(item.href) ? '2px solid #3b82f6' : '2px solid transparent',
            textDecoration: 'none', fontWeight: pathname.startsWith(item.href) ? 600 : 400
          }}>{item.label}</a>
        ))}
      </nav>
      <main style={{ padding: 24 }}>{children}</main>
    </div>
  )
}
```

---

## Critical Implementation Rules

1. **Never modify existing API routes** — only extend or add new ones
2. **Never modify existing lib/server modules** except `prototype-store.js` (add tables/helpers only) and `execution/label-executor.js` (add `emitPriceUpdate` call)
3. **Temperature = 0 on every Gemini call** — hardcoded, not configurable at runtime
4. **Every agent output must be validated against a schema** before persisting — use existing `lib/server/agent/validate-proposals.js` or add per-agent validators
5. **No agent can execute** — only the deterministic rule engine (`lib/server/rules/evaluate-proposal.js`) routes proposals to execution
6. **Confidence < 0.6 = force approval route** — implement in `lib/server/agent/pipeline.js` post-guardrail step
7. **socket.io price-update events must be store-scoped** — always emit to `store:{storeId}` room
8. **PDF generation is client-side only** — import jspdf in `lib/client/` files, never in server-side code
9. **No external font imports** — use system-ui stack only
10. **No Tailwind, no shadcn, no component libraries** — plain CSS only

---

## Environment Variables

The project already has `GEMINI_API_KEY` and `DATABASE_URL` configured. You need to add:

```env
EXA_API_KEY=<already provided in project>
STORE_ID=Q7
MANAGER_PIN=1234
```

Read the existing `.env` file to find current values. Do not overwrite existing values.

---

## Execution Order

Execute phases in this exact order. Complete all tasks in a phase before starting the next.

```
Phase 0: Foundation
  → install deps, server.js, server-events.js, electron scaffold,
    design tokens, shared UI components (Button/Card/Badge/Modal/Table/Spinner),
    route group layouts for (admin), (pos), (eink)

Phase 1: Multi-Agent Pipeline
  → exa-client.js, provider-registry tier update, all 5 agent files,
    pipeline.js orchestrator, aggregation/run route extension,
    pipeline event types in events.js

Phase 2: Admin Dashboard Core
  → KpiCard, AlertFeed, PipelineProgress, SignalFreshnessPanel,
    InventoryTable, ProposalTable, ModelRunDrawer,
    dashboard/page.jsx, chains/page.jsx, recommendations/page.jsx

Phase 3: Admin Ops (campaigns, approvals)
  → campaigns DB table + helpers, campaign API routes,
    campaign-scheduler.js, CampaignCreateModal, GeoStrategyCard,
    campaigns/page.jsx, ApprovalCard, approvals/page.jsx

Phase 4: Reports + Settings
  → eol-events API, sdg metrics API, settings DB + API,
    tax-writeoff-pdf.js, sdg-report-pdf.js,
    tax-writeoff/page.jsx, sdg-report/page.jsx, settings/page.jsx

Phase 5: POS Interface
  → pos/transaction API, POSHeader, ProductCard, ProductGrid,
    CartPanel, CheckoutModal, ShrinkageModal, ManagerOverrideModal,
    POSApp, pos/page.jsx

Phase 6: E-ink Display
  → PriceTile, PriceGrid, EinkHeader, EinkDisplay, eink/page.jsx

Phase 7: Integration Wiring
  → label-executor.js emitPriceUpdate, campaign-scheduler emitPriceUpdate,
    end-to-end test: pipeline → label → E-ink red tile within 2s

Phase 8: Packaging
  → electron/icon.ico, electron-builder.yml, .env.example update,
    .gitignore update, quickstart.md update, README.md update
```

---

## Success Criteria

Your implementation is complete when all of the following are true:

- [ ] `npm run dev` starts without errors (uses `server.js`, not `next dev`)
- [ ] `http://localhost:3000/admin/dashboard` loads with real seeded data, KPI cards populated
- [ ] "Run Engine" button on dashboard triggers all 5 agents, `PipelineProgress` shows each step live
- [ ] A completed markdown proposal appears in the Recommendations proposal queue
- [ ] A `<=50%` discount proposal dispatches a label → E-ink tile at `http://localhost:3000/eink?storeId=Q7` turns red within 2 seconds
- [ ] The same SKU shows a red SALE badge in POS at `http://localhost:3000/pos?storeId=Q7` without page reload
- [ ] A `>50%` discount proposal routes to the Approvals page, cannot dispatch until approved
- [ ] Approving it dispatches the label → E-ink updates
- [ ] Flash sale campaign created in Campaigns → E-ink turns red → expires → E-ink reverts to white
- [ ] "Suggest with AI" in Geo-Demographic shows agent suggestions, does not auto-apply
- [ ] POS checkout completes with receipt modal, transaction persisted in DB
- [ ] Tax write-off PDF downloads with correct EOL data
- [ ] SDG report PDF downloads with waste metrics vs baseline
- [ ] `npm run electron:dev` opens `/pos` in a chromeless Electron window
- [ ] `npm run package:win` produces a `.exe` in `dist/`

---

## Common Pitfalls to Avoid

- Do not use `next dev` — the custom `server.js` must be used. Update `package.json` `dev` script to `"node server.js"`.
- Do not import `server-events.js` from any Next.js API route — it holds the socket.io singleton which only exists in the custom server process. Use SSE (existing `/api/events`) for server-to-browser push from API routes. Only `label-executor.js` and `campaign-scheduler.js` (both server-side Node modules, not API routes) should import `server-events.js`.
- Do not call Gemini with `temperature > 0` for any agent — financial reasoning must be deterministic.
- Do not auto-apply Campaign Agent suggestions — they must go through manager review and explicit save.
- Do not skip schema validation on agent outputs — raw text from Gemini must always pass through the validator.
- Do not add navigation or chrome to the `/eink` route — it is a display-only page.
- The `(admin)`, `(pos)`, `(eink)` route group folders use parentheses — these are Next.js App Router route groups and do not appear in the URL path.
