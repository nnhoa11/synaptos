/**
 * EXA API Client — Reusable wrapper for contextual web search.
 * Used for weather data (INPUT 1) and local events (INPUT 3).
 *
 * Docs: https://docs.exa.ai/reference/search
 */

const EXA_API_URL = "https://api.exa.ai/search";

function getApiKey() {
  const key = process.env.EXA_API_KEY;
  if (!key) throw new Error("EXA_API_KEY is not configured in .env");
  return key;
}

/**
 * Core search function.
 * @param {object} opts
 * @param {string} opts.query - Natural language search query
 * @param {number} [opts.numResults=5] - Number of results
 * @param {string} [opts.category] - "news", "research paper", etc.
 * @param {string} [opts.startPublishedDate] - ISO 8601 date filter
 * @param {string} [opts.type="auto"] - Search type
 * @param {string[]} [opts.includeDomains] - Restrict to these domains
 * @returns {Promise<object>} EXA search results
 */
export async function exaSearch({
  query,
  numResults = 5,
  category,
  startPublishedDate,
  type = "auto",
  includeDomains,
}) {
  const body = {
    query,
    numResults,
    type,
    contents: {
      highlights: { maxCharacters: 2000 },
    },
  };

  if (category) body.category = category;
  if (startPublishedDate) body.startPublishedDate = startPublishedDate;
  if (includeDomains?.length) body.includeDomains = includeDomains;

  const startedAt = Date.now();

  try {
    const response = await fetch(EXA_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": getApiKey(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      const msg = data?.error?.message || `EXA request failed with ${response.status}`;
      return {
        success: false,
        error: msg,
        statusCode: response.status,
        latencyMs: Date.now() - startedAt,
        results: [],
      };
    }

    return {
      success: true,
      results: (data?.results ?? []).map((r) => ({
        title: r.title,
        url: r.url,
        publishedDate: r.publishedDate,
        highlights: r.highlights ?? [],
        summary: r.summary ?? "",
        text: r.text ?? "",
      })),
      costDollars: data?.costDollars?.total ?? 0,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      latencyMs: Date.now() - startedAt,
      results: [],
    };
  }
}

/**
 * Search for current weather conditions in a location.
 */
export async function searchWeather(location) {
  const today = new Date().toISOString().split("T")[0];
  return exaSearch({
    query: `current weather forecast ${location} today temperature humidity rain`,
    numResults: 3,
    category: "news",
    startPublishedDate: `${today}T00:00:00.000Z`,
  });
}

/**
 * Search for local events, festivals, promotions near a location.
 */
export async function searchLocalEvents(location) {
  const today = new Date().toISOString().split("T")[0];
  return exaSearch({
    query: `upcoming events festivals promotions food markets ${location} this week`,
    numResults: 5,
    category: "news",
    startPublishedDate: `${today}T00:00:00.000Z`,
  });
}

/**
 * Search for commodity price trends relevant to fresh food retail.
 */
export async function searchCommodityPrices(region) {
  return exaSearch({
    query: `fresh food commodity prices ${region} pork chicken vegetables rice wholesale market today`,
    numResults: 3,
    category: "news",
    startPublishedDate: new Date(Date.now() - 7 * 86400000).toISOString(),
  });
}
