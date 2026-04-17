import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";

export default function KpiCard({ label, value, footnote, tone = "blue", trend = null }) {
  return (
    <Card>
      <Card.Body>
        <div className="stack" style={{ gap: 10 }}>
          <div className="row-between">
            <p className="metric-label">{label}</p>
            {trend ? <Badge tone={tone}>{trend}</Badge> : null}
          </div>
          <div className="metric-value">{value}</div>
          {footnote ? <div className="metric-footnote">{footnote}</div> : null}
        </div>
      </Card.Body>
    </Card>
  );
}
