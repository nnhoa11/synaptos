import {
  runGeminiStage,
  schemaError,
  toNullableNumber,
  toNullableString,
  toNullableStringArray,
} from "@/lib/server/agent/agents/utils";

const SYSTEM_PROMPT = `You receive raw web crawl text for one signal type.
Extract only the fields listed in the output schema.
If a field cannot be found in the text, return null for that field.
Never invent, interpolate, or estimate values.
If the text contains no usable data, return {"status":"insufficient_data","reason":"<one sentence>"}.
Output valid JSON only. No prose.`;

const WEATHER_SCHEMA = {
  type: "object",
  properties: {
    temperature_c: { type: ["number", "null"] },
    humidity_pct: { type: ["number", "null"] },
    rain_probability_pct: { type: ["number", "null"] },
    forecast_hours: { type: ["string", "null"] },
  },
};

const COMMODITY_SCHEMA = {
  type: "object",
  properties: {
    commodity: { type: ["string", "null"] },
    unit_price_vnd: { type: ["number", "null"] },
    unit: { type: ["string", "null"] },
    source_date: { type: ["string", "null"] },
  },
};

const DEMOGRAPHIC_SCHEMA = {
  type: "object",
  properties: {
    district: { type: ["string", "null"] },
    spending_tier: { type: ["string", "null"] },
    peak_hours: { type: ["array", "null"] },
    profile_type: { type: ["string", "null"] },
  },
};

function inferConfidence(fields) {
  const populated = Object.values(fields).filter((value) => {
    if (value == null) {
      return false;
    }
    if (Array.isArray(value)) {
      return value.length > 0;
    }
    return true;
  }).length;

  return Math.min(1, 0.35 + populated * 0.15);
}

function wrapSignalRecord(input, fields) {
  return {
    signal_type: input.signalType,
    source_url: input.signal.url ?? null,
    observed_at: input.signal.observed_at ?? new Date().toISOString(),
    cached: Boolean(input.signal.cached),
    cached_at: input.signal.cached_at ?? null,
    fields,
    confidence: inferConfidence(fields),
  };
}

function validateSignalPayload(payload, input) {
  if (payload?.status === "insufficient_data") {
    return {
      status: "insufficient_data",
      reason: toNullableString(payload.reason) ?? "The crawl did not include usable signal data.",
      signal_type: input.signalType,
      confidence: 0.2,
    };
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw schemaError("ingestion output must be an object");
  }

  if (input.signalType === "weather") {
    return wrapSignalRecord(input, {
      temperature_c: toNullableNumber(payload.temperature_c),
      humidity_pct: toNullableNumber(payload.humidity_pct),
      rain_probability_pct: toNullableNumber(payload.rain_probability_pct),
      forecast_hours: toNullableString(payload.forecast_hours),
    });
  }

  if (input.signalType === "commodity") {
    return wrapSignalRecord(input, {
      commodity: toNullableString(payload.commodity),
      unit_price_vnd: toNullableNumber(payload.unit_price_vnd),
      unit: toNullableString(payload.unit),
      source_date: toNullableString(payload.source_date),
    });
  }

  return wrapSignalRecord(input, {
    district: toNullableString(payload.district),
    spending_tier: toNullableString(payload.spending_tier),
    peak_hours: toNullableStringArray(payload.peak_hours),
    profile_type: toNullableString(payload.profile_type),
  });
}

function fallbackWeather(signal) {
  const text = String(signal.text ?? "");
  const tempMatch = text.match(/(\d{2,3})(?:\s*(?:degrees|degree|c|C|°))/);
  const humidityMatch = text.match(/humidity[^0-9]*(\d{1,3})\s*%/i);
  const rainMatch = text.match(/(\d{1,3})\s*%\s*(?:chance of rain|rain chance|precipitation)/i);
  const hoursMatch = text.match(/(\d{1,2}(?::\d{2})?\s*-\s*\d{1,2}(?::\d{2})?)/);

  const fields = {
    temperature_c: tempMatch ? Number(tempMatch[1]) : null,
    humidity_pct: humidityMatch ? Number(humidityMatch[1]) : null,
    rain_probability_pct: rainMatch ? Number(rainMatch[1]) : null,
    forecast_hours: hoursMatch ? hoursMatch[1] : null,
  };

  if (Object.values(fields).every((value) => value == null)) {
    return {
      status: "insufficient_data",
      reason: "The crawl text did not expose a weather metric that could be extracted reliably.",
      signal_type: "weather",
      confidence: 0.2,
    };
  }

  return wrapSignalRecord({ signalType: "weather", signal }, fields);
}

function fallbackCommodity(signal, category) {
  const text = String(signal.text ?? "");
  const priceMatch = text.match(/(\d[\d,.]{2,})\s*(?:vnd|dong|d)/i);
  const unitMatch = text.match(/(?:per|\/)\s*(kg|g|box|pack|tray|item|unit)/i);
  const dateMatch = text.match(/(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{2,4})/);

  const fields = {
    commodity: category ?? null,
    unit_price_vnd: priceMatch ? Number(priceMatch[1].replace(/[,.]/g, "")) : null,
    unit: unitMatch ? unitMatch[1] : null,
    source_date: dateMatch ? dateMatch[1] : null,
  };

  if (Object.values(fields).every((value) => value == null)) {
    return {
      status: "insufficient_data",
      reason: "The crawl text did not contain a commodity price that could be extracted reliably.",
      signal_type: "commodity",
      confidence: 0.2,
    };
  }

  return wrapSignalRecord({ signalType: "commodity", signal }, fields);
}

function fallbackDemographic(signal, district) {
  const text = String(signal.text ?? "");
  const lower = text.toLowerCase();
  const spendingTier =
    lower.includes("premium") || lower.includes("high income")
      ? "high"
      : lower.includes("middle")
        ? "middle"
        : lower.includes("budget") || lower.includes("low income")
          ? "low"
          : null;

  const peakHours = Array.from(
    new Set((text.match(/\b\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2}\b/g) ?? []).slice(0, 3))
  );

  const fields = {
    district: district ?? null,
    spending_tier: spendingTier,
    peak_hours: peakHours.length ? peakHours : null,
    profile_type: lower.includes("transit")
      ? "transit"
      : lower.includes("residential")
        ? "residential"
        : lower.includes("urban")
          ? "premium_urban"
          : null,
  };

  if (Object.values(fields).every((value) => value == null)) {
    return {
      status: "insufficient_data",
      reason: "The crawl text did not contain a demographic signal that could be extracted reliably.",
      signal_type: "demographic",
      confidence: 0.2,
    };
  }

  return wrapSignalRecord({ signalType: "demographic", signal }, fields);
}

function buildFallback(input) {
  if (input.signalType === "weather") {
    return fallbackWeather(input.signal);
  }

  if (input.signalType === "commodity") {
    return fallbackCommodity(input.signal, input.category);
  }

  return fallbackDemographic(input.signal, input.district);
}

export async function runIngestionAgent(input) {
  const schema =
    input.signalType === "weather"
      ? WEATHER_SCHEMA
      : input.signalType === "commodity"
        ? COMMODITY_SCHEMA
        : DEMOGRAPHIC_SCHEMA;

  return runGeminiStage({
    stageName: `ingestion:${input.signalType}`,
    tier: "low",
    systemPrompt: SYSTEM_PROMPT,
    input,
    schema,
    validate: validateSignalPayload,
    fallback: buildFallback,
  });
}
