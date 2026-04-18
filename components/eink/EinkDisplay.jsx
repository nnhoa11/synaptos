"use client";

import { useEffect, useState } from "react";
import { io } from "socket.io-client";
import EinkHeader from "@/components/eink/EinkHeader";
import PriceGrid from "@/components/eink/PriceGrid";
import { fetchJson } from "@/lib/fetch-json";

function mapProduct(product) {
  return {
    sku_id: product.skuId,
    product_name: product.productName,
    category: product.category,
    current_price: product.currentPrice,
    original_price: product.originalPrice,
    discount_pct: product.discountPct,
    quantity: product.quantity,
    item_traffic: product.itemTraffic,
    recent_velocity: product.recentVelocity,
    status_tone: product.statusTone,
    unit: product.unit,
    flashing: Boolean(product.flashing),
  };
}

export default function EinkDisplay({ storeId }) {
  const [storefront, setStorefront] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState("connecting");

  useEffect(() => {
    fetchJson(`/api/storefront?storeId=${encodeURIComponent(storeId)}`).then(setStorefront).catch(() => {});

    const socket = io({ query: { storeId } });
    socket.on("connect", () => setConnectionStatus("connected"));
    socket.on("disconnect", () => setConnectionStatus("reconnecting"));
    socket.on("price-update", (payload) => {
      setStorefront((current) =>
        current
          ? {
              ...current,
              products: current.products.map((product) =>
                product.skuId === payload.sku_id
                  ? {
                      ...product,
                      currentPrice: payload.current_price,
                      originalPrice: payload.original_price,
                      discountPct: payload.discount_pct,
                      quantity: payload.quantity ?? product.quantity,
                      category: payload.category ?? product.category,
                      itemTraffic: payload.item_traffic ?? product.itemTraffic,
                      recentVelocity: payload.recent_velocity ?? product.recentVelocity,
                      statusTone: payload.status_tone ?? product.statusTone,
                      flashing: true,
                    }
                  : product
              ),
            }
          : current
      );

      setTimeout(() => {
        setStorefront((current) =>
          current
            ? {
                ...current,
                products: current.products.map((product) =>
                  product.skuId === payload.sku_id ? { ...product, flashing: false } : product
                ),
              }
            : current
        );
      }, 600);
    });

    return () => socket.disconnect();
  }, [storeId]);

  return (
    <div className="eink-page">
      <EinkHeader connectionStatus={connectionStatus} storeName={storefront?.store?.name ?? storeId} />
      <PriceGrid tiles={(storefront?.products ?? []).map(mapProduct)} />
    </div>
  );
}
