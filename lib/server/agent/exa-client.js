import { loadEnvConfig } from "@next/env";
import Exa from "exa-js";

loadEnvConfig(process.cwd());

const cache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000;

const WEATHER_HINTS = {
  Q1: { temperatureC: 32, humidityPct: 71, rainPct: 28, hours: "11:00-17:00" },
  Q3: { temperatureC: 33, humidityPct: 68, rainPct: 22, hours: "12:00-18:00" },
  Q7: { temperatureC: 31, humidityPct: 76, rainPct: 42, hours: "13:00-19:00" },
};

const DEMOGRAPHIC_HINTS = {
  Q1: {
    spendingTier: "high",
    peakHours: ["11:30-13:30", "18:30-20:30"],
    profileType: "premium_urban",
    note: "office lunch traffic and evening premium basket demand remain elevated",
  },
  Q3: {
    spendingTier: "middle",
    peakHours: ["07:00-09:00", "17:30-20:30"],
    profileType: "transit",
    note: "commuter traffic compresses demand into rush windows with fast basket turnover",
  },
  Q7: {
    spendingTier: "middle",
    peakHours: ["09:00-11:00", "17:00-19:00"],
    profileType: "residential",
    note: "family shopping remains strongest in late afternoon and dinner prep windows",
  },
};

const CATEGORY_PRICE_HINTS = {
  Seafood: { price: 182000, unit: "kg" },
  Meat: { price: 128000, unit: "kg" },
  Veg: { price: 36000, unit: "kg" },
  Fruit: { price: 58000, unit: "kg" },
  Dairy: { price: 42000, unit: "pack" },
  RTE: { price: 69000, unit: "pack" },
  Drink: { price: 24000, unit: "bottle" },
  Snack: { price: 18000, unit: "pack" },
};

function getExaClient() {
  if (!process.env.EXA_API_KEY) {
    return null;
  }

  if (!globalThis.__synaptosExaClient) {
    globalThis.__synaptosExaClient = new Exa(process.env.EXA_API_KEY);
  }

  return globalThis.__synaptosExaClient;
}

function getDistrictKey(district) {
  const raw = String(district ?? "").trim().toUpperCase();
  if (raw.includes("1")) return "Q1";
  if (raw.includes("3")) return "Q3";
  if (raw.includes("7")) return "Q7";
  return "Q7";
}

function buildSyntheticSignalText(kind, { district, category }) {
  const districtKey = getDistrictKey(district);
  if (kind === "weather") {
    const hint = WEATHER_HINTS[districtKey] ?? WEATHER_HINTS.Q7;
    return [
      `Ho Chi Minh City ${districtKey} intraday weather outlook: temperature ${hint.temperatureC} C, humidity ${hint.humidityPct}%, rain probability ${hint.rainPct}% for ${hint.hours}.`,
      `Street-level heat remains elevated through the midday trading window with intermittent cloud cover and convection risk after ${hint.hours.split("-")[1]}.`,
    ].join(" ");
  }

  if (kind === "commodity") {
    const hint = CATEGORY_PRICE_HINTS[category] ?? CATEGORY_PRICE_HINTS.Veg;
    return [
      `Vietnam wholesale ${category} benchmark is trading around ${hint.price.toLocaleString("en-US")} VND per ${hint.unit} in the latest dealer and market commentary.`,
      `Merchants describe supply as stable but not loose, with price checks refreshed on ${new Date().toISOString().slice(0, 10)}.`,
    ].join(" ");
  }

  const hint = DEMOGRAPHIC_HINTS[districtKey] ?? DEMOGRAPHIC_HINTS.Q7;
  return [
    `${districtKey} district spending tier is ${hint.spendingTier} and the dominant profile is ${hint.profileType}.`,
    `Recent local traffic commentary shows peak hours around ${hint.peakHours.join(" and ")}; ${hint.note}.`,
  ].join(" ");
}

function buildSignalPayload({ text, url, error = null, synthetic = false, query }) {
  return {
    text,
    url: url ?? null,
    cached: false,
    cached_at: null,
    observed_at: new Date().toISOString(),
    error,
    synthetic,
    query,
  };
}

async function crawlWithCache(key, query, context = {}) {
  const cached = cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return {
      ...cached.data,
      cached: true,
      cached_at: new Date(cached.ts).toISOString(),
      observed_at: new Date().toISOString(),
    };
  }

  const exa = getExaClient();
  if (!exa) {
    return buildSignalPayload({
      text: buildSyntheticSignalText(context.kind, context),
      url: null,
      error: "EXA_API_KEY is not configured",
      synthetic: true,
      query,
    });
  }

  try {
    const result = await exa.search(query, { numResults: 3, useAutoprompt: true });
    const text = (result.results ?? [])
      .map((entry) => entry.text || entry.summary || entry.highlights?.join(" ") || "")
      .filter(Boolean)
      .join("\n\n");

    const usableText = text.trim() || buildSyntheticSignalText(context.kind, context);
    const data = buildSignalPayload({
      text: usableText,
      url: result.results?.[0]?.url ?? null,
      synthetic: !text.trim(),
      query,
    });
    cache.set(key, { data, ts: Date.now() });
    return data;
  } catch (error) {
    return buildSignalPayload({
      text: buildSyntheticSignalText(context.kind, context),
      url: null,
      error: error.message,
      synthetic: true,
      query,
    });
  }
}

export async function crawlSignals(storeContext) {
  const { storeId, district, category } = storeContext;
  const hourKey = new Date().toISOString().slice(0, 13);

  const signals = await Promise.all([
    crawlWithCache(
      `${storeId}:weather:${hourKey}`,
      `${district} Ho Chi Minh City weather forecast today temperature humidity`,
      { kind: "weather", district, category }
    ),
    crawlWithCache(
      `${storeId}:commodity:${hourKey}`,
      `Vietnam wholesale ${category} fresh food price today VND`,
      { kind: "commodity", district, category }
    ),
    crawlWithCache(
      `${storeId}:demographic:${hourKey}`,
      `${district} HCMC district spending power foot traffic peak hours`,
      { kind: "demographic", district, category }
    ),
  ]);

  return {
    weather: signals[0],
    commodity: signals[1],
    demographic: signals[2],
  };
}

export function clearExaCache() {
  cache.clear();
}
