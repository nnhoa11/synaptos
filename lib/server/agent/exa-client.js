import { loadEnvConfig } from "@next/env";
import Exa from "exa-js";

loadEnvConfig(process.cwd());

const cache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000;

function getExaClient() {
  if (!process.env.EXA_API_KEY) {
    return null;
  }

  if (!globalThis.__synaptosExaClient) {
    globalThis.__synaptosExaClient = new Exa(process.env.EXA_API_KEY);
  }

  return globalThis.__synaptosExaClient;
}

async function crawlWithCache(key, query) {
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
    return {
      text: "",
      url: null,
      cached: false,
      cached_at: null,
      observed_at: new Date().toISOString(),
      error: "EXA_API_KEY is not configured",
    };
  }

  try {
    const result = await exa.search(query, { numResults: 3, useAutoprompt: true });
    const text = (result.results ?? [])
      .map((entry) => entry.text || entry.highlights?.join(" ") || "")
      .filter(Boolean)
      .join("\n\n");

    const data = {
      text,
      url: result.results?.[0]?.url ?? null,
      cached: false,
      cached_at: null,
      observed_at: new Date().toISOString(),
    };
    cache.set(key, { data, ts: Date.now() });
    return data;
  } catch (error) {
    return {
      text: "",
      url: null,
      cached: false,
      cached_at: null,
      observed_at: new Date().toISOString(),
      error: error.message,
    };
  }
}

export async function crawlSignals(storeContext) {
  const { storeId, district, category } = storeContext;
  const hourKey = new Date().toISOString().slice(0, 13);

  const signals = await Promise.all([
    crawlWithCache(
      `${storeId}:weather:${hourKey}`,
      `${district} Ho Chi Minh City weather forecast today temperature humidity`
    ),
    crawlWithCache(
      `${storeId}:commodity:${hourKey}`,
      `Vietnam wholesale ${category} fresh food price today VND`
    ),
    crawlWithCache(
      `${storeId}:demographic:${hourKey}`,
      `${district} HCMC district spending power foot traffic peak hours`
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
