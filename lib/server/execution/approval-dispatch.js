import { TASK_STATUSES } from "@/lib/server/control-tower/constants";

export function buildApprovalDispatchResult({ proposal, approvalStatus }) {
  return {
    proposalId: proposal.id,
    storeId: proposal.storeId,
    route: approvalStatus === "approved" ? "label" : "approval",
    status: approvalStatus === "approved" ? TASK_STATUSES.READY : TASK_STATUSES.BLOCKED,
  };
}
