import { PARSE_STATUSES } from "@/lib/server/control-tower/constants";
import { getModelForTier } from "@/lib/server/agent/provider-registry";
import { generateWithGemini } from "@/lib/server/agent/providers/gemini";

const DEFAULT_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS ?? 30000);

function zeroUsage() {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function schemaError(message) {
  const error = new Error(message);
  error.code = PARSE_STATUSES.SCHEMA_FAILED;
  return error;
}

function extractCandidateJson(rawText) {
  const trimmed = String(rawText ?? "").trim();
  if (!trimmed) {
    throw schemaError("provider output was empty");
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const firstBrace = trimmed.indexOf("{");
  const firstBracket = trimmed.indexOf("[");
  const start = [firstBrace, firstBracket].filter((value) => value >= 0).sort((a, b) => a - b)[0];
  if (start == null) {
    throw schemaError("provider output did not contain JSON");
  }

  return trimmed.slice(start);
}

function deriveConfidence(output) {
  if (output == null) {
    return null;
  }

  if (typeof output?.confidence === "number") {
    return clamp(output.confidence, 0, 1);
  }

  if (Array.isArray(output)) {
    const confidences = output
      .map((entry) => entry?.confidence)
      .filter((value) => typeof value === "number");
    if (!confidences.length) {
      return null;
    }
    return clamp(
      confidences.reduce((sum, value) => sum + value, 0) / confidences.length,
      0,
      1
    );
  }

  return null;
}

function buildRequest({ input, schema, systemPrompt }) {
  return {
    systemPrompt,
    developerPrompt: `Return JSON that matches this schema exactly:\n${JSON.stringify(schema, null, 2)}`,
    userPrompt: JSON.stringify(input, null, 2),
    responseSchemaJson: schema,
  };
}

async function callGemini({ model, request }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    return await generateWithGemini({
      promptEnvelope: { request },
      model,
      signal: controller.signal,
    });
  } catch (error) {
    if (error.name === "AbortError") {
      const timeoutError = new Error("Gemini request timed out");
      timeoutError.code = "PROVIDER_TIMEOUT";
      throw timeoutError;
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function toNullableNumber(value) {
  if (value == null || value === "") {
    return null;
  }

  const next = Number(value);
  if (!Number.isFinite(next)) {
    throw schemaError("expected a numeric value");
  }
  return next;
}

export function toNullableString(value) {
  if (value == null || value === "") {
    return null;
  }

  if (typeof value !== "string") {
    throw schemaError("expected a string value");
  }

  return value.trim() || null;
}

export function toNullableStringArray(value) {
  if (value == null) {
    return null;
  }

  if (!Array.isArray(value)) {
    throw schemaError("expected an array of strings");
  }

  return value.map((entry) => {
    if (typeof entry !== "string") {
      throw schemaError("expected an array of strings");
    }
    return entry.trim();
  });
}

export async function runGeminiStage({
  fallback,
  input,
  schema,
  stageName,
  systemPrompt,
  tier,
  validate,
}) {
  const createdAt = new Date().toISOString();
  const model = getModelForTier(tier);
  const request = buildRequest({ input, schema, systemPrompt });
  let providerResult = null;
  let rawText = "";
  let rawJson = null;
  let parsedOutput = null;
  let effectiveOutput = null;
  let fallbackUsed = false;
  let fallbackReason = null;
  let status = "completed";
  let parseStatus = PARSE_STATUSES.PARSED;
  let failureCode = null;
  let failureReason = null;

  try {
    providerResult = await callGemini({ model, request });
    rawText = providerResult.rawText ?? "";
    rawJson = providerResult.rawJson ?? null;
    const parsed = JSON.parse(extractCandidateJson(rawText));
    parsedOutput = validate(parsed, input);
    effectiveOutput = parsedOutput;

    if (parsedOutput?.status === "insufficient_data") {
      status = "partial";
      parseStatus = PARSE_STATUSES.INSUFFICIENT_DATA;
    }
  } catch (error) {
    failureCode = error.code ?? "PIPELINE_STAGE_FAILED";
    failureReason = error.message ?? "stage failed";
    parseStatus =
      failureCode === PARSE_STATUSES.SCHEMA_FAILED ? PARSE_STATUSES.SCHEMA_FAILED : PARSE_STATUSES.PROVIDER_FAILED;
    status = "failed";

    if (fallback) {
      const fallbackOutput = fallback(input, error);
      effectiveOutput = fallbackOutput;
      parsedOutput = fallbackOutput;
      if (effectiveOutput != null) {
        fallbackUsed = true;
        fallbackReason = failureReason;
        if (effectiveOutput?.status === "insufficient_data") {
          status = "partial";
          parseStatus = PARSE_STATUSES.INSUFFICIENT_DATA;
        } else {
          status = "completed";
          parseStatus = PARSE_STATUSES.PARSED;
          failureCode = null;
          failureReason = null;
        }
      }
    }
  }

  return {
    stageName,
    tier,
    provider: providerResult?.provider ?? "gemini",
    model: providerResult?.model ?? model,
    status,
    parseStatus,
    failureCode,
    failureReason,
    usage: providerResult?.usage ?? zeroUsage(),
    retryCount: providerResult?.retryCount ?? 0,
    latencyMs: providerResult?.latencyMs ?? null,
    createdAt,
    completedAt: new Date().toISOString(),
    inputArtifact: {
      promptContext: input,
      request,
    },
    outputArtifact: {
      rawText,
      rawJson,
      parsedOutput,
      parseStatus,
      errorCode: failureCode,
      errorMessage: failureReason,
      fallbackUsed,
      fallbackReason,
    },
    output: effectiveOutput,
    confidence: deriveConfidence(effectiveOutput),
    fallbackUsed,
  };
}
