"use client";

import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";
import { currency } from "@/lib/prototype-core";

export default function CheckoutModal({ items = [], onClose, onConfirm, open, receipt, total }) {
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [stage, setStage] = useState("payment");

  useEffect(() => {
    if (open) {
      setStage("payment");
      setPaymentMethod("cash");
    }
  }, [open]);

  async function confirm() {
    await onConfirm?.(paymentMethod);
    setStage("receipt");
  }

  return (
    <Modal
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          {stage === "payment" ? <Button onClick={confirm}>Confirm Payment</Button> : null}
        </>
      }
      onClose={onClose}
      open={open}
      title={stage === "payment" ? "Checkout" : "Receipt"}
    >
      {stage === "payment" ? (
        <div className="stack">
          {items.map((item) => (
            <div className="row-between" key={item.skuId}>
              <span>
                {item.productName} × {item.quantity}
              </span>
              <strong>{currency(item.unitPrice * item.quantity)}</strong>
            </div>
          ))}
          <div className="row-between">
            <span>Total</span>
            <strong>{currency(total)}</strong>
          </div>
          <label className="field">
            <span>Payment</span>
            <select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>
              <option value="cash">Cash</option>
              <option value="card">Card</option>
              <option value="qr">QR</option>
            </select>
          </label>
        </div>
      ) : (
        <div className="stack" id="receipt">
          <strong>{receipt?.store_name}</strong>
          <span className="metric-footnote">{new Date(receipt?.created_at ?? Date.now()).toLocaleString()}</span>
          {(receipt?.items ?? []).map((item, index) => (
            <div className="row-between" key={`${item.sku_id ?? item.skuId}-${index}`}>
              <span>
                {item.product_name ?? item.productName ?? item.sku_id} × {item.qty ?? item.quantity}
              </span>
              <strong>{currency((item.unit_price ?? item.unitPrice ?? 0) * (item.qty ?? item.quantity ?? 0))}</strong>
            </div>
          ))}
          <div className="row-between">
            <span>Total</span>
            <strong>{currency(receipt?.total ?? total)}</strong>
          </div>
          <div className="row">
            <Button size="sm" variant="secondary" onClick={() => window.print()}>
              Print Receipt
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
