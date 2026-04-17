import { EventEmitter } from "node:events";
import { EVENT_TYPES } from "@/lib/server/control-tower/constants";

const globalScope = globalThis;

if (!globalScope.__synaptosEventBus) {
  globalScope.__synaptosEventBus = new EventEmitter();
  globalScope.__synaptosEventBus.setMaxListeners(100);
}

const eventBus = globalScope.__synaptosEventBus;

export function publishEvent(type, payload = {}) {
  const event = {
    id: crypto.randomUUID(),
    type,
    at: new Date().toISOString(),
    ...payload,
  };

  eventBus.emit("event", event);
  return event;
}

export function subscribeToEvents(listener) {
  eventBus.on("event", listener);
  return () => eventBus.off("event", listener);
}

export function publishAggregationCompleted(payload = {}) {
  return publishEvent(EVENT_TYPES.AGGREGATION_COMPLETED, payload);
}

export function publishAgentCompleted(payload = {}) {
  return publishEvent(EVENT_TYPES.AGENT_COMPLETED, payload);
}

export function publishModelRunUpdated(payload = {}) {
  return publishEvent(EVENT_TYPES.MODEL_RUN_UPDATED, payload);
}

export function publishProposalUpdated(payload = {}) {
  return publishEvent(EVENT_TYPES.PROPOSAL_UPDATED, payload);
}

export function publishApprovalUpdated(payload = {}) {
  return publishEvent(EVENT_TYPES.APPROVAL_UPDATED, payload);
}

export function publishExecutionUpdated(payload = {}) {
  return publishEvent(EVENT_TYPES.EXECUTION_UPDATED, payload);
}

export function publishLogisticsUpdated(payload = {}) {
  return publishEvent(EVENT_TYPES.LOGISTICS_UPDATED, payload);
}

export function publishProcurementUpdated(payload = {}) {
  return publishEvent(EVENT_TYPES.PROCUREMENT_UPDATED, payload);
}

export function publishPipelineAgentStart(payload = {}) {
  return publishEvent(EVENT_TYPES.PIPELINE_AGENT_START, payload);
}

export function publishPipelineAgentDone(payload = {}) {
  return publishEvent(EVENT_TYPES.PIPELINE_AGENT_DONE, payload);
}

export function publishPipelineFailed(payload = {}) {
  return publishEvent(EVENT_TYPES.PIPELINE_FAILED, payload);
}

export function publishPipelineDone(payload = {}) {
  return publishEvent(EVENT_TYPES.PIPELINE_DONE, payload);
}
