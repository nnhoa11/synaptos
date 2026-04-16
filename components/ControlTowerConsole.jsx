"use client";

import {
  currency,
  formatAuditTime,
  formatNumber,
  shortCurrency,
} from "@/lib/prototype-core";

function statusTone(status) {
  if (["approved", "dispatched", "completed", "healthy", "fresh"].includes(status)) {
    return "safe";
  }
  if (["pending", "pending_approval", "ready", "watch", "degraded"].includes(status)) {
    return "warn";
  }
  if (["blocked", "rejected", "attention", "stale"].includes(status)) {
    return "danger";
  }
  return "neutral";
}

function ProposalActionRow({ proposal, canApprove, canDispatch, onApprove, onReject, onDispatch }) {
  const dispatchable = proposal.executionTask && ["ready", "dispatched"].includes(proposal.executionTask.status);
  return (
    <div className="queue-item-actions">
      {proposal.approvalRequest?.status === "pending" && (
        <>
          <button
            className="button button-primary"
            disabled={!canApprove}
            onClick={() => onApprove(proposal)}
          >
            Approve
          </button>
          <button
            className="button button-danger"
            disabled={!canApprove}
            onClick={() => onReject(proposal)}
          >
            Reject
          </button>
        </>
      )}
      {dispatchable && (
        <button
          className="button"
          disabled={!canDispatch || proposal.executionTask.status === "dispatched"}
          onClick={() => onDispatch(proposal.executionTask)}
        >
          {proposal.executionTask.status === "dispatched" ? "Dispatched" : "Dispatch"}
        </button>
      )}
    </div>
  );
}

export default function ControlTowerConsole({
  detail,
  stores,
  selectedStoreId,
  session,
  liveMessage,
  onRunAggregation,
  onGenerateProposals,
  onApprove,
  onReject,
  onDispatch,
}) {
  const role = session?.role ?? "admin";
  const canApprove = ["admin", "manager"].includes(role);
  const canDispatch =
    role === "admin" ||
    (role === "manager" && selectedStoreId === session?.storeId) ||
    role === "logistics_coordinator" ||
    role === "procurement_planner";
  const selectedStore = stores.find((store) => store.id === selectedStoreId) ?? null;
  const proposals = detail?.proposals ?? [];
  const approvals = detail?.approvals ?? [];
  const logisticsTasks = detail?.logisticsTasks ?? [];
  const procurementOrders = detail?.procurementOrders ?? [];
  const freshness = detail?.aggregatedSnapshot?.payload?.sourceFreshness ?? [];
  const sourceHealth = detail?.aggregatedSnapshot?.payload?.sourceHealth ?? "healthy";
  const routeCounts = detail?.aggregatedSnapshot?.payload?.routeCounts ?? {};
  const audit = detail?.audit ?? [];
  const labels = Object.values(detail?.labels ?? {});
  const latestModelRun = detail?.latestModelRun ?? null;
  const modelRunHistory = detail?.modelRunHistory ?? [];
  const llmMode = detail?.llmMode ?? "shadow";

  const metricCards = [
    {
      label: "Source Health",
      value: sourceHealth,
      footnote: `${freshness.length} tracked feeds · ${llmMode} mode`,
    },
    {
      label: "Proposal Queue",
      value: String(proposals.length),
      footnote: `${approvals.filter((item) => item.status === "pending").length} waiting for review`,
    },
    {
      label: "Logistics Work",
      value: String(logisticsTasks.length),
      footnote: "Unsaleable lots routed to simulated tasks",
    },
    {
      label: "Procurement Work",
      value: String(procurementOrders.length),
      footnote: "Bounded replenishment tasks awaiting action",
    },
  ];

  return (
    <section className="control-tower-shell">
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Control-Tower Runtime</h2>
            <span className="panel-subtitle">
              {selectedStore?.name ?? "Store"} · {detail?.snapshotKey ?? "No snapshot"} · {liveMessage || "Realtime connected"}
            </span>
          </div>
          <div className="hero-badges">
            <span className="badge">Control Tower</span>
            <span className="badge">{llmMode}</span>
            <span className="badge">
              {latestModelRun ? `${latestModelRun.provider} · ${latestModelRun.model}` : "No model run"}
            </span>
          </div>
        </div>
        <div className="toolbar-inline">
          <button className="button button-primary" onClick={onRunAggregation}>
            Run Aggregation
          </button>
          <button className="button" onClick={onGenerateProposals}>
            Generate Proposals
          </button>
        </div>
      </section>

      <section className="metric-grid">
        {metricCards.map((card) => (
          <article key={card.label} className="panel metric-card">
            <div className="metric-label">{card.label}</div>
            <div className="metric-value">{card.value}</div>
            <div className="metric-footnote">{card.footnote}</div>
          </article>
        ))}
      </section>

	      <section className="control-tower-grid">
	        <article className="panel">
          <div className="panel-header">
            <h2>Source Freshness</h2>
            <span className="panel-subtitle">Weather, demographics, commodity, POS, and inventory signals</span>
          </div>
          <div className="queue-list">
	            {freshness.map((source) => (
	              <article key={source.sourceType} className="queue-item">
	                <div>
	                  <strong>{source.sourceType.replaceAll("_", " ")}</strong>
	                  <div className="small-copy">
	                    {source.freshnessMinutes} min old · {source.sourceFamily ?? "signal"} source
	                  </div>
	                </div>
                  <div className="queue-meta">
	                  <span className={`pill ${statusTone(source.freshnessStatus)}`}>
	                    {source.freshnessStatus}
	                  </span>
                    <span className="pill neutral">{source.provenance}</span>
                  </div>
	              </article>
	            ))}
	          </div>
	        </article>

        <article className="panel">
          <div className="panel-header">
            <h2>Route Mix</h2>
            <span className="panel-subtitle">Candidate actions inferred from the current store state</span>
          </div>
          <div className="store-stats">
            {Object.entries(routeCounts).map(([key, value]) => (
              <div key={key} className="stat-chip">
                <span className="small-copy">{key.replaceAll("_", " ")}</span>
                <strong>{value}</strong>
              </div>
            ))}
	          </div>
	        </article>
	      </section>

      <section className="control-tower-grid">
        <article className="panel">
          <div className="panel-header">
            <h2>Latest Model Run</h2>
            <span className="panel-subtitle">Provider detail, parse status, retries, and failure visibility</span>
          </div>
          {latestModelRun ? (
            <div className="queue-list">
              <article className="queue-item queue-item-wide">
                <div>
                  <strong>
                    {latestModelRun.provider} · {latestModelRun.model}
                  </strong>
                  <div className="small-copy">
                    Prompt {latestModelRun.promptTemplateName}:{latestModelRun.promptTemplateVersion}
                  </div>
                  <div className="queue-meta">
                    <span className={`pill ${statusTone(latestModelRun.status)}`}>{latestModelRun.status}</span>
                    <span className={`pill ${statusTone(latestModelRun.parseStatus)}`}>
                      {latestModelRun.parseStatus}
                    </span>
                    <span className="pill neutral">{latestModelRun.mode}</span>
                  </div>
                </div>
                <div className="queue-side">
                  <div className="small-copy">
                    Retry {latestModelRun.retryCount} · Timeout {latestModelRun.timedOut ? "yes" : "no"} ·
                    Rate limit {latestModelRun.rateLimited ? "yes" : "no"}
                  </div>
                  <div className="small-copy">
                    Latency {latestModelRun.latencyMs ?? "N/A"} ms · Tokens {latestModelRun.usage?.totalTokens ?? 0} ·
                    Cost {shortCurrency(latestModelRun.estimatedCost ?? 0)}
                  </div>
                  {latestModelRun.failureReason && (
                    <div className="small-copy">{latestModelRun.failureCode}: {latestModelRun.failureReason}</div>
                  )}
                </div>
              </article>
            </div>
          ) : (
            <div className="small-copy">No provider-backed model run has been recorded yet.</div>
          )}
        </article>

        <article className="panel">
          <div className="panel-header">
            <h2>Model Run History</h2>
            <span className="panel-subtitle">Most recent provider attempts for this store and snapshot</span>
          </div>
          <div className="queue-list">
            {modelRunHistory.length ? (
              modelRunHistory.slice(0, 6).map((modelRun) => (
                <article key={modelRun.id} className="queue-item">
                  <div>
                    <strong>{modelRun.provider} · {modelRun.model}</strong>
                    <div className="small-copy">
                      {formatAuditTime(modelRun.createdAt)} · {modelRun.promptTemplateVersion}
                    </div>
                  </div>
                  <div className="queue-meta">
                    <span className={`pill ${statusTone(modelRun.status)}`}>{modelRun.status}</span>
                    <span className="pill neutral">{modelRun.parseStatus}</span>
                  </div>
                </article>
              ))
            ) : (
              <div className="small-copy">No model-run history for this store yet.</div>
            )}
          </div>
        </article>
      </section>

	      <section className="panel">
        <div className="panel-header">
          <h2>Proposal Queue</h2>
          <span className="panel-subtitle">Proposal, guardrail, approval, and execution states stay separated</span>
        </div>
        <div className="queue-list">
          {proposals.length ? (
            proposals.map((proposal) => (
              <article key={proposal.id} className="queue-item queue-item-wide">
                <div>
                  <strong>{proposal.skuName}</strong>
                  <div className="small-copy">{proposal.rationale}</div>
                  <div className="queue-meta">
                    <span className={`pill ${statusTone(proposal.proposalType)}`}>
                      {proposal.proposalType.replaceAll("_", " ")}
                    </span>
                    <span className={`pill ${statusTone(proposal.status)}`}>
                      {proposal.status.replaceAll("_", " ")}
                    </span>
	                    <span className={`pill ${statusTone(proposal.guardrail?.outcome ?? "neutral")}`}>
	                      {proposal.guardrail?.outcome?.replaceAll("_", " ") ?? "no guardrail"}
	                    </span>
	                    <span className="pill neutral">{proposal.executionRoute}</span>
                      {proposal.modelRun && (
                        <span className="pill neutral">
                          {proposal.modelRun.provider} · {proposal.modelRun.parseStatus}
                        </span>
                      )}
	                  </div>
	                </div>
                <div className="queue-side">
                  <div className="small-copy">
                    Proposed price {currency(proposal.proposedPrice)} · Discount {proposal.recommendedDiscountPct}%
                  </div>
	                  {proposal.executionTask && (
	                    <div className="small-copy">
	                      Task {proposal.executionTask.taskType.replaceAll("_", " ")} · {proposal.executionTask.status} ·
                        {proposal.executionTask.simulated ? " simulated" : " live"}
	                    </div>
	                  )}
                  <ProposalActionRow
                    proposal={proposal}
                    canApprove={canApprove}
                    canDispatch={canDispatch}
                    onApprove={onApprove}
                    onReject={onReject}
                    onDispatch={onDispatch}
                  />
                </div>
              </article>
            ))
          ) : (
            <div className="small-copy">No control-tower proposals yet. Run the agent pipeline after aggregation.</div>
          )}
        </div>
      </section>

      <section className="control-tower-grid">
        <article className="panel">
          <div className="panel-header">
            <h2>Human Approval Console</h2>
            <span className="panel-subtitle">Markdowns above threshold remain under review</span>
          </div>
          <div className="queue-list">
            {approvals.length ? (
	              approvals.map((approval) => (
	                <article key={approval.id} className="queue-item">
	                  <div>
	                    <strong>{approval.proposalId}</strong>
	                    <div className="small-copy">
                        {approval.matchedRule}
                        {approval.reviewNotes ? ` · ${approval.reviewNotes}` : ""}
                      </div>
	                  </div>
	                  <span className={`pill ${statusTone(approval.status)}`}>{approval.status}</span>
	                </article>
              ))
            ) : (
              <div className="small-copy">No pending or reviewed approval requests.</div>
            )}
          </div>
        </article>

        <article className="panel">
          <div className="panel-header">
            <h2>Virtual E-ink Wall</h2>
            <span className="panel-subtitle">Auto-markdowns publish here when dispatch is allowed</span>
          </div>
          <div className="label-grid">
            {labels.length ? (
              labels.map((label, index) => (
	                <article key={`${label.recommendationId}_${index}`} className="label-card">
	                  <div className="small-copy">Simulated label executor</div>
	                  <div className="price-row">
                    <span className="price-main">{currency(label.currentPrice)}</span>
                    <span className="price-old">{currency(label.previousPrice)}</span>
                  </div>
                  <div className={`pill ${statusTone(label.status)}`}>{label.status}</div>
                </article>
              ))
            ) : (
              <div className="small-copy">No label updates have been published yet.</div>
            )}
          </div>
        </article>
      </section>

      <section className="control-tower-grid">
        <article className="panel">
          <div className="panel-header">
            <h2>Logistics Workbench</h2>
            <span className="panel-subtitle">Unsaleable inventory becomes explicit routing work</span>
          </div>
          <div className="queue-list">
            {logisticsTasks.length ? (
              logisticsTasks.map((task) => (
	                <article key={task.id} className="queue-item">
	                  <div>
	                    <strong>{task.routeType.replaceAll("_", " ")}</strong>
	                    <div className="small-copy">{task.destination}</div>
	                  </div>
                    <div className="queue-meta">
	                    <span className={`pill ${statusTone(task.status)}`}>{task.status}</span>
                      <span className="pill neutral">simulated</span>
                    </div>
	                </article>
              ))
            ) : (
              <div className="small-copy">No logistics tasks yet.</div>
            )}
          </div>
        </article>

        <article className="panel">
          <div className="panel-header">
            <h2>Procurement Console</h2>
            <span className="panel-subtitle">Stockout-risk actions become bounded replenishment orders</span>
          </div>
          <div className="queue-list">
            {procurementOrders.length ? (
              procurementOrders.map((order) => (
	                <article key={order.id} className="queue-item">
	                  <div>
	                    <strong>{order.supplier}</strong>
	                    <div className="small-copy">
	                      Qty {formatNumber(order.quantity)} · {shortCurrency(order.estimatedCost)}
	                    </div>
	                  </div>
                    <div className="queue-meta">
	                  <span className={`pill ${statusTone(order.status)}`}>{order.status}</span>
                      <span className="pill neutral">simulated</span>
                    </div>
	                </article>
              ))
            ) : (
              <div className="small-copy">No procurement orders yet.</div>
            )}
          </div>
        </article>
      </section>

      <section className="panel">
        <div className="panel-header">
          <h2>Audit and Policy View</h2>
          <span className="panel-subtitle">Aggregation, proposal, guardrail, approvals, and executor outcomes</span>
        </div>
        <div className="audit-log">
          {audit.length ? (
            audit.slice(0, 16).map((entry) => (
              <article key={entry.id} className="audit-entry">
                <div className="audit-entry-header">
                  <span>{entry.type}</span>
                  <span>{formatAuditTime(entry.createdAt ?? entry.at)}</span>
                </div>
                <strong>{entry.message}</strong>
                <p className="small-copy">{entry.details}</p>
                <div className="small-copy">Actor: {entry.actor}</div>
              </article>
            ))
          ) : (
            <div className="small-copy">No audit events yet.</div>
          )}
        </div>
      </section>
    </section>
  );
}
