"use client";

import { useEffect, useState } from "react";
import Badge from "@/components/ui/Badge";
import Card from "@/components/ui/Card";
import { formatAuditTime } from "@/lib/prototype-core";
import { toneFromStatus } from "@/lib/ui-format";

const EVENT_TYPES = [
  "session.ready",
  "run.completed",
  "recommendation.updated",
  "label.updated",
  "price.updated",
  "calibration.recorded",
  "import.completed",
  "import.failed",
  "aggregation.completed",
  "agent.completed",
  "model_run.updated",
  "proposal.updated",
  "approval.updated",
  "execution.updated",
  "logistics.updated",
  "procurement.updated",
  "pipeline.agent.start",
  "pipeline.agent.done",
  "pipeline.failed",
  "pipeline.done",
];

function normalizeEvent(event) {
  return {
    id: event.id ?? crypto.randomUUID(),
    type: event.type ?? "message",
    at: event.at ?? new Date().toISOString(),
    storeId: event.storeId ?? event.store_id ?? null,
    message:
      event.message ??
      event.reason ??
      `${String(event.type ?? "event").replaceAll(".", " ")}${event.status ? ` (${event.status})` : ""}`.trim(),
  };
}

export default function AlertFeed({ embedded = false, storeId = null }) {
  const [events, setEvents] = useState([]);

  useEffect(() => {
    const source = new EventSource("/api/events");
    const appendEvent = (message) => {
      const next = normalizeEvent(JSON.parse(message.data));

      if (storeId && next.storeId && next.storeId !== storeId) {
        return;
      }

      setEvents((current) => [next, ...current].slice(0, 10));
    };

    for (const eventType of EVENT_TYPES) {
      source.addEventListener(eventType, appendEvent);
    }

    return () => {
      for (const eventType of EVENT_TYPES) {
        source.removeEventListener(eventType, appendEvent);
      }
      source.close();
    };
  }, [storeId]);

  const content = events.length ? (
    <div className="stack" style={{ gap: 10 }}>
      {events.map((event) => (
        <article className="alert-row" key={event.id}>
          <div className="stack" style={{ gap: 4 }}>
            <strong>{event.message}</strong>
            <span className="metric-footnote">
              {formatAuditTime(event.at)}
              {event.storeId ? ` | ${event.storeId}` : ""}
            </span>
          </div>
          <Badge tone={toneFromStatus(event.type.includes("failed") ? "failed" : "completed")}>
            {event.type.replaceAll(".", " ")}
          </Badge>
        </article>
      ))}
    </div>
  ) : (
    <div className="empty-state">
      <p className="empty-state__copy">Live alerts will appear here once the engine or operators emit events.</p>
    </div>
  );

  if (embedded) {
    return content;
  }

  return (
    <Card>
      <Card.Header title="Alert Feed" subtitle="Live operations, approvals, and pipeline notifications." />
      <Card.Body>{content}</Card.Body>
    </Card>
  );
}
