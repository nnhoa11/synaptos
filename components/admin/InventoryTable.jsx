"use client";

import { useMemo, useState } from "react";
import Table from "@/components/ui/Table";
import Badge from "@/components/ui/Badge";
import { currency, formatNumber } from "@/lib/prototype-core";
import { formatCountdown } from "@/lib/ui-format";

function RiskBar({ value = null }) {
  const pct = Math.max(0, Math.min(100, Math.round(Number(value ?? 0) * 100)));
  return (
    <div className="risk-bar">
      <span style={{ width: `${pct}%` }} />
      <strong>{pct}%</strong>
    </div>
  );
}

export default function InventoryTable({ rows = [] }) {
  const [category, setCategory] = useState("all");
  const categories = useMemo(
    () => ["all", ...new Set(rows.map((row) => row.category).filter(Boolean))],
    [rows]
  );
  const filteredRows = useMemo(
    () => (category === "all" ? rows : rows.filter((row) => row.category === category)),
    [category, rows]
  );

  return (
    <div className="stack">
      <div className="row-between">
        <div className="metric-footnote">Lot-level inventory state with risk and expiry visibility.</div>
        <label className="row" style={{ gap: 8 }}>
          <span className="metric-label">Category</span>
          <select className="inventory-filter" value={category} onChange={(event) => setCategory(event.target.value)}>
            {categories.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Table
        columns={[
          { key: "lotId", label: "Lot ID", sortable: true },
          { key: "category", label: "Category", sortable: true },
          {
            key: "quantity",
            label: "Qty",
            sortable: true,
            render: (row) => formatNumber(row.quantity),
          },
          {
            key: "hoursToExpiry",
            label: "Expiry",
            sortable: true,
            render: (row) => (
              <div className="stack" style={{ gap: 2 }}>
                <strong>{formatCountdown(row.hoursToExpiry)}</strong>
                <Badge tone={row.statusTone === "critical" ? "red" : row.statusTone === "watch" ? "amber" : "gray"}>
                  {row.statusTone}
                </Badge>
              </div>
            ),
          },
          {
            key: "currentPrice",
            label: "Current Price",
            sortable: true,
            render: (row) => currency(row.currentPrice),
          },
          {
            key: "spoilageRisk",
            label: "Spoilage Risk",
            sortable: true,
            render: (row) => <RiskBar value={row.spoilageRisk} />,
            sortValue: (row) => row.spoilageRisk ?? 0,
          },
          {
            key: "sellThroughProbability",
            label: "Sell-through",
            sortable: true,
            render: (row) => <RiskBar value={row.sellThroughProbability} />,
            sortValue: (row) => row.sellThroughProbability ?? 0,
          },
          {
            key: "stockoutRisk",
            label: "Stockout",
            sortable: true,
            render: (row) => <RiskBar value={row.stockoutRisk} />,
            sortValue: (row) => row.stockoutRisk ?? 0,
          },
        ]}
        emptyState="No inventory lots matched the current filter."
        initialSort={{ key: "hoursToExpiry", direction: "asc" }}
        rowClassName={(row) =>
          row.statusTone === "critical"
            ? "table-row-critical"
            : row.statusTone === "watch"
              ? "table-row-watch"
              : ""
        }
        rows={filteredRows}
      />
    </div>
  );
}
