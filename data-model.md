# SynaptOS LLM-Integrated Control-Tower Data Model

## Modeling Notes

- The target architecture remains a modular monolith backed by `Postgres`.
- The main design change is that the `agent` boundary now integrates with real LLM providers.
- The data model must preserve three truths separately:
  - aggregated operational facts
  - model-generated proposals
  - deterministic policy and execution outcomes

## Entities

### Store

Purpose:

- Represents one retail location managed by SynaptOS.

Fields:

- `id`
- `code`
- `name`
- `district`
- `type` enum: `premium`, `transit`, `residential`
- `timezone`
- `status` enum: `active`, `inactive`
- `controlTowerEnabled`
- `llmMode` enum: `disabled`, `shadow`, `assisted`, `live`

Validation:

- `code` must be unique
- `llmMode` must be one of the supported rollout modes

Relationships:

- one-to-one with `StorePolicy`
- one-to-many with `InventoryLot`
- one-to-many with `PosTransaction`
- one-to-many with `AggregationRun`
- one-to-many with `ModelRun`

### StorePolicy

Purpose:

- Stores deterministic thresholds and execution constraints for one store.

Fields:

- `id`
- `storeId`
- `approvalThresholdPct`
- `markdownMaxAutoDiscountPct`
- `minMarginPct`
- `procurementSpendCap`
- `unsaleableHoursThreshold`
- `allowedLogisticsRoutesJson`
- `preferredSupplierId` nullable

Validation:

- `approvalThresholdPct` must be between `0` and `100`
- `markdownMaxAutoDiscountPct` must be between `0` and `100`
- `procurementSpendCap` must be greater than or equal to `0`

### User

Purpose:

- Represents an authenticated actor who can review, dispatch, or inspect work.

Fields:

- `id`
- `name`
- `email`
- `role` enum: `staff`, `manager`, `admin`, `procurement_planner`, `logistics_coordinator`
- `storeId` nullable

Validation:

- `role` must match one of the supported RBAC roles

### Supplier

Purpose:

- Represents a supplier that may receive procurement actions.

Fields:

- `id`
- `code`
- `name`
- `status` enum: `active`, `inactive`
- `leadTimeHours`
- `catalogJson`

Validation:

- `code` must be unique
- `leadTimeHours` must be greater than or equal to `0`

### InventoryLot

Purpose:

- Tracks one perishable batch and its on-hand state.

Fields:

- `id`
- `storeId`
- `skuKey`
- `batchCode`
- `receivedAt`
- `expiresAt`
- `quantityOnHand`
- `confidenceScore`
- `currentPrice`
- `status` enum: `active`, `markdowned`, `unsaleable`, `expired`, `removed`

Validation:

- `expiresAt` must be later than `receivedAt`
- `quantityOnHand` must be greater than or equal to `0`
- `confidenceScore` must be between `0` and `1`

Relationships:

- many-to-one with `Store`
- one-to-many with `ActionProposal`
- one-to-many with `ExecutionTask`

### PosTransaction

Purpose:

- Stores internal demand signals from POS activity.

Fields:

- `id`
- `storeId`
- `skuKey`
- `lotId` nullable
- `soldAt`
- `quantity`
- `unitPrice`
- `grossAmount`

Validation:

- `quantity` must be greater than `0`
- `unitPrice` must be greater than or equal to `0`

### SignalObservation

Purpose:

- Represents any external or internal signal consumed by the aggregator.

Fields:

- `id`
- `aggregationRunId`
- `snapshotKey`
- `storeId`
- `sourceFamily` enum: `external`, `internal`
- `sourceType` enum: `weather_api`, `demographic_data`, `commodity_prices`, `pos_transactions`, `inventory_ledger`
- `observedAt`
- `freshnessStatus` enum: `fresh`, `degraded`, `stale`
- `freshnessMinutes`
- `provenance` enum: `simulated`, `live`
- `payloadJson`

Validation:

- `sourceType` must be one of the supported aggregator inputs
- `freshnessMinutes` must be greater than or equal to `0`

### AggregationRun

Purpose:

- Captures one execution of the data aggregator.

Fields:

- `id`
- `snapshotKey`
- `actorUserId` nullable
- `status` enum: `running`, `completed`, `failed`
- `summaryJson`
- `createdAt`

Relationships:

- one-to-many with `SignalObservation`
- one-to-many with `AggregatedSnapshot`
- one-to-many with `ModelRun`

### AggregatedSnapshot

Purpose:

- Holds the normalized state bundle presented to the model layer.

Fields:

- `id`
- `aggregationRunId`
- `snapshotKey`
- `storeId`
- `status` enum: `ready`, `failed`
- `sourceHealth` enum: `healthy`, `watch`, `attention`
- `payloadJson`
- `createdAt`

Validation:

- `payloadJson` must match the internal snapshot schema
- one store may have one latest aggregated snapshot per aggregation run

### PromptTemplate

Purpose:

- Represents a versioned prompt package used by the model layer.

Fields:

- `id`
- `name`
- `version`
- `systemPrompt`
- `developerPrompt`
- `responseSchemaJson`
- `isActive`
- `createdAt`

Validation:

- `name + version` must be unique
- `responseSchemaJson` must be valid JSON schema

### ModelRun

Purpose:

- Captures one provider-backed LLM invocation against an aggregated snapshot.

Fields:

- `id`
- `aggregationRunId`
- `snapshotKey`
- `storeId`
- `mode` enum: `shadow`, `assisted`, `live`
- `provider` enum: `openai`, `gemini`, `anthropic`, `mock`
- `model`
- `promptTemplateId`
- `status` enum: `running`, `completed`, `failed`, `rate_limited`, `timed_out`
- `latencyMs`
- `retryCount`
- `usageJson`
- `estimatedCost`
- `errorCode` nullable
- `errorMessage` nullable
- `startedAt`
- `completedAt` nullable

Validation:

- `provider` and `model` are required
- `estimatedCost` must be greater than or equal to `0`
- `mode` must reflect a supported rollout mode

Relationships:

- many-to-one with `AggregatedSnapshot` through `aggregationRunId`
- one-to-many with `ModelInputArtifact`
- one-to-many with `ModelOutputArtifact`
- one-to-many with `ActionProposal`

### ModelInputArtifact

Purpose:

- Stores the compacted prompt context sent to the provider.

Fields:

- `id`
- `modelRunId`
- `snapshotSummaryJson`
- `policyHintsJson`
- `messagesJson`
- `tokenEstimate`
- `redactionStatus` enum: `not_needed`, `redacted`
- `createdAt`

Validation:

- `messagesJson` must preserve the exact request payload or a faithful replayable equivalent

### ModelOutputArtifact

Purpose:

- Stores raw provider output and parse results.

Fields:

- `id`
- `modelRunId`
- `rawText`
- `structuredJson` nullable
- `parseStatus` enum: `parsed`, `repair_failed`, `schema_failed`, `provider_failed`
- `validationErrorsJson`
- `createdAt`

Validation:

- `parseStatus` must explain whether structured output was accepted

### ActionProposal

Purpose:

- Represents one structured action proposed by the LLM layer.

Fields:

- `id`
- `modelRunId`
- `aggregationRunId`
- `snapshotKey`
- `storeId`
- `lotId` nullable
- `skuKey` nullable
- `proposalType` enum: `markdown`, `unsaleable`, `stockout_risk`
- `executionRoute` enum: `label`, `approval`, `logistics`, `procurement`
- `recommendedDiscountPct` nullable
- `proposedPrice` nullable
- `proposedQuantity` nullable
- `recommendedSupplier` nullable
- `logisticsDisposition` nullable
- `rationale`
- `confidenceScore` nullable
- `status` enum: `draft`, `blocked`, `pending_approval`, `approved`, `rejected`, `dispatched`, `completed`
- `metadataJson`
- `createdAt`

Validation:

- `executionRoute` must be consistent with `proposalType`
- `recommendedDiscountPct` must be between `0` and `100` when present
- `proposedQuantity` must be greater than `0` when present

State transitions:

- `draft -> blocked`
- `draft -> approved`
- `draft -> pending_approval`
- `pending_approval -> approved`
- `pending_approval -> rejected`
- `approved -> dispatched`
- `dispatched -> completed`

### GuardrailEvaluation

Purpose:

- Represents the deterministic business decision applied to one proposal.

Fields:

- `id`
- `proposalId`
- `storeId`
- `outcome` enum: `approved`, `requires_approval`, `blocked`
- `matchedRule`
- `executionRoute`
- `reason`
- `status` enum: `ready`, `waiting_approval`, `blocked`
- `createdAt`

Validation:

- every `ActionProposal` must have exactly one latest `GuardrailEvaluation`

### ApprovalRequest

Purpose:

- Tracks human review for proposals that cannot auto-execute.

Fields:

- `id`
- `proposalId`
- `storeId`
- `status` enum: `pending`, `approved`, `rejected`
- `matchedRule`
- `requestedBy`
- `reviewedBy` nullable
- `reviewNotes`
- `createdAt`
- `reviewedAt` nullable

Validation:

- only proposals with `GuardrailEvaluation.outcome = requires_approval` may create approval requests

### ExecutionTask

Purpose:

- Represents downstream executable work after guardrail evaluation.

Fields:

- `id`
- `proposalId`
- `storeId`
- `route` enum: `label`, `logistics`, `procurement`
- `taskType`
- `status` enum: `ready`, `dispatched`, `completed`, `blocked`
- `detailsJson`
- `simulated`
- `createdAt`
- `dispatchedAt` nullable

Validation:

- no task may be created without a prior approved or approval-cleared guardrail state

### LogisticsRoute

Purpose:

- Holds route-specific logistics handling details.

Fields:

- `id`
- `executionTaskId`
- `storeId`
- `routeType`
- `destination`
- `status`
- `createdAt`

### ProcurementOrder

Purpose:

- Holds bounded replenishment order details.

Fields:

- `id`
- `executionTaskId`
- `storeId`
- `supplier`
- `quantity`
- `estimatedCost`
- `status`
- `createdAt`

Validation:

- `estimatedCost` must not exceed deterministic spend caps after guardrail approval

### AuditEvent

Purpose:

- Stores operator-visible history across the control-tower lifecycle.

Fields:

- `id`
- `storeId` nullable
- `type`
- `actor`
- `actorUserId` nullable
- `message`
- `details`
- `createdAt`

Validation:

- audit coverage must include aggregation, model runs, parse failures, guardrail outcomes, approvals, and execution outcomes
