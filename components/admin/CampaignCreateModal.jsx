"use client";

import { useState } from "react";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";

export default function CampaignCreateModal({ onClose, onSubmit, open, stores = [] }) {
  const [draft, setDraft] = useState({
    storeId: stores[0]?.id ?? "",
    type: "flash_sale",
    targetCategory: "Produce",
    targetSkuId: "",
    discountPct: 15,
    durationMinutes: 60,
    startsAt: "now",
    name: "Flash Sale",
  });

  return (
    <Modal
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              onSubmit?.({
                ...draft,
                startsAt:
                  draft.startsAt === "now"
                    ? new Date().toISOString()
                    : new Date(draft.startsAt).toISOString(),
                endsAt:
                  draft.startsAt === "now"
                    ? new Date(Date.now() + draft.durationMinutes * 60000).toISOString()
                    : new Date(new Date(draft.startsAt).getTime() + draft.durationMinutes * 60000).toISOString(),
              })
            }
          >
            Save Campaign
          </Button>
        </>
      }
      onClose={onClose}
      open={open}
      title="Create Campaign"
    >
      <div className="field-grid">
        <div className="field-row">
          <label className="field">
            <span>Store</span>
            <select value={draft.storeId} onChange={(event) => setDraft((current) => ({ ...current, storeId: event.target.value }))}>
              {stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Type</span>
            <select value={draft.type} onChange={(event) => setDraft((current) => ({ ...current, type: event.target.value }))}>
              <option value="flash_sale">Flash Sale</option>
            </select>
          </label>
        </div>
        <div className="field-row">
          <label className="field">
            <span>Category</span>
            <input value={draft.targetCategory} onChange={(event) => setDraft((current) => ({ ...current, targetCategory: event.target.value }))} />
          </label>
          <label className="field">
            <span>Specific SKU</span>
            <input
              placeholder="Optional lot/SKU id"
              value={draft.targetSkuId}
              onChange={(event) => setDraft((current) => ({ ...current, targetSkuId: event.target.value }))}
            />
          </label>
        </div>
        <div className="field-row">
          <label className="field">
            <span>Discount %</span>
            <input
              max="50"
              min="5"
              type="range"
              value={draft.discountPct}
              onChange={(event) => setDraft((current) => ({ ...current, discountPct: Number(event.target.value) }))}
            />
            <strong>{draft.discountPct}%</strong>
          </label>
          <label className="field">
            <span>Duration</span>
            <select value={draft.durationMinutes} onChange={(event) => setDraft((current) => ({ ...current, durationMinutes: Number(event.target.value) }))}>
              {[15, 30, 60, 120, 240].map((value) => (
                <option key={value} value={value}>
                  {value} min
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          <span>Start</span>
          <select value={draft.startsAt} onChange={(event) => setDraft((current) => ({ ...current, startsAt: event.target.value }))}>
            <option value="now">Now</option>
            <option value={new Date(Date.now() + 30 * 60000).toISOString()}>In 30 minutes</option>
            <option value={new Date(Date.now() + 60 * 60000).toISOString()}>In 1 hour</option>
          </select>
        </label>
      </div>
    </Modal>
  );
}
