import {
  EXECUTION_ROUTES,
  GUARDRAIL_OUTCOMES,
  PROPOSAL_TYPES,
  TASK_STATUSES,
} from "@/lib/server/control-tower/constants";

export function evaluateProposal({ proposal, storePolicy, sourceHealth }) {
  const autoMarkdownThresholdPct =
    storePolicy?.markdownMaxAutoDiscountPct ?? storePolicy?.approvalThresholdPct ?? 50;

  if (sourceHealth === "attention") {
    return {
      outcome: GUARDRAIL_OUTCOMES.BLOCKED,
      matchedRule: "stale_sources_block_auto_execution",
      executionRoute: proposal.executionRoute,
      executionStatus: TASK_STATUSES.BLOCKED,
      reason: "One or more required sources are stale.",
    };
  }

  if (proposal.proposalType === PROPOSAL_TYPES.MARKDOWN) {
    if (proposal.recommendedDiscountPct > autoMarkdownThresholdPct) {
      return {
        outcome: GUARDRAIL_OUTCOMES.REQUIRES_APPROVAL,
        matchedRule: "high_discount_requires_human_review",
        executionRoute: EXECUTION_ROUTES.APPROVAL,
        executionStatus: TASK_STATUSES.WAITING_APPROVAL,
        reason: `Discount exceeds ${autoMarkdownThresholdPct}%.`,
      };
    }

    return {
      outcome: GUARDRAIL_OUTCOMES.APPROVED,
      matchedRule: "markdown_within_auto_threshold",
      executionRoute: EXECUTION_ROUTES.LABEL,
      executionStatus: TASK_STATUSES.READY,
      reason: "Discount is within the auto-publish threshold.",
    };
  }

  if (proposal.proposalType === PROPOSAL_TYPES.UNSALEABLE) {
    return {
      outcome: GUARDRAIL_OUTCOMES.APPROVED,
      matchedRule: "unsaleable_inventory_routes_to_logistics",
      executionRoute: EXECUTION_ROUTES.LOGISTICS,
      executionStatus: TASK_STATUSES.READY,
      reason: "Lot has crossed the unsaleable handling threshold.",
    };
  }

  return {
    outcome: GUARDRAIL_OUTCOMES.APPROVED,
    matchedRule: "stockout_risk_routes_to_procurement",
    executionRoute: EXECUTION_ROUTES.PROCUREMENT,
    executionStatus: TASK_STATUSES.READY,
    reason: "Demand and on-hand position justify a bounded replenishment task.",
  };
}
