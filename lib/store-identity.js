export const STORE_ALIAS_TO_ID = {
  Q1: "BHX_44NguyenHue_D1",
  Q3: "BHX_23CachMangThang8_D3",
  Q7: "BHX_78NguyenHuuTho_D7",
};

export function resolveStoreId(value, stores = []) {
  if (!value) {
    return stores[0]?.id ?? null;
  }

  const raw = String(value).trim();
  const upper = raw.toUpperCase();
  const direct = stores.find((store) => store.id === raw);
  if (direct) {
    return direct.id;
  }

  if (STORE_ALIAS_TO_ID[upper]) {
    return STORE_ALIAS_TO_ID[upper];
  }

  const byDistrict = stores.find((store) => String(store.district ?? "").toUpperCase() === upper);
  if (byDistrict) {
    return byDistrict.id;
  }

  return raw;
}

export function getStoreAlias(storeOrId) {
  const id = typeof storeOrId === "string" ? storeOrId : storeOrId?.id;
  return Object.entries(STORE_ALIAS_TO_ID).find(([, value]) => value === id)?.[0] ?? id ?? "STORE";
}

export function getStoreTabLabel(store) {
  if (!store) {
    return "Store";
  }

  return store.name ?? `${store.displayType ?? "Store"} ${store.district ?? getStoreAlias(store)}`.trim();
}
