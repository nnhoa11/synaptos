/**
 * Weather Adapter (INPUT 1) — Fetches weather context via EXA API
 * and normalizes into a SignalObservation for the aggregation pipeline.
 */

import { searchWeather } from "@/lib/server/ingestion/exa-client";
import { FRESHNESS_THRESHOLDS } from "@/lib/server/control-tower/constants";

/**
 * Extracts structured weather signals from EXA search highlights.
 * Uses a lightweight parse — AI agents will do deeper reasoning.
 */
function extractWeatherSignals(results) {
  const combined = results
    .map((r) => [...r.highlights, r.summary].join(" "))
    .join(" ")
    .toLowerCase();

  // Simple keyword/number extraction for prototype
  const tempMatch = combined.match(/(\d{2,3})\s*[°ºo]?\s*[cf]/i);
  const humidityMatch = combined.match(/humidity[:\s]*(\d{1,3})\s*%/i);
  const rainKeywords = ["rain", "shower", "storm", "thunderstorm", "drizzle", "precipitation"];
  const heatKeywords = ["heat", "hot", "heatwave", "scorching", "sweltering"];

  return {
    temperature: tempMatch ? parseInt(tempMatch[1], 10) : null,
    humidity: humidityMatch ? parseInt(humidityMatch[1], 10) : null,
    isRainy: rainKeywords.some((k) => combined.includes(k)),
    isHot: heatKeywords.some((k) => combined.includes(k)),
    rawSummary: results[0]?.summary || results[0]?.highlights?.[0] || "No weather data available",
    sourceCount: results.length,
  };
}

function classifyFreshness(latencyMs) {
  const minutes = latencyMs / 60000;
  if (minutes <= FRESHNESS_THRESHOLDS.FRESH) return "fresh";
  if (minutes <= FRESHNESS_THRESHOLDS.DEGRADED) return "degraded";
  return "stale";
}

/**
 * Fetch weather data for a store location and return a normalized signal.
 * @param {string} storeId
 * @param {string} location - e.g. "Ho Chi Minh City, Vietnam"
 * @returns {Promise<object>} SignalObservation-compatible object
 */
export async function fetchWeatherSignal(storeId, location) {
  const loc = location || process.env.SAMPLE_LOCATION || "Ho Chi Minh City, Vietnam";
  const result = await searchWeather(loc);
  const observedAt = new Date().toISOString();

  if (!result.success) {
    return {
      storeId,
      sourceFamily: "external",
      sourceType: "weather_api",
      observedAt,
      freshnessStatus: "stale",
      freshnessMinutes: 999,
      provenance: "simulated",
      payload: { error: result.error, location: loc },
      success: false,
    };
  }

  const signals = extractWeatherSignals(result.results);

  return {
    storeId,
    sourceFamily: "external",
    sourceType: "weather_api",
    observedAt,
    freshnessStatus: classifyFreshness(result.latencyMs),
    freshnessMinutes: Math.round(result.latencyMs / 60000 * 100) / 100,
    provenance: "live",
    payload: {
      location: loc,
      ...signals,
      costDollars: result.costDollars,
    },
    success: true,
  };
}
