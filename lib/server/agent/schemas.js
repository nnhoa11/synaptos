import {
  EXECUTION_ROUTES,
  PROPOSAL_TYPES,
} from "@/lib/server/control-tower/constants";

export const ACTION_PROPOSAL_RESPONSE_SCHEMA = {
  type: "object",
  required: ["proposals"],
  properties: {
    proposals: {
      type: "array",
      items: {
        type: "object",
        required: [
          "recommendationId",
          "proposalType",
          "executionRoute",
          "recommendedDiscountPct",
          "proposedPrice",
          "rationale",
        ],
      },
    },
  },
};

function schemaError(message) {
  const error = new Error(message);
  error.code = "SCHEMA_VALIDATION_FAILED";
  return error;
}

function assertEnum(value, allowed, label) {
  if (!allowed.includes(value)) {
    throw schemaError(`${label} must be one of ${allowed.join(", ")}`);
  }
}

function coerceNumber(value, label) {
  const next = Number(value);
  if (!Number.isFinite(next)) {
    throw schemaError(`${label} must be numeric`);
  }
  return next;
}

function coerceObject(value, label) {
  if (value == null) {
    return {};
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw schemaError(`${label} must be an object`);
  }
  return value;
}

function validateProposalItem(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw schemaError("proposal item must be an object");
  }

  if (typeof item.recommendationId !== "string" || !item.recommendationId.trim()) {
    throw schemaError("proposal.recommendationId is required");
  }

  assertEnum(
    item.proposalType,
    Object.values(PROPOSAL_TYPES),
    "proposal.proposalType"
  );
  assertEnum(
    item.executionRoute,
    Object.values(EXECUTION_ROUTES),
    "proposal.executionRoute"
  );

  if (typeof item.rationale !== "string" || !item.rationale.trim()) {
    throw schemaError("proposal.rationale is required");
  }

  return {
    recommendationId: item.recommendationId,
    proposalType: item.proposalType,
    executionRoute: item.executionRoute,
    recommendedDiscountPct: coerceNumber(item.recommendedDiscountPct ?? 0, "proposal.recommendedDiscountPct"),
    proposedPrice: coerceNumber(item.proposedPrice ?? 0, "proposal.proposedPrice"),
    rationale: item.rationale.trim(),
    metadata: coerceObject(item.metadata ?? {}, "proposal.metadata"),
  };
}

export function validateActionProposalPayload(payload) {
  const proposals = Array.isArray(payload) ? payload : payload?.proposals;
  if (!Array.isArray(proposals)) {
    throw schemaError("provider output must include a proposals array");
  }
  return proposals.map(validateProposalItem);
}
