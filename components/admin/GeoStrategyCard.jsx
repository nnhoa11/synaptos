"use client";

import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";

export default function GeoStrategyCard({
  archetype,
  description,
  onAddRow,
  onChange,
  onRemoveRow,
  onSuggest,
  rows = [],
}) {
  return (
    <Card>
      <Card.Header
        actions={
          <Button size="sm" variant="secondary" onClick={onSuggest}>
            Suggest with AI
          </Button>
        }
        title={archetype}
        subtitle={description}
      />
      <Card.Body>
        <div className="stack">
          {rows.map((row, index) => (
            <div className="field-row" key={`${archetype}-${index}`}>
              <label className="field">
                <span>Start</span>
                <input value={row.start_time} onChange={(event) => onChange(index, "start_time", event.target.value)} />
              </label>
              <label className="field">
                <span>End</span>
                <input value={row.end_time} onChange={(event) => onChange(index, "end_time", event.target.value)} />
              </label>
              <label className="field">
                <span>Discount %</span>
                <input value={row.discount_pct} onChange={(event) => onChange(index, "discount_pct", event.target.value)} />
              </label>
              <label className="field">
                <span>Category</span>
                <input value={row.target_category} onChange={(event) => onChange(index, "target_category", event.target.value)} />
              </label>
              <div className="row" style={{ alignItems: "flex-end" }}>
                <Button size="sm" variant="danger" onClick={() => onRemoveRow(index)}>
                  Remove
                </Button>
              </div>
            </div>
          ))}
          <Button size="sm" variant="secondary" onClick={onAddRow}>
            Add Window
          </Button>
        </div>
      </Card.Body>
    </Card>
  );
}
