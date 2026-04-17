import { loadEnvConfig } from "@next/env";
import { LLM_PROVIDERS } from "@/lib/server/control-tower/constants";

loadEnvConfig(process.cwd());

function providerError(code, message, extras = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, extras);
  return error;
}

export async function generateWithOpenAI({ promptEnvelope, model, signal }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw providerError("PROVIDER_NOT_CONFIGURED", "OPENAI_API_KEY is not configured");
  }

  const endpoint = process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1/chat/completions";
  const selectedModel = model || process.env.OPENAI_MODEL || process.env.LLM_MODEL || "gpt-4.1-mini";
  const startedAt = Date.now();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: selectedModel,
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [promptEnvelope.request.systemPrompt, promptEnvelope.request.developerPrompt]
            .filter(Boolean)
            .join("\n\n"),
        },
        { role: "user", content: promptEnvelope.request.userPrompt },
      ],
    }),
    signal,
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error?.message || `OpenAI request failed with ${response.status}`;
    throw providerError(
      response.status === 429 ? "PROVIDER_RATE_LIMITED" : "PROVIDER_FAILED",
      message,
      { statusCode: response.status, rateLimited: response.status === 429 }
    );
  }

  const rawText = payload?.choices?.[0]?.message?.content ?? "";
  const usage = {
    inputTokens: Number(payload?.usage?.prompt_tokens ?? 0),
    outputTokens: Number(payload?.usage?.completion_tokens ?? 0),
    totalTokens: Number(payload?.usage?.total_tokens ?? 0),
  };

  return {
    provider: LLM_PROVIDERS.OPENAI,
    model: payload?.model ?? selectedModel,
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
