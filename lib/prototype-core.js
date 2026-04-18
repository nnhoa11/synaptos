export const roleProfiles = {
  admin: { label: "HQ Admin", canApprove: true },
  manager: { label: "Store Manager", canApprove: true },
  staff: { label: "Store Staff", canApprove: false },
  procurement_planner: { label: "Procurement Planner", canApprove: false },
  logistics_coordinator: { label: "Logistics Coordinator", canApprove: false },
};

export const storeTypeProfiles = {
  Premium_Urban: {
    displayType: "Premium Urban",
    archetype: "premium",
    storeId: "premium_urban_q1",
    name: "BHX 44 Nguyễn Huệ",
    address: "44 Nguyễn Huệ, Quận 1, TP.HCM",
    district: "Q1",
    zone: "District 1 Core",
    markdownBias: -5,
    approvalThresholdPct: 50,
  },
  Transit: {
    displayType: "Transit Hub",
    archetype: "transit",
    storeId: "transit_q3",
    name: "BHX 23 Cách Mạng Tháng 8",
    address: "23 Cách Mạng Tháng 8, Quận 3, TP.HCM",
    district: "Q3",
    zone: "Commuter Corridor",
    markdownBias: 2,
    approvalThresholdPct: 45,
  },
  Residential: {
    displayType: "Residential",
    archetype: "residential",
    storeId: "residential_q7",
    name: "BHX 78 Nguyễn Hữu Thọ",
    address: "78 Nguyễn Hữu Thọ, Quận 7, TP.HCM",
    district: "Q7",
    zone: "Phú Mỹ Hưng",
    markdownBias: 7,
    approvalThresholdPct: 40,
  },
};

const canonicalStoreDisplayMetadata = {
  premium_urban_q1: {
    name: "SynaptOS Premium Urban Q1",
    address: "44 Nguyen Hue, District 1, Ho Chi Minh City",
    zone: "District 1 Core",
  },
  transit_q3: {
    name: "SynaptOS Transit Hub Q3",
    address: "23 Cach Mang Thang 8, District 3, Ho Chi Minh City",
    zone: "Commuter Corridor",
  },
  residential_q7: {
    name: "SynaptOS Residential Q7",
    address: "78 Nguyen Huu Tho, District 7, Ho Chi Minh City",
    zone: "Phu My Hung",
  },
};

function getCanonicalStoreDisplay(profile = {}) {
  return canonicalStoreDisplayMetadata[profile.storeId] ?? {
    name: profile.name,
    address: profile.address,
    zone: profile.zone,
  };
}

export function parseCsv(text) {
  const normalized = String(text ?? "").replace(/^\uFEFF/, "");
  const rows = [];
  let currentField = "";
  let currentRow = [];
  let inQuotes = false;

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        currentField += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === ",") {
      currentRow.push(currentField);
      currentField = "";
      continue;
    }

    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      currentRow.push(currentField);
      rows.push(currentRow);
      currentField = "";
      currentRow = [];
      continue;
    }

    currentField += char;
  }

  if (currentField.length || currentRow.length) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  const filteredRows = rows.filter((row) => row.some((field) => String(field ?? "").trim() !== ""));
  if (!filteredRows.length) {
    return [];
  }

  const [headerRow, ...dataRows] = filteredRows;
  const headers = headerRow.map((header) => String(header ?? "").trim());

  return dataRows.map((fields) => {
    const row = {};
    headers.forEach((header, index) => {
      row[header] = String(fields[index] ?? "").trim();
    });
    return row;
  });
}

function parseNumber(value, fallback = 0) {
  const next = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(next) ? next : fallback;
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getTimestampFields(row) {
  const [startTime = ""] = String(row.Time_Slot ?? "").split("-");
  const [hourValue, minuteValue = "0"] = startTime.split(":");
  const hour = Number(hourValue);
  const minute = Number(minuteValue);

  if (!row.Date || Number.isNaN(hour) || Number.isNaN(minute)) {
    return { timestampKey: null, timestampMs: NaN };
  }

  const timestampKey = `${row.Date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
  return {
    timestampKey,
    timestampMs: new Date(timestampKey).getTime(),
  };
}

function fallbackCostRatio(category) {
  switch (String(category ?? "").trim()) {
    case "Seafood":
    case "Meat":
      return 0.72;
    case "Dairy":
    case "RTE":
      return 0.64;
    case "Drink":
    case "Snack":
      return 0.48;
    case "Veg":
    case "Fruit":
      return 0.58;
    default:
      return 0.6;
  }
}

function inferLegacyLotId(row, district) {
  return row.Lot_ID?.trim() || slugify(`${row.Store_Type}-${district}-${row.SKU_Name}-${row.Expiry_Date}`);
}

function inferAmbientTemp({ category, storeType, timestampMs }) {
  const hour = new Date(timestampMs).getHours();
  let temperature = 28;

  if (hour >= 11 && hour <= 15) {
    temperature += 4;
  } else if (hour >= 16 && hour <= 20) {
    temperature += 2;
  }

  if (storeType === "Transit") {
    temperature += 1.2;
  } else if (storeType === "Premium_Urban") {
    temperature -= 0.6;
  }

  if (category === "Drink") {
    temperature += 0.8;
  }

  return Number(clampNumber(temperature, 24, 36).toFixed(1));
}

function inferItemTraffic({ imported, qohStart, sold, storeType, timestampMs }) {
  const hour = new Date(timestampMs).getHours();
  let traffic = 0.7;

  if (storeType === "Premium_Urban") {
    if (hour >= 11 && hour <= 14) {
      traffic += 0.55;
    } else if (hour >= 17 && hour <= 20) {
      traffic += 0.2;
    }
  } else if (storeType === "Transit") {
    if (hour >= 7 && hour <= 9) {
      traffic += 0.45;
    } else if (hour >= 17 && hour <= 22) {
      traffic += 0.7;
    }
  } else if (hour >= 16 && hour <= 19) {
    traffic += 0.75;
  } else if (hour >= 10 && hour <= 12) {
    traffic += 0.2;
  }

  traffic += Math.min(0.8, Number(sold ?? 0) / 6);

  if (Number(imported ?? 0) > 0 && Number(sold ?? 0) === 0 && Number(qohStart ?? 0) > 0) {
    traffic -= 0.05;
  }

  return Number(clampNumber(traffic, 0.35, 2.4).toFixed(2));
}

function inferMasterUnitCost({ activePrice, category, grossProfit, revenue, sold }) {
  if (sold > 0 && revenue > 0) {
    const unitCost = (revenue - grossProfit) / sold;
    if (Number.isFinite(unitCost) && unitCost > 0) {
      return Number(unitCost.toFixed(2));
    }
  }

  return Number((activePrice * fallbackCostRatio(category)).toFixed(2));
}

function normalizeLegacyRow(row, profile, timestampKey, timestampMs) {
  const district = String(row.District ?? profile.district ?? "").trim() || profile.district;
  const expiryDate = row.Expiry_Date;
  const expiryAtMs = new Date(`${expiryDate}T23:59:59`).getTime();
  const display = getCanonicalStoreDisplay(profile);

  return {
    date: row.Date,
    timestampMs,
    timestampKey,
    timeSlot: row.Time_Slot,
    storeType: row.Store_Type,
    district,
    storeId: profile.storeId ?? slugify(`${row.Store_Type}-${district}`),
    storeName: display.name,
    archetype: profile.archetype,
    skuName: row.SKU_Name,
    category: row.Category,
    expiryDate,
    expiryAtMs,
    temp: parseNumber(row.Temp),
    itemTraffic: parseNumber(row.Item_Traffic, 1),
    imported: parseNumber(row.Import),
    sold: parseNumber(row.Sold),
    waste: parseNumber(row.Waste),
    cost: parseNumber(row.Cost),
    price: parseNumber(row.Price),
    revenue: parseNumber(row.Revenue),
    opCost: parseNumber(row.Op_Cost),
    wasteLoss: parseNumber(row.Waste_Loss),
    netProfit: parseNumber(row.Net_Profit),
    lotId: inferLegacyLotId(row, district),
    endingQuantity: null,
  };
}

function normalizeMasterRow(row, profile, timestampKey, timestampMs) {
  const district = profile.district;
  const display = getCanonicalStoreDisplay(profile);
  const lotIdBase = String(row.Lot_ID ?? "").trim();
  const sold = parseNumber(row.Sold);
  const waste = parseNumber(row.Waste);
  const imported = parseNumber(row.Import);
  const qohStart = parseNumber(row.QoH_Start);
  const activePrice = parseNumber(row.Active_Price);
  const revenue = parseNumber(row.Revenue, activePrice * sold);
  const grossProfit = parseNumber(row.Gross_Profit);
  const hoursToExpiry = parseNumber(row.T_Minus_Hours, 24);
  const expiryAtMs = timestampMs + hoursToExpiry * 3.6e6;

  return {
    date: row.Date,
    timestampMs,
    timestampKey,
    timeSlot: row.Time_Slot,
    storeType: row.Store_Type,
    district,
    storeId: profile.storeId,
    storeName: display.name,
    archetype: profile.archetype,
    skuName: row.SKU_Name,
    category: row.Category,
    expiryDate: new Date(expiryAtMs).toISOString().slice(0, 10),
    expiryAtMs,
    temp: inferAmbientTemp({ category: row.Category, storeType: row.Store_Type, timestampMs }),
    itemTraffic: inferItemTraffic({ imported, qohStart, sold, storeType: row.Store_Type, timestampMs }),
    imported,
    sold,
    waste,
    cost: inferMasterUnitCost({ activePrice, category: row.Category, grossProfit, revenue, sold }),
    price: activePrice,
    revenue,
    opCost: parseNumber(row.Op_Cost),
    wasteLoss: parseNumber(row.Waste_Loss),
    netProfit: parseNumber(row.Net_Profit),
    lotId: lotIdBase ? `${lotIdBase}-${row.Date}` : slugify(`${row.Store_Type}-${district}-${row.SKU_Name}-${row.Date}`),
    endingQuantity: parseNumber(row.QoH_End),
  };
}

export function normalizeRow(row) {
  const profile = storeTypeProfiles[row.Store_Type];
  const { timestampKey, timestampMs } = getTimestampFields(row);

  if (!profile || Number.isNaN(timestampMs)) {
    return null;
  }

  if (row.Lot_ID && row.Active_Price) {
    return normalizeMasterRow(row, profile, timestampKey, timestampMs);
  }

  if (row.Expiry_Date) {
    return normalizeLegacyRow(row, profile, timestampKey, timestampMs);
  }

  return null;
}

export function buildStores(rows) {
  const storeMap = new Map();
  rows.forEach((row) => {
    if (storeMap.has(row.storeId)) return;
    const profile = storeTypeProfiles[row.storeType];
    const display = getCanonicalStoreDisplay(profile);
    storeMap.set(row.storeId, {
      id: row.storeId,
      type: row.storeType,
      archetype: row.archetype,
      district: row.district,
      name: display.name ?? row.storeName,
      address: display.address,
      zone: display.zone,
      approvalThresholdPct: profile.approvalThresholdPct,
      markdownBias: profile.markdownBias,
      displayType: profile.displayType,
    });
  });
  return [...storeMap.values()];
}

export function buildSnapshots(rows) {
  return [...new Set(rows.map((row) => row.timestampKey))].sort();
}

export function runPrototype({
  rows,
  stores,
  selectedSnapshot,
  calibrations = [],
  pendingAdjustments = {},
  previousLabels = {},
}) {
  const snapshotMs = new Date(selectedSnapshot).getTime();
  const rowsAtOrBeforeSnapshot = rows.filter((row) => row.timestampMs <= snapshotMs);
  const lotMap = new Map();
  const salesHistory = new Map();

  rowsAtOrBeforeSnapshot.forEach((row) => {
    if (!salesHistory.has(row.lotId)) salesHistory.set(row.lotId, []);
    salesHistory.get(row.lotId).push(row);

    const calibrationAdjustment = getCalibrationAdjustment(calibrations, row.storeId, row.skuName);
    const previous = lotMap.get(row.lotId) || {
      lotId: row.lotId,
      storeId: row.storeId,
      storeName: row.storeName,
      storeType: row.storeType,
      archetype: row.archetype,
      district: row.district,
      skuName: row.skuName,
      category: row.category,
      expiryDate: row.expiryDate,
      expiryAtMs: row.expiryAtMs,
      quantityOnHand: 0,
      totalImported: 0,
      totalSold: 0,
      totalWaste: 0,
      latestRow: row,
      confidenceScore: 1,
    };

    previous.totalImported += row.imported;
    previous.totalSold += row.sold;
    previous.totalWaste += row.waste;
    previous.quantityOnHand += row.imported - row.sold - row.waste;
    previous.latestRow = row;
    previous.confidenceScore = Math.max(
      0.35,
      1 - (calibrationAdjustment / Math.max(1, previous.totalImported)) * 0.45
    );
    lotMap.set(row.lotId, previous);
  });

  const activeLots = [...lotMap.values()]
    .map((lot) => finalizeLot(lot, salesHistory.get(lot.lotId), snapshotMs, calibrations))
    .filter((lot) => lot.quantityOnHand > 0 && lot.hoursToExpiry > -8)
    .sort((a, b) => b.hoursToExpiry - a.hoursToExpiry);

  const recommendations = activeLots
    .map((lot) => buildRecommendation(lot, snapshotMs, stores, selectedSnapshot))
    .sort((a, b) => b.riskScore - a.riskScore);

  const { nextRecommendations, nextLabels, updatedLabelIds } = applyRecommendationState(
    recommendations,
    pendingAdjustments,
    previousLabels
  );

  const metrics = buildMetrics(activeLots, nextRecommendations);

  return {
    latestRun: {
      snapshotDate: selectedSnapshot,
      activeLots,
      recommendations: nextRecommendations,
      metrics,
      generatedAt: new Date().toISOString(),
    },
    labels: nextLabels,
    updatedLabelIds,
  };
}

function finalizeLot(lot, historyRows = [], snapshotMs, calibrations) {
  const quantityOnHand = Math.max(
    0,
    lot.quantityOnHand - getCalibrationAdjustment(calibrations, lot.storeId, lot.skuName)
  );
  const recentRows = historyRows.slice(-3);
  const recentVelocity =
    recentRows.reduce((sum, row) => sum + row.sold, 0) / Math.max(1, recentRows.length);
  const latest = lot.latestRow;
  const hoursToExpiry = (lot.expiryAtMs - snapshotMs) / 3.6e6;

  return {
    ...lot,
    quantityOnHand,
    recentVelocity,
    hoursToExpiry,
    temp: latest.temp,
    itemTraffic: latest.itemTraffic,
    basePrice: latest.price,
    currentPrice: latest.price,
    unitCost: latest.cost,
    revenue: latest.revenue,
    netProfit: latest.netProfit,
    latestTimeSlot: latest.timeSlot,
  };
}

function buildRecommendation(lot, snapshotMs, stores, selectedSnapshot) {
  const store = stores.find((item) => item.id === lot.storeId);
  const urgency = getUrgencyScore(lot.hoursToExpiry);
  const velocityStress = clamp(
    (lot.quantityOnHand / Math.max(1, lot.recentVelocity || 0.5)) * 8,
    0,
    38
  );
  const weatherPressure =
    lot.category === "Seafood" || lot.category === "Meat"
      ? clamp((lot.temp - 28) * 2.4, 0, 14)
      : lot.category === "Drink" && lot.temp > 33
        ? -8
        : 0;
  const trafficRelief = clamp((lot.itemTraffic - 1.2) * 4.5, -8, 10);
  const storeBias = store?.markdownBias ?? 0;
  const confidencePenalty = lot.confidenceScore < 0.7 ? 8 : 0;

  let riskScore =
    urgency + velocityStress + weatherPressure - trafficRelief + storeBias + confidencePenalty;

  if (store?.archetype === "transit" && getHour(snapshotMs) < 17) riskScore -= 6;
  if (store?.archetype === "premium" && lot.hoursToExpiry > 12) riskScore -= 5;
  if (store?.archetype === "residential" && lot.quantityOnHand > 18) riskScore += 6;

  riskScore = Math.round(clamp(riskScore, 8, 98));

  let recommendedDiscountPct = 0;
  if (riskScore >= 88) recommendedDiscountPct = 55;
  else if (riskScore >= 76) recommendedDiscountPct = 35;
  else if (riskScore >= 62) recommendedDiscountPct = 20;
  else if (riskScore >= 45) recommendedDiscountPct = 10;

  if (lot.category === "Drink" && lot.temp > 33 && lot.hoursToExpiry > 10) {
    recommendedDiscountPct = Math.max(0, recommendedDiscountPct - 10);
  }

  const recommendedPrice = lot.basePrice * (1 - recommendedDiscountPct / 100);
  const approvalThresholdPct = store?.approvalThresholdPct ?? 50;
  const requiresApproval = recommendedDiscountPct >= approvalThresholdPct;
  const expectedRescueUnits = Math.min(
    lot.quantityOnHand,
    Math.max(
      1,
      Math.round(
        lot.recentVelocity * 2 + (recommendedDiscountPct / 100) * lot.quantityOnHand * 0.65
      )
    )
  );

  return {
    id: `rec_${lot.lotId}_${selectedSnapshot}`,
    lotId: lot.lotId,
    storeId: lot.storeId,
    skuName: lot.skuName,
    category: lot.category,
    lot,
    riskScore,
    recommendedDiscountPct,
    recommendedPrice,
    approvalThresholdPct,
    requiresApproval,
    reasonSummary: summarizeRecommendation(lot, riskScore, recommendedDiscountPct),
    expectedRescueUnits,
    expectedRescueGmv: expectedRescueUnits * recommendedPrice,
    status: requiresApproval
      ? "pending_review"
      : recommendedDiscountPct > 0
        ? "auto_applied"
        : "hold",
    activePrice:
      recommendedDiscountPct > 0 && !requiresApproval ? recommendedPrice : lot.basePrice,
  };
}

function applyRecommendationState(recommendations, pendingAdjustments, previousLabels) {
  const nextLabels = { ...previousLabels };
  const updatedLabelIds = [];

  const nextRecommendations = recommendations.map((recommendation) => {
    const adjustment = pendingAdjustments[recommendation.id];
    const next = { ...recommendation };

    if (adjustment) {
      if (adjustment.status === "approved") {
        next.status = "approved";
        next.recommendedDiscountPct = adjustment.discountPct;
        next.recommendedPrice = next.lot.basePrice * (1 - adjustment.discountPct / 100);
        next.activePrice = next.recommendedPrice;
        next.expectedRescueGmv = next.expectedRescueUnits * next.activePrice;
      } else if (adjustment.status === "rejected") {
        next.status = "rejected";
        next.activePrice = next.lot.basePrice;
      }
    }

    const previousLabel = previousLabels[next.lotId];
    const nextLabel = {
      currentPrice: next.activePrice,
      previousPrice: previousLabel?.currentPrice ?? next.lot.basePrice,
      status: next.status,
      recommendationId: next.id,
    };

    if (
      previousLabel &&
      Math.round(previousLabel.currentPrice) !== Math.round(nextLabel.currentPrice)
    ) {
      updatedLabelIds.push(next.lotId);
    }

    nextLabels[next.lotId] = nextLabel;
    return next;
  });

  return { nextRecommendations, nextLabels, updatedLabelIds };
}

export function buildMetrics(activeLots, recommendations) {
  const pendingReviews = recommendations.filter((rec) => rec.status === "pending_review");
  const atRiskLots = recommendations.filter((rec) => rec.riskScore >= 60);
  const executedRecs = recommendations.filter((rec) =>
    ["auto_applied", "approved"].includes(rec.status)
  );
  const rescuedGmv = executedRecs.reduce((sum, rec) => sum + rec.expectedRescueGmv, 0);
  const wasteAvoided = executedRecs.reduce(
    (sum, rec) =>
      sum +
      Math.min(100, (rec.expectedRescueUnits / Math.max(1, rec.lot.quantityOnHand)) * 100),
    0
  );
  const approvalTargets = recommendations.filter((rec) => rec.requiresApproval);

  return {
    networkLots: activeLots.length,
    pendingReviews: pendingReviews.length,
    atRiskLots: atRiskLots.length,
    rescuedGmv,
    wasteAvoidedPct: executedRecs.length ? wasteAvoided / executedRecs.length : 0,
    markdownCount: executedRecs.filter((rec) => rec.activePrice < rec.lot.basePrice).length,
    approvalRate:
      approvalTargets.length > 0
        ? recommendations.filter((rec) => rec.status === "approved").length /
          approvalTargets.length
        : 1,
  };
}

function getCalibrationAdjustment(calibrations, storeId, skuName) {
  return calibrations
    .filter((entry) => entry.storeId === storeId && entry.skuKey === skuName)
    .reduce((sum, entry) => sum + Number(entry.shrinkageUnits || 0) + Number(entry.spoiledUnits || 0), 0);
}

function getUrgencyScore(hoursToExpiry) {
  if (hoursToExpiry <= 0) return 96;
  if (hoursToExpiry <= 4) return 92;
  if (hoursToExpiry <= 8) return 82;
  if (hoursToExpiry <= 12) return 72;
  if (hoursToExpiry <= 24) return 58;
  if (hoursToExpiry <= 36) return 44;
  if (hoursToExpiry <= 48) return 32;
  return 18;
}

function summarizeRecommendation(lot, riskScore, discountPct) {
  const reasons = [];
  if (lot.hoursToExpiry < 12) reasons.push("expiry clock is critical");
  else if (lot.hoursToExpiry < 24) reasons.push("expiry window is narrowing");
  if (lot.quantityOnHand > lot.recentVelocity * 5)
    reasons.push("inventory is outrunning sell-through");
  if (lot.temp > 33 && lot.category !== "Drink")
    reasons.push("high heat raises spoilage pressure");
  if (lot.itemTraffic < 1) reasons.push("foot traffic is weak for this window");
  if (!reasons.length) reasons.push("store context supports a controlled markdown");
  return `${discountPct}% markdown because ${reasons.join(", ")}. Risk score ${riskScore}.`;
}

function getHour(timestampMs) {
  return new Date(timestampMs).getHours();
}

export function formatSnapshot(snapshotKey) {
  const date = new Date(snapshotKey);
  return date.toLocaleString("en-AU", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatAuditTime(value) {
  return new Date(value).toLocaleString("en-AU", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function currency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(value);
}

export function shortCurrency(value) {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return `${Math.round(value)}`;
}

export function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(Math.max(0, Math.round(value)));
}

export function average(values) {
  const filtered = values.filter((value) => Number.isFinite(value));
  return filtered.length
    ? filtered.reduce((sum, value) => sum + value, 0) / filtered.length
    : 0;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function slugify(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}
