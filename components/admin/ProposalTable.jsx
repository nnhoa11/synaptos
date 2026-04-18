"use client";

import { Fragment, useMemo, useState } from "react";
import Badge from "@/components/ui/Badge";
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

function RiskMiniBar({ value = 0 }) {
  const pct = Math.max(0, Math.min(100, Math.round(Number(value ?? 0) * 100)));
  const color = pct >= 85 ? "#dc2626" : pct >= 60 ? "#d97706" : "#059669";
  return (
    <span className="risk-mini-bar">
      <span style={{ width: `${pct}%`, background: color }} />
    </span>
  );
}

function InlineAuditChain({ row }) {
  const riskScore = Number(row.metadata?.riskScore ?? 0);
  const confidence = Number(row.metadata?.confidence ?? 0);
  const discountPct = Number(row.recommendedDiscountPct ?? 0);
  const sellThrough = Number(row.metadata?.sellThroughProbability ?? 0);
  const hoursToExpiry = Number(row.metadata?.hoursToExpiry ?? 0);
  const route = row.executionRoute ?? "label";
  const outcome = row.guardrail?.outcome ?? "approved";
  const dataCitation = row.metadata?.dataCitation ?? "expiry + signals";
  const isEOL = route === "logistics";
  const isAutoDispatch = outcome === "approved" && route === "label";

  return (
    <div className="audit-chain audit-chain--inline">
      <div className="audit-step">
        <div className="audit-step-label">① Signal</div>
        <div className="audit-step-title">Expiry + Signals</div>
        <div className="audit-step-detail">
          {dataCitation}
          {hoursToExpiry > 0 ? <><br />T−{hoursToExpiry.toFixed(1)}h</> : null}
        </div>
      </div>

      <div className="audit-step">
        <div className="audit-step-label">② Risk Score</div>
        <div className="audit-step-title">Spoilage Risk</div>
        <div className="audit-step-detail">
          <div className="audit-step-value">
            {riskScore.toFixed(2)} <RiskMiniBar value={riskScore} />
          </div>
          {sellThrough > 0 ? `Sell-through: ${(sellThrough * 100).toFixed(0)}%` : `Confidence: ${(confidence * 100).toFixed(0)}%`}
        </div>
      </div>

      <div className="audit-step">
        <div className="audit-step-label">③ Guardrail</div>
        <div className="audit-step-title">
          {isEOL ? "EOL trigger" : isAutoDispatch ? "Auto-label" : "Human gate"}
        </div>
        <div className="audit-step-detail">
          {isEOL
            ? "Route: logistics\nRevoke from sales floor"
            : isAutoDispatch
              ? `Confidence ${confidence.toFixed(2)} ≥ 0.60\nDiscount ${discountPct}% ≤ 50%`
              : `Discount ${discountPct}% > limit\nApproval queue`}
        </div>
      </div>

      <div className="audit-step">
        <div className="audit-step-label">④ Execution</div>
        <div className="audit-step-title">
          {isEOL ? "Logistics Executor" : "Label Executor"}
        </div>
        <div className="audit-step-detail">
          <strong>{row.executionTask?.status ?? row.status ?? "—"}</strong>
          <br />
          {currency(row.proposedPrice)}
          {isEOL ? <><br />Tax write-off · SDG 12</> : <><br />E-ink + POS updated</>}
        </div>
      </div>
    </div>
  );
}

export default function ProposalTable({ onSelect, rows = [] }) {
  const [route, setRoute] = useState("all");
  const [outcome, setOutcome] = useState("all");
  const [minConfidence, setMinConfidence] = useState(0);
  const [expandedId, setExpandedId] = useState(null);

  const filteredRows = useMemo(
    () =>
      rows.filter((row) => {
        const confidence = Number(row.metadata?.confidence ?? 0);
        if (route !== "all" && row.executionRoute !== route) return false;
        if (outcome !== "all" && row.guardrail?.outcome !== outcome) return false;
        return confidence >= minConfidence;
      }),
    [minConfidence, outcome, route, rows]
  );

  function handleRowClick(row) {
    const id = row.id ?? row.lotId ?? row.skuName;
    setExpandedId((current) => (current === id ? null : id));
    onSelect?.(row);
  }

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

      <div className="ui-table-shell">
        <table className="ui-table">
          <thead>
            <tr>
              <th>Type</th>
              <th>SKU</th>
              <th>Route</th>
              <th>Risk</th>
              <th>Confidence</th>
              <th>Guardrail</th>
              <th>Execution</th>
              <th style={{ width: 28 }} />
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr>
                <td className="ui-table__empty" colSpan={8}>
                  No proposals matched the current filters.
                </td>
              </tr>
            ) : null}
            {filteredRows.map((row) => {
              const id = row.id ?? row.lotId ?? row.skuName;
              const isExpanded = expandedId === id;
              const showAudit = row.executionRoute !== "approval";

              return (
                <Fragment key={id}>
                  <tr
                    style={{ cursor: "pointer" }}
                    onClick={() => handleRowClick(row)}
                  >
                    <td>
                      <Badge tone="blue">{row.proposalType?.replaceAll("_", " ") ?? "—"}</Badge>
                    </td>
                    <td>{row.skuName}</td>
                    <td>
                      <Badge tone="gray">{row.executionRoute ?? "—"}</Badge>
                    </td>
                    <td>{row.metadata?.riskScore ?? 0}</td>
                    <td>
                      <ConfidenceBar value={row.metadata?.confidence ?? 0} />
                    </td>
                    <td>
                      {row.guardrail ? (
                        <Badge
                          tone={
                            row.guardrail.outcome === "blocked"
                              ? "red"
                              : row.guardrail.outcome === "requires_approval"
                                ? "amber"
                                : "green"
                          }
                        >
                          {row.guardrail.outcome.replaceAll("_", " ")}
                        </Badge>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>
                      <div className="stack" style={{ gap: 2 }}>
                        <strong>{row.executionTask?.status ?? row.status}</strong>
                        <span className="metric-footnote">{currency(row.proposedPrice)}</span>
                      </div>
                    </td>
                    <td style={{ textAlign: "center", color: "var(--muted)", fontSize: 10 }}>
                      {showAudit ? (isExpanded ? "▲" : "▼") : null}
                    </td>
                  </tr>
                  {isExpanded && showAudit ? (
                    <tr>
                      <td colSpan={8} style={{ padding: 0, background: "#f7f8fa" }}>
                        <InlineAuditChain row={row} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
