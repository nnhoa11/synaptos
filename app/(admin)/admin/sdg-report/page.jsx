"use client";

import { useEffect, useState } from "react";
import CssBarChart from "@/components/admin/CssBarChart";
import KpiCard from "@/components/admin/KpiCard";
import StoreTabs from "@/components/admin/StoreTabs";
import { useAdminBootstrap } from "@/components/admin/use-admin-data";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Spinner from "@/components/ui/Spinner";
import { fetchJson } from "@/lib/fetch-json";
import { generateSDGReportPDF } from "@/lib/client/pdf/sdg-report-pdf";
import { formatPercent } from "@/lib/ui-format";

export default function SDGReportPage() {
  const bootstrap = useAdminBootstrap();
  const [period, setPeriod] = useState("30d");
  const [metrics, setMetrics] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!bootstrap.selectedStoreId) {
      return;
    }

    fetchJson(
      `/api/metrics/sdg?storeId=${encodeURIComponent(bootstrap.selectedStoreId)}&period=${encodeURIComponent(period)}`
    )
      .then(setMetrics)
      .catch((nextError) => setError(nextError.message));
  }, [bootstrap.selectedStoreId, period]);

  if (bootstrap.loading || !metrics) {
    return (
      <div className="empty-state">
        <Spinner size="lg" />
      </div>
    );
  }

  const store = bootstrap.stores.find((item) => item.id === bootstrap.selectedStoreId);

  return (
    <div className="page-shell">
      <header className="page-header">
        <p className="page-eyebrow">Reports</p>
        <h1 className="page-title">SDG 12 Report</h1>
        <p className="page-subtitle">Waste diversion, emissions savings, and circular-routing performance against baseline.</p>
      </header>

      <StoreTabs
        selectedStoreId={bootstrap.selectedStoreId}
        stores={bootstrap.stores}
        onChange={bootstrap.setSelectedStoreId}
      />

      <div className="row-between">
        <div className="row">
          {["7d", "30d", "90d"].map((value) => (
            <Button
              key={value}
              size="sm"
              variant={period === value ? "primary" : "secondary"}
              onClick={() => setPeriod(value)}
            >
              {value}
            </Button>
          ))}
        </div>
        <Button onClick={() => generateSDGReportPDF(metrics, store?.name ?? bootstrap.selectedStoreId, period)}>
          Export PDF
        </Button>
      </div>

      {error ? (
        <Card>
          <Card.Body>
            <p className="empty-state__copy">{error}</p>
          </Card.Body>
        </Card>
      ) : null}

      <div className="kpi-grid">
        <KpiCard label="Waste Rate" value={formatPercent(metrics.wasteRate, 1)} footnote={`Baseline ${formatPercent(metrics.baselineWasteRate, 1)}`} />
        <KpiCard label="Kg Diverted" value={`${metrics.totalKgDiverted}`} footnote="Estimated across markdown and EOL routing." tone="green" />
        <KpiCard label="CO2 Saved" value={`${metrics.co2SavedKg} kg`} footnote="UNEP 0.6kg CO2e per kg prevented." tone="green" />
        <KpiCard label="Items Rescued" value={`${metrics.itemsRescued}`} footnote="Units moved before waste." tone="blue" />
      </div>

      <div className="grid-2">
        <Card>
          <Card.Header title="Action Breakdown" subtitle="Operational routing mix for the selected period." />
          <Card.Body>
            <CssBarChart
              formatValue={(value) => `${value}`}
              rows={[
                { label: "Markdown rescue", value: metrics.breakdown.markdown_rescue },
                { label: "Cross-dock", value: metrics.breakdown.cross_dock },
                { label: "EOL donation", value: metrics.breakdown.eol_donation },
                { label: "EOL compost", value: metrics.breakdown.eol_compost },
              ]}
            />
          </Card.Body>
        </Card>
        <Card>
          <Card.Header title="Waste Rate Trend" subtitle="Snapshot-derived trend buckets across the chosen period." />
          <Card.Body>
            <CssBarChart
              formatValue={(value) => formatPercent(value, 1)}
              rows={metrics.trend.map((row) => ({ label: row.label, value: row.wasteRate }))}
            />
          </Card.Body>
        </Card>
      </div>
    </div>
  );
}
