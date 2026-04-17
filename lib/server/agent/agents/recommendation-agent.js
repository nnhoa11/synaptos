import { clamp, runGeminiStage, schemaError, toNullableString } from "@/lib/server/agent/agents/utils";

const SYSTEM_PROMPT = `You receive a fully aggregated store snapshot with per-lot risk scores.
Propose actions using only these action types: markdown, logistics_route, procurement_order.
Every proposal must include a data_citation field naming the exact input field that justifies the action.
Do not propose discount values. Guardrails determine discount amounts after your output.
Do not propose actions for lots not present in the input.
If no action is warranted for a lot, omit it from the output.
Output valid JSON array only. No prose.`;

const SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      type: { type: "string" },
      lot_id: { type: "string" },
      data_citation: { type: "string" },
      confidence: { type: "number" },
    },
  },
};

function validateEntry(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw schemaError("recommendation entries must be objects");
  }

  const type = toNullableString(entry.type);
  if (!["markdown", "logistics_route", "procurement_order"].includes(type)) {
    throw schemaError("recommendation type must be markdown, logistics_route, or procurement_order");
  }

  return {
    type,
    lot_id: toNullableString(entry.lot_id),
    data_citation: toNullableString(entry.data_citation),
    confidence: clamp(Number(entry.confidence ?? 0.8), 0, 1),
  };
}

function validatePayload(payload) {
  if (!Array.isArray(payload)) {
    throw schemaError("recommendation output must be an array");
  }

  return payload.map(validateEntry);
}

function buildFallback(input) {
  return input.lots.flatMap((lot) => {
    if (lot.candidate_type === "unsaleable") {
      return [
        {
          type: "logistics_route",
          lot_id: lot.lot_id,
          data_citation: "spoilage_risk",
          confidence: 0.88,
        },
      ];
    }

    if (lot.candidate_type === "stockout_risk" || (lot.stockout_risk ?? 0) >= 0.72) {
      return [
        {
          type: "procurement_order",
          lot_id: lot.lot_id,
          data_citation: "stockout_risk",
          confidence: 0.82,
        },
      ];
    }

    if ((lot.spoilage_risk ?? 0) >= 0.62 || (lot.baseline_recommended_discount_pct ?? 0) > 0) {
      return [
        {
          type: "markdown",
          lot_id: lot.lot_id,
          data_citation: (lot.spoilage_risk ?? 0) >= 0.62 ? "spoilage_risk" : "baseline_recommended_discount_pct",
          confidence: 0.8,
        },
      ];
    }

    if ((lot.spoilage_risk ?? 0) >= 0.92) {
      return [
        {
          type: "logistics_route",
          lot_id: lot.lot_id,
          data_citation: "spoilage_risk",
          confidence: 0.88,
        },
      ];
    }

    return [];
  });
}

export async function runRecommendationAgent(input) {
  return runGeminiStage({
    stageName: "recommendation",
    tier: "high",
    systemPrompt: SYSTEM_PROMPT,
    input,
    schema: SCHEMA,
    validate: validatePayload,
    fallback: buildFallback,
  });
}
