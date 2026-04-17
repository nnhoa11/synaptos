import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import { currency } from "@/lib/prototype-core";
import { formatCountdown } from "@/lib/ui-format";

export default function ApprovalCard({ busy = false, onApprove, onReject, proposal }) {
  return (
    <Card>
      <Card.Body>
        <div className="stack">
          <div className="row-between">
            <div className="stack" style={{ gap: 2 }}>
              <strong>{proposal.skuName}</strong>
              <span className="metric-footnote">
                {proposal.lotId} · {proposal.metadata.category ?? "unknown"}
              </span>
            </div>
            <Badge tone="amber">{proposal.recommendedDiscountPct}%</Badge>
          </div>
          <div className="row-between">
            <div className="stack" style={{ gap: 2 }}>
              <span className="metric-footnote">Hours to expiry</span>
              <strong>{formatCountdown(proposal.metadata.hoursToExpiry ?? 0)}</strong>
            </div>
            <div className="stack" style={{ gap: 2, textAlign: "right" }}>
              <span className="metric-footnote">Price change</span>
              <strong>
                {currency(proposal.metadata.basePrice ?? proposal.proposedPrice)} → {currency(proposal.proposedPrice)}
              </strong>
            </div>
          </div>
          <p className="metric-footnote">{proposal.rationale}</p>
          <div className="row">
            <Badge tone="gray">{proposal.guardrail?.matchedRule ?? "guardrail"}</Badge>
            <Badge tone="blue">{proposal.metadata.dataCitation ?? "data citation"}</Badge>
          </div>
          <div className="row">
            <Button disabled={busy} onClick={() => onApprove?.(proposal)}>
              Approve
            </Button>
            <Button disabled={busy} variant="danger" onClick={() => onReject?.(proposal)}>
              Reject
            </Button>
          </div>
        </div>
      </Card.Body>
    </Card>
  );
}
