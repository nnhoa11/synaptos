"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";

export default function ManagerOverrideModal({
  cartItems = [],
  managerPin,
  onApplyDiscount,
  onClose,
  open,
}) {
  const [pin, setPin] = useState("");
  const [discountPct, setDiscountPct] = useState("10");
  const [skuId, setSkuId] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (!open) {
      setPin("");
      setDiscountPct("10");
      setSkuId("");
      setStatus("");
    }
  }, [open]);

  function unlock() {
    if (pin === managerPin) {
      setStatus("unlocked");
      return;
    }

    setStatus("Incorrect PIN");
  }

  function apply() {
    const pct = Number(discountPct);
    if (pct > 50) {
      setStatus("Pending manager approval. Discounts above 50% are not auto-applied.");
      return;
    }

    onApplyDiscount?.({
      skuId,
      discountPct: pct,
    });
    onClose?.();
  }

  return (
    <Modal
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          {status === "unlocked" ? <Button onClick={apply}>Apply</Button> : <Button onClick={unlock}>Unlock</Button>}
        </>
      }
      onClose={onClose}
      open={open}
      title="Manager Override"
    >
      <div className="field-grid">
        {status === "unlocked" ? (
          <>
            <label className="field">
              <span>Cart Item</span>
              <select value={skuId} onChange={(event) => setSkuId(event.target.value)}>
                <option value="">Select item</option>
                {cartItems.map((item) => (
                  <option key={item.skuId} value={item.skuId}>
                    {item.productName}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Discount %</span>
              <input value={discountPct} onChange={(event) => setDiscountPct(event.target.value)} />
            </label>
          </>
        ) : (
          <label className="field">
            <span>4-digit PIN</span>
            <input maxLength={4} value={pin} onChange={(event) => setPin(event.target.value)} />
          </label>
        )}
        {status ? <p className="metric-footnote">{status}</p> : null}
      </div>
    </Modal>
  );
}
