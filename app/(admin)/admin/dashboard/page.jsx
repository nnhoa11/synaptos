"use client";

import { useEffect, useState } from "react";
import ControlTowerOverview from "@/components/admin/ControlTowerOverview";
import PipelineProgress from "@/components/admin/PipelineProgress";
import StoreTabs from "@/components/admin/StoreTabs";
import { useAdminBootstrap, useControlTowerDetail, useControlTowerStores } from "@/components/admin/use-admin-data";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Spinner from "@/components/ui/Spinner";
import Table from "@/components/ui/Table";
import { fetchJson } from "@/lib/fetch-json";
import { formatAuditTime } from "@/lib/prototype-core";

const INITIAL_PIPELINE_STEPS = {
  ingestion: { status: "running", summary: "Connecting to ingestion signals…" },
  aggregation: { status: "waiting", summary: "Waiting for ingestion…" },
  risk_scoring: { status: "waiting", summary: "Waiting for aggregation…" },
  recommendation: { status: "waiting", summary: "Waiting for risk scoring…" },
  campaign: { status: "waiting", summary: "Waiting for recommendation output…" },
};

function buildPipelineStepsFromResponse(response) {
  const statuses = response?.stageSummary?.stageStatuses ?? {};
  const confidences = response?.stageSummary?.stageConfidences ?? {};
  const routeSummary = response?.stageSummary?.routeSummary ?? {};
  const isDoneLike = (value) => value === "completed" || value === "partial";
  const isErrorLike = (value) => value === "failed";

  return {
    ingestion: {
      status:
        Object.entries(statuses).some(([key, value]) => key.startsWith("ingestion:") && isErrorLike(value))
          ? "error"
          : Object.entries(statuses).some(([key, value]) => key.startsWith("ingestion:") && isDoneLike(value))
            ? "done"
            : "waiting",
      summary:
        Object.entries(statuses).some(([key, value]) => key.startsWith("ingestion:") && isErrorLike(value))
          ? "One or more signal ingestors failed."
          : Object.entries(statuses).some(([key, value]) => key.startsWith("ingestion:") && value === "partial")
            ? "Signal extraction completed with fallback signals."
            : "Signal extraction completed.",
    },
    aggregation: {
      status: isErrorLike(statuses.aggregation) ? "error" : isDoneLike(statuses.aggregation) ? "done" : "waiting",
      summary:
        isErrorLike(statuses.aggregation)
          ? "Aggregation did not complete cleanly."
          : statuses.aggregation === "partial"
            ? "Aggregation completed with fallback merge logic."
            : statuses.aggregation
            ? "Structured store snapshot assembled."
            : "Waiting for ingestion…",
      confidence: confidences.aggregation ?? null,
    },
    risk_scoring: {
      status: isErrorLike(statuses.risk_scoring) ? "error" : isDoneLike(statuses.risk_scoring) ? "done" : "waiting",
      summary:
        isErrorLike(statuses.risk_scoring)
          ? "Risk scoring failed."
          : statuses.risk_scoring
            ? "Lot-level risk scores completed."
            : "Waiting for aggregation…",
    },
    recommendation: {
      status: isErrorLike(statuses.recommendation) ? "error" : isDoneLike(statuses.recommendation) ? "done" : "waiting",
      summary:
        isErrorLike(statuses.recommendation)
          ? "Recommendation generation failed."
          : statuses.recommendation
            ? `${response?.proposalCount ?? 0} proposals generated.`
            : "Waiting for risk scoring…",
    },
    campaign: {
      status: isErrorLike(statuses.campaign) ? "error" : isDoneLike(statuses.campaign) ? "done" : "waiting",
      summary:
        isErrorLike(statuses.campaign)
          ? "Campaign suggestion stage failed."
          : statuses.campaign === "partial"
            ? "Campaign windows prepared with fallback strategy."
            : statuses.campaign
            ? `Route summary: ${routeSummary.autoDispatched ?? 0} auto, ${routeSummary.pendingApproval ?? 0} approvals.`
            : "Waiting…",
      confidence: confidences.campaign ?? null,
    },
  };
}

export default function DashboardPage() {
  const bootstrap = useAdminBootstrap();
  const [refreshToken, setRefreshToken] = useState(0);
  const storesState = useControlTowerStores(refreshToken);
  const detailState = useControlTowerDetail(bootstrap.selectedStoreId, bootstrap.defaultSnapshot, refreshToken);
  const [metrics, setMetrics] = useState(null);
  const [pageError, setPageError] = useState("");
  const [runningStoreId, setRunningStoreId] = useState(null);
  const [pipelineSeedSteps, setPipelineSeedSteps] = useState({});

  useEffect(() => {
    if (!bootstrap.defaultSnapshot) {
      return;
    }

    let active = true;
    fetchJson(`/api/metrics?snapshot=${encodeURIComponent(bootstrap.defaultSnapshot)}`)
      .then((payload) => {
        if (active) {
          setMetrics(payload);
        }
      })
      .catch((error) => {
        if (active) {
          setPageError(error.message);
        }
      });

    return () => {
      active = false;
    };
  }, [bootstrap.defaultSnapshot, refreshToken]);

  async function runEngine(storeId) {
    if (!bootstrap.defaultSnapshot || !storeId) {
      return;
    }

    setPageError("");
    setRunningStoreId(storeId);
    setPipelineSeedSteps(INITIAL_PIPELINE_STEPS);

    try {
      const response = await fetchJson("/api/aggregation/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "live",
          snapshot: bootstrap.defaultSnapshot,
          storeId,
        }),
      });
      setPipelineSeedSteps(buildPipelineStepsFromResponse(response));
      setRefreshToken((current) => current + 1);
    } catch (error) {
      setPipelineSeedSteps({
        ingestion: { status: "error", summary: error.message || "Pipeline failed to start." },
      });
      setPageError(error.message);
    }
  }

  if (bootstrap.loading || storesState.loading || detailState.loading) {
    return (
      <div className="empty-state">
        <Spinner size="lg" />
      </div>
    );
  }

  const selectedStore = bootstrap.stores.find((store) => store.id === bootstrap.selectedStoreId) ?? null;
  const detail = detailState.detail;
  const overviewRows = storesState.stores ?? [];

  return (
    <div className="page-shell">
      <header className="page-header">
        <p className="page-eyebrow">Admin Dashboard</p>
        <h1 className="page-title">Control Tower Overview</h1>
        <p className="page-subtitle">
          Read the live chain pulse, inspect district demand shape, and trigger the engine from the highest-pressure
          operating window.
        </p>
      </header>

      <StoreTabs
        selectedStoreId={bootstrap.selectedStoreId}
        stores={bootstrap.stores}
        onChange={bootstrap.setSelectedStoreId}
      />

      {pageError ? (
        <Card>
          <Card.Body>
            <p className="empty-state__copy">{pageError}</p>
          </Card.Body>
        </Card>
      ) : null}

      <ControlTowerOverview
        detail={detail}
        metrics={metrics}
        onRunEngine={runEngine}
        runningStoreId={runningStoreId}
        selectedStore={selectedStore}
        snapshotKey={bootstrap.defaultSnapshot}
        stores={overviewRows}
      />

      <Card>
        <Card.Header
          actions={
            <div className="row">
              <Button size="sm" variant="secondary" onClick={() => setRefreshToken((current) => current + 1)}>
                Refresh
              </Button>
              <Button size="sm" onClick={() => runEngine(bootstrap.selectedStoreId)}>
                Run Selected Store
              </Button>
            </div>
          }
          title="Store Status Matrix"
          subtitle={`Operational snapshot ${
            bootstrap.defaultSnapshot ? formatAuditTime(bootstrap.defaultSnapshot) : "not available"
          }`}
        />
        <Card.Body>
          <Table
            columns={[
              { key: "name", label: "Store" },
              {
                key: "archetype",
                label: "Archetype",
                render: (row) => row.displayType ?? row.archetype,
              },
              {
                key: "activeLots",
                label: "Live Lots",
                render: (row) => `${row.activeLots ?? 0}`,
              },
              {
                key: "totalQuantity",
                label: "Units On Hand",
                render: (row) => `${row.totalQuantity ?? 0}`,
              },
              {
                key: "atRiskLots",
                label: "At Risk",
                render: (row) => `${row.atRiskLots ?? 0}`,
              },
              {
                key: "onSaleLots",
                label: "On Sale",
                render: (row) => `${row.onSaleLots ?? 0}`,
              },
              {
                key: "lastAggregationAt",
                label: "Last Run",
                render: (row) => (row.lastAggregationAt ? formatAuditTime(row.lastAggregationAt) : "Live mock"),
              },
              {
                key: "actions",
                label: "Actions",
                render: (row) => (
                  <Button size="sm" onClick={() => runEngine(row.id)}>
                    Run Engine
                  </Button>
                ),
              },
            ]}
            rowKey="id"
            rows={overviewRows}
          />
        </Card.Body>
      </Card>

      <PipelineProgress
        open={Boolean(runningStoreId)}
        seedSteps={pipelineSeedSteps}
        storeId={runningStoreId}
        onClose={() => {
          setRunningStoreId(null);
          setPipelineSeedSteps({});
        }}
      />
    </div>
  );
}
