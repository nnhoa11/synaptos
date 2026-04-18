export const STORE_ALIAS_TO_ID = {
  Q1: "premium_urban_q1",
  Q3: "transit_q3",
  Q7: "residential_q7",
  DISTRICT_1: "premium_urban_q1",
  DISTRICT_3: "transit_q3",
  DISTRICT_7: "residential_q7",
  PREMIUM_URBAN_Q1: "premium_urban_q1",
  TRANSIT_Q3: "transit_q3",
  RESIDENTIAL_Q7: "residential_q7",
  BHX_44NGUYENHUE_D1: "premium_urban_q1",
  BHX_23CACHMANGTHANG8_D3: "transit_q3",
  BHX_78NGUYENHUUTHO_D7: "residential_q7",
};

function normalizeAliasToken(value) {
  return String(value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

export function resolveStoreId(value, stores = []) {
  if (!value) {
    return stores[0]?.id ?? null;
  }

  const raw = String(value).trim();
  const normalized = normalizeAliasToken(raw);
  const direct = stores.find((store) => store.id === raw);
  if (direct) {
    return direct.id;
  }

  if (STORE_ALIAS_TO_ID[normalized]) {
    return STORE_ALIAS_TO_ID[normalized];
  }

  const byDistrict = stores.find(
    (store) =>
      normalizeAliasToken(store.district) === normalized ||
      normalizeAliasToken(store.name) === normalized ||
      normalizeAliasToken(store.displayType) === normalized
  );
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
