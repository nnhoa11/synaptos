export const CONTROL_TOWER_MODE = "control_tower";
export const LEGACY_MODE = "legacy";

export const LLM_ROLLOUT_MODES = {
  DISABLED: "disabled",
  SHADOW: "shadow",
  ASSISTED: "assisted",
  LIVE: "live",
};

export const LLM_PROVIDERS = {
  OPENAI: "openai",
  GEMINI: "gemini",
  MOCK: "mock",
};

export const MODEL_RUN_STATUSES = {
  RUNNING: "running",
  COMPLETED: "completed",
  FAILED: "failed",
};

export const PARSE_STATUSES = {
  PARSED: "parsed",
  REPAIR_FAILED: "repair_failed",
  SCHEMA_FAILED: "schema_failed",
  PROVIDER_FAILED: "provider_failed",
};

export const SOURCE_TYPES = {
  WEATHER: "weather_api",
  DEMOGRAPHICS: "demographic_data",
  COMMODITY: "commodity_prices",
  POS: "pos_transactions",
  INVENTORY: "inventory_ledger",
};

export const SOURCE_FAMILIES = {
  EXTERNAL: "external",
  INTERNAL: "internal",
};

export const PROPOSAL_TYPES = {
  MARKDOWN: "markdown",
  UNSALEABLE: "unsaleable",
  STOCKOUT_RISK: "stockout_risk",
};

export const EXECUTION_ROUTES = {
  LABEL: "label",
  APPROVAL: "approval",
  LOGISTICS: "logistics",
  PROCUREMENT: "procurement",
};

export const PROPOSAL_STATUSES = {
  DRAFT: "draft",
  APPROVED: "approved",
  PENDING_APPROVAL: "pending_approval",
  BLOCKED: "blocked",
  DISPATCHED: "dispatched",
  REJECTED: "rejected",
};

export const TASK_STATUSES = {
  READY: "ready",
  WAITING_APPROVAL: "waiting_approval",
  DISPATCHED: "dispatched",
  COMPLETED: "completed",
  BLOCKED: "blocked",
};

export const GUARDRAIL_OUTCOMES = {
  APPROVED: "approved",
  REQUIRES_APPROVAL: "requires_approval",
  BLOCKED: "blocked",
};

export const APPROVAL_STATUSES = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
};

export const EVENT_TYPES = {
  SESSION_READY: "session.ready",
  RUN_COMPLETED: "run.completed",
  RECOMMENDATION_UPDATED: "recommendation.updated",
  LABEL_UPDATED: "label.updated",
  PRICE_UPDATED: "price.updated",
  CALIBRATION_RECORDED: "calibration.recorded",
  IMPORT_COMPLETED: "import.completed",
  IMPORT_FAILED: "import.failed",
  AGGREGATION_COMPLETED: "aggregation.completed",
  AGENT_COMPLETED: "agent.completed",
  MODEL_RUN_UPDATED: "model_run.updated",
  PROPOSAL_UPDATED: "proposal.updated",
  APPROVAL_UPDATED: "approval.updated",
  EXECUTION_UPDATED: "execution.updated",
  LOGISTICS_UPDATED: "logistics.updated",
  PROCUREMENT_UPDATED: "procurement.updated",
};

export const AUDIT_TYPES = {
  AGGREGATION: "Aggregation run",
  MODEL_RUN: "Model run",
  PROPOSAL_GENERATION: "Proposal generation",
  GUARDRAIL: "Guardrail evaluation",
  APPROVAL: "Approval review",
  EXECUTION: "Execution outcome",
};

export const CONTROL_TOWER_ROLES = [
  "admin",
  "manager",
  "staff",
  "procurement_planner",
  "logistics_coordinator",
];

export const SIMULATION_LABEL = "simulated";
export const AUTO_MARKDOWN_THRESHOLD_PCT = 50;
export const DEFAULT_PROMPT_TEMPLATE = {
  NAME: "control_tower_proposals",
  VERSION: "1.0.0",
};
