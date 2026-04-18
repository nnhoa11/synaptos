import PriceTile from "@/components/eink/PriceTile";

export default function PriceGrid({ tiles = [] }) {
  return (
    <div className="price-grid">
      {tiles.map((tile) => (
        <PriceTile
          key={tile.sku_id}
          category={tile.category}
          current_price={tile.current_price}
          discount_pct={tile.discount_pct}
          flashing={tile.flashing}
          item_traffic={tile.item_traffic}
          original_price={tile.original_price}
          product_name={tile.product_name}
          quantity={tile.quantity}
          recent_velocity={tile.recent_velocity}
          status_tone={tile.status_tone}
          unit={tile.unit}
        />
      ))}
    </div>
  );
}
