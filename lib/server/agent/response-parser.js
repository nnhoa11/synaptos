import {
  PARSE_STATUSES,
} from "@/lib/server/control-tower/constants";
import { validateActionProposalPayload } from "@/lib/server/agent/schemas";

function extractCandidateJson(rawText) {
  const trimmed = rawText.trim();
  if (!trimmed) {
    const error = new Error("provider output was empty");
    error.code = "REPAIR_FAILED";
    throw error;
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const firstBrace = trimmed.indexOf("{");
  const firstBracket = trimmed.indexOf("[");
  const start = [firstBrace, firstBracket].filter((value) => value >= 0).sort((a, b) => a - b)[0];
  if (start == null) {
    const error = new Error("provider output did not contain JSON");
    error.code = "REPAIR_FAILED";
    throw error;
  }

  return trimmed.slice(start);
}

export function parseProviderResponse(rawText) {
  try {
    const parsed = JSON.parse(extractCandidateJson(rawText));
    const proposals = validateActionProposalPayload(parsed);
    return {
      parseStatus: PARSE_STATUSES.PARSED,
      parsedOutput: { proposals },
      proposals,
      failureCode: null,
      failureReason: null,
    };
  } catch (error) {
    const isSchema = error.code === "SCHEMA_VALIDATION_FAILED";
    return {
      parseStatus: isSchema ? PARSE_STATUSES.SCHEMA_FAILED : PARSE_STATUSES.REPAIR_FAILED,
      parsedOutput: null,
      proposals: [],
      failureCode: error.code ?? "PARSE_FAILED",
      failureReason: error.message,
    };
  }
}
