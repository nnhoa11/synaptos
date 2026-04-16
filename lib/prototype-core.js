export const roleProfiles = {
  admin: { label: "HQ Admin", canApprove: true },
  manager: { label: "Store Manager", canApprove: true },
  staff: { label: "Store Staff", canApprove: false },
};

export const storeTypeProfiles = {
  Premium_Urban: {
    displayType: "Premium Urban",
    archetype: "premium",
    name: "SynaptOS District 1 Premium",
    markdownBias: -5,
    approvalThresholdPct: 50,
  },
  Transit: {
    displayType: "Transit",
    archetype: "transit",
    name: "SynaptOS District 3 Transit",
    markdownBias: 2,
    approvalThresholdPct: 45,
  },
  Residential: {
    displayType: "Residential",
    archetype: "residential",
    name: "SynaptOS District 7 Residential",
    markdownBias: 7,
    approvalThresholdPct: 40,
  },
};

export function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const headers = lines.shift().split(",");
  return lines.map((line) => {
    const parts = line.split(",");
    const row = {};
    headers.forEach((header, index) => {
      row[header] = parts[index];
    });
    return row;
  });
}

export function normalizeRow(row) {
  const [startHour] = row.Time_Slot.split("-")[0].split(":").map(Number);
  const timestampKey = `${row.Date}T${String(startHour).padStart(2, "0")}:00:00`;
  const timestampMs = new Date(timestampKey).getTime();
  const expiryAtMs = new Date(`${row.Expiry_Date}T23:59:59`).getTime();
  const profile = storeTypeProfiles[row.Store_Type];

  if (!profile || Number.isNaN(timestampMs)) {
    return null;
  }

  return {
    date: row.Date,
    timestampMs,
    timestampKey,
    timeSlot: row.Time_Slot,
    storeType: row.Store_Type,
    district: row.District,
    storeId: slugify(`${row.Store_Type}-${row.District}`),
    storeName: profile.name,
    archetype: profile.archetype,
    skuName: row.SKU_Name,
    category: row.Category,
    expiryDate: row.Expiry_Date,
    expiryAtMs,
    temp: Number(row.Temp),
    itemTraffic: Number(row.Item_Traffic),
    imported: Number(row.Import),
    sold: Number(row.Sold),
    waste: Number(row.Waste),
    cost: Number(row.Cost),
    price: Number(row.Price),
    revenue: Number(row.Revenue),
    opCost: Number(row.Op_Cost),
    wasteLoss: Number(row.Waste_Loss),
    netProfit: Number(row.Net_Profit),
    lotId: slugify(`${row.Store_Type}-${row.District}-${row.SKU_Name}-${row.Expiry_Date}`),
  };
}

export function buildStores(rows) {
  const storeMap = new Map();
  rows.forEach((row) => {
    if (storeMap.has(row.storeId)) return;
    const profile = storeTypeProfiles[row.storeType];
    storeMap.set(row.storeId, {
      id: row.storeId,
      type: row.storeType,
      archetype: row.archetype,
      district: row.district,
      name: row.storeName,
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
