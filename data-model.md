# SynaptOS Data Model

## Modeling Notes

- The prototype models lot-level perishables because expiry-driven pricing is the central workflow.
- All entities are scoped for a local prototype using `SQLite`, but the structure is suitable for later migration to `Postgres`.
- State transitions focus on recommendation and approval flow rather than full retail ERP behavior.

## Entities

### Store

Purpose:

- Represents a retail location participating in the prototype.

Fields:

- `id`
- `code`
- `name`
- `district`
- `type` enum: `premium`, `transit`, `residential`
- `timezone`
- `status` enum: `active`, `inactive`

Validation:

- `code` must be unique
- `type` must be one of the supported archetypes

Relationships:

- one-to-one with `StoreProfile`
- one-to-many with `InventoryLot`
- one-to-many with `SalesEvent`
- one-to-many with `CalibrationEntry`

### StoreProfile

Purpose:

- Holds pricing and demand assumptions for a store.

Fields:

- `id`
- `storeId`
- `avgBasketSize`
- `demandElasticityBand`
- `markdownAggressiveness`
- `trafficPatternJson`
- `approvalThresholdPct`

Validation:

- `approvalThresholdPct` must be between `0` and `100`

### User

Purpose:

- Represents a demo actor using the system.

Fields:

- `id`
- `name`
- `email`
- `role` enum: `staff`, `manager`, `admin`
- `storeId` nullable

Validation:

- `role` must match one of the supported RBAC roles

### Sku

Purpose:

- Master record for a sellable product.

Fields:

- `id`
- `code`
- `name`
- `category`
- `unit`
- `basePrice`
- `unitCost`
- `minMarginPct`
- `isPerishable`

Validation:

- `basePrice` must be greater than `0`
- `unitCost` must be greater than or equal to `0`
- `minMarginPct` must be between `0` and `100`

Relationships:

- one-to-many with `InventoryLot`
- one-to-many with `SalesEvent`

### InventoryLot

Purpose:

- Tracks a perishable batch with its own expiry clock.

Fields:

- `id`
- `storeId`
- `skuId`
- `batchCode`
- `receivedAt`
- `expiresAt`
- `quantityOnHand`
- `basePrice`
- `activePrice`
- `confidenceScore`
- `status` enum: `active`, `markdowned`, `expired`, `removed`

Validation:

- `expiresAt` must be later than `receivedAt`
- `quantityOnHand` must be greater than or equal to `0`
- `confidenceScore` must be between `0` and `1`

Relationships:

- many-to-one with `Store`
- many-to-one with `Sku`
- one-to-many with `PriceRecommendation`
- one-to-many with `CalibrationEntry`

State transitions:

- `active -> markdowned`
- `active -> expired`
- `markdowned -> expired`
- `markdowned -> removed`

### SalesEvent

Purpose:

- Records sales velocity for decision-making and reporting.

Fields:

- `id`
- `storeId`
- `skuId`
- `lotId` nullable
- `soldAt`
- `quantity`
- `unitPrice`
- `totalAmount`

Validation:

- `quantity` must be greater than `0`
- `unitPrice` must be greater than or equal to `0`

### DemandSignal

Purpose:

- Stores external or contextual signals used by the engine.

Fields:

- `id`
- `storeId`
- `signalType` enum: `weather`, `time_of_day`, `district_profile`, `traffic`
- `signalValue`
- `effectiveAt`
- `expiresAt` nullable
- `source`

Validation:

- `signalType` must be supported by the scoring engine

### RecommendationRun

Purpose:

- Tracks a scoring pass over current inventory.

Fields:

- `id`
- `startedAt`
- `completedAt`
- `storeId` nullable
- `status` enum: `running`, `completed`, `failed`
- `engineVersion`

Relationships:

- one-to-many with `PriceRecommendation`

### PriceRecommendation

Purpose:

- Represents a proposed pricing action for one lot.

Fields:

- `id`
- `runId`
- `lotId`
- `riskScore`
- `sellThroughScore`
- `recommendedDiscountPct`
- `recommendedPrice`
- `reasonSummary`
- `status` enum: `draft`, `pending_review`, `approved`, `rejected`, `executed`, `expired`
- `requiresApproval`

Validation:

- `riskScore` must be between `0` and `100`
- `recommendedDiscountPct` must be between `0` and `100`
- `recommendedPrice` must be greater than or equal to `0`

State transitions:

- `draft -> approved`
- `draft -> pending_review`
- `pending_review -> approved`
- `pending_review -> rejected`
- `approved -> executed`
- `draft -> expired`
- `pending_review -> expired`

### ApprovalDecision

Purpose:

- Captures human review of a risky recommendation.

Fields:

- `id`
- `recommendationId`
- `reviewedBy`
- `decision` enum: `approved`, `rejected`, `edited`
- `approvedDiscountPct` nullable
- `approvedPrice` nullable
- `comment` nullable
- `reviewedAt`

Validation:

- `approvedPrice` is required when `decision` is `edited`

### ActivePrice

Purpose:

- Stores the currently effective price shown to the shelf-label view.

Fields:

- `id`
- `lotId`
- `recommendationId` nullable
- `currentPrice`
- `previousPrice`
- `effectiveFrom`
- `effectiveUntil` nullable
- `source` enum: `base`, `auto_markdown`, `manager_override`

Validation:

- `currentPrice` must be greater than or equal to `0`

### ShelfLabelEvent

Purpose:

- Provides an auditable stream of virtual shelf-label updates.

Fields:

- `id`
- `storeId`
- `lotId`
- `activePriceId`
- `emittedAt`
- `labelStateJson`

### CalibrationEntry

Purpose:

- Records manager-entered discrepancy corrections.

Fields:

- `id`
- `storeId`
- `skuId`
- `lotId` nullable
- `enteredBy`
- `enteredAt`
- `shrinkageUnits`
- `spoiledUnits`
- `notes`

Validation:

- `shrinkageUnits` must be greater than or equal to `0`
- `spoiledUnits` must be greater than or equal to `0`

### ImpactMetric

Purpose:

- Stores rolled-up metrics for reporting.

Fields:

- `id`
- `storeId` nullable
- `metricDate`
- `rescuedGmv`
- `unitsClearedBeforeExpiry`
- `markdownCount`
- `overrideCount`
- `estimatedWasteAvoided`

Validation:

- numeric fields must be greater than or equal to `0`

## Relationship Summary

- `Store` has one `StoreProfile`
- `Store` has many `InventoryLot`
- `Store` has many `SalesEvent`
- `Store` has many `CalibrationEntry`
- `Sku` has many `InventoryLot`
- `Sku` has many `SalesEvent`
- `InventoryLot` has many `PriceRecommendation`
- `RecommendationRun` has many `PriceRecommendation`
- `PriceRecommendation` may have one `ApprovalDecision`
- `InventoryLot` has many `ActivePrice` revisions over time

## Prototype Constraints

- The prototype assumes one active selling price per lot at a time.
- A lot may be sold without strict lot-level sales attribution; `lotId` on `SalesEvent` is nullable to allow simplified demo data.
- `ImpactMetric` is derived rather than source-of-truth data, and can be recomputed.
