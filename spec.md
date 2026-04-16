# SynaptOS Control Tower Specification

## Overview

SynaptOS needs to evolve from a markdown-focused retail prototype into a control tower that can ingest multiple data sources, generate structured operational proposals, enforce deterministic guardrails, and route decisions to the correct execution surface.

The feature should preserve the current pilot-friendly strengths of the product:

- durable operational history
- manager oversight for high-risk actions
- live operational visibility
- technically honest simulated integrations

The new capability must expand SynaptOS beyond markdown-only recommendations so it can also handle unsaleable inventory routing and stockout-risk procurement while keeping humans in control of risky actions.

## Problem Statement

The current prototype demonstrates perishable markdown recommendations, but it does not yet model the broader control loop shown in the target architecture:

- multiple source feeds do not converge into one explicit decision snapshot
- model-driven proposal generation does not exist
- guardrails are not represented as a separate decision stage
- execution paths beyond markdown labels are absent

Without those capabilities, the product cannot credibly demonstrate the intended control-tower workflow for fresh-food retail operations leadership.

## Goals

- Create a single control-tower workflow that combines external signals and internal retail records.
- Generate structured proposals for pricing, routing, and procurement decisions.
- Ensure deterministic guardrails decide whether a proposal is blocked, auto-routed, or sent for human approval.
- Represent downstream actions as typed operational tasks with full auditability.
- Preserve a staged rollout path so the product can remain demoable while the new architecture lands.

## Non-Goals

- Direct supplier submission in the first release
- Production WMS, ERP, or live POS writeback integrations
- Physical e-ink device integration
- Independent microservice deployment
- Unconstrained autonomous model execution

## Users and Stakeholders

Primary stakeholders:

- chain operations leadership
- store operations leadership

Primary users:

- `admin`
- `manager`

Secondary users:

- `staff`
- `procurement planner`
- `logistics coordinator`

## User Stories

### Story 1: Control-Tower Monitoring

As an operations leader, I want to see one store-level decision snapshot built from all relevant signals so that I can understand what the system is acting on.

Acceptance indicators:

- the user can see source freshness and status before proposals are reviewed
- the user can distinguish aggregated facts from downstream actions

Evidence References:

- architecture image labels for `Weather API`, `Demographic Data`, `Commodity Prices`, `POS Transactions`, and `Inventory Ledger`

### Story 2: Safe Automated Markdown

As a store manager, I want low-risk markdown actions to publish automatically when guardrails pass so that expiring inventory can be cleared without unnecessary manual review.

Acceptance indicators:

- markdown proposals at or below the allowed threshold can reach the virtual label surface automatically
- blocked or high-risk markdowns never auto-execute

Evidence References:

- architecture image labels for `Discount <= 50%` and `Virtual E-ink Display`

### Story 3: Human Review For High-Risk Actions

As a manager, I want high-risk discount actions to enter an approval queue so that aggressive markdowns remain under human control.

Acceptance indicators:

- proposals above the defined discount threshold require explicit approval
- approval and rejection outcomes are recorded and visible

Evidence References:

- architecture image labels for `Discount > 50%` and `Human-in-the-Loop Approval`

### Story 4: Unsaleable Inventory Routing

As a logistics coordinator, I want unsaleable inventory to become a routing task so that stock can be cross-docked or sent to end-of-life handling instead of remaining stranded.

Acceptance indicators:

- unsaleable inventory proposals create route-specific operational tasks
- the routing task status remains visible after creation

Evidence References:

- architecture image labels for `Unsaleable` and `Cross-docking / EOL Routing`

### Story 5: Stockout Prevention

As a procurement planner, I want stockout-risk proposals to create bounded replenishment tasks so that high-demand items can be addressed before shelves run empty.

Acceptance indicators:

- stockout-risk proposals become procurement tasks with quantity and supplier context
- procurement actions remain bounded and reviewable

Evidence References:

- architecture image labels for `Stockout Risk` and `Autonomous Procurement`

## Functional Requirements

### FR-1 Aggregated Snapshot

The system must combine relevant external and internal sources into a single aggregated snapshot before proposal generation.

### FR-2 Source Visibility

The system must expose source freshness and provenance so operators can see whether a snapshot is trustworthy.

### FR-3 Structured Proposal Generation

The system must generate structured proposals that classify the action type and intended execution route.

### FR-4 Guardrail Enforcement

The system must evaluate every proposal through deterministic business guardrails before any execution can occur.

### FR-5 Auto Markdown Routing

The system must allow eligible markdown proposals at or below the allowed threshold to route to the virtual label execution path.

### FR-6 High-Risk Approval Routing

The system must require human approval for markdown proposals above the allowed threshold.

### FR-7 Unsaleable Routing

The system must convert unsaleable inventory proposals into logistics tasks with explicit disposition context.

### FR-8 Procurement Routing

The system must convert stockout-risk proposals into bounded procurement tasks with quantity and supplier context.

### FR-9 Stage-Level Auditability

The system must create audit records for aggregation, proposal generation, guardrail decisions, approvals, and execution outcomes.

### FR-10 Operational Queue Visibility

The system must provide operator views for control-tower status, proposal review, approvals, logistics work, procurement work, and audit history.

### FR-11 Role-Aware Actions

The system must ensure only authorized roles can approve, reject, or operate route-specific tasks.

### FR-12 Incremental Adoption

The system must support an additive rollout that does not require immediate removal of the current markdown workflow while the new path is being introduced.

## Non-Functional Requirements

### NFR-1 Deterministic Safety

Execution eligibility must be determined by deterministic rules rather than model output alone.

### NFR-2 Auditability

Audit history must be queryable and understandable by operators without direct database access.

### NFR-3 Operational Clarity

Users must be able to distinguish source state, proposal state, guardrail state, and execution state.

### NFR-4 Technical Honesty

Simulated integrations must remain clearly distinguishable from live enterprise integrations.

### NFR-5 Incremental Delivery

The feature must be deliverable in phases that allow partial adoption without invalidating the current prototype.

## Edge Cases

- Source data is stale or missing for one or more external feeds.
- Aggregated facts are contradictory or confidence is too low for automatic action.
- A markdown proposal qualifies for approval routing but the approval queue is not yet acted on.
- An item becomes unsaleable after previously being markdown-eligible.
- Stockout-risk and markdown-risk indicators appear for related inventory at the same time.
- A downstream task is created but cannot be dispatched yet because the integration remains simulated.
- An operator can view a task but does not have permission to change its state.

## Assumptions

- The initial release uses simulated external sources and simulated downstream procurement and logistics integrations.
- The approval threshold for risky discounts is `50%`.
- The first implementation remains within the current modular monolith.
- The current markdown prototype remains available during rollout of the new control-tower path.
- BuildBetter evidence artifacts are unavailable in this workspace, so the feature is specified from the architecture image and current repository documentation.
- Human-readable role names such as `procurement planner` and `logistics coordinator` map to system role identifiers `procurement_planner` and `logistics_coordinator`.

## Key Entities

- Store
- Store Profile
- Inventory Lot
- POS Transaction
- Signal Observation
- Aggregation Run
- Aggregated Snapshot
- ModelRun
- Action Proposal
- Guardrail Evaluation
- Approval Request
- Execution Task
- Label Display Update
- Logistics Route
- Procurement Order
- Audit Event
- Impact Metric

## Success Criteria

- For a seeded store, an operator can trigger aggregation and view a persisted snapshot with freshness status for every configured source type in one control-tower view.
- For each seeded scenario, the UI shows proposal type, route classification, and guardrail outcome without requiring direct database inspection.
- In the low-risk markdown scenario, a markdown proposal at or below the discount threshold dispatches to the virtual label path without creating an approval request.
- In the high-risk markdown scenario, a proposal above the discount threshold creates an approval request and cannot dispatch until approved.
- In the unsaleable and stockout-risk scenarios, the system creates one logistics task and one procurement task respectively, each with route-specific status.
- For every seeded scenario, audit history includes records for aggregation, proposal generation, guardrail evaluation, and final route outcome.
- During rollout validation, the legacy markdown flow remains usable while the control-tower path is exercised end to end.
