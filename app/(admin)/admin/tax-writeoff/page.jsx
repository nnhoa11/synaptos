"use client";

import { useEffect, useMemo, useState } from "react";
import StoreTabs from "@/components/admin/StoreTabs";
import { useAdminBootstrap } from "@/components/admin/use-admin-data";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Spinner from "@/components/ui/Spinner";
import Table from "@/components/ui/Table";
import { fetchJson } from "@/lib/fetch-json";
import { generateTaxWriteoffPDF } from "@/lib/client/pdf/tax-writeoff-pdf";
import { currency } from "@/lib/prototype-core";

function buildRange(range) {
  const now = new Date();
  const from = new Date(now.getTime() - range * 24 * 60 * 60 * 1000);
  return {
    from: from.toISOString(),
    to: now.toISOString(),
  };
}

export default function TaxWriteoffPage() {
  const bootstrap = useAdminBootstrap();
  const [range, setRange] = useState("7");
  const [events, setEvents] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!bootstrap.selectedStoreId) {
      return;
    }

    const { from, to } = buildRange(Number(range));
    fetchJson(
      `/api/eol-events?storeId=${encodeURIComponent(bootstrap.selectedStoreId)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
    )
      .then(setEvents)
      .catch((nextError) => setError(nextError.message));
  }, [bootstrap.selectedStoreId, range]);

  const totals = useMemo(
    () => ({
      original: events.reduce((sum, event) => sum + Number(event.original_value ?? 0), 0),
      writeoff: events.reduce((sum, event) => sum + Number(event.writeoff_value ?? 0), 0),
    }),
    [events]
  );

  if (bootstrap.loading) {
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
        <h1 className="page-title">Tax Write-off</h1>
        <p className="page-subtitle">Export end-of-life routing records for compliance review and finance handoff.</p>
      </header>

      <StoreTabs
        selectedStoreId={bootstrap.selectedStoreId}
        stores={bootstrap.stores}
        onChange={bootstrap.setSelectedStoreId}
      />

      <Card>
        <Card.Header
          actions={
            <Button
              onClick={() =>
                generateTaxWriteoffPDF(events, store?.name ?? bootstrap.selectedStoreId, `last-${range}-days`)
              }
            >
              Export PDF
            </Button>
          }
          title="EOL Events"
          subtitle="Routing records surfaced from the current control-tower state."
        />
        <Card.Body>
          <div className="row-between" style={{ marginBottom: 12 }}>
            <div className="row">
              {[7, 30].map((value) => (
                <Button
                  key={value}
                  size="sm"
                  variant={range === String(value) ? "primary" : "secondary"}
                  onClick={() => setRange(String(value))}
                >
                  Last {value}d
                </Button>
              ))}
            </div>
            {error ? <span className="metric-footnote">{error}</span> : null}
          </div>
          <Table
            columns={[
              { key: "sku_id", label: "SKU" },
              { key: "category", label: "Category" },
              { key: "quantity", label: "Qty" },
              {
                key: "original_value",
                label: "Original",
                render: (row) => currency(row.original_value),
              },
              {
                key: "writeoff_value",
                label: "Write-off",
                render: (row) => currency(row.writeoff_value),
              },
              {
                key: "eol_at",
                label: "EOL Time",
                render: (row) => new Date(row.eol_at).toLocaleString(),
              },
              { key: "routing_destination", label: "Routing" },
            ]}
            rows={events}
          />
          <div className="row-between" style={{ marginTop: 12 }}>
            <strong>Total original: {currency(totals.original)}</strong>
            <strong>Total write-off: {currency(totals.writeoff)}</strong>
          </div>
        </Card.Body>
      </Card>
    </div>
  );
}
