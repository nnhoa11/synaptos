import PriceTile from "@/components/eink/PriceTile";

export default function PriceGrid({ tiles = [] }) {
  return (
    <div className="price-grid">
      {tiles.map((tile) => (
        <PriceTile
          key={tile.sku_id}
          current_price={tile.current_price}
          discount_pct={tile.discount_pct}
          flashing={tile.flashing}
          original_price={tile.original_price}
          product_name={tile.product_name}
          unit={tile.unit}
        />
      ))}
    </div>
  );
}
