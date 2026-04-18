"use client";

const ARCHETYPE_LABELS = {
  premium: "Premium Urban",
  transit: "Transit Hub",
  residential: "Residential",
};

export default function StoreTabs({ onChange, selectedStoreId, stores = [] }) {
  return (
    <div className="store-tabs">
      {stores.map((store) => (
        <button
          key={store.id}
          className={`store-tab${selectedStoreId === store.id ? " store-tab--selected" : ""}`}
          onClick={() => onChange?.(store.id)}
          type="button"
        >
          <div className="store-tab__id">{store.id}</div>
          <div className="store-tab__name">{store.name ?? store.displayType}</div>
          <div className="store-tab__meta">
            <span className={`store-tab__chip store-tab__chip--${store.archetype ?? "gray"}`}>
              {ARCHETYPE_LABELS[store.archetype] ?? store.displayType}
            </span>
            {store.zone ? <span className="store-tab__zone">{store.zone}</span> : null}
          </div>
        </button>
      ))}
    </div>
  );
}
