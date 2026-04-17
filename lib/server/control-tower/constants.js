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
  INSUFFICIENT_DATA: "insufficient_data",
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
  PIPELINE_AGENT_START: "pipeline.agent.start",
  PIPELINE_AGENT_DONE: "pipeline.agent.done",
  PIPELINE_FAILED: "pipeline.failed",
  PIPELINE_DONE: "pipeline.done",
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

// Multi-tier AI agent levels
export const AGENT_TIERS = {
  FLASH: "flash",   // Tier 1: calculations, invoicing, routine tasks
  PRO: "pro",       // Tier 2: strategy reasoning, demand forecasting
};

// EOL waste routing destinations (diagram 2)
export const EOL_ROUTES = {
  FOOD_BANK: "food_bank",
  COMPOSTING: "composting",
  SAFE_DISPOSAL: "safe_disposal",
};

// Risk classification from demand forecasting (diagram 1)
export const RISK_CLASSIFICATIONS = {
  SURGE: "positive_anomaly",     // Demand spike → expand PO
  STABLE: "expected_variance",   // Normal → routine replenishment
  SHOCK: "negative_anomaly",     // Demand drop → hold/decrease inbound
};

// Extended source types
export const EXTENDED_SOURCE_TYPES = {
  ...SOURCE_TYPES,
  LOCAL_EVENTS: "local_events",
  COMMODITY: "commodity_prices",
};

// Ingestion freshness thresholds (minutes)
export const FRESHNESS_THRESHOLDS = {
  FRESH: 30,
  DEGRADED: 120,
  // Anything above DEGRADED is STALE
};
