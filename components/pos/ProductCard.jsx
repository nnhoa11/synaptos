import Badge from "@/components/ui/Badge";
import Card from "@/components/ui/Card";
import { currency } from "@/lib/prototype-core";
import { formatCountdown } from "@/lib/ui-format";

export default function ProductCard({
  category,
  current_price,
  discount_pct,
  expiry_iso,
  item_traffic,
  onClick,
  original_price,
  product_name,
  quantity,
  recent_velocity,
  sku_id,
  status_tone,
  unit,
}) {
  const hoursToExpiry = expiry_iso ? (new Date(expiry_iso).getTime() - Date.now()) / 3.6e6 : null;
  const tone = status_tone === "critical" ? "red" : status_tone === "watch" ? "amber" : "blue";

  return (
    <button className="product-card-button" onClick={() => onClick?.(sku_id)} type="button">
      <Card className="product-card">
        <Card.Body>
          <div className="stack" style={{ gap: 8 }}>
            <div className="row-between">
              <strong>{product_name}</strong>
              <div className="row" style={{ gap: 6 }}>
                {category ? <Badge tone="gray">{category}</Badge> : null}
                {discount_pct ? <Badge tone="red">Sale {discount_pct}%</Badge> : null}
              </div>
            </div>
            <div className="metric-footnote">
              {unit} | Qty {quantity}
            </div>
            <div className="stack" style={{ gap: 2 }}>
              <strong style={{ fontSize: 20 }}>{currency(current_price)}</strong>
              {discount_pct ? <span className="metric-footnote">{currency(original_price)}</span> : null}
            </div>
            <div className="row-between" style={{ gap: 8 }}>
              <span className="metric-footnote">Traffic {Number(item_traffic ?? 0).toFixed(2)}</span>
              <Badge tone={tone}>Velocity {Number(recent_velocity ?? 0).toFixed(1)}</Badge>
            </div>
            <span className="metric-footnote">
              Expiry {hoursToExpiry != null ? formatCountdown(hoursToExpiry) : "n/a"}
            </span>
          </div>
        </Card.Body>
      </Card>
    </button>
  );
}
