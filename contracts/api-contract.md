# SynaptOS LLM-Integrated Control-Tower API Contract

## Scope

This contract defines the internal HTTP and realtime interfaces for a control-tower architecture that integrates with real LLM providers while keeping deterministic execution control.

## Conventions

- Content type: `application/json`
- Time values: ISO 8601
- Currency fields: decimal values in the tenant display currency
- IDs: opaque strings
- Model output must be stored and surfaced as structured artifacts, not only as free text

## HTTP Endpoints

### `GET /api/stores`

Purpose:

- Return stores and top-level control-tower status.

Response:

```json
[
  {
    "id": "store_d1",
    "name": "SynaptOS D1 Premium",
    "llmMode": "shadow",
    "pendingApprovals": 2,
    "queuedLogisticsTasks": 1,
    "queuedProcurementOrders": 3,
    "lastAggregationAt": "2026-04-17T01:45:00Z",
    "lastModelRunAt": "2026-04-17T01:46:10Z"
  }
]
```

### `GET /api/stores/:storeId/control-tower`

Purpose:

- Return the latest store-level control-tower state.

Response shape:

- `store`
- `runtimeMode`
- `llmMode`
- `sourceFreshness`
- `aggregatedSnapshot`
- `latestModelRun`
- `proposals`
- `approvals`
- `executionQueues`
- `metrics`
- `audit`

### `POST /api/aggregation/run`

Purpose:

- Trigger a `Data Aggregator` pass for one store or for the current snapshot set.

Request:

```json
{
  "storeId": "store_d1",
  "snapshotKey": "2026-04-17T01:45:00Z"
}
```

Response:

```json
{
  "aggregationRunId": "agg_001",
  "status": "completed"
}
```

### `GET /api/aggregation/runs/:id`

Purpose:

- Return one aggregation run, its source observations, and the resulting aggregated snapshots.

### `POST /api/agent/runs`

Purpose:

- Invoke the model layer against the latest aggregated snapshot.

Request:

```json
{
  "storeId": "store_d1",
  "snapshotKey": "2026-04-17T01:45:00Z",
  "provider": "openai",
  "model": "gpt-5.4",
  "mode": "shadow"
}
```

Response:

```json
{
  "modelRunId": "model_001",
  "status": "completed",
  "provider": "openai",
  "model": "gpt-5.4",
  "proposalCount": 4
}
```

### `GET /api/agent/runs/:id`

Purpose:

- Return one model run, including prompt version, usage, parse status, and proposal summary.

Response shape:

- `modelRun`
- `inputArtifact`
- `outputArtifact`
- `proposals`
- `parseStatus`
- `usage`

### `GET /api/proposals`

Query params:

- `storeId` optional
- `route` optional
- `status` optional
- `snapshotKey` optional

Purpose:

- Return typed action proposals with linked model-run, guardrail, approval, and execution state.

### `POST /api/proposals/:id/approve`

Purpose:

- Approve a proposal that requires human review.

Request:

```json
{
  "reviewNotes": "Approved after checking local demand recovery"
}
```

### `POST /api/proposals/:id/reject`

Purpose:

- Reject a proposal that reached human review.

Request:

```json
{
  "reviewNotes": "Rejecting until spoilage count is verified"
}
```

### `POST /api/execution/tasks/:id/dispatch`

Purpose:

- Dispatch a queued execution task to its route-specific executor.

Request:

```json
{
  "route": "label",
  "storeId": "store_d1"
}
```

### `GET /api/logistics/tasks`

Query params:

- `storeId` optional
- `status` optional
- `snapshotKey` optional

Purpose:

- Return unsaleable routing tasks and their state.

### `GET /api/procurement/orders`

Query params:

- `storeId` optional
- `status` optional
- `snapshotKey` optional

Purpose:

- Return bounded procurement orders generated from stockout risk.

### `GET /api/metrics`

Query params:

- `storeId` optional
- `snapshotKey` optional

Purpose:

- Return impact metrics plus LLM-related control-tower counts.

Response shape:

- legacy recommendation metrics
- control-tower route counts
- `controlTower.proposalCount`
- `controlTower.pendingApprovals`
- `controlTower.logisticsTasks`
- `controlTower.procurementOrders`
- `controlTower.simulated`

### `GET /api/audit`

Query params:

- `storeId` optional
- `includeSummary` optional

Purpose:

- Return operator-visible audit history across aggregation, model runs, parse failures, guardrails, approvals, and execution.

## Realtime Contract

### `GET /api/events`

Transport:

- Server-Sent Events

Event types:

- `aggregation.completed`
- `agent.started`
- `agent.completed`
- `agent.failed`
- `proposal.updated`
- `approval.updated`
- `execution.updated`
- `logistics.updated`
- `procurement.updated`
- `label.updated`
- `import.completed`

Example event payload:

```json
{
  "type": "agent.completed",
  "storeId": "store_d1",
  "modelRunId": "model_001",
  "provider": "openai",
  "model": "gpt-5.4",
  "proposalCount": 4,
  "at": "2026-04-17T01:50:00Z"
}
```

## Error Contract

Error response shape:

```json
{
  "error": {
    "code": "SCHEMA_VALIDATION_FAILED",
    "message": "Model output did not match the ActionProposal schema"
  }
}
```

Common codes:

- `VALIDATION_ERROR`
- `NOT_FOUND`
- `INVALID_STATE`
- `UNAUTHORIZED_ROLE`
- `SOURCE_STALE`
- `SCHEMA_VALIDATION_FAILED`
- `PROVIDER_RATE_LIMITED`
- `PROVIDER_TIMEOUT`
- `GUARDRAIL_BLOCKED`
