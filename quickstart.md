# SynaptOS LLM-Integrated Control-Tower Quickstart

## Goal

Stand up the architecture so the demo proves this loop:

1. ingest external and internal signals
2. aggregate them into one store snapshot
3. invoke a real LLM provider against that snapshot
4. parse structured proposals
5. enforce deterministic guardrails before execution
6. route approved work to labels, logistics, procurement, or human approval

## Current Foundation

The existing repo already provides:

- `Next.js` App Router
- `React`
- `Postgres` persistence via `pg`
- cookie-backed RBAC sessions
- `SSE` updates
- baseline CSV import and current inventory logic
- additive `legacy` and `control_tower` UI/runtime paths

## Required Environment

Start with the local database:

```bash
docker compose -f docker-compose.postgres.yml up -d
```

Then provide at least one provider key:

```bash
export OPENAI_API_KEY="sk-..."
export GEMINI_API_KEY="..."
export LLM_PROVIDER="openai"
export LLM_MODEL="gpt-5.4"
export LLM_MODE="shadow"
export LLM_TIMEOUT_MS="15000"
export LLM_MAX_RETRIES="2"
```

If a provider key is absent, the runtime should either:

- refuse live model runs with a clear error, or
- fall back to `mock` provider mode for local development

Current implementation behavior:

- `shadow` and `assisted` modes can fall back to `mock` when the selected provider is not configured
- `live` mode surfaces a provider configuration failure instead of silently downgrading
- retry, timeout, and rate-limit metadata are persisted into the model-run detail surface

## Run The App

```bash
npm install
npm run dev
```

Open `http://127.0.0.1:3000`.

## Recommended Build Sequence

### 1. Aggregation Foundation

- keep aggregation deterministic and replayable
- materialize `AggregationRun`, `SignalObservation`, and `AggregatedSnapshot`
- expose `POST /api/aggregation/run`

### 2. LLM Gateway

- add `lib/server/agent/providers/*`
- implement provider adapters for at least one real provider plus `mock`
- isolate auth, retries, rate-limit handling, and response normalization inside the provider boundary

### 3. Prompting and Structured Output

- add prompt template versioning
- build prompts from aggregated snapshots, not raw tables
- require strict structured response parsing into `ActionProposal[]`
- persist raw and parsed model artifacts

### 4. Guardrail Engine

- keep guardrails deterministic and post-model
- encode discount, margin, freshness, and procurement spend policies
- create approval requests for markdowns above threshold

### 5. Route-Specific Executors

- `label` for low-risk markdowns
- `approval` for high-risk markdown review
- `logistics` for cross-dock or EOL routing
- `procurement` for stockout-risk replenishment

### 6. Control-Tower UI

- add model run visibility
- show provider, model, parse status, and rollout mode
- keep audit and simulation labels visible end to end

## Demo Script

### Shadow Mode

- run aggregation for one store
- run the LLM in `shadow` mode
- inspect the model run, prompt version, and structured proposals
- show that deterministic guardrails still decide what is executable
- confirm the UI shows retry count, timeout status, and rate-limit state for the latest model run

### Low-Risk Markdown

- demonstrate a markdown proposal at or below the threshold
- show guardrails approving it
- show the label route dispatching

### High-Risk Markdown

- demonstrate a proposal above the threshold
- show approval queue entry
- approve or reject and show the resulting state

### Unsaleable Routing

- demonstrate a lot that routes to logistics
- show simulated route creation and audit history

### Stockout Procurement

- demonstrate a stockout-risk case
- show bounded procurement task creation and simulation labels

## Done Criteria

- aggregation, model run, proposal, guardrail, and execution are separate persisted stages
- model runs are replayable and auditable
- deterministic guardrails remain the execution authority
- simulated integrations remain visibly marked
- the UI exposes stage status and model-run state end to end
