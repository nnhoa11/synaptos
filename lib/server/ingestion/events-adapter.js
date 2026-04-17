/**
 * Local Events Adapter (INPUT 3) — Fetches local events via EXA API
 * to detect foot traffic surges, festivals, holidays, etc.
 */

import { searchLocalEvents } from "@/lib/server/ingestion/exa-client";
import { FRESHNESS_THRESHOLDS } from "@/lib/server/control-tower/constants";

/**
 * Classifies events by their expected impact on foot traffic.
 */
function classifyEventImpact(highlights) {
  const text = highlights.join(" ").toLowerCase();
  const highImpact = ["festival", "concert", "marathon", "holiday", "national day", "tet", "new year", "parade", "championship"];
  const mediumImpact = ["market", "fair", "exhibition", "conference", "promotion", "sale", "food street"];
  const lowImpact = ["workshop", "meetup", "seminar", "webinar"];

  if (highImpact.some((k) => text.includes(k))) return "high";
  if (mediumImpact.some((k) => text.includes(k))) return "medium";
  if (lowImpact.some((k) => text.includes(k))) return "low";
  return "none";
}

function extractEvents(results) {
  return results.map((r) => ({
    title: r.title,
    url: r.url,
    date: r.publishedDate,
    summary: r.summary || r.highlights?.[0] || "",
    trafficImpact: classifyEventImpact(r.highlights),
  }));
}

function classifyFreshness(latencyMs) {
  const minutes = latencyMs / 60000;
  if (minutes <= FRESHNESS_THRESHOLDS.FRESH) return "fresh";
  if (minutes <= FRESHNESS_THRESHOLDS.DEGRADED) return "degraded";
  return "stale";
}

/**
 * Fetch local events for a store location.
 * @param {string} storeId
 * @param {string} location
 * @returns {Promise<object>} SignalObservation-compatible object
 */
export async function fetchEventsSignal(storeId, location) {
  const loc = location || process.env.SAMPLE_LOCATION || "Ho Chi Minh City, Vietnam";
  const result = await searchLocalEvents(loc);
  const observedAt = new Date().toISOString();

  if (!result.success) {
    return {
      storeId,
      sourceFamily: "external",
      sourceType: "local_events",
      observedAt,
      freshnessStatus: "stale",
      freshnessMinutes: 999,
      provenance: "simulated",
      payload: { error: result.error, location: loc },
      success: false,
    };
  }

  const events = extractEvents(result.results);
  const overallTrafficImpact = events.some((e) => e.trafficImpact === "high")
    ? "high"
    : events.some((e) => e.trafficImpact === "medium")
      ? "medium"
      : "low";

  return {
    storeId,
    sourceFamily: "external",
    sourceType: "local_events",
    observedAt,
    freshnessStatus: classifyFreshness(result.latencyMs),
    freshnessMinutes: Math.round(result.latencyMs / 60000 * 100) / 100,
    provenance: "live",
    payload: {
      location: loc,
      events,
      eventCount: events.length,
      overallTrafficImpact,
      costDollars: result.costDollars,
    },
    success: true,
  };
}
