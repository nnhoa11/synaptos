"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  average,
  currency,
  formatAuditTime,
  formatNumber,
  formatSnapshot,
  roleProfiles,
  shortCurrency,
} from "@/lib/prototype-core";

const TABS = [
  { id: "overview", label: "HQ Overview" },
  { id: "operations", label: "Store Operations" },
  { id: "approvals", label: "Approval Queue" },
  { id: "labels", label: "Shelf Labels" },
  { id: "audit", label: "Calibration & Audit" },
];

async function readJson(response) {
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error?.message || `HTTP ${response.status}`);
  }
  return payload;
}

export default function PrototypeApp({
  stores: initialStores,
  snapshots: initialSnapshots,
  defaultSnapshot,
}) {
  const [session, setSession] = useState(null);
  const [stores, setStores] = useState(initialStores);
  const [snapshots, setSnapshots] = useState(initialSnapshots);
  const [selectedStoreId, setSelectedStoreId] = useState(initialStores[0]?.id ?? null);
  const [selectedSnapshot, setSelectedSnapshot] = useState(
    defaultSnapshot ?? initialSnapshots[initialSnapshots.length - 1] ?? null
  );
  const [activeTab, setActiveTab] = useState("overview");
  const [latestRun, setLatestRun] = useState(null);
  const [labels, setLabels] = useState({});
  const [updatedLabelIds, setUpdatedLabelIds] = useState([]);
  const [auditLog, setAuditLog] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [liveMessage, setLiveMessage] = useState("");
  const [importState, setImportState] = useState(null);
  const [calibrationDraft, setCalibrationDraft] = useState({
    skuKey: "",
    shrinkageUnits: 0,
    spoiledUnits: 0,
    notes: "",
  });

  const role = session?.role ?? "admin";
  const canApprove = ["admin", "manager"].includes(role);
  const isAdmin = role === "admin";

  const selectedStore = useMemo(
    () => stores.find((store) => store.id === selectedStoreId) ?? null,
    [stores, selectedStoreId]
  );

  const syncPayload = useCallback((payload) => {
    setLatestRun(payload.latestRun);
    setLabels(payload.labels || {});
    setUpdatedLabelIds(payload.updatedLabelIds || []);
  }, []);

  const refreshAudit = useCallback(async (storeId) => {
    const targetStoreId = storeId ?? selectedStoreId;
    const query = targetStoreId ? `?storeId=${encodeURIComponent(targetStoreId)}` : "";
    const payload = await readJson(await fetch(`/api/audit${query}`));
    setAuditLog(payload);
  }, [selectedStoreId]);

  const loadCurrentPayload = useCallback(
    async (snapshot = selectedSnapshot) => {
      if (!snapshot) return;
      setLoading(true);
      setError("");

      try {
        const payload = await readJson(
          await fetch(`/api/recommendations/current?snapshot=${encodeURIComponent(snapshot)}`)
        );
        syncPayload(payload);
      } catch (loadError) {
        setError(loadError.message);
      } finally {
        setLoading(false);
      }
    },
    [selectedSnapshot, syncPayload]
  );

  const hydrateSession = useCallback(async () => {
    const payload = await readJson(await fetch("/api/auth/session"));
    setSession(payload.user);
    setStores(payload.stores);

    const fallbackStoreId = payload.stores[0]?.id ?? null;
    setSelectedStoreId((current) =>
      current && payload.stores.some((store) => store.id === current)
        ? current
        : fallbackStoreId
    );

    return payload;
  }, []);

  const refreshSnapshots = useCallback(async () => {
    const payload = await readJson(await fetch("/api/snapshots"));
    setSnapshots(payload);
    if (!selectedSnapshot && payload.length) {
      setSelectedSnapshot(payload[payload.length - 1]);
    }
    return payload;
  }, [selectedSnapshot]);

  const executeRun = useCallback(
    async ({ recordAudit = false } = {}) => {
      if (!selectedSnapshot) return;
      setLoading(true);
      setError("");

      try {
        const payload = await readJson(
          await fetch("/api/recommendations/run", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ snapshot: selectedSnapshot }),
          })
        );
        syncPayload(payload);
        if (recordAudit) {
          await refreshAudit();
        }
      } catch (runError) {
        setError(runError.message);
      } finally {
        setLoading(false);
      }
    },
    [refreshAudit, selectedSnapshot, syncPayload]
  );

  useEffect(() => {
    let active = true;

    async function bootstrap() {
      try {
        setLoading(true);
        const sessionPayload = await hydrateSession();
        await refreshSnapshots();
        if (defaultSnapshot || selectedSnapshot) {
          await loadCurrentPayload(defaultSnapshot || selectedSnapshot);
        }
        await refreshAudit(sessionPayload.stores[0]?.id ?? selectedStoreId);
      } catch (bootstrapError) {
        if (active) setError(bootstrapError.message);
      } finally {
        if (active) setLoading(false);
      }
    }

    bootstrap();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedSnapshot) return;
    loadCurrentPayload(selectedSnapshot);
  }, [loadCurrentPayload, selectedSnapshot]);

  useEffect(() => {
    refreshAudit(selectedStoreId).catch(() => {});
  }, [refreshAudit, selectedStoreId]);

  useEffect(() => {
    const events = new EventSource("/api/events");
    events.onmessage = (message) => {
      const event = JSON.parse(message.data);
      setLiveMessage(`${event.type.replaceAll(".", " ")} · ${formatAuditTime(event.at)}`);

      if (
        [
          "run.completed",
          "recommendation.updated",
          "label.updated",
          "price.updated",
          "calibration.recorded",
          "import.completed",
        ].includes(event.type)
      ) {
        loadCurrentPayload(selectedSnapshot).catch(() => {});
        refreshAudit(selectedStoreId).catch(() => {});
      }
    };

    return () => events.close();
  }, [loadCurrentPayload, refreshAudit, selectedSnapshot, selectedStoreId]);

  const recommendations = latestRun?.recommendations ?? [];
  const selectedStoreRecommendations = recommendations.filter(
    (recommendation) => recommendation.storeId === selectedStoreId
  );

  const storeSummaries = useMemo(
    () =>
      stores.map((store) => {
        const storeRecs = recommendations.filter(
          (recommendation) => recommendation.storeId === store.id
        );
        return {
          store,
          activeLots: storeRecs.length,
          riskyLots: storeRecs.filter((recommendation) => recommendation.riskScore >= 60).length,
          pendingReviews: storeRecs.filter(
            (recommendation) => recommendation.status === "pending_review"
          ).length,
          rescuedGmv: storeRecs
            .filter((recommendation) =>
              ["auto_applied", "approved"].includes(recommendation.status)
            )
            .reduce((sum, recommendation) => sum + recommendation.expectedRescueGmv, 0),
        };
      }),
    [recommendations, stores]
  );

  const storeLots = selectedStoreRecommendations.map((recommendation) => recommendation.lot);
  const avgTemp = average(storeLots.map((lot) => lot.temp));
  const avgTraffic = average(storeLots.map((lot) => lot.itemTraffic));
  const lowConfidence = storeLots.filter((lot) => lot.confidenceScore < 0.75).length;

  const pendingApprovals = selectedStoreRecommendations.filter(
    (recommendation) => recommendation.status === "pending_review"
  );

  const calibrationSkuOptions = selectedStoreRecommendations.map(
    (recommendation) => recommendation.skuName
  );

  useEffect(() => {
    if (
      calibrationSkuOptions.length &&
      (!calibrationDraft.skuKey ||
        !calibrationSkuOptions.includes(calibrationDraft.skuKey))
    ) {
      setCalibrationDraft((current) => ({ ...current, skuKey: calibrationSkuOptions[0] }));
    }
  }, [calibrationDraft.skuKey, calibrationSkuOptions]);

  const trend = useMemo(() => {
    const trendValues = auditLog
      .filter((entry) => entry.type === "Recommendation engine run")
      .slice(0, 12)
      .reverse()
      .map((entry, index) => ({
        label: `Run ${index + 1}`,
        value: 1 + index * 0.25 + (latestRun?.metrics.rescuedGmv ?? 0) / 7000000,
      }));

    if (trendValues.length) return trendValues;

    return stores.map((_, index) => ({
      label: `${index + 1}`,
      value: 0.8 + index * 0.4 + (latestRun?.metrics.rescuedGmv ?? 0) / 9000000,
    }));
  }, [auditLog, latestRun?.metrics.rescuedGmv, stores]);

  const maxTrend = Math.max(...trend.map((point) => point.value), 1);

  const signalCards = [
    {
      label: "Avg Temperature",
      value: Number.isFinite(avgTemp) ? `${avgTemp.toFixed(1)}°C` : "N/A",
      note:
        avgTemp > 33
          ? "Heatwave demand on drinks"
          : avgTemp < 27
            ? "Cooler demand mix"
            : "Normal weather band",
    },
    {
      label: "Traffic Intensity",
      value: Number.isFinite(avgTraffic) ? `${avgTraffic.toFixed(2)}x` : "N/A",
      note: "Used as a liquidity signal in the pricing loop",
    },
    {
      label: "Low Confidence Lots",
      value: String(lowConfidence),
      note: "Reduced confidence from calibration mismatch",
    },
    {
      label: "Store Strategy",
      value:
        selectedStore?.archetype === "premium"
          ? "Protect margin until late window"
          : selectedStore?.archetype === "transit"
            ? "Delay flash sales until traffic drop"
            : "Start earlier markdowns on heavy family packs",
      note: "Derived from district profile and archetype",
    },
  ];

  const metrics = latestRun?.metrics ?? {
    rescuedGmv: 0,
    pendingReviews: 0,
    atRiskLots: 0,
    wasteAvoidedPct: 0,
    approvalRate: 1,
  };

  const metricCards = [
    {
      label: "Rescued GMV",
      value: currency(metrics.rescuedGmv),
      footnote: "Projected sales value saved by executed markdowns",
    },
    {
      label: "Pending Reviews",
      value: String(metrics.pendingReviews),
      footnote: "Recommendations waiting on manager sign-off",
    },
    {
      label: "At-Risk Lots",
      value: String(metrics.atRiskLots),
      footnote: "Lots above the risk threshold at this snapshot",
    },
    {
      label: "Waste Avoided",
      value: `${metrics.wasteAvoidedPct.toFixed(0)}%`,
      footnote: "Estimated reduction in spoilage across executed actions",
    },
    {
      label: "Approval Rate",
      value: `${(metrics.approvalRate * 100).toFixed(0)}%`,
      footnote: "Approved high-risk markdowns in the current run",
    },
  ];

  async function switchRole(nextRole) {
    const targetStoreId = nextRole === "admin" ? null : selectedStoreId ?? stores[0]?.id ?? null;
    const payload = await readJson(
      await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role: nextRole,
          storeId: targetStoreId,
        }),
      })
    );

    setSession(payload.user);
    setStores(payload.stores);
    if (payload.stores.length && !payload.stores.some((store) => store.id === selectedStoreId)) {
      setSelectedStoreId(payload.stores[0].id);
    }
    await loadCurrentPayload(selectedSnapshot);
    await refreshAudit(targetStoreId ?? selectedStoreId);
  }

  async function handleApprove(recommendation, discountPct) {
    setLoading(true);
    setError("");
    try {
      const payload = await readJson(
        await fetch(`/api/recommendations/${recommendation.id}/approve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            discountPct,
            snapshot: selectedSnapshot,
          }),
        })
      );
      syncPayload(payload.payload);
      await refreshAudit();
    } catch (approveError) {
      setError(approveError.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleReject(recommendation) {
    setLoading(true);
    setError("");
    try {
      const payload = await readJson(
        await fetch(`/api/recommendations/${recommendation.id}/reject`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            snapshot: selectedSnapshot,
          }),
        })
      );
      syncPayload(payload.payload);
      await refreshAudit();
    } catch (rejectError) {
      setError(rejectError.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCalibrationSubmit(event) {
    event.preventDefault();
    if (!calibrationDraft.skuKey || !selectedStoreId || !selectedSnapshot) return;

    setLoading(true);
    setError("");
    try {
      const payload = await readJson(
        await fetch("/api/calibration", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storeId: selectedStoreId,
            skuKey: calibrationDraft.skuKey,
            shrinkageUnits: Number(calibrationDraft.shrinkageUnits || 0),
            spoiledUnits: Number(calibrationDraft.spoiledUnits || 0),
            notes: calibrationDraft.notes.trim(),
            snapshot: selectedSnapshot,
          }),
        })
      );
      syncPayload(payload.payload);
      await refreshAudit();
      setCalibrationDraft({
        skuKey: calibrationSkuOptions[0] ?? "",
        shrinkageUnits: 0,
        spoiledUnits: 0,
        notes: "",
      });
    } catch (calibrationError) {
      setError(calibrationError.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleBaselineImport() {
    setLoading(true);
    setError("");
    try {
      const payload = await readJson(
        await fetch("/api/imports", {
          method: "POST",
        })
      );
      setImportState(payload.batch);
      if (payload.payload) {
        syncPayload(payload.payload);
      }
      const refreshedSnapshots = await refreshSnapshots();
      if (!selectedSnapshot && refreshedSnapshots.length) {
        setSelectedSnapshot(refreshedSnapshots[refreshedSnapshots.length - 1]);
      }
      await refreshAudit();
    } catch (importError) {
      setError(importError.message);
    } finally {
      setLoading(false);
    }
  }

  const visibleAuditLog =
    auditLog.length > 0
      ? auditLog
      : [
          {
            id: "seed_1",
            type: "System ready",
            actor: "SynaptOS",
            createdAt: new Date().toISOString(),
            message: "Persistent v2 store is ready",
            details:
              "Run the recommendation engine or approve a pending action to populate the audit log.",
          },
        ];

  return (
    <>
      <div className="background-glow background-glow-a" />
      <div className="background-glow background-glow-b" />

      <main className="app-shell">
        <header className="hero">
          <div>
            <p className="eyebrow">Retail Nervous System</p>
            <h1>SynaptOS v2 Prototype</h1>
            <p className="hero-copy">
              Durable markdown operations with server-backed approvals, calibration,
              audit history, imports, and realtime operator updates.
            </p>
          </div>
          <div className="hero-badges">
            <span className="badge">SSE Events</span>
            <span className="badge">RBAC Session</span>
          </div>
        </header>

        <section className="toolbar panel">
          <div className="control-group">
            <label htmlFor="roleSelect">Role</label>
            <select
              id="roleSelect"
              value={role}
              onChange={(event) => switchRole(event.target.value)}
            >
              {Object.entries(roleProfiles).map(([value, profile]) => (
                <option key={value} value={value}>
                  {profile.label}
                </option>
              ))}
            </select>
          </div>

          <div className="control-group">
            <label htmlFor="storeSelect">Store</label>
            <select
              id="storeSelect"
              value={selectedStoreId ?? ""}
              disabled={!isAdmin}
              onChange={(event) => setSelectedStoreId(event.target.value)}
            >
              {stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </select>
          </div>

          <div className="control-group">
            <label htmlFor="snapshotSelect">Snapshot</label>
            <select
              id="snapshotSelect"
              value={selectedSnapshot ?? ""}
              onChange={(event) => setSelectedSnapshot(event.target.value)}
            >
              {snapshots.map((snapshot) => (
                <option key={snapshot} value={snapshot}>
                  {formatSnapshot(snapshot)}
                </option>
              ))}
            </select>
          </div>

          <button
            className="button button-primary"
            onClick={() => executeRun({ recordAudit: true })}
          >
            Run Recommendation Engine
          </button>

          {isAdmin && (
            <button className="button" onClick={handleBaselineImport}>
              Resync Baseline Import
            </button>
          )}
        </section>

        <section className="panel">
          <div className="panel-header">
            <h2>Session and Live State</h2>
            <span className="panel-subtitle">
              {session ? `${session.name} · ${roleProfiles[session.role].label}` : "Loading session"}
            </span>
          </div>
          <div className="store-stats">
            <div className="stat-chip">
              <span className="small-copy">User</span>
              <strong>{session?.name ?? "Bootstrapping"}</strong>
            </div>
            <div className="stat-chip">
              <span className="small-copy">Realtime</span>
              <strong>{liveMessage || "Connected"}</strong>
            </div>
            <div className="stat-chip">
              <span className="small-copy">Last Import</span>
              <strong>{importState?.status ?? "completed"}</strong>
            </div>
          </div>
        </section>

        {loading && (
          <section className="panel loading-panel">
            <div className="spinner" />
            <div>
              <h2>Running retail decision engine</h2>
              <p>
                Loading persisted state, recomputing lot-level risk, and refreshing
                shelf-label state for the selected snapshot.
              </p>
            </div>
          </section>
        )}

        {!loading && error && (
          <section className="panel error-panel">
            <div>
              <h2>Unable to complete the requested action</h2>
              <p>{error}</p>
            </div>
          </section>
        )}

        {!loading && latestRun && (
          <>
            <section className="metric-grid">
              {metricCards.map((card) => (
                <article key={card.label} className="panel metric-card">
                  <div className="metric-label">{card.label}</div>
                  <div className="metric-value">{card.value}</div>
                  <div className="metric-footnote">{card.footnote}</div>
                </article>
              ))}
            </section>

            <nav className="tab-bar">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  className={`tab ${activeTab === tab.id ? "is-active" : ""}`}
                  onClick={() => setActiveTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </nav>

            <section
              className={`tab-panel ${activeTab === "overview" ? "is-active" : ""}`}
            >
              <div className="overview-grid">
                <article className="panel">
                  <div className="panel-header">
                    <h2>Store Heatmap</h2>
                    <span className="panel-subtitle">Live risk across the network</span>
                  </div>
                  <div className="store-card-grid">
                    {storeSummaries.map((summary) => (
                      <article
                        key={summary.store.id}
                        className={`store-card ${
                          summary.store.id === selectedStoreId ? "selected" : ""
                        }`}
                        onClick={() => setSelectedStoreId(summary.store.id)}
                      >
                        <h3>{summary.store.name}</h3>
                        <div className="store-meta">
                          {summary.store.district} · {summary.store.displayType}
                        </div>
                        <div className="store-stats">
                          <div className="stat-chip">
                            <span className="small-copy">Active Lots</span>
                            <strong>{summary.activeLots}</strong>
                          </div>
                          <div className="stat-chip">
                            <span className="small-copy">Risky Lots</span>
                            <strong>{summary.riskyLots}</strong>
                          </div>
                          <div className="stat-chip">
                            <span className="small-copy">Pending</span>
                            <strong>{summary.pendingReviews}</strong>
                          </div>
                          <div className="stat-chip">
                            <span className="small-copy">Rescued GMV</span>
                            <strong>{shortCurrency(summary.rescuedGmv)}</strong>
                          </div>
                        </div>
                      </article>
                    ))}
                  </div>
                </article>

                <article className="panel">
                  <div className="panel-header">
                    <h2>Rescued GMV Trend</h2>
                    <span className="panel-subtitle">Last 12 persisted runs</span>
                  </div>
                  <div className="trend-chart">
                    {trend.map((point) => (
                      <div key={point.label} className="trend-bar">
                        <div
                          className="trend-bar-fill"
                          style={{ height: `${(point.value / maxTrend) * 220}px` }}
                        />
                        <span className="trend-bar-label">{point.label}</span>
                      </div>
                    ))}
                  </div>
                </article>
              </div>

              <article className="panel">
                <div className="panel-header">
                  <h2>Priority Lots</h2>
                  <span className="panel-subtitle">
                    Highest-risk perishable inventory at the selected snapshot
                  </span>
                </div>
                <div className="table-wrapper">
                  <table>
                    <thead>
                      <tr>
                        <th>Store</th>
                        <th>SKU</th>
                        <th>Qty</th>
                        <th>Hours Left</th>
                        <th>Risk</th>
                        <th>Action</th>
                        <th>Expected Rescue</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recommendations.slice(0, 10).map((recommendation) => (
                        <tr key={recommendation.id}>
                          <td>
                            {stores.find((store) => store.id === recommendation.storeId)
                              ?.district ?? recommendation.storeId}
                          </td>
                          <td>{recommendation.skuName}</td>
                          <td>{formatNumber(recommendation.lot.quantityOnHand)}</td>
                          <td>{recommendation.lot.hoursToExpiry.toFixed(1)}</td>
                          <td>
                            <span
                              className={`pill ${
                                recommendation.riskScore >= 80
                                  ? "danger"
                                  : recommendation.riskScore >= 60
                                    ? "warn"
                                    : "safe"
                              }`}
                            >
                              {recommendation.riskScore}
                            </span>
                          </td>
                          <td>
                            <span
                              className={`pill ${
                                recommendation.status === "pending_review"
                                  ? "warn"
                                  : ["approved", "auto_applied"].includes(recommendation.status)
                                    ? "safe"
                                    : recommendation.status === "rejected"
                                      ? "danger"
                                      : "neutral"
                              }`}
                            >
                              {recommendation.status.replaceAll("_", " ")}
                            </span>
                          </td>
                          <td>{currency(recommendation.expectedRescueGmv)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </article>
            </section>

            <section
              className={`tab-panel ${activeTab === "operations" ? "is-active" : ""}`}
            >
              <div className="operations-layout">
                <article className="panel">
                  <div className="panel-header">
                    <h2>Store Operations Board</h2>
                    <span className="panel-subtitle">
                      Lot-level decisions for the selected store
                    </span>
                  </div>
                  <div className="table-wrapper">
                    <table>
                      <thead>
                        <tr>
                          <th>SKU</th>
                          <th>Category</th>
                          <th>Qty</th>
                          <th>Hours Left</th>
                          <th>Traffic</th>
                          <th>Base</th>
                          <th>Active</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selectedStoreRecommendations.length ? (
                          selectedStoreRecommendations.map((recommendation) => (
                            <tr key={recommendation.id}>
                              <td>
                                <strong>{recommendation.skuName}</strong>
                                <div className="small-copy">
                                  Lot {recommendation.lot.expiryDate}
                                </div>
                              </td>
                              <td>{recommendation.category}</td>
                              <td>{formatNumber(recommendation.lot.quantityOnHand)}</td>
                              <td>{recommendation.lot.hoursToExpiry.toFixed(1)}</td>
                              <td>{recommendation.lot.itemTraffic.toFixed(2)}x</td>
                              <td>{currency(recommendation.lot.basePrice)}</td>
                              <td>{currency(recommendation.activePrice)}</td>
                              <td>
                                <span
                                  className={`pill ${
                                    recommendation.status === "pending_review"
                                      ? "warn"
                                      : ["approved", "auto_applied"].includes(
                                            recommendation.status
                                          )
                                        ? "safe"
                                        : recommendation.status === "rejected"
                                          ? "danger"
                                          : "neutral"
                                  }`}
                                >
                                  {recommendation.status.replaceAll("_", " ")}
                                </span>
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan="8" className="small-copy">
                              No inventory available for this store and snapshot.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </article>

                <article className="panel stack-panel">
                  <div className="panel-header">
                    <h2>Signal Breakdown</h2>
                    <span className="panel-subtitle">
                      What the engine is reacting to right now
                    </span>
                  </div>
                  <div className="signal-list">
                    {signalCards.map((signal) => (
                      <div key={signal.label} className="signal-card">
                        <div className="metric-label">{signal.label}</div>
                        <div className="signal-value">{signal.value}</div>
                        <div className="small-copy">{signal.note}</div>
                      </div>
                    ))}
                  </div>
                </article>
              </div>
            </section>

            <section
              className={`tab-panel ${activeTab === "approvals" ? "is-active" : ""}`}
            >
              <article className="panel">
                <div className="panel-header">
                  <h2>Manager Approval Queue</h2>
                  <span className="panel-subtitle">
                    Recommendations beyond the safety threshold
                  </span>
                </div>
                <div className="approval-grid">
                  {pendingApprovals.length ? (
                    pendingApprovals.map((recommendation) => (
                      <ApprovalCard
                        key={recommendation.id}
                        recommendation={recommendation}
                        canApprove={canApprove}
                        onApprove={handleApprove}
                        onReject={handleReject}
                      />
                    ))
                  ) : (
                    <div className="panel">
                      <h3>No pending approvals</h3>
                      <p className="small-copy">
                        The current snapshot does not require manager sign-off for the
                        selected store.
                      </p>
                    </div>
                  )}
                </div>
              </article>
            </section>

            <section
              className={`tab-panel ${activeTab === "labels" ? "is-active" : ""}`}
            >
              <article className="panel">
                <div className="panel-header">
                  <h2>Virtual Shelf Label Wall</h2>
                  <span className="panel-subtitle">
                    Live active prices propagated from approved recommendations
                  </span>
                </div>
                <div className="label-grid">
                  {selectedStoreRecommendations.map((recommendation) => {
                    const label = labels[recommendation.lotId];
                    return (
                      <article
                        key={recommendation.id}
                        className={`label-card ${
                          updatedLabelIds.includes(recommendation.lotId) ? "updated" : ""
                        }`}
                      >
                        <div>
                          <h3>{recommendation.skuName}</h3>
                          <p className="small-copy">
                            {recommendation.category} · expires {recommendation.lot.expiryDate}
                          </p>
                        </div>
                        <div className="price-row">
                          <span className="price-main">
                            {currency(label?.currentPrice ?? recommendation.activePrice)}
                          </span>
                          <span className="price-old">
                            {currency(label?.previousPrice ?? recommendation.lot.basePrice)}
                          </span>
                        </div>
                        <div
                          className={`pill ${
                            ["approved", "auto_applied"].includes(recommendation.status)
                              ? "safe"
                              : recommendation.status === "pending_review"
                                ? "warn"
                                : "neutral"
                          }`}
                        >
                          {recommendation.status.replaceAll("_", " ")}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </article>
            </section>

            <section
              className={`tab-panel ${activeTab === "audit" ? "is-active" : ""}`}
            >
              <div className="audit-layout">
                <article className="panel">
                  <div className="panel-header">
                    <h2>Calibration Input</h2>
                    <span className="panel-subtitle">
                      Record shrinkage and spoilage to correct phantom inventory
                    </span>
                  </div>
                  <form className="calibration-form" onSubmit={handleCalibrationSubmit}>
                    <label>
                      SKU
                      <select
                        value={calibrationDraft.skuKey}
                        onChange={(event) =>
                          setCalibrationDraft((current) => ({
                            ...current,
                            skuKey: event.target.value,
                          }))
                        }
                      >
                        {calibrationSkuOptions.map((skuName) => (
                          <option key={skuName} value={skuName}>
                            {skuName}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Shrinkage Units
                      <input
                        type="number"
                        min="0"
                        value={calibrationDraft.shrinkageUnits}
                        onChange={(event) =>
                          setCalibrationDraft((current) => ({
                            ...current,
                            shrinkageUnits: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      Spoiled Units
                      <input
                        type="number"
                        min="0"
                        value={calibrationDraft.spoiledUnits}
                        onChange={(event) =>
                          setCalibrationDraft((current) => ({
                            ...current,
                            spoiledUnits: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label className="full-width">
                      Notes
                      <textarea
                        rows="3"
                        value={calibrationDraft.notes}
                        placeholder="Damaged packaging, stock count mismatch, theft, etc."
                        onChange={(event) =>
                          setCalibrationDraft((current) => ({
                            ...current,
                            notes: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <button className="button button-primary" type="submit">
                      Save Calibration Event
                    </button>
                  </form>
                </article>

                <article className="panel">
                  <div className="panel-header">
                    <h2>Audit Log</h2>
                    <span className="panel-subtitle">
                      Every recommendation, approval, rejection, calibration, and import
                    </span>
                  </div>
                  <div className="audit-log">
                    {visibleAuditLog.slice(0, 14).map((entry) => (
                      <article key={entry.id} className="audit-entry">
                        <div className="audit-entry-header">
                          <span>{entry.type}</span>
                          <span>{formatAuditTime(entry.createdAt ?? entry.at)}</span>
                        </div>
                        <strong>{entry.message}</strong>
                        <p className="small-copy">{entry.details}</p>
                        <div className="small-copy">Actor: {entry.actor}</div>
                      </article>
                    ))}
                  </div>
                </article>
              </div>
            </section>
          </>
        )}
      </main>
    </>
  );
}

function ApprovalCard({ recommendation, canApprove, onApprove, onReject }) {
  const [discount, setDiscount] = useState(recommendation.recommendedDiscountPct);

  useEffect(() => {
    setDiscount(recommendation.recommendedDiscountPct);
  }, [recommendation.recommendedDiscountPct]);

  return (
    <article className="approval-card">
      <h3>{recommendation.skuName}</h3>
      <p className="small-copy">{recommendation.reasonSummary}</p>
      <div className="store-stats">
        <div className="stat-chip">
          <span className="small-copy">Risk Score</span>
          <strong>{recommendation.riskScore}</strong>
        </div>
        <div className="stat-chip">
          <span className="small-copy">Qty on Hand</span>
          <strong>{formatNumber(recommendation.lot.quantityOnHand)}</strong>
        </div>
        <div className="stat-chip">
          <span className="small-copy">Hours Left</span>
          <strong>{recommendation.lot.hoursToExpiry.toFixed(1)}</strong>
        </div>
        <div className="stat-chip">
          <span className="small-copy">Suggested</span>
          <strong>{recommendation.recommendedDiscountPct}%</strong>
        </div>
      </div>
      <div className="approval-card-actions">
        <div className="control-inline">
          <label htmlFor={`discount_${recommendation.id}`}>Discount %</label>
          <input
            id={`discount_${recommendation.id}`}
            type="number"
            min="0"
            max="80"
            value={discount}
            disabled={!canApprove}
            onChange={(event) => setDiscount(Number(event.target.value))}
          />
        </div>
        <button
          className="button button-primary"
          disabled={!canApprove}
          onClick={() => onApprove(recommendation, Math.max(0, Math.min(80, discount)))}
        >
          Approve
        </button>
        <button
          className="button button-danger"
          disabled={!canApprove}
          onClick={() => onReject(recommendation)}
        >
          Reject
        </button>
      </div>
    </article>
  );
}
