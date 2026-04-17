import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import { formatAuditTime } from "@/lib/prototype-core";
import { toneFromFreshness } from "@/lib/ui-format";

function provenanceTone(provenance) {
  if (provenance === "live") {
    return "green";
  }
  if (provenance === "cached") {
    return "amber";
  }
  return "gray";
}

export default function SignalFreshnessPanel({ observations = [] }) {
  return (
    <Card>
      <Card.Header
        title="Signal Freshness"
        subtitle="Weather, commodity, and district data sources for the current store."
      />
      <Card.Body>
        <div className="stack" style={{ gap: 10 }}>
          {observations.length ? (
            observations.map((observation) => (
              <div className="signal-row" key={`${observation.sourceType}-${observation.observedAt}`}>
                <div className="stack" style={{ gap: 2 }}>
                  <strong>{observation.sourceType.replaceAll("_", " ")}</strong>
                  <span className="metric-footnote">Last crawled {formatAuditTime(observation.observedAt)}</span>
                </div>
                <div className="row" style={{ justifyContent: "flex-end" }}>
                  <Badge tone={provenanceTone(observation.provenance)}>{observation.provenance}</Badge>
                  <Badge tone={toneFromFreshness(observation.freshnessStatus)}>{observation.freshnessStatus}</Badge>
                </div>
              </div>
            ))
          ) : (
            <div className="empty-state">
              <p className="empty-state__copy">No external source observations are persisted for this store yet.</p>
            </div>
          )}
        </div>
      </Card.Body>
    </Card>
  );
}
