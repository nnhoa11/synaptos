"use client";

import { useState } from "react";
import ModelRunDrawer from "@/components/admin/ModelRunDrawer";
import PipelineProgress from "@/components/admin/PipelineProgress";
import ProposalTable from "@/components/admin/ProposalTable";
import StoreTabs from "@/components/admin/StoreTabs";
import { useAdminBootstrap, useControlTowerDetail } from "@/components/admin/use-admin-data";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Spinner from "@/components/ui/Spinner";
import { fetchJson } from "@/lib/fetch-json";
import { formatAuditTime } from "@/lib/prototype-core";

const MODES = [
  { id: "legacy", label: "Legacy", payload: { controlTowerEnabled: false, llmMode: "disabled" } },
  { id: "shadow", label: "Shadow", payload: { controlTowerEnabled: true, llmMode: "shadow" } },
  { id: "live", label: "Live", payload: { controlTowerEnabled: true, llmMode: "live" } },
];

export default function RecommendationsPage() {
  const bootstrap = useAdminBootstrap();
  const [refreshToken, setRefreshToken] = useState(0);
  const detailState = useControlTowerDetail(bootstrap.selectedStoreId, bootstrap.defaultSnapshot, refreshToken);
  const [selectedProposal, setSelectedProposal] = useState(null);
  const [runningStoreId, setRunningStoreId] = useState(null);
  const [error, setError] = useState("");

  if (bootstrap.loading || detailState.loading) {
    return (
      <div className="empty-state">
        <Spinner size="lg" />
      </div>
    );
  }

  const detail = detailState.detail;

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
        <h1 className="page-title">Proposal Queue And Model Trace</h1>
        <p className="page-subtitle">
          Run the full multi-agent stack, inspect every proposal, and open the underlying prompt/output artifact trail.
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

      <div className="grid-2">
        <Card>
          <Card.Header title="Last Run Summary" subtitle="Most recent provider-backed agent state." />
          <Card.Body>
            <div className="grid-3">
              <div className="ui-card ui-card--padded">
                <p className="metric-label">Latest Stage</p>
                <strong>{detail?.latestModelRun?.stageName ?? "—"}</strong>
              </div>
              <div className="ui-card ui-card--padded">
                <p className="metric-label">Model</p>
                <strong>{detail?.latestModelRun?.model ?? "—"}</strong>
              </div>
              <div className="ui-card ui-card--padded">
                <p className="metric-label">Run Time</p>
                <strong>
                  {detail?.latestModelRun?.createdAt ? formatAuditTime(detail.latestModelRun.createdAt) : "—"}
                </strong>
              </div>
            </div>
          </Card.Body>
        </Card>

        <Card>
          <Card.Header title="Route Breakdown" subtitle="Auto-dispatched vs approval-routed outcomes." />
          <Card.Body>
            <div className="grid-3">
              <div className="ui-card ui-card--padded">
                <p className="metric-label">Auto</p>
                <strong>{detail?.executionTasks?.length ?? 0}</strong>
              </div>
              <div className="ui-card ui-card--padded">
                <p className="metric-label">Pending Approval</p>
                <strong>{detail?.approvals?.filter((item) => item.status === "pending").length ?? 0}</strong>
              </div>
              <div className="ui-card ui-card--padded">
                <p className="metric-label">Blocked</p>
                <strong>{detail?.proposals?.filter((item) => item.guardrail?.outcome === "blocked").length ?? 0}</strong>
              </div>
            </div>
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
