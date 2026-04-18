import { currency } from "@/lib/prototype-core";

export default function PriceTile({
  category,
  current_price,
  discount_pct,
  flashing = false,
  item_traffic,
  original_price,
  product_name,
  quantity,
  recent_velocity,
  status_tone,
  unit,
}) {
  return (
    <article className={`price-tile ${discount_pct ? "on-sale" : ""} ${flashing ? "flashing" : ""}`}>
      <div className="product-name">{product_name}</div>
      <div className="current-price">{currency(current_price)}</div>
      <div className="metric-footnote" style={{ color: discount_pct ? "#fee2e2" : "#6b7280" }}>
        {category ? `${category} | ` : ""}
        {unit}
      </div>
      <div className="metric-footnote" style={{ color: discount_pct ? "#fee2e2" : "#9ca3af" }}>
        Qty {quantity ?? "-"} | Traffic {Number(item_traffic ?? 0).toFixed(2)}
      </div>
      <div className="metric-footnote" style={{ color: discount_pct ? "#fee2e2" : "#9ca3af" }}>
        Velocity {Number(recent_velocity ?? 0).toFixed(1)} | {status_tone ?? "normal"}
      </div>
      {discount_pct ? (
        <>
          <div className="original-price">{currency(original_price)}</div>
          <div className="discount-badge">SALE {discount_pct}%</div>
        </>
      ) : null}
    </article>
  );
}
