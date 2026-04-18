"use client";

import { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import Button from "@/components/ui/Button";

const AGENT_DEFS = [
  { num: 1, name: "Ingestion", model: "gemini-2.0-flash", stepKey: "ingestion" },
  { num: 2, name: "Aggregation", model: "gemini-2.0-flash", stepKey: "aggregation" },
  { num: 3, name: "Risk Scoring", model: "gemini-2.5-flash", stepKey: "risk_scoring" },
  { num: 4, name: "Recommendations", model: "gemini-2.5-pro", stepKey: "recommendation" },
  { num: 5, name: "Campaign Suggestions", model: "gemini-2.5-flash", stepKey: "campaign" },
];

const WAITING_SUMMARIES = [
  "Waiting for signals…",
  "Waiting for ingestion…",
  "Waiting for aggregation…",
  "Waiting for risk scores…",
  "Waiting…",
];

function normalizeEventStatus(status) {
  if (status === "start") return "running";
  if (status === "failed") return "error";
  if (status === "completed") return "done";
  return status ?? "waiting";
}

function normalizePipelineEvent(event) {
  if (!event) return null;
  const stepKey = event.stepKey ?? event.step ?? null;
  if (!stepKey) return null;

  return {
    ...event,
    stepKey,
    status: normalizeEventStatus(event.status),
    summary:
      event.summary ??
      (event.status === "start"
        ? "Running…"
        : event.status === "failed"
          ? event.reason ?? "Stage failed."
          : event.status === "done" || event.status === "completed"
            ? "Completed."
            : null),
  };
}

function buildSeedStepMap(seedSteps = {}) {
  return Object.fromEntries(
    Object.entries(seedSteps)
      .map(([key, value]) => [key, normalizePipelineEvent({ stepKey: key, ...value })])
      .filter(([, value]) => value)
  );
}

function AgentIcon({ num, status }) {
  const cls =
    status === "done"
      ? "pipeline-step-icon pipeline-step-icon--done"
      : status === "running"
        ? "pipeline-step-icon pipeline-step-icon--running"
        : status === "error"
          ? "pipeline-step-icon pipeline-step-icon--error"
          : "pipeline-step-icon pipeline-step-icon--waiting";
  return <div className={cls}>{num}</div>;
}

function StatusMark({ status }) {
  if (status === "done") return <span className="pipeline-step-check">✓</span>;
  if (status === "error") return <span className="pipeline-step-cross">✗</span>;
  if (status === "running") return <span className="ui-spinner ui-spinner--sm" />;
  return null;
}

function AgentStepCard({ agent, stepData }) {
  const status = stepData?.status ?? "waiting";
  const cardClass = `pipeline-step-card pipeline-step-card--${status}`;

  return (
    <div className={cardClass}>
      <AgentIcon num={agent.num} status={status} />
      <div className="pipeline-step-body">
        <div className="pipeline-step-name">
          <StatusMark status={status} />
          <span>{agent.name}</span>
          <span className="pipeline-step-model">{agent.model}</span>
        </div>
        <div className={`pipeline-step-summary${status === "waiting" ? " pipeline-step-summary--waiting" : status === "error" ? " pipeline-step-summary--error" : ""}`}>
          {stepData?.summary ?? WAITING_SUMMARIES[agent.num - 1]}
        </div>
        {(status === "done" || status === "error") && (stepData?.tokens || stepData?.elapsedMs || stepData?.errorCode) ? (
          <div className="pipeline-step-meta">
            {stepData.errorCode ? (
              <span style={{ color: "var(--red)" }}>{stepData.errorCode}</span>
            ) : null}
            {stepData.tokens ? <span>{stepData.tokens.toLocaleString()} tokens</span> : null}
            {stepData.elapsedMs ? <span>{(stepData.elapsedMs / 1000).toFixed(1)}s</span> : null}
          </div>
        ) : status === "running" ? (
          <div className="pipeline-step-meta"><span>running…</span></div>
        ) : null}
      </div>
    </div>
  );
}

export default function PipelineProgress({ onClose, open, seedSteps = {}, storeId }) {
  const [stepMap, setStepMap] = useState({});

  useEffect(() => {
    if (!open) {
      setStepMap({});
      return;
    }

    setStepMap(buildSeedStepMap(seedSteps));
  }, [open, seedSteps, storeId]);

  useEffect(() => {
    if (!open || !storeId) {
      setStepMap({});
      return undefined;
    }

    const socket = io({ query: { storeId } });
    socket.on("pipeline", (event) => {
      const normalized = normalizePipelineEvent(event);
      const key = normalized?.stepKey;
      if (!key) return;
      setStepMap((current) => ({ ...current, [key]: normalized }));
    });

    return () => socket.disconnect();
  }, [open, storeId]);

  const steps = useMemo(
    () => AGENT_DEFS.map((agent) => ({ agent, stepData: stepMap[agent.stepKey] ?? null })),
    [stepMap]
  );

  const doneCount = steps.filter((s) => s.stepData?.status === "done").length;
  const hasError = steps.some((s) => s.stepData?.status === "error");
  const isComplete = doneCount === 5 && !hasError;
  const progressPct = isComplete ? 100 : hasError ? Math.round((doneCount / 5) * 100) : Math.round((doneCount / 5) * 100);
  const progressColor = isComplete ? "var(--green)" : hasError ? "var(--red)" : "var(--blue)";

  const totalTokens = steps.reduce((sum, s) => sum + (s.stepData?.tokens ?? 0), 0);

  if (!open) return null;

  return (
    <div className="pipeline-overlay">
      <div className="pipeline-drawer">
        <div className="pipeline-drawer-header">
          <div>
            <div className="pipeline-drawer-title">
              {isComplete ? "Engine Complete" : hasError ? "Engine Stopped" : "Engine Running"}
            </div>
            <div className="pipeline-drawer-sub">
              <span className="pipeline-drawer-store">{storeId}</span>
              {isComplete ? " · all agents done" : hasError ? " · error — check step details" : " · live socket stream"}
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>

        <div className="pipeline-progress-track">
          <div className="pipeline-progress-fill" style={{ width: `${progressPct}%`, background: progressColor }} />
        </div>

        <div className="pipeline-steps">
          {steps.map(({ agent, stepData }) => (
            <AgentStepCard key={agent.stepKey} agent={agent} stepData={stepData} />
          ))}
        </div>

        {isComplete ? (
          <div className="pipeline-drawer-footer">
            <div>
              <div className="pipeline-footer-label">✓ Pipeline complete</div>
              <div className="pipeline-result-chips">
                <span className="result-chip result-chip--green">{doneCount} agents done</span>
                {totalTokens > 0 ? (
                  <span className="result-chip result-chip--gray">{totalTokens.toLocaleString()} tokens</span>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
