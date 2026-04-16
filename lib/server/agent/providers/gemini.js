import { LLM_PROVIDERS } from "@/lib/server/control-tower/constants";

function providerError(code, message, extras = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, extras);
  return error;
}

export async function generateWithGemini({ promptEnvelope, model, signal }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw providerError("PROVIDER_NOT_CONFIGURED", "GEMINI_API_KEY is not configured");
  }

  const selectedModel = model || process.env.GEMINI_MODEL || process.env.LLM_MODEL || "gemini-2.5-pro";
  const endpoint =
    process.env.GEMINI_BASE_URL ||
    `https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent?key=${apiKey}`;
  const startedAt = Date.now();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            {
              text: [
                promptEnvelope.request.systemPrompt,
                promptEnvelope.request.developerPrompt,
                promptEnvelope.request.userPrompt,
              ].join("\n\n"),
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
      },
    }),
    signal,
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error?.message || `Gemini request failed with ${response.status}`;
    throw providerError(
      response.status === 429 ? "PROVIDER_RATE_LIMITED" : "PROVIDER_FAILED",
      message,
      { statusCode: response.status, rateLimited: response.status === 429 }
    );
  }

  const rawText =
    payload?.candidates?.[0]?.content?.parts?.map((part) => part.text).join("\n") ?? "";
  const usage = {
    inputTokens: Number(payload?.usageMetadata?.promptTokenCount ?? 0),
    outputTokens: Number(payload?.usageMetadata?.candidatesTokenCount ?? 0),
    totalTokens: Number(payload?.usageMetadata?.totalTokenCount ?? 0),
  };

  return {
    provider: LLM_PROVIDERS.GEMINI,
    model: selectedModel,
    usage,
    rawText,
    rawJson: payload,
    retryCount: 0,
    latencyMs: Date.now() - startedAt,
    failureCode: null,
    failureReason: null,
    timedOut: false,
    rateLimited: false,
    requestEcho: promptEnvelope.request,
  };
}
