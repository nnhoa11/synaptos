/**
 * Seeded provider response fixtures for model-run regression testing.
 *
 * These represent the raw text that a provider adapter would return.
 * Each fixture is paired with a scenario from scenarios.js.
 */

// ─── Valid Responses ─────────────────────────────────────────────────────────

/**
 * Valid low-risk markdown response — should parse and pass guardrails.
 */
export const RESPONSE_LOW_RISK_MARKDOWN = {
  scenarioId: "low_risk_markdown",
  label: "Valid low-risk markdown proposal at 20% discount",
  expectedParseStatus: "parsed",
  rawText: JSON.stringify(
    {
      proposals: [
        {
          recommendationId: "rec_fixture_lowrisk_01",
          proposalType: "markdown",
          executionRoute: "label",
          recommendedDiscountPct: 20,
          proposedPrice: 44000,
          rationale:
            "Organic chicken is approaching expiry with 14 hours remaining. " +
            "A 20% markdown will drive clearance without eroding category margins. " +
            "Current foot traffic supports rapid sell-through at the discounted price.",
          metadata: {},
        },
      ],
    },
    null,
    2
  ),
};

/**
 * Valid high-risk markdown response — should parse but trigger approval.
 */
export const RESPONSE_HIGH_RISK_MARKDOWN = {
  scenarioId: "high_risk_markdown",
  label: "Valid high-risk markdown proposal at 65% discount",
  expectedParseStatus: "parsed",
  rawText: JSON.stringify(
    {
      proposals: [
        {
          recommendationId: "rec_fixture_highrisk_01",
          proposalType: "markdown",
          executionRoute: "approval",
          recommendedDiscountPct: 65,
          proposedPrice: 122500,
          rationale:
            "Premium Wagyu with only 6 hours left requires aggressive clearance. " +
            "The high unit cost means the 65% markdown exceeds policy threshold " +
            "and must be reviewed by a manager before label update.",
          metadata: {},
        },
      ],
    },
    null,
    2
  ),
};

/**
 * Valid unsaleable routing response — should parse and route to logistics.
 */
export const RESPONSE_UNSALEABLE = {
  scenarioId: "unsaleable_routing",
  label: "Valid unsaleable proposal routing to logistics",
  expectedParseStatus: "parsed",
  rawText: JSON.stringify(
    {
      proposals: [
        {
          recommendationId: "rec_fixture_unsaleable_01",
          proposalType: "unsaleable",
          executionRoute: "logistics",
          recommendedDiscountPct: 0,
          proposedPrice: 32000,
          rationale:
            "Fresh milk with only 30 minutes remaining is no longer sellable. " +
            "Route to cross-dock for partner redistribution or EOL disposal.",
          metadata: {
            logistics: {
              routeType: "cross_dock_or_eol",
              destination: "eol",
            },
          },
        },
      ],
    },
    null,
    2
  ),
};

/**
 * Valid stockout-risk response — should parse and route to procurement.
 */
export const RESPONSE_STOCKOUT_RISK = {
  scenarioId: "stockout_risk_procurement",
  label: "Valid stockout-risk proposal routing to procurement",
  expectedParseStatus: "parsed",
  rawText: JSON.stringify(
    {
      proposals: [
        {
          recommendationId: "rec_fixture_stockout_01",
          proposalType: "stockout_risk",
          executionRoute: "procurement",
          recommendedDiscountPct: 0,
          proposedPrice: 89000,
          rationale:
            "Jasmine rice velocity at 18.5 units/day against 3 on-hand. " +
            "Bounded replenishment of 6 units from preferred supplier is recommended " +
            "to prevent shelf stockout within the next 4 hours.",
          metadata: {
            procurement: {
              supplier: "Fixture Supplier Co.",
              quantity: 6,
            },
          },
        },
      ],
    },
    null,
    2
  ),
};

/**
 * Valid mixed proposal response — multiple proposal types in one output.
 */
export const RESPONSE_MIXED = {
  scenarioId: "mixed_proposals",
  label: "Valid mixed proposals: markdown + unsaleable + stockout-risk",
  expectedParseStatus: "parsed",
  rawText: JSON.stringify(
    {
      proposals: [
        {
          recommendationId: "rec_fixture_mixed_md",
          proposalType: "markdown",
          executionRoute: "label",
          recommendedDiscountPct: 30,
          proposedPrice: 56000,
          rationale: "Imported cheese at 12h expiry warrants a 30% markdown within auto-threshold.",
          metadata: {},
        },
        {
          recommendationId: "rec_fixture_mixed_unsale",
          proposalType: "unsaleable",
          executionRoute: "logistics",
          recommendedDiscountPct: 0,
          proposedPrice: 15000,
          rationale: "Yogurt cup at 12 minutes to expiry is no longer sellable.",
          metadata: {
            logistics: {
              routeType: "cross_dock_or_eol",
              destination: "eol",
            },
          },
        },
        {
          recommendationId: "rec_fixture_mixed_stock",
          proposalType: "stockout_risk",
          executionRoute: "procurement",
          recommendedDiscountPct: 0,
          proposedPrice: 45000,
          rationale: "Free-range eggs with 2 on-hand vs 14.8 velocity require replenishment.",
          metadata: {
            procurement: {
              supplier: "Fixture Supplier Co.",
              quantity: 6,
            },
          },
        },
      ],
    },
    null,
    2
  ),
};

// ─── Failure Responses ───────────────────────────────────────────────────────

/**
 * Malformed JSON — provider returned invalid syntax.
 * Should trigger repair_failed parse status.
 */
export const RESPONSE_MALFORMED_JSON = {
  scenarioId: "low_risk_markdown",
  label: "Malformed JSON — missing closing brace",
  expectedParseStatus: "repair_failed",
  rawText: '{"proposals": [{"recommendationId": "rec_fixture_lowrisk_01", "proposalType": "markdown"',
};

/**
 * Schema-violating output — valid JSON but missing required fields.
 * Should trigger schema_failed parse status.
 */
export const RESPONSE_SCHEMA_VIOLATION = {
  scenarioId: "low_risk_markdown",
  label: "Schema violation — missing rationale and proposalType",
  expectedParseStatus: "schema_failed",
  rawText: JSON.stringify(
    {
      proposals: [
        {
          recommendationId: "rec_fixture_lowrisk_01",
          // Missing: proposalType, executionRoute, rationale
          recommendedDiscountPct: 20,
          proposedPrice: 44000,
        },
      ],
    },
    null,
    2
  ),
};

/**
 * Empty output — provider returned nothing.
 * Should trigger repair_failed parse status.
 */
export const RESPONSE_EMPTY = {
  scenarioId: "low_risk_markdown",
  label: "Empty provider output",
  expectedParseStatus: "repair_failed",
  rawText: "",
};

/**
 * Fenced markdown response — provider wrapped JSON in code fences.
 * Should still parse successfully after extraction.
 */
export const RESPONSE_FENCED_JSON = {
  scenarioId: "low_risk_markdown",
  label: "JSON wrapped in markdown code fences",
  expectedParseStatus: "parsed",
  rawText: [
    "Here is my analysis of the store snapshot:",
    "",
    "```json",
    JSON.stringify(
      {
        proposals: [
          {
            recommendationId: "rec_fixture_lowrisk_01",
            proposalType: "markdown",
            executionRoute: "label",
            recommendedDiscountPct: 20,
            proposedPrice: 44000,
            rationale: "Clearance markdown within auto-threshold.",
            metadata: {},
          },
        ],
      },
      null,
      2
    ),
    "```",
  ].join("\n"),
};

// ─── Export ──────────────────────────────────────────────────────────────────

export const ALL_VALID_RESPONSES = [
  RESPONSE_LOW_RISK_MARKDOWN,
  RESPONSE_HIGH_RISK_MARKDOWN,
  RESPONSE_UNSALEABLE,
  RESPONSE_STOCKOUT_RISK,
  RESPONSE_MIXED,
  RESPONSE_FENCED_JSON,
];

export const ALL_FAILURE_RESPONSES = [
  RESPONSE_MALFORMED_JSON,
  RESPONSE_SCHEMA_VIOLATION,
  RESPONSE_EMPTY,
];

export const ALL_RESPONSES = [...ALL_VALID_RESPONSES, ...ALL_FAILURE_RESPONSES];

export function getResponsesForScenario(scenarioId) {
  return ALL_RESPONSES.filter((r) => r.scenarioId === scenarioId);
}
