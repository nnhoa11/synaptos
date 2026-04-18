"use client";

import { useEffect, useMemo, useState } from "react";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";

const DEFAULT_DRAFT = {
  storeId: "",
  type: "flash_sale",
  targetCategory: "Produce",
  targetSkuId: "",
  discountPct: 15,
  durationMinutes: 60,
  startsAt: "now",
  name: "Flash Sale",
};

function buildDraft(stores, initialDraft = null) {
  return {
    ...DEFAULT_DRAFT,
    storeId: initialDraft?.storeId ?? stores[0]?.id ?? DEFAULT_DRAFT.storeId,
    type: initialDraft?.type ?? DEFAULT_DRAFT.type,
    targetCategory: initialDraft?.targetCategory ?? DEFAULT_DRAFT.targetCategory,
    targetSkuId: initialDraft?.targetSkuId ?? DEFAULT_DRAFT.targetSkuId,
    discountPct: Number(initialDraft?.discountPct ?? DEFAULT_DRAFT.discountPct),
    durationMinutes: Number(initialDraft?.durationMinutes ?? DEFAULT_DRAFT.durationMinutes),
    startsAt: initialDraft?.startsAt ?? DEFAULT_DRAFT.startsAt,
    name: initialDraft?.name ?? DEFAULT_DRAFT.name,
  };
}

export default function CampaignCreateModal({
  categories = [],
  initialDraft = null,
  onClose,
  onSubmit,
  open,
  stores = [],
}) {
  const normalizedDraft = useMemo(() => buildDraft(stores, initialDraft), [initialDraft, stores]);
  const [draft, setDraft] = useState(normalizedDraft);

  useEffect(() => {
    if (!open) {
      return;
    }

    setDraft(normalizedDraft);
  }, [normalizedDraft, open]);

  const durationEndLabel =
    draft.startsAt === "now"
      ? new Date(Date.now() + draft.durationMinutes * 60000).toLocaleString()
      : new Date(new Date(draft.startsAt).getTime() + draft.durationMinutes * 60000).toLocaleString();

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
              <option value="clearance">Clearance</option>
              <option value="micro_markdown">Micro Markdown</option>
            </select>
          </label>
        </div>

        <label className="field">
          <span>Campaign Name</span>
          <input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} />
        </label>

        <div className="field-row">
          <label className="field">
            <span>Category</span>
            <select
              value={draft.targetCategory}
              onChange={(event) => setDraft((current) => ({ ...current, targetCategory: event.target.value }))}
            >
              <option value="">All categories</option>
              {[...new Set([draft.targetCategory, ...categories].filter(Boolean))].map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
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
            <select
              value={draft.durationMinutes}
              onChange={(event) => setDraft((current) => ({ ...current, durationMinutes: Number(event.target.value) }))}
            >
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
            <option value={new Date(Date.now() + 2 * 60 * 60000).toISOString()}>In 2 hours</option>
          </select>
        </label>

        <div className="ui-card ui-card--padded">
          <p className="metric-label">Campaign Preview</p>
          <strong>{draft.name}</strong>
          <p className="metric-footnote" style={{ margin: "6px 0 0" }}>
            {draft.targetCategory || "All categories"} · {draft.discountPct}% · closes {durationEndLabel}
          </p>
        </div>
      </div>
    </Modal>
  );
}
