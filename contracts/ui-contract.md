# SynaptOS LLM-Integrated Control-Tower UI Contract

## Scope

This contract defines the minimum UI surfaces required by the control-tower architecture once the agent layer integrates with real LLM providers.

## Global Behaviors

- The UI must show source freshness before showing model proposals.
- The UI must distinguish `aggregated fact`, `model proposal`, `guardrail result`, and `execution state` as separate stages.
- The UI must stream updates over `SSE` without requiring a full page reload.
- Guardrail-blocked actions must remain visible with the blocking rule.
- Executed actions must link back to the originating proposal, model run, and aggregation run.
- Simulated feeds and simulated executors must remain visibly labeled.
- Model failures must be visible without breaking the rest of the control-tower screen.

## Required Screens

### Control Tower

Must show:

- external and internal signal freshness
- latest aggregation run status
- latest model run status
- provider and model name for the latest run
- route counts for labels, logistics, procurement, and approvals
- per-store risk summary

Primary users:

- `admin`
- `manager`

### Proposal Queue

Must show:

- proposal type
- route
- risk class
- structured rationale
- model confidence when present
- guardrail outcome
- downstream execution status
- provider and prompt version metadata in a detail surface

Primary users:

- `manager`
- `admin`

### Human Approval Console

Must show:

- proposals with `discount > threshold`
- proposed discount and price
- affected lot and hours to expiry
- matched guardrail rules
- review notes history

Must allow:

- approve
- reject
- add review notes

Primary users:

- `manager`
- `admin`

### Virtual E-ink Wall

Must show:

- product name
- active published price
- previous price when recently changed
- discount badge
- execution timestamp
- whether the underlying route is simulated or live

Primary users:

- `staff`
- demo observers

### Logistics Workbench

Must show:

- unsaleable lots
- selected route type
- destination or disposition
- task status
- simulation badge until a live connector exists

Primary users:

- `logistics_coordinator`
- `admin`

### Procurement Console

Must show:

- stockout-risk proposals
- recommended supplier
- quantity
- estimated cost
- order status
- simulation badge until a live connector exists

Primary users:

- `procurement_planner`
- `admin`

### Audit and Policy View

Must show:

- aggregation history
- model run history
- parse or schema failures
- proposal history
- matched guardrail rules
- approvals and rejections
- executor outcomes

Primary users:

- `admin`
- `manager`

### Model Run Detail

Must show:

- provider
- model
- rollout mode: `shadow`, `assisted`, or `live`
- prompt version
- token or usage metadata when available
- parse status
- failure reason when the model run fails

Primary users:

- `admin`

## State Rules

- No action may appear as executed without a prior guardrail decision.
- A blocked proposal must never appear in an execution queue.
- A proposal requiring approval cannot appear on the virtual E-ink wall until approved and dispatched.
- A failed model run must not erase the last successful control-tower state.
- Unsaleable and procurement tasks must preserve their route-specific status even if the originating proposal changes later.
