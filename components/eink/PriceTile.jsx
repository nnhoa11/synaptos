import { currency } from "@/lib/prototype-core";

export default function PriceTile({
  current_price,
  discount_pct,
  flashing = false,
  original_price,
  product_name,
  unit,
}) {
  return (
    <article className={`price-tile ${discount_pct ? "on-sale" : ""} ${flashing ? "flashing" : ""}`}>
      <div className="product-name">{product_name}</div>
      <div className="current-price">{currency(current_price)}</div>
      <div className="metric-footnote" style={{ color: discount_pct ? "#fee2e2" : "#6b7280" }}>
        {unit}
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
