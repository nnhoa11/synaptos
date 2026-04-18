"use client";

import { useMemo, useState } from "react";
import Badge from "@/components/ui/Badge";
import ModelRunDrawer from "@/components/admin/ModelRunDrawer";
import PipelineProgress from "@/components/admin/PipelineProgress";
import ProposalTable from "@/components/admin/ProposalTable";
import StoreTabs from "@/components/admin/StoreTabs";
import { useAdminBootstrap, useControlTowerDetail } from "@/components/admin/use-admin-data";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Spinner from "@/components/ui/Spinner";
import { fetchJson } from "@/lib/fetch-json";
import { currency, formatAuditTime } from "@/lib/prototype-core";
import styles from "@/components/admin/OpsWorkbench.module.css";

const MODES = [
  { id: "legacy", label: "Legacy", payload: { controlTowerEnabled: false, llmMode: "disabled" } },
  { id: "shadow", label: "Shadow", payload: { controlTowerEnabled: true, llmMode: "shadow" } },
  { id: "live", label: "Live", payload: { controlTowerEnabled: true, llmMode: "live" } },
];

async function copyText(value, setCopiedKey, key) {
  try {
    await navigator.clipboard.writeText(value);
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey(""), 1600);
  } catch {
    setCopiedKey("");
  }
}

function urgencyTone(level) {
  if (level === "immediate") {
    return "red";
  }
  if (level === "high") {
    return "amber";
  }
  if (level === "watch") {
    return "blue";
  }
  return "gray";
}

function buildFallbackProcurementOrders(detail) {
  const inventoryLots = detail?.inventoryLots ?? [];
  const store = detail?.store;
  if (!store) {
    return [];
  }

  return inventoryLots
    .filter(
      (lot) =>
        Number(lot.stockoutRisk ?? 0) >= 0.68 || Number(lot.forecastUnits ?? 0) > Number(lot.quantity ?? 0) * 1.25
    )
    .sort((left, right) => Number(right.stockoutRisk ?? 0) - Number(left.stockoutRisk ?? 0))
    .slice(0, 3)
    .map((lot, index) => {
      const quantity = Math.max(4, Math.round(Math.max(Number(lot.forecastUnits ?? 0) - Number(lot.quantity ?? 0), 4)));
      const estimatedCost = Math.round(quantity * Math.max(1, Number(lot.cost ?? 0) / Math.max(1, Number(lot.sold ?? 1))));
      const urgency = Number(lot.stockoutRisk ?? 0) >= 0.82 ? "high" : "watch";
      const supplier = `${lot.category} preferred supplier`;
      const supplierEmail = `${String(supplier).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}@partners.synaptos.local`;
      const reasonSummary = `${lot.productName} is forecast to move ${Math.round(lot.forecastUnits ?? 0)} units with only ${lot.quantity} units on hand. Suggested inbound quantity is ${quantity}.`;
      return {
        id: `fallback-po-${lot.lotId}-${index}`,
        executionTaskId: `fallback-po-task-${lot.lotId}`,
        proposalId: null,
        storeId: detail.storeId,
        storeName: store.name,
        district: store.district,
        archetype: store.archetype,
        route: "procurement",
        taskType: "procurement_order",
        supplier,
        supplierEmail,
        buyerEmail: `${detail.storeId}.procurement@synaptos.local`,
        managerEmail: `${detail.storeId}.manager@synaptos.local`,
        quantity,
        estimatedCost,
        unitCost: Math.round(estimatedCost / Math.max(1, quantity)),
        status: "draft",
        createdAt: detail.snapshotKey,
        dispatchedAt: null,
        skuName: lot.productName,
        proposalType: "procurement_order",
        category: lot.category,
        proposedPrice: Number(lot.currentPrice ?? 0),
        stockoutRisk: Number(lot.stockoutRisk ?? 0),
        forecastUnits: Number(lot.forecastUnits ?? 0),
        recentVelocity: Number(lot.recentVelocity ?? 0),
        itemTraffic: Number(lot.itemTraffic ?? 0),
        confidence: Number(lot.confidenceScore ?? 0),
        urgency,
        supplierLeadTime: urgency === "high" ? "same shift" : "next delivery wave",
        reasonSummary,
        emailSubject: `[SynaptOS][PO Draft] ${store.name} requests ${quantity} units of ${lot.productName}`,
        emailBody: [
          `To: ${supplier} <${supplierEmail}>`,
          `CC: ${store.district} Procurement <${detail.storeId}.procurement@synaptos.local>`,
          "",
          `Store: ${store.name} (${detail.storeId})`,
          `SKU: ${lot.productName}`,
          `Category: ${lot.category}`,
          `Requested quantity: ${quantity}`,
          `Estimated cost: ${estimatedCost.toLocaleString()} VND`,
          "",
          reasonSummary,
        ].join("\n"),
      };
    });
}

function buildFallbackLogisticsTasks(detail) {
  const inventoryLots = detail?.inventoryLots ?? [];
  const store = detail?.store;
  if (!store) {
    return [];
  }

  return inventoryLots
    .filter((lot) => Number(lot.hoursToExpiry ?? 999) <= 18 || Number(lot.spoilageRisk ?? 0) >= 0.72)
    .sort((left, right) => Number(left.hoursToExpiry ?? 999) - Number(right.hoursToExpiry ?? 999))
    .slice(0, 3)
    .map((lot, index) => {
      const destination = Number(lot.hoursToExpiry ?? 999) <= 8 ? "eol" : "cross_dock";
      const destinationLabel = destination === "eol" ? "tax write-off hold" : "cross-dock rebalancing";
      const urgency = Number(lot.hoursToExpiry ?? 999) <= 8 ? "immediate" : "high";
      const writeoffValue = Math.round(Number(lot.cost ?? 0) * 0.35);
      const pickupWindow = urgency === "immediate" ? "within 60 min" : "before next peak window";
      const handoffMessage = `${store.name} should route ${lot.quantity} units of ${lot.productName} to ${destinationLabel}. ${Number(
        lot.hoursToExpiry ?? 0
      ).toFixed(1)}h remain to expiry.`;
      return {
        id: `fallback-log-${lot.lotId}-${index}`,
        executionTaskId: `fallback-log-task-${lot.lotId}`,
        proposalId: null,
        storeId: detail.storeId,
        storeName: store.name,
        district: store.district,
        archetype: store.archetype,
        route: "logistics",
        taskType: "logistics_route",
        routeType: "cross_dock_or_eol",
        destination,
        destinationLabel,
        status: "draft",
        createdAt: detail.snapshotKey,
        dispatchedAt: null,
        skuName: lot.productName,
        proposalType: "unsaleable",
        proposedPrice: Number(lot.currentPrice ?? 0),
        recommendedDiscountPct: Number(lot.discountPct ?? 0),
        quantity: Number(lot.quantity ?? 0),
        category: lot.category,
        hoursToExpiry: Number(lot.hoursToExpiry ?? 0),
        unitCost: Math.round(Number(lot.cost ?? 0) / Math.max(1, Number(lot.sold ?? 1))),
        basePrice: Number(lot.originalPrice ?? lot.currentPrice ?? 0),
        originalValue: Math.round(Number(lot.originalPrice ?? lot.currentPrice ?? 0) * Number(lot.quantity ?? 0)),
        writeoffValue,
        urgency,
        pickupWindow,
        coordinatorName: `${store.district} Logistics`,
        coordinatorEmail: `${detail.storeId}.logistics@synaptos.local`,
        managerEmail: `${detail.storeId}.manager@synaptos.local`,
        handoffMessage,
        emailSubject: `[SynaptOS][${store.name}] ${destinationLabel} routing for ${lot.productName}`,
        emailBody: [
          `Coordinator: ${store.district} Logistics <${detail.storeId}.logistics@synaptos.local>`,
          "",
          `Store: ${store.name} (${detail.storeId})`,
          `SKU: ${lot.productName}`,
          `Quantity: ${lot.quantity}`,
          `Route: ${destinationLabel}`,
          `Pickup window: ${pickupWindow}`,
          "",
          handoffMessage,
        ].join("\n"),
      };
    });
}

export default function RecommendationsPage() {
  const bootstrap = useAdminBootstrap();
  const [refreshToken, setRefreshToken] = useState(0);
  const detailState = useControlTowerDetail(bootstrap.selectedStoreId, bootstrap.defaultSnapshot, refreshToken);
  const [selectedProposal, setSelectedProposal] = useState(null);
  const [runningStoreId, setRunningStoreId] = useState(null);
  const [dispatchingTaskId, setDispatchingTaskId] = useState("");
  const [copiedKey, setCopiedKey] = useState("");
  const [error, setError] = useState("");

  if (bootstrap.loading || detailState.loading) {
    return (
      <div className="empty-state">
        <Spinner size="lg" />
      </div>
    );
  }

  const detail = detailState.detail;
  const markdownProposals = (detail?.proposals ?? []).filter(
    (proposal) => proposal.proposalType === "markdown" || proposal.executionRoute === "label"
  );
  const effectiveMarkdowns = markdownProposals.length
    ? markdownProposals
    : (detail?.currentRecommendations ?? []).map((recommendation) => ({
        skuName: recommendation.skuName,
        recommendedDiscountPct: recommendation.recommendedDiscountPct,
        proposedPrice: recommendation.activePrice ?? recommendation.recommendedPrice,
        rationale: recommendation.reasonSummary,
        metadata: { category: recommendation.category },
      }));
  const procurementOrders = detail?.procurementOrders?.length
    ? detail.procurementOrders
    : buildFallbackProcurementOrders(detail);
  const logisticsTasks = detail?.logisticsTasks?.length ? detail.logisticsTasks : buildFallbackLogisticsTasks(detail);
  const topProcurement = procurementOrders[0] ?? null;
  const topLogistics = logisticsTasks[0] ?? null;

  const markdownDraft = useMemo(() => {
    if (!detail?.store || !effectiveMarkdowns.length) {
      return null;
    }

    const totalRescueValue = effectiveMarkdowns.reduce((sum, proposal) => sum + Number(proposal.proposedPrice ?? 0), 0);
    const subject = `[SynaptOS][Markdown Memo] ${detail.store.name} floor actions for the next trading window`;
    const body = [
      `To: ${detail.store.district} Store Team <${detail.storeId}.manager@synaptos.local>`,
      "",
      `Store: ${detail.store.name} (${detail.storeId})`,
      `Generated at: ${new Date().toLocaleString()}`,
      `Lots in markdown queue: ${effectiveMarkdowns.length}`,
      `Projected active price value: ${currency(totalRescueValue)}`,
      "",
      "Execute these floor moves:",
      ...effectiveMarkdowns.slice(0, 8).map(
        (proposal, index) =>
          `${index + 1}. ${proposal.skuName} -> ${proposal.recommendedDiscountPct ?? 0}% markdown at ${currency(
            proposal.proposedPrice
          )} | ${proposal.metadata?.category ?? "unknown"} | reason: ${proposal.rationale}`
      ),
      "",
      "Confirm shelf update completion and isolate any lots that cross into EOL routing threshold.",
    ].join("\n");

    return {
      subject,
      body,
      rescueValue: totalRescueValue,
    };
  }, [detail, effectiveMarkdowns]);

  async function setMode(mode) {
    try {
      setError("");
      await fetchJson(`/api/stores/${encodeURIComponent(bootstrap.selectedStoreId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode.payload),
      });
      setRefreshToken((current) => current + 1);
    } catch (nextError) {
      setError(nextError.message);
    }
  }

  async function runEngine() {
    try {
      setError("");
      setRunningStoreId(bootstrap.selectedStoreId);
      await fetchJson("/api/aggregation/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "live",
          snapshot: bootstrap.defaultSnapshot,
          storeId: bootstrap.selectedStoreId,
        }),
      });
      setRefreshToken((current) => current + 1);
    } catch (nextError) {
      setError(nextError.message);
    }
  }

  async function dispatchTask(task) {
    if (!task?.executionTaskId || dispatchingTaskId) {
      return;
    }

    try {
      setError("");
      setDispatchingTaskId(task.executionTaskId);
      await fetchJson(`/api/execution/tasks/${encodeURIComponent(task.executionTaskId)}/dispatch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          route: task.route,
          storeId: task.storeId,
        }),
      });
      setRefreshToken((current) => current + 1);
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setDispatchingTaskId("");
    }
  }

  const activeMode =
    detail?.mode === "legacy"
      ? "legacy"
      : detail?.llmMode === "live"
        ? "live"
        : "shadow";

  return (
    <div className="page-shell">
      <header className="page-header">
        <p className="page-eyebrow">Recommendations</p>
        <h1 className="page-title">Proposal Queue, Procurement, And Floor Execution</h1>
        <p className="page-subtitle">
          Inspect the multi-agent output, then move directly into markdown broadcast, supplier ordering, and logistics routing without leaving the console.
        </p>
      </header>

      <StoreTabs
        selectedStoreId={bootstrap.selectedStoreId}
        stores={bootstrap.stores}
        onChange={bootstrap.setSelectedStoreId}
      />

      <Card>
        <Card.Header
          actions={<Button onClick={runEngine}>Run Engine</Button>}
          title="Rollout Mode"
          subtitle="Persisted control-tower posture for the selected store."
        />
        <Card.Body>
          <div className="row">
            {MODES.map((mode) => (
              <Button
                key={mode.id}
                size="sm"
                variant={activeMode === mode.id ? "primary" : "secondary"}
                onClick={() => setMode(mode)}
              >
                {mode.label}
              </Button>
            ))}
          </div>
          {error ? <p className="metric-footnote">{error}</p> : null}
        </Card.Body>
      </Card>

      <div className={styles.kpiGrid}>
        <div className={styles.kpiCard}>
          <p className={styles.kpiLabel}>Latest Stage</p>
          <p className={styles.kpiValue}>{detail?.latestModelRun?.stageName ?? "-"}</p>
          <p className={styles.kpiMeta}>Model: {detail?.latestModelRun?.model ?? "-"}</p>
        </div>
        <div className={styles.kpiCard}>
          <p className={styles.kpiLabel}>Auto Routes</p>
          <p className={styles.kpiValue}>{detail?.executionTasks?.length ?? 0}</p>
          <p className={styles.kpiMeta}>Dispatched label, logistics, and procurement tasks.</p>
        </div>
        <div className={styles.kpiCard}>
          <p className={styles.kpiLabel}>Pending Approval</p>
          <p className={styles.kpiValue}>{detail?.approvals?.filter((item) => item.status === "pending").length ?? 0}</p>
          <p className={styles.kpiMeta}>Human-in-loop routes blocked by discount or confidence policy.</p>
        </div>
        <div className={styles.kpiCard}>
          <p className={styles.kpiLabel}>Blocked</p>
          <p className={styles.kpiValue}>{detail?.proposals?.filter((item) => item.guardrail?.outcome === "blocked").length ?? 0}</p>
          <p className={styles.kpiMeta}>
            Last run {detail?.latestModelRun?.createdAt ? formatAuditTime(detail.latestModelRun.createdAt) : "-"}
          </p>
        </div>
      </div>

      <div className={styles.bento}>
        <Card>
          <Card.Header title="Markdown Broadcast" subtitle="Auto-drafted floor memo for price reduction and shelf execution." />
          <Card.Body className={styles.shell}>
            {markdownDraft ? (
              <>
                <div className={styles.tagRow}>
                  <Badge tone="blue">{effectiveMarkdowns.length} active markdowns</Badge>
                  <Badge tone="green">{currency(markdownDraft.rescueValue)} live price value</Badge>
                </div>
                <div className={styles.codePanel}>
                  <p className={styles.codeLabel}>Store Memo Subject</p>
                  <pre className={styles.codeBody}>{markdownDraft.subject}</pre>
                </div>
                <div className={styles.codePanel}>
                  <p className={styles.codeLabel}>Store Memo Body</p>
                  <pre className={styles.codeBody}>{markdownDraft.body}</pre>
                </div>
                <div className={styles.actionRow}>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => copyText(markdownDraft.subject, setCopiedKey, "markdown-subject")}
                  >
                    {copiedKey === "markdown-subject" ? "Copied Subject" : "Copy Subject"}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => copyText(markdownDraft.body, setCopiedKey, "markdown-body")}
                  >
                    {copiedKey === "markdown-body" ? "Copied Memo" : "Copy Memo"}
                  </Button>
                </div>
              </>
            ) : (
              <div className={styles.empty}>No markdown actions are active for this store.</div>
            )}
          </Card.Body>
        </Card>

        <Card>
          <Card.Header title="Execution Linkage" subtitle="How the reasoner is translating into action across the Act layer." />
          <Card.Body className={styles.shell}>
            <div className={styles.barList}>
              {[
                {
                  label: "Markdown",
                  value: markdownProposals.length,
                  total: detail?.proposals?.length ?? 0,
                },
                {
                  label: "Logistics",
                  value: logisticsTasks.length,
                  total: detail?.proposals?.length ?? 0,
                },
                {
                  label: "Procurement",
                  value: procurementOrders.length,
                  total: detail?.proposals?.length ?? 0,
                },
              ].map((row) => {
                const width = row.total ? Math.max(8, Math.round((row.value / row.total) * 100)) : 0;
                return (
                  <div className={styles.barRow} key={row.label}>
                    <div className={styles.barHeader}>
                      <span>{row.label}</span>
                      <span>{row.value}</span>
                    </div>
                    <div className={styles.barTrack}>
                      <div className={styles.barFill} style={{ width: `${width}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
            <ul className={styles.checklist}>
              <li className={styles.checklistItem}>Procurement drafts convert stockout signals into supplier-ready communication.</li>
              <li className={styles.checklistItem}>Markdown memos turn model output into store-floor action without rewriting instructions.</li>
              <li className={styles.checklistItem}>Logistics routes keep EOL handling inside the same operator loop.</li>
            </ul>
          </Card.Body>
        </Card>
      </div>

      <div className={styles.bento}>
        <Card>
          <Card.Header title="Procurement Autopilot" subtitle="Drafted PO emails and inbound context derived from stockout risk." />
          <Card.Body className={styles.shell}>
            {topProcurement ? (
              <>
                <div className={styles.list}>
                  {procurementOrders.slice(0, 4).map((order) => (
                    <div className={styles.listItem} key={order.id}>
                      <div className={styles.listItemHeader}>
                        <div>
                          <div className={styles.titleRow}>
                            <h3 className={styles.itemTitle}>{order.skuName}</h3>
                            <Badge tone={urgencyTone(order.urgency)}>{order.urgency}</Badge>
                          </div>
                          <p className={styles.itemMeta}>
                            {order.quantity} units · {order.supplier} · ETA {order.supplierLeadTime}
                          </p>
                        </div>
                        <strong>{currency(order.estimatedCost)}</strong>
                      </div>
                      <p className={styles.note}>{order.reasonSummary}</p>
                    </div>
                  ))}
                </div>
                <div className={styles.codePanel}>
                  <p className={styles.codeLabel}>Supplier Email</p>
                  <pre className={styles.codeBody}>{topProcurement.emailBody}</pre>
                </div>
                <div className={styles.actionRow}>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => copyText(topProcurement.emailSubject, setCopiedKey, "po-subject")}
                  >
                    {copiedKey === "po-subject" ? "Copied Subject" : "Copy Subject"}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => copyText(topProcurement.emailBody, setCopiedKey, "po-body")}
                  >
                    {copiedKey === "po-body" ? "Copied Email" : "Copy Email"}
                  </Button>
                  {topProcurement.status !== "dispatched" && !String(topProcurement.id).startsWith("fallback-") ? (
                    <Button
                      size="sm"
                      onClick={() => dispatchTask(topProcurement)}
                      disabled={dispatchingTaskId === topProcurement.executionTaskId}
                    >
                      {dispatchingTaskId === topProcurement.executionTaskId ? "Dispatching..." : "Dispatch PO"}
                    </Button>
                  ) : null}
                </div>
              </>
            ) : (
              <div className={styles.empty}>No procurement order is active for the selected store.</div>
            )}
          </Card.Body>
        </Card>

        <Card>
          <Card.Header title="Logistics Route Desk" subtitle="Operational brief for cross-dock and EOL routing." />
          <Card.Body className={styles.shell}>
            {topLogistics ? (
              <>
                <div className={styles.list}>
                  {logisticsTasks.slice(0, 4).map((task) => (
                    <div className={styles.listItem} key={task.id}>
                      <div className={styles.listItemHeader}>
                        <div>
                          <div className={styles.titleRow}>
                            <h3 className={styles.itemTitle}>{task.skuName}</h3>
                            <Badge tone={urgencyTone(task.urgency)}>{task.urgency}</Badge>
                            <Badge tone="gray">{task.destinationLabel}</Badge>
                          </div>
                          <p className={styles.itemMeta}>
                            {task.quantity} units · pickup {task.pickupWindow} · {task.coordinatorEmail}
                          </p>
                        </div>
                        <strong>{currency(task.writeoffValue ?? 0)}</strong>
                      </div>
                      <p className={styles.note}>{task.handoffMessage}</p>
                    </div>
                  ))}
                </div>
                <div className={styles.codePanel}>
                  <p className={styles.codeLabel}>Coordinator Brief</p>
                  <pre className={styles.codeBody}>{topLogistics.emailBody}</pre>
                </div>
                <div className={styles.actionRow}>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => copyText(topLogistics.emailSubject, setCopiedKey, "logistics-subject")}
                  >
                    {copiedKey === "logistics-subject" ? "Copied Subject" : "Copy Subject"}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => copyText(topLogistics.emailBody, setCopiedKey, "logistics-body")}
                  >
                    {copiedKey === "logistics-body" ? "Copied Brief" : "Copy Brief"}
                  </Button>
                  {topLogistics.status !== "dispatched" && !String(topLogistics.id).startsWith("fallback-") ? (
                    <Button
                      size="sm"
                      onClick={() => dispatchTask(topLogistics)}
                      disabled={dispatchingTaskId === topLogistics.executionTaskId}
                    >
                      {dispatchingTaskId === topLogistics.executionTaskId ? "Dispatching..." : "Dispatch Route"}
                    </Button>
                  ) : null}
                </div>
              </>
            ) : (
              <div className={styles.empty}>No logistics route is active for this store.</div>
            )}
          </Card.Body>
        </Card>
      </div>

      <Card>
        <Card.Header title="Proposal Queue" subtitle="Click any row to inspect the full model artifact." />
        <Card.Body>
          <ProposalTable rows={detail?.proposals ?? []} onSelect={setSelectedProposal} />
        </Card.Body>
      </Card>

      <ModelRunDrawer
        modelRunId={selectedProposal?.modelRun?.id ?? selectedProposal?.modelRunId ?? null}
        open={Boolean(selectedProposal)}
        onClose={() => setSelectedProposal(null)}
      />
      <PipelineProgress
        open={Boolean(runningStoreId)}
        storeId={runningStoreId}
        onClose={() => setRunningStoreId(null)}
      />
    </div>
  );
}
