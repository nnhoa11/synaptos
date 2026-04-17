"use client";

import { useDeferredValue, useMemo, useState } from "react";
import ProductCard from "@/components/pos/ProductCard";

export default function ProductGrid({ onAddToCart, products = [] }) {
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const filteredProducts = useMemo(() => {
    const query = deferredSearch.trim().toLowerCase();
    if (!query) {
      return products;
    }

    return products.filter(
      (product) =>
        String(product.productName ?? "").toLowerCase().includes(query) ||
        String(product.skuId ?? "").toLowerCase().includes(query)
    );
  }, [deferredSearch, products]);

  function handleSubmit(event) {
    event.preventDefault();
    const query = search.trim().toLowerCase();
    if (!query) {
      return;
    }

    const match = products.find(
      (product) =>
        String(product.skuId ?? "").toLowerCase() === query ||
        String(product.productName ?? "").toLowerCase() === query
    );
    if (match) {
      onAddToCart?.(match.skuId);
      setSearch("");
    }
  }

  return (
    <div className="stack">
      <form className="row" onSubmit={handleSubmit}>
        <input
          className="inventory-filter"
          placeholder="Search by name or scan SKU"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </form>
      <div className="product-grid">
        {filteredProducts.map((product) => (
          <ProductCard
            key={product.skuId}
            current_price={product.currentPrice}
            discount_pct={product.discountPct}
            expiry_iso={product.expiryIso}
            original_price={product.originalPrice}
            product_name={product.productName}
            quantity={product.quantity}
            sku_id={product.skuId}
            unit={product.unit}
            onClick={onAddToCart}
          />
        ))}
      </div>
    </div>
  );
}
