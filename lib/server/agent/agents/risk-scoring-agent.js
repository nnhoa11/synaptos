import { clamp, runGeminiStage, schemaError, toNullableNumber, toNullableString } from "@/lib/server/agent/agents/utils";

const SYSTEM_PROMPT = `You receive lot-level inventory facts including quantity, expiry, category, temperature, and demand signals.
Score each risk dimension on a 0.0-1.0 scale using only the provided data.
Do not reference market knowledge outside the input.
For each score, include a one-field citation: the input field name that most influenced the score.
If a required input field is null, set the affected score to null and explain in the citation.
Output valid JSON only. No prose.`;

const SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      lot_id: { type: "string" },
      spoilage_risk: { type: ["number", "null"] },
      sell_through_probability: { type: ["number", "null"] },
      stockout_risk: { type: ["number", "null"] },
      citations: { type: "object" },
      confidence: { type: "number" },
    },
  },
};

function validateEntry(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw schemaError("risk score entries must be objects");
  }

  return {
    lot_id: toNullableString(entry.lot_id),
    spoilage_risk: toNullableNumber(entry.spoilage_risk),
    sell_through_probability: toNullableNumber(entry.sell_through_probability),
    stockout_risk: toNullableNumber(entry.stockout_risk),
    citations: entry.citations && typeof entry.citations === "object" ? entry.citations : {},
    confidence: clamp(toNullableNumber(entry.confidence) ?? 0.8, 0, 1),
  };
}

function validatePayload(payload) {
  if (!Array.isArray(payload)) {
    throw schemaError("risk scoring output must be an array");
  }

  return payload.map(validateEntry);
}

function citeOrExplain(fieldName, value) {
  return value == null ? `${fieldName}: missing` : fieldName;
}

function buildFallback(input) {
  return input.lots.map((lot) => {
    const quantity = lot.quantity ?? 0;
    const hours = lot.hours_to_expiry ?? null;
    const velocity = lot.recent_velocity ?? 0;
    const traffic = lot.item_traffic ?? 1;
    const temperature = lot.temperature_c ?? null;

    const spoilageRisk =
      hours == null
        ? null
        : clamp((36 - hours) / 36 + ((temperature ?? 28) - 28) / 20 + quantity / Math.max(12, velocity * 6 + 1), 0, 1);

    const sellThroughProbability =
      quantity <= 0
        ? 1
        : clamp(velocity / Math.max(quantity, 1) + (traffic - 1) * 0.25 + (hours != null && hours <= 24 ? 0.15 : 0), 0, 1);

    const stockoutRisk =
      quantity <= 0
        ? 1
        : clamp((velocity * 1.4) / Math.max(quantity, 1) + (traffic - 1) * 0.35, 0, 1);

    return {
      lot_id: lot.lot_id,
      spoilage_risk: spoilageRisk,
      sell_through_probability: sellThroughProbability,
      stockout_risk: stockoutRisk,
      citations: {
        spoilage_risk: citeOrExplain("hours_to_expiry", hours),
        sell_through_probability: citeOrExplain("recent_velocity", velocity),
        stockout_risk: citeOrExplain("quantity", quantity),
      },
      confidence: 0.76,
    };
  });
}

export async function runRiskScoringAgent(input) {
  return runGeminiStage({
    stageName: "risk_scoring",
    tier: "medium",
    systemPrompt: SYSTEM_PROMPT,
    input,
    schema: SCHEMA,
    validate: validatePayload,
    fallback: buildFallback,
  });
}
