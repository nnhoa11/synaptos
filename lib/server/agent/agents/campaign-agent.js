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

function extractHour(value) {
  const match = String(value ?? "").match(/^(\d{1,2})/);
  return match ? Number(match[1]) : null;
}

function toTime(hour, minute = 0) {
  const normalizedHour = Math.max(0, Math.min(23, Number(hour ?? 0)));
  const normalizedMinute = Math.max(0, Math.min(59, Number(minute ?? 0)));
  return `${String(normalizedHour).padStart(2, "0")}:${String(normalizedMinute).padStart(2, "0")}`;
}

function resolvePrimaryCategory(input, archetype) {
  const categories = Array.isArray(input.inventory_state?.categories) ? input.inventory_state.categories : [];
  const normalized = categories
    .map((entry) => ({
      category: toNullableString(entry?.category),
      quantity: toNullableNumber(entry?.quantity) ?? 0,
    }))
    .filter((entry) => entry.category);

  const names = normalized.map((entry) => entry.category);
  if (archetype === "premium_urban") {
    return names.find((name) => name.toLowerCase() === "rte") ?? normalized[0]?.category ?? "RTE";
  }
  if (archetype === "transit") {
    return (
      names.find((name) => ["drink", "rte", "snack"].includes(name.toLowerCase())) ??
      normalized[0]?.category ??
      "Drink"
    );
  }
  return normalized[0]?.category ?? "Meat";
}

function buildFallback(input) {
  const archetype = input.archetype === "premium_urban" ? "premium_urban" : input.archetype === "transit" ? "transit" : "residential";
  const peakHours = Array.isArray(input.district_profile?.peak_hours) ? input.district_profile.peak_hours : [];
  const firstPeakHour = extractHour(peakHours[0]) ?? (archetype === "transit" ? 20 : archetype === "premium_urban" ? 12 : 17);
  const secondPeakHour = extractHour(peakHours[1]) ?? (archetype === "transit" ? 21 : archetype === "premium_urban" ? 13 : 18);
  const primaryCategory = resolvePrimaryCategory(input, archetype);

  if (archetype === "premium_urban") {
    return {
      archetype: "premium_urban",
      windows: [
        {
          start_time: toTime(Math.min(firstPeakHour, 12), 0),
          end_time: toTime(Math.min(firstPeakHour, 12), 45),
          discount_pct: 10,
          target_category: primaryCategory,
        },
      ],
      confidence: 0.86,
    };
  }

  if (archetype === "transit") {
    return {
      archetype: "transit",
      windows: [
        {
          start_time: toTime(Math.max(firstPeakHour, 20), 0),
          end_time: toTime(Math.max(secondPeakHour, 22), 0),
          discount_pct: 30,
          target_category: primaryCategory,
        },
      ],
      confidence: 0.88,
    };
  }

  return {
    archetype: "residential",
    windows: [
      {
        start_time: toTime(Math.min(firstPeakHour, 17), 0),
        end_time: toTime(Math.min(firstPeakHour, 17), 45),
        discount_pct: 12,
        target_category: primaryCategory,
      },
      {
        start_time: toTime(Math.max(secondPeakHour, 18), 0),
        end_time: toTime(Math.max(secondPeakHour, 19), 0),
        discount_pct: 22,
        target_category: primaryCategory,
      },
    ],
    confidence: 0.87,
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
