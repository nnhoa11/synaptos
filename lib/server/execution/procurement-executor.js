import { TASK_STATUSES } from "@/lib/server/control-tower/constants";

export function buildProcurementExecution({ proposal }) {
  const quantity = Math.max(4, Math.ceil((proposal.metadata.riskScore ?? 50) / 12));
  return {
    taskType: "procurement_order",
    storeId: proposal.storeId,
    proposalId: proposal.id,
    route: "procurement",
    status: TASK_STATUSES.DISPATCHED,
    procurementOrder: {
      supplier: "Simulated Preferred Supplier",
      quantity,
      estimatedCost: Number((quantity * (proposal.metadata.unitCost ?? 3.5)).toFixed(2)),
    },
  };
}
