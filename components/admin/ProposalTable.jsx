"use client";

import { useMemo, useState } from "react";
import Badge from "@/components/ui/Badge";
import Table from "@/components/ui/Table";
import { currency } from "@/lib/prototype-core";

function ConfidenceBar({ value = 0 }) {
  const pct = Math.max(0, Math.min(100, Math.round(Number(value ?? 0) * 100)));
  return (
    <div className="risk-bar">
      <span style={{ width: `${pct}%` }} />
      <strong>{pct}%</strong>
    </div>
  );
}

export default function ProposalTable({ onSelect, rows = [] }) {
  const [route, setRoute] = useState("all");
  const [outcome, setOutcome] = useState("all");
  const [minConfidence, setMinConfidence] = useState(0);

  const filteredRows = useMemo(
    () =>
      rows.filter((row) => {
        const confidence = Number(row.metadata?.confidence ?? 0);
        if (route !== "all" && row.executionRoute !== route) {
          return false;
        }
        if (outcome !== "all" && row.guardrail?.outcome !== outcome) {
          return false;
        }
        return confidence >= minConfidence;
      }),
    [minConfidence, outcome, route, rows]
  );

  return (
    <div className="stack">
      <div className="filter-bar">
        <label className="field">
          <span>Route</span>
          <select value={route} onChange={(event) => setRoute(event.target.value)}>
            <option value="all">All routes</option>
            <option value="label">Label</option>
            <option value="approval">Approval</option>
            <option value="logistics">Logistics</option>
            <option value="procurement">Procurement</option>
          </select>
        </label>
        <label className="field">
          <span>Guardrail</span>
          <select value={outcome} onChange={(event) => setOutcome(event.target.value)}>
            <option value="all">All outcomes</option>
            <option value="approved">Approved</option>
            <option value="requires_approval">Requires approval</option>
            <option value="blocked">Blocked</option>
          </select>
        </label>
        <label className="field">
          <span>Min confidence</span>
          <input
            max="1"
            min="0"
            onChange={(event) => setMinConfidence(Number(event.target.value))}
            step="0.05"
            type="range"
            value={minConfidence}
          />
        </label>
      </div>
      <Table
        columns={[
          {
            key: "proposalType",
            label: "Type",
            sortable: true,
            render: (row) => <Badge tone="blue">{row.proposalType.replaceAll("_", " ")}</Badge>,
          },
          { key: "skuName", label: "SKU", sortable: true },
          {
            key: "executionRoute",
            label: "Route",
            sortable: true,
            render: (row) => <Badge tone="gray">{row.executionRoute}</Badge>,
          },
          {
            key: "riskClass",
            label: "Risk",
            sortable: true,
            sortValue: (row) => row.metadata?.riskScore ?? 0,
            render: (row) => `${row.metadata?.riskScore ?? 0}`,
          },
          {
            key: "confidence",
            label: "Confidence",
            sortable: true,
            sortValue: (row) => row.metadata?.confidence ?? 0,
            render: (row) => <ConfidenceBar value={row.metadata?.confidence ?? 0} />,
          },
          {
            key: "guardrailOutcome",
            label: "Guardrail",
            sortable: true,
            sortValue: (row) => row.guardrail?.outcome ?? "",
            render: (row) =>
              row.guardrail ? (
                <Badge tone={row.guardrail.outcome === "blocked" ? "red" : row.guardrail.outcome === "requires_approval" ? "amber" : "green"}>
                  {row.guardrail.outcome.replaceAll("_", " ")}
                </Badge>
              ) : (
                "—"
              ),
          },
          {
            key: "status",
            label: "Execution",
            sortable: true,
            render: (row) => (
              <div className="stack" style={{ gap: 2 }}>
                <strong>{row.executionTask?.status ?? row.status}</strong>
                <span className="metric-footnote">{currency(row.proposedPrice)}</span>
              </div>
            ),
          },
        ]}
        emptyState="No proposals matched the current filters."
        onRowClick={(row) => onSelect?.(row)}
        rows={filteredRows}
      />
    </div>
  );
}
