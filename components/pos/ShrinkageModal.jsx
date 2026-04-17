"use client";

import { useEffect, useMemo, useState } from "react";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";
import { fetchJson } from "@/lib/fetch-json";

export default function ShrinkageModal({ onClose, open, products = [], snapshotKey, storeId }) {
  const [skuId, setSkuId] = useState("");
  const [physicalCount, setPhysicalCount] = useState("");
  const [reason, setReason] = useState("count_variance");
  const [history, setHistory] = useState([]);
  const selected = useMemo(() => products.find((product) => product.skuId === skuId) ?? null, [products, skuId]);

  useEffect(() => {
    if (!open || !storeId) {
      return;
    }

    fetchJson(`/api/calibration?storeId=${encodeURIComponent(storeId)}`)
      .then((payload) => setHistory(payload.slice(0, 5)))
      .catch(() => {});
  }, [open, storeId]);

  async function submit() {
    if (!selected || !snapshotKey) {
      return;
    }

    const systemCount = Number(selected.quantity ?? 0);
    const physical = Number(physicalCount ?? 0);
    const shrinkageUnits = Math.max(0, systemCount - physical);

    await fetchJson("/api/calibration", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storeId,
        skuKey: selected.productName,
        shrinkageUnits,
        spoiledUnits: reason === "spoilage" ? shrinkageUnits : 0,
        notes: `POS shrinkage capture · ${reason}`,
        snapshot: snapshotKey,
      }),
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
          <Button onClick={submit}>Submit</Button>
        </>
      }
      onClose={onClose}
      open={open}
      title="Shrinkage Input"
    >
      <div className="field-grid">
        <label className="field">
          <span>Item</span>
          <select value={skuId} onChange={(event) => setSkuId(event.target.value)}>
            <option value="">Select item</option>
            {products.map((product) => (
              <option key={product.skuId} value={product.skuId}>
                {product.productName}
              </option>
            ))}
          </select>
        </label>
        <div className="field-row">
          <label className="field">
            <span>System count</span>
            <input disabled value={selected?.quantity ?? ""} />
          </label>
          <label className="field">
            <span>Physical count</span>
            <input value={physicalCount} onChange={(event) => setPhysicalCount(event.target.value)} />
          </label>
        </div>
        <label className="field">
          <span>Reason</span>
          <select value={reason} onChange={(event) => setReason(event.target.value)}>
            <option value="count_variance">Count variance</option>
            <option value="spoilage">Spoilage</option>
            <option value="damage">Damage</option>
          </select>
        </label>
        <div className="stack">
          <strong>Recent entries</strong>
          {history.map((entry) => (
            <div className="metric-footnote" key={entry.id}>
              {entry.skuKey} · {entry.shrinkageUnits + entry.spoiledUnits} units
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
