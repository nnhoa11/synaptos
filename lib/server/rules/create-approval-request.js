export function createApprovalRequestDraft({ proposal, evaluation, actorUserId }) {
  return {
    proposalId: proposal.id,
    storeId: proposal.storeId,
    status: "pending",
    matchedRule: evaluation.matchedRule,
    requestedBy: actorUserId,
  };
}
