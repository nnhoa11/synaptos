import { clamp, runGeminiStage, schemaError, toNullableNumber, toNullableString } from "@/lib/server/agent/agents/utils";

const SYSTEM_PROMPT = `You receive a store archetype (residential, premium_urban, or transit), district profile, and intraday traffic data.
Suggest campaign timing windows and discount trajectories that match the archetype strategy:
- residential: progressive volume discounts, target family-pack categories, peak 17:00-19:00
- premium_urban: defer discounts, prefer cross-dock routing, micro-markdowns at 12:00 on RTE only
- transit: flat day pricing, aggressive EOD flash clearance at 20:00-22:00
Output must match the campaign schema exactly. Do not suggest strategies not listed above.
All timing values must be 24h format strings. Output valid JSON only. No prose.`;

const SCHEMA = {
  type: "object",
  properties: {
    archetype: { type: "string" },
    windows: { type: "array" },
    confidence: { type: "number" },
  },
};

const VALID_ARCHETYPES = new Set(["residential", "premium_urban", "transit"]);
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

function requireString(value, fieldName) {
  const next = toNullableString(value);
  if (!next) {
    throw schemaError(`${fieldName} is required`);
  }
  return next;
}

function requireNumber(value, fieldName) {
  const next = toNullableNumber(value);
  if (next == null) {
    throw schemaError(`${fieldName} is required`);
  }
  return next;
}

function requireTime(value, fieldName) {
  const next = requireString(value, fieldName);
  if (!TIME_PATTERN.test(next)) {
    throw schemaError(`${fieldName} must be a 24h time string`);
  }
  return next;
}

function validateWindow(window) {
  if (!window || typeof window !== "object" || Array.isArray(window)) {
    throw schemaError("campaign windows must be objects");
  }

  const startTime = requireTime(window.start_time, "start_time");
  const endTime = requireTime(window.end_time, "end_time");
  const discountPct = requireNumber(window.discount_pct, "discount_pct");
  if (discountPct < 0 || discountPct > 100) {
    throw schemaError("discount_pct must be between 0 and 100");
  }

  return {
    start_time: startTime,
    end_time: endTime,
    discount_pct: discountPct,
    target_category: requireString(window.target_category, "target_category"),
  };
}

function validatePayload(payload, input) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw schemaError("campaign output must be an object");
  }

  const archetype = requireString(payload.archetype, "archetype");
  if (!VALID_ARCHETYPES.has(archetype)) {
    throw schemaError("archetype must be residential, premium_urban, or transit");
  }

  if (!Array.isArray(payload.windows)) {
    throw schemaError("campaign windows must be an array");
  }

  const windows = payload.windows.map(validateWindow);
  if (!windows.length) {
    throw schemaError("campaign output must include at least one window");
  }

  return {
    archetype,
    windows,
    confidence: clamp(toNullableNumber(payload.confidence) ?? 0.8, 0, 1),
  };
}

function buildFallback(input) {
  if (input.archetype === "premium_urban") {
    return {
      archetype: "premium_urban",
      windows: [
        { start_time: "12:00", end_time: "12:45", discount_pct: 10, target_category: "RTE" },
      ],
      confidence: 0.79,
    };
  }

  if (input.archetype === "transit") {
    return {
      archetype: "transit",
      windows: [
        { start_time: "20:00", end_time: "22:00", discount_pct: 30, target_category: "grab_and_go" },
      ],
      confidence: 0.82,
    };
  }

  return {
    archetype: "residential",
    windows: [
      { start_time: "17:00", end_time: "18:00", discount_pct: 15, target_category: "family_pack" },
      { start_time: "18:00", end_time: "19:00", discount_pct: 25, target_category: "family_pack" },
    ],
    confidence: 0.84,
  };
}

export async function runCampaignAgent(input) {
  return runGeminiStage({
    stageName: "campaign",
    tier: "medium",
    systemPrompt: SYSTEM_PROMPT,
    input,
    schema: SCHEMA,
    validate: validatePayload,
    fallback: buildFallback,
  });
}
