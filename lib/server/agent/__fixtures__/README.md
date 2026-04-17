# Seeded Replay and Evaluation Fixtures

These fixtures provide deterministic, replayable scenarios for validating the
full control-tower pipeline — from aggregated snapshot through provider
invocation, response parsing, guardrail evaluation, and execution routing.

## Fixture Categories

### `scenarios.js`
Seeded store snapshots, recommendations, and candidate lots covering all five
user stories:

| Scenario         | Story | Expected Route   | Expected Guardrail       |
|------------------|-------|------------------|--------------------------|
| Low-risk markdown | US2  | `label`          | `approved`               |
| High-risk markdown| US3  | `approval`       | `requires_approval`      |
| Unsaleable lot    | US4  | `logistics`      | `approved`               |
| Stockout risk     | US5  | `procurement`    | `approved`               |
| Stale sources     | Edge | any              | `blocked`                |

### `provider-responses.js`
Seeded provider outputs for each scenario:

- **Valid structured JSON** — parses successfully into proposals
- **Malformed JSON** — triggers `repair_failed` parse status
- **Schema-violating output** — triggers `schema_failed` parse status
- **Empty output** — triggers `repair_failed` parse status

### `replay-runner.js`
Self-contained runner that exercises the parsing and guardrail pipeline against
every fixture without requiring a live provider or database. Used for regression
checks.

## Usage

```js
import { runAllReplayScenarios } from "@/lib/server/agent/__fixtures__/replay-runner";

const results = runAllReplayScenarios();
// Each result includes: scenarioId, parseStatus, guardrailOutcome, pass/fail
```
