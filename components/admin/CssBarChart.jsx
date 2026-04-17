import { formatPercent } from "@/lib/ui-format";

export default function CssBarChart({ formatValue = null, rows = [], title = null }) {
  const max = Math.max(1, ...rows.map((row) => Number(row.value ?? 0)));

  return (
    <div className="stack" style={{ gap: 10 }}>
      {title ? <strong>{title}</strong> : null}
      {rows.map((row) => (
        <div className="chart-row" key={row.label}>
          <div className="row-between">
            <span>{row.label}</span>
            <strong>{formatValue ? formatValue(row.value) : formatPercent(row.value, 1)}</strong>
          </div>
          <div className="chart-bar">
            <span style={{ width: `${Math.max(4, (Number(row.value ?? 0) / max) * 100)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
