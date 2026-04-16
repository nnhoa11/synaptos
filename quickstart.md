# SynaptOS Prototype Quickstart

## Goal

Stand up a demoable prototype that proves the core SynaptOS loop:

1. load perishable inventory and context
2. generate markdown recommendations
3. review high-risk recommendations
4. publish approved prices to virtual shelf labels
5. measure rescued GMV

## Current Stack

- `Next.js` App Router
- `React`
- CSS via `app/globals.css`
- CSV-backed server data loading
- In-memory approvals, labels, and calibration state for the prototype

## Run It

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:3000`.

## Build Sequence

### 1. App Shell

- `app/page.jsx` renders the prototype shell.
- `components/PrototypeApp.jsx` contains the interactive dashboard.
- `app/api/recommendations/run/route.js` computes the engine result for the selected snapshot.

### 2. Data Layer

- `lib/prototype-data.js` reads the baseline CSV from the project root.
- `lib/prototype-core.js` normalizes rows, derives lots, and computes recommendations.
- The baseline dataset drives 3 stores:
  - premium urban
  - residential
  - transit

### 3. Scoring Engine

- Compute:
  - hours to expiry
  - stock pressure
  - sales velocity gap
  - store-context modifier
  - weather modifier
- Output:
  - hold
  - mild markdown
  - moderate markdown
  - aggressive markdown
  - manager review required

### 4. Operations UI

- HQ overview
- store operations board
- approval queue
- shelf label wall
- calibration and audit view

Use the UI expectations in [contracts/ui-contract.md](/Users/nguyenngochoa/Git/gg-hackathon/contracts/ui-contract.md).

### 5. Execution Layer

- The prototype keeps approval, calibration, and label state in the client.
- `labels` are recalculated after each run from the current adjustment state.
- The implemented read/compute endpoints are:
  - `GET /api/stores`
  - `GET /api/snapshots`
  - `POST /api/recommendations/run`

### 6. Reporting

- rescued GMV
- units cleared before expiry
- markdown count
- overrides
- estimated waste avoided

## Demo Script

### Premium Urban

- Show a lightly discounted organic item near lunch.

### Residential

- Show earlier markdown on family-pack chicken because sell-through is lagging.

### Transit

- Hold cold-drink prices during heat-driven demand, then trigger late flash markdown.

## Done Criteria

- recommendations can be generated on demand
- manager approval changes the effective price
- shelf-label view updates from the effective price
- the system logs all actions
- the report shows measurable simulated impact
