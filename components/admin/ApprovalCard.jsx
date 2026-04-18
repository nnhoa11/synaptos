import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import { currency } from "@/lib/prototype-core";
import { formatCountdown } from "@/lib/ui-format";

function RiskMiniBar({ value = 0 }) {
  const pct = Math.max(0, Math.min(100, Math.round(Number(value ?? 0) * 100)));
  const color = pct >= 85 ? "#dc2626" : pct >= 60 ? "#d97706" : "#059669";
  return (
    <span className="risk-mini-bar">
      <span style={{ width: `${pct}%`, background: color }} />
    </span>
  );
}

function AuditChain({ proposal }) {
  const riskScore = Number(proposal.metadata?.riskScore ?? proposal.riskScore ?? 0);
  const confidence = Number(proposal.metadata?.confidence ?? proposal.confidence ?? 0);
  const discountPct = Number(proposal.recommendedDiscountPct ?? 0);
  const sellThrough = Number(proposal.metadata?.sellThroughProbability ?? 0);
  const hoursToExpiry = Number(proposal.metadata?.hoursToExpiry ?? 0);
  const route = proposal.executionRoute ?? "approval";
  const outcome = proposal.guardrail?.outcome ?? "requires_approval";
  const matchedRule = proposal.guardrail?.matchedRule ?? "human_gate";
  const dataCitation = proposal.metadata?.dataCitation ?? "expiry + signals";
  const isEOL = route === "logistics" || proposal.proposalType === "unsaleable";
  const isAutoDispatch = outcome === "approved" && route === "label";

  return (
    <div className="audit-chain">
      <div className="audit-step">
        <div className="audit-step-label">① Signal</div>
        <div className="audit-step-title">Expiry + Signals</div>
        <div className="audit-step-detail">
          {dataCitation}
          {hoursToExpiry > 0 ? <><br />T−{hoursToExpiry.toFixed(1)}h to expiry</> : null}
        </div>
      </div>

      <div className="audit-step">
        <div className="audit-step-label">② Risk Score</div>
        <div className="audit-step-title">Spoilage Risk</div>
        <div className="audit-step-detail">
          <div className="audit-step-value">
            {riskScore.toFixed(2)}
            <RiskMiniBar value={riskScore} />
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
            ? "T−4h + unsaleable\nRoute: logistics"
            : isAutoDispatch
              ? `Confidence ${confidence.toFixed(2)} ≥ 0.60\nDiscount ${discountPct}% ≤ 50%`
              : `Discount ${discountPct}% > 50% limit\nRouted to approval queue`}
        </div>
      </div>

      <div className="audit-step">
        <div className="audit-step-label">④ {isAutoDispatch ? "Execution" : isEOL ? "Execution" : "Waiting"}</div>
        <div className="audit-step-title">
          {isEOL ? "Logistics Executor" : isAutoDispatch ? "Label Executor" : "Pending manager"}
        </div>
        <div className="audit-step-detail">
          {isEOL ? (
            <>Tax write-off filed<br />SDG 12 routed</>
          ) : isAutoDispatch ? (
            <>
              {currency(proposal.metadata?.basePrice ?? proposal.proposedPrice)} → {currency(proposal.proposedPrice)}
              <br />E-ink + POS updated
            </>
          ) : (
            <div className="ai-rationale">
              <strong>AI rationale:</strong> {proposal.rationale}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ApprovalCard({ busy = false, onApprove, onReject, proposal }) {
  const discountPct = Number(proposal.recommendedDiscountPct ?? 0);

  return (
    <Card style={{ borderColor: "#fde68a", background: "#fffbf5" }}>
      <Card.Body>
        <div className="stack">
          <div className="row-between">
            <div className="stack" style={{ gap: 2 }}>
              <strong>{proposal.skuName}</strong>
              <span className="metric-footnote">
                {proposal.lotId} · {proposal.metadata?.category ?? "unknown"}
              </span>
              <span className="metric-footnote">
                T−{formatCountdown(proposal.metadata?.hoursToExpiry ?? 0)} to expiry
              </span>
            </div>
            <div className="stack" style={{ gap: 6, alignItems: "flex-end" }}>
              <Badge tone="amber">−{discountPct}% markdown</Badge>
              <span className="approval-flag">⚠ Manager Review Required</span>
            </div>
          </div>

          <AuditChain proposal={proposal} />

          <div className="approval-actions">
            <button className="btn-approve" disabled={busy} onClick={() => onApprove?.(proposal)} type="button">
              ✓ Approve −{discountPct}%
            </button>
            <button className="btn-modify" disabled={busy} type="button">
              Edit discount
            </button>
            <button className="btn-reject" disabled={busy} onClick={() => onReject?.(proposal)} type="button">
              ✗ Reject
            </button>
          </div>
        </div>
      </Card.Body>
    </Card>
  );
}
