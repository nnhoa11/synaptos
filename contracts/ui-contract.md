# SynaptOS Prototype UI Contract

## Scope

This contract defines the minimum UI surfaces that must exist for the prototype to satisfy the plan.

## Global Behaviors

- The UI must support role switching between `staff`, `manager`, and `admin`.
- All operational pages must display the selected store context.
- Pricing changes must be visible in under one refresh cycle after approval.
- Risk states must use a consistent color system:
  - green: safe
  - amber: action soon
  - red: urgent

## Required Screens

### HQ Overview

Must show:

- store cards for all demo stores
- total expiring lots today
- pending manager reviews
- rescued GMV trend

Primary user:

- `admin`

### Store Operations Board

Must show:

- expiring lots table
- hours to expiry
- active price
- base price
- risk score
- current recommendation status

Primary users:

- `staff`
- `manager`

### Approval Queue

Must show:

- recommendation reason
- recommended discount
- recommended price
- risk score
- approval threshold context

Must allow:

- approve
- reject
- edit markdown
- add comment

Primary user:

- `manager`

### Shelf Label Wall

Must show:

- product name
- active price
- previous price when recently changed
- discount badge or reason badge

Primary users:

- `staff`
- demo observers

### Calibration and Audit

Must show:

- discrepancy entry form
- action history
- manual overrides
- rejected recommendations

Primary users:

- `manager`
- `admin`

## State Rules

- A recommendation requiring approval cannot appear as executed until approval occurs.
- A rejected recommendation must remain visible in audit history.
- A low-confidence lot must display a warning state in the operational view.
- Shelf labels must always reflect `ActivePrice`, not the recommended price.
