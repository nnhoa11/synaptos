import { TASK_STATUSES } from "@/lib/server/control-tower/constants";

export function buildLabelExecution({ proposal }) {
  return {
    taskType: "label_publish",
    storeId: proposal.storeId,
    proposalId: proposal.id,
    route: "label",
    status: TASK_STATUSES.DISPATCHED,
    labelUpdate: {
      lotId: proposal.lotId,
      currentPrice: proposal.proposedPrice,
      previousPrice: proposal.metadata.basePrice ?? proposal.proposedPrice,
    },
  };
}
