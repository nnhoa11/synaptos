import Badge from "@/components/ui/Badge";
import Card from "@/components/ui/Card";
import { currency } from "@/lib/prototype-core";
import { formatCountdown } from "@/lib/ui-format";

export default function ProductCard({
  current_price,
  discount_pct,
  expiry_iso,
  onClick,
  original_price,
  product_name,
  quantity,
  sku_id,
  unit,
}) {
  const hoursToExpiry = expiry_iso ? (new Date(expiry_iso).getTime() - Date.now()) / 3.6e6 : null;

  return (
    <button className="product-card-button" onClick={() => onClick?.(sku_id)} type="button">
      <Card className="product-card">
        <Card.Body>
          <div className="stack" style={{ gap: 8 }}>
            <div className="row-between">
              <strong>{product_name}</strong>
              {discount_pct ? <Badge tone="red">Sale {discount_pct}%</Badge> : null}
            </div>
            <div className="metric-footnote">
              {unit} · Qty {quantity}
            </div>
            <div className="stack" style={{ gap: 2 }}>
              <strong style={{ fontSize: 20 }}>{currency(current_price)}</strong>
              {discount_pct ? <span className="metric-footnote">{currency(original_price)}</span> : null}
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
