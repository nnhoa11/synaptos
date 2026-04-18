"use client";

import { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import CheckoutModal from "@/components/pos/CheckoutModal";
import CartPanel from "@/components/pos/CartPanel";
import ManagerOverrideModal from "@/components/pos/ManagerOverrideModal";
import POSHeader from "@/components/pos/POSHeader";
import ProductGrid from "@/components/pos/ProductGrid";
import ShrinkageModal from "@/components/pos/ShrinkageModal";
import Modal from "@/components/ui/Modal";
import { fetchJson } from "@/lib/fetch-json";

export default function POSApp({ storeId }) {
  const [storefront, setStorefront] = useState(null);
  const [cart, setCart] = useState([]);
  const [connectionStatus, setConnectionStatus] = useState("connecting");
  const [clientCount, setClientCount] = useState(null);
  const [eventTicker, setEventTicker] = useState(null);
  const [lastUpdatedSkuId, setLastUpdatedSkuId] = useState(null);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [shrinkageOpen, setShrinkageOpen] = useState(false);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [managerPin, setManagerPin] = useState("1234");
  const [cashier, setCashier] = useState("Cashier");
  const [shiftSummaryOpen, setShiftSummaryOpen] = useState(false);

  useEffect(() => {
    fetchJson(`/api/storefront?storeId=${encodeURIComponent(storeId)}`).then(setStorefront).catch(() => {});
    fetchJson("/api/settings")
      .then((payload) => setManagerPin(payload.pipeline?.managerPin ?? "1234"))
      .catch(() => {});
    fetchJson("/api/auth/session")
      .then((payload) => setCashier(payload.user?.name ?? "Cashier"))
      .catch(() => {});

    const socket = io({ query: { storeId } });
    socket.on("connect", () => setConnectionStatus("connected"));
    socket.on("disconnect", () => setConnectionStatus("reconnecting"));
    socket.on("room:meta", (meta) => setClientCount(meta.clientCount ?? null));
    socket.on("price-update", (payload) => {
      setStorefront((current) => {
        if (!current) return current;
        const updated = current.products.find((p) => p.skuId === payload.sku_id);
        if (updated) {
          setEventTicker({
            skuName: updated.productName,
            oldPrice: updated.currentPrice,
            newPrice: payload.current_price,
            timestamp: new Date().toLocaleTimeString(),
          });
          setLastUpdatedSkuId(payload.sku_id);
          setTimeout(() => {
            setEventTicker(null);
            setLastUpdatedSkuId(null);
          }, 3000);
        }
        return {
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
                  sellThroughProbability: payload.sell_through_probability ?? product.sellThroughProbability,
                  stockoutRisk: payload.stockout_risk ?? product.stockoutRisk,
                  spoilageRisk: payload.spoilage_risk ?? product.spoilageRisk,
                  statusTone: payload.status_tone ?? product.statusTone,
                  snapshotKey: payload.snapshot_key ?? product.snapshotKey,
                }
              : product
          ),
        };
      });
      setCart((current) =>
        current.map((item) =>
          item.skuId === payload.sku_id && !item.manualOverride
            ? {
                ...item,
                unitPrice: payload.current_price,
                originalPrice: payload.original_price,
                discountPct: payload.discount_pct,
              }
            : item
        )
      );
    });

    return () => socket.disconnect();
  }, [storeId]);

  const total = useMemo(
    () => cart.reduce((sum, item) => sum + Number(item.unitPrice) * Number(item.quantity), 0),
    [cart]
  );

  function addToCart(skuId) {
    const product = storefront?.products.find((item) => item.skuId === skuId);
    if (!product) {
      return;
    }

    setCart((current) => {
      const existing = current.find((item) => item.skuId === skuId);
      if (existing) {
        return current.map((item) =>
          item.skuId === skuId ? { ...item, quantity: item.quantity + 1 } : item
        );
      }

      return [
        ...current,
        {
          skuId,
          productName: product.productName,
          quantity: 1,
          unitPrice: product.currentPrice,
          originalPrice: product.originalPrice,
          discountPct: product.discountPct,
          manualOverride: false,
        },
      ];
    });
  }

  function changeQty(skuId, quantity) {
    if (quantity <= 0) {
      setCart((current) => current.filter((item) => item.skuId !== skuId));
      return;
    }

    setCart((current) =>
      current.map((item) => (item.skuId === skuId ? { ...item, quantity } : item))
    );
  }

  async function confirmCheckout() {
    const payload = await fetchJson("/api/pos/transaction", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storeId,
        cashier,
        items: cart.map((item) => ({
          sku_id: item.skuId,
          product_name: item.productName,
          qty: item.quantity,
          unit_price: item.unitPrice,
        })),
        total,
      }),
    });

    setReceipt(payload.receipt_data);
    setCart([]);
    setStorefront(await fetchJson(`/api/storefront?storeId=${encodeURIComponent(storeId)}`));
  }

  function applyManagerDiscount({ discountPct, skuId }) {
    setCart((current) =>
      current.map((item) =>
        item.skuId === skuId
          ? {
              ...item,
              unitPrice: Math.round(item.originalPrice * (1 - discountPct / 100)),
              discountPct,
              manualOverride: true,
            }
          : item
      )
    );
  }

  return (
    <div className="pos-page">
      <POSHeader
        address={storefront?.store?.address}
        cashier={cashier}
        clientCount={clientCount}
        connectionStatus={connectionStatus}
        onEndShift={() => setShiftSummaryOpen(true)}
        onManagerOverride={() => setOverrideOpen(true)}
        storeId={storeId}
        storeName={storefront?.store?.name ?? storeId}
      />
      {connectionStatus === "reconnecting" ? (
        <div className="reconnecting-bar">
          <span className="pipeline-dot is-amber" />
          Reconnecting to {storeId} store room… Prices shown may be out of date.
        </div>
      ) : null}
      <div className="pos-layout">
        <div className="pos-product-grid">
          {eventTicker ? (
            <div className="event-ticker">
              <span>↓ price-update</span>
              <strong>{eventTicker.skuName}</strong>
              <span className="event-ticker__old">{eventTicker.oldPrice?.toLocaleString()}</span>
              <span>→</span>
              <span className="event-ticker__new">{eventTicker.newPrice?.toLocaleString()} VND</span>
              <span className="metric-footnote">{eventTicker.timestamp}</span>
            </div>
          ) : null}
          <ProductGrid
            lastUpdatedSkuId={lastUpdatedSkuId}
            onAddToCart={addToCart}
            products={storefront?.products ?? []}
          />
        </div>
        <CartPanel
          items={cart}
          total={total}
          onChangeQty={changeQty}
          onCheckout={() => setCheckoutOpen(true)}
          onClear={() => setCart([])}
          onRemove={(skuId) => setCart((current) => current.filter((item) => item.skuId !== skuId))}
          onShrinkage={() => setShrinkageOpen(true)}
        />
      </div>

      <CheckoutModal
        items={cart}
        onClose={() => {
          setCheckoutOpen(false);
          setReceipt(null);
        }}
        onConfirm={confirmCheckout}
        open={checkoutOpen}
        receipt={receipt}
        total={total}
      />
      <ShrinkageModal
        onClose={() => setShrinkageOpen(false)}
        open={shrinkageOpen}
        products={storefront?.products ?? []}
        snapshotKey={storefront?.snapshotKey}
        storeId={storeId}
      />
      <ManagerOverrideModal
        cartItems={cart}
        managerPin={managerPin}
        onApplyDiscount={applyManagerDiscount}
        onClose={() => setOverrideOpen(false)}
        open={overrideOpen}
      />
      <Modal onClose={() => setShiftSummaryOpen(false)} open={shiftSummaryOpen} title="Shift Summary">
        <div className="stack">
          <strong>Transactions handled in current session</strong>
          <span className="metric-footnote">Cart items: {cart.length}</span>
          <span className="metric-footnote">Current open total: {total}</span>
        </div>
      </Modal>
    </div>
  );
}
