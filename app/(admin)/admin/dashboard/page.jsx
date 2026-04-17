"use client";

import { useEffect, useState } from "react";
import AlertFeed from "@/components/admin/AlertFeed";
import KpiCard from "@/components/admin/KpiCard";
import PipelineProgress from "@/components/admin/PipelineProgress";
import StoreTabs from "@/components/admin/StoreTabs";
import { useAdminBootstrap, useControlTowerDetail, useControlTowerStores } from "@/components/admin/use-admin-data";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Spinner from "@/components/ui/Spinner";
import Table from "@/components/ui/Table";
import { fetchJson } from "@/lib/fetch-json";
import { formatAuditTime, shortCurrency } from "@/lib/prototype-core";
import { formatPercent } from "@/lib/ui-format";

export default function DashboardPage() {
  const bootstrap = useAdminBootstrap();
  const [refreshToken, setRefreshToken] = useState(0);
  const storesState = useControlTowerStores(refreshToken);
  const detailState = useControlTowerDetail(bootstrap.selectedStoreId, bootstrap.defaultSnapshot, refreshToken);
  const [metrics, setMetrics] = useState(null);
  const [pageError, setPageError] = useState("");
  const [runningStoreId, setRunningStoreId] = useState(null);

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

    try {
      await fetchJson("/api/aggregation/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "live",
          snapshot: bootstrap.defaultSnapshot,
          storeId,
        }),
      });
      setRefreshToken((current) => current + 1);
    } catch (error) {
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
          Monitor chain KPIs, launch the multi-agent engine, and watch execution propagate into downstream interfaces.
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

      <div className="kpi-grid">
        <KpiCard
          footnote="Current operational snapshot rescued GMV."
          label="Rescued GMV"
          tone="green"
          value={`${shortCurrency(metrics?.rescuedGmv ?? 0)}₫`}
        />
        <KpiCard
          footnote={`${detail?.storeMetrics?.atRiskLots ?? 0} at-risk lots in ${selectedStore?.name ?? "store"}.`}
          label="Waste Rate"
          tone="amber"
          value={formatPercent(detail?.storeMetrics?.wasteRate ?? 0, 1)}
        />
        <KpiCard
          footnote="Markdowned lots vs active inventory."
          label="Sell-through"
          tone="blue"
          value={formatPercent(metrics?.wasteAvoidedPct ? metrics.wasteAvoidedPct / 100 : 0, 1)}
        />
        <KpiCard
          footnote="Persisted model runs in the selected store snapshot."
          label="AI Loops"
          tone="blue"
          value={`${detail?.modelRunHistory?.length ?? 0}`}
        />
      </div>

      <div className="grid-2">
        <Card>
          <Card.Header
            actions={
              <Button onClick={() => runEngine(bootstrap.selectedStoreId)}>Run Engine</Button>
            }
            title="Store Status"
            subtitle={`Operational snapshot ${bootstrap.defaultSnapshot ?? "not available"}`}
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
                  key: "lastAggregationAt",
                  label: "Last Run",
                  render: (row) => (row.lastAggregationAt ? formatAuditTime(row.lastAggregationAt) : "Never"),
                },
                {
                  key: "wasteRate",
                  label: "Waste Rate",
                  render: (row) => formatPercent(row.wasteRate ?? 0, 1),
                },
                {
                  key: "onSaleLots",
                  label: "Active Labels",
                  render: (row) => `${row.onSaleLots ?? 0}`,
                },
                {
                  key: "latestModelRun",
                  label: "WS Status",
                  render: (row) => row.latestModelRun?.status ?? "idle",
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

        <AlertFeed storeId={bootstrap.selectedStoreId} />
      </div>

      <Card>
        <Card.Header title="Selected Store" subtitle="Latest aggregation and proposal posture for the chosen store." />
        <Card.Body>
          <div className="grid-4">
            <div className="ui-card ui-card--padded">
              <p className="metric-label">Store</p>
              <strong>{selectedStore?.name ?? "—"}</strong>
            </div>
            <div className="ui-card ui-card--padded">
              <p className="metric-label">Proposals</p>
              <strong>{detail?.proposals?.length ?? 0}</strong>
            </div>
            <div className="ui-card ui-card--padded">
              <p className="metric-label">Pending Approvals</p>
              <strong>{detail?.approvals?.filter((item) => item.status === "pending").length ?? 0}</strong>
            </div>
            <div className="ui-card ui-card--padded">
              <p className="metric-label">Latest Provider</p>
              <strong>{detail?.latestModelRun?.model ?? "—"}</strong>
            </div>
          </div>
        </Card.Body>
      </Card>

      <PipelineProgress
        open={Boolean(runningStoreId)}
        storeId={runningStoreId}
        onClose={() => setRunningStoreId(null)}
      />
    </div>
  );
}
