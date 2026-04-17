"use client";

import Button from "@/components/ui/Button";
import { getStoreTabLabel } from "@/lib/store-identity";

export default function StoreTabs({ onChange, selectedStoreId, stores = [] }) {
  return (
    <div className="row" style={{ gap: 8 }}>
      {stores.map((store) => (
        <Button
          key={store.id}
          size="sm"
          variant={selectedStoreId === store.id ? "primary" : "secondary"}
          onClick={() => onChange?.(store.id)}
        >
          {getStoreTabLabel(store)}
        </Button>
      ))}
    </div>
  );
}
