"use client";

import { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import { toneFromStatus } from "@/lib/ui-format";

const STAGES = ["ingestion", "aggregation", "risk_scoring", "recommendation", "campaign", "guardrails", "done"];

export default function PipelineProgress({ onClose, open, storeId }) {
  const [events, setEvents] = useState([]);

  useEffect(() => {
    if (!open || !storeId) {
      setEvents([]);
      return undefined;
    }

    const socket = io({ query: { storeId } });
    socket.on("pipeline", (event) => {
      setEvents((current) => [...current, event]);
    });

    return () => socket.disconnect();
  }, [open, storeId]);

  const stageMap = useMemo(() => {
    const summary = new Map(STAGES.map((stage) => [stage, { status: "pending", at: null }]));
    for (const event of events) {
      if (!event?.step || !summary.has(event.step)) {
        continue;
      }
      summary.set(event.step, {
        status: event.status ?? "pending",
        at: event.at ?? null,
        meta: event,
      });
    }
    return summary;
  }, [events]);

  if (!open) {
    return null;
  }

  return (
    <div className="pipeline-overlay">
      <Card className="pipeline-card">
        <Card.Header
          actions={
            <Button size="sm" variant="ghost" onClick={onClose}>
              Close
            </Button>
          }
          title="Pipeline Progress"
          subtitle={`Live socket stream for ${storeId}`}
        />
        <Card.Body>
          <div className="stack" style={{ gap: 10 }}>
            {STAGES.map((stage) => {
              const current = stageMap.get(stage);
              return (
                <div className="pipeline-row" key={stage}>
                  <div className="row" style={{ flexWrap: "nowrap" }}>
                    <span className={`pipeline-dot is-${toneFromStatus(current?.status)}`} />
                    <strong>{stage.replaceAll("_", " ")}</strong>
                  </div>
                  <span className="metric-footnote">{current?.status ?? "pending"}</span>
                </div>
              );
            })}
          </div>
        </Card.Body>
      </Card>
    </div>
  );
}
