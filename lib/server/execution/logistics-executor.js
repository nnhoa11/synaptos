import { TASK_STATUSES } from "@/lib/server/control-tower/constants";

export function buildLogisticsExecution({ proposal }) {
  return {
    taskType: "logistics_route",
    storeId: proposal.storeId,
    proposalId: proposal.id,
    route: "logistics",
    status: TASK_STATUSES.DISPATCHED,
    logisticsRoute: {
      routeType: "cross_dock_or_eol",
      destination:
        proposal.metadata.hoursToExpiry != null && proposal.metadata.hoursToExpiry <= 1
          ? "eol"
          : "cross_dock",
    },
  };
}
