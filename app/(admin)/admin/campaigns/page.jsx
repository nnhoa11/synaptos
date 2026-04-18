"use client";

import { useEffect, useMemo, useState } from "react";
import CampaignCreateModal from "@/components/admin/CampaignCreateModal";
import StoreTabs from "@/components/admin/StoreTabs";
import styles from "@/components/admin/CampaignsConsole.module.css";
import { useAdminBootstrap } from "@/components/admin/use-admin-data";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Spinner from "@/components/ui/Spinner";
import { fetchJson } from "@/lib/fetch-json";
import { formatAuditTime, shortCurrency } from "@/lib/prototype-core";

function mapStoreArchetype(store) {
  if (store?.archetype === "premium") {
    return "premium_urban";
  }
  if (store?.archetype === "transit") {
    return "transit";
  }
  return "residential";
}

function compactMoney(value) {
  return `${shortCurrency(Number(value ?? 0))} VND`;
}

function hoursToMinutes(time) {
  const [hours, minutes] = String(time ?? "00:00")
    .split(":")
    .map((value) => Number(value));
  return hours * 60 + minutes;
}

function buildCampaignPayload(storeId, window, index) {
  const now = new Date();
  const [startHour, startMinute] = String(window.start_time ?? "17:00")
    .split(":")
    .map((value) => Number(value));
  const [endHour, endMinute] = String(window.end_time ?? "18:00")
    .split(":")
    .map((value) => Number(value));

  const startsAt = new Date(now);
  startsAt.setHours(startHour, startMinute, 0, 0);

  const endsAt = new Date(now);
  endsAt.setHours(endHour, endMinute, 0, 0);

  if (startsAt.getTime() <= Date.now()) {
    startsAt.setDate(startsAt.getDate() + 1);
  }
  if (endsAt.getTime() <= startsAt.getTime()) {
    endsAt.setDate(startsAt.getDate());
    if (endsAt.getTime() <= startsAt.getTime()) {
      endsAt.setDate(endsAt.getDate() + 1);
    }
  }

  return {
    storeId,
    name: `AI ${window.target_category} Window ${index + 1}`,
    type: "flash_sale",
    targetCategory: window.target_category || null,
    targetSkuId: "",
    discountPct: Number(window.discount_pct ?? 0),
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
  };
}

function summarizeSuggestion(store, suggestionPayload, storefront) {
  const suggestion = suggestionPayload?.suggestion ?? null;
  const input = suggestionPayload?.input ?? null;

  return {
    archetype: suggestion?.archetype ?? mapStoreArchetype(store),
    confidence: Number(suggestion?.confidence ?? 0),
    windowCount: suggestion?.windows?.length ?? 0,
    avgTraffic: Number(input?.intraday_traffic?.avg_item_traffic ?? 0),
    lotCount: Number(input?.inventory_state?.lot_count ?? storefront.products.length ?? 0),
    markdownCandidates: Number(input?.inventory_state?.markdown_candidates ?? 0),
    district: input?.district_profile?.district ?? store?.district ?? "n/a",
    peakHours: input?.district_profile?.peak_hours ?? input?.intraday_traffic?.peak_hours ?? [],
  };
}

function campaignTone(status) {
  if (status === "active") {
    return "green";
  }
  if (status === "scheduled") {
    return "blue";
  }
  if (status === "expired") {
    return "gray";
  }
  return "amber";
}

export default function CampaignsPage() {
  const bootstrap = useAdminBootstrap();
  const [refreshToken, setRefreshToken] = useState(0);
  const [campaigns, setCampaigns] = useState([]);
  const [storefront, setStorefront] = useState({ products: [], activeCampaigns: [] });
  const [modalOpen, setModalOpen] = useState(false);
  const [modalDraft, setModalDraft] = useState(null);
  const [suggestionPayload, setSuggestionPayload] = useState(null);
  const [editableWindows, setEditableWindows] = useState([]);
  const [selectedWindowIndex, setSelectedWindowIndex] = useState(0);
  const [loadingSuggestion, setLoadingSuggestion] = useState(false);
  const [savingCampaign, setSavingCampaign] = useState(false);
  const [error, setError] = useState("");

  const selectedStore = bootstrap.stores.find((store) => store.id === bootstrap.selectedStoreId) ?? null;
  const categories = useMemo(
    () => [...new Set((storefront.products ?? []).map((product) => product.category).filter(Boolean))],
    [storefront.products]
  );

  useEffect(() => {
    if (!bootstrap.selectedStoreId) {
      return;
    }

    let active = true;

    Promise.all([
      fetchJson(`/api/campaigns?storeId=${encodeURIComponent(bootstrap.selectedStoreId)}`),
      fetchJson(`/api/storefront?storeId=${encodeURIComponent(bootstrap.selectedStoreId)}`),
    ])
      .then(([campaignRows, storefrontPayload]) => {
        if (!active) {
          return;
        }

        setCampaigns(campaignRows);
        setStorefront(storefrontPayload);
      })
      .catch((nextError) => {
        if (active) {
          setError(nextError.message);
        }
      });

    return () => {
      active = false;
    };
  }, [bootstrap.selectedStoreId, refreshToken]);

  useEffect(() => {
    if (!bootstrap.selectedStoreId || !selectedStore) {
      return;
    }

    let active = true;
    setLoadingSuggestion(true);

    fetchJson("/api/campaigns/suggest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storeId: bootstrap.selectedStoreId,
        archetype: mapStoreArchetype(selectedStore),
      }),
    })
      .then((payload) => {
        if (!active) {
          return;
        }

        setSuggestionPayload(payload);
        setEditableWindows(payload?.suggestion?.windows ?? []);
        setSelectedWindowIndex(0);
      })
      .catch((nextError) => {
        if (active) {
          setError(nextError.message);
        }
      })
      .finally(() => {
        if (active) {
          setLoadingSuggestion(false);
        }
      });

    return () => {
      active = false;
    };
  }, [bootstrap.selectedStoreId, selectedStore]);

  if (bootstrap.loading) {
    return (
      <div className="empty-state">
        <Spinner size="lg" />
      </div>
    );
  }

  async function createCampaign(draft) {
    try {
      setSavingCampaign(true);
      setError("");
      await fetchJson("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      setModalOpen(false);
      setModalDraft(null);
      setRefreshToken((current) => current + 1);
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setSavingCampaign(false);
    }
  }

  async function stopCampaign(campaignId) {
    try {
      setError("");
      await fetchJson(`/api/campaigns/${encodeURIComponent(campaignId)}`, { method: "DELETE" });
      setRefreshToken((current) => current + 1);
    } catch (nextError) {
      setError(nextError.message);
    }
  }

  async function regenerateSuggestion() {
    if (!bootstrap.selectedStoreId || !selectedStore) {
      return;
    }

    try {
      setError("");
      setLoadingSuggestion(true);
      const payload = await fetchJson("/api/campaigns/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: bootstrap.selectedStoreId,
          archetype: mapStoreArchetype(selectedStore),
        }),
      });
      setSuggestionPayload(payload);
      setEditableWindows(payload?.suggestion?.windows ?? []);
      setSelectedWindowIndex(0);
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setLoadingSuggestion(false);
    }
  }

  async function applyWindow(window, index) {
    await createCampaign(buildCampaignPayload(bootstrap.selectedStoreId, window, index));
  }

  async function applyAllWindows() {
    if (!editableWindows.length) {
      return;
    }

    try {
      setSavingCampaign(true);
      setError("");
      for (const [index, window] of editableWindows.entries()) {
        await fetchJson("/api/campaigns", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildCampaignPayload(bootstrap.selectedStoreId, window, index)),
        });
      }
      setRefreshToken((current) => current + 1);
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setSavingCampaign(false);
    }
  }

  const campaignGroups = {
    active: campaigns.filter((campaign) => campaign.status === "active"),
    scheduled: campaigns.filter((campaign) => campaign.status === "scheduled"),
    history: campaigns.filter((campaign) => !["active", "scheduled"].includes(campaign.status)),
  };

  const suggestionSummary = summarizeSuggestion(selectedStore, suggestionPayload, storefront);
  const selectedWindow = editableWindows[selectedWindowIndex] ?? null;
  const maxDiscount = Math.max(1, ...editableWindows.map((window) => Number(window.discount_pct ?? 0)));
  const scenarioRows = [
    {
      title: "Traffic posture",
      copy: `${suggestionSummary.peakHours.join(" / ") || "Peak hours unavailable"} remain the dominant operating window.`,
      tone: "blue",
    },
    {
      title: "Inventory posture",
      copy: `${suggestionSummary.lotCount} live lots with ${suggestionSummary.markdownCandidates} markdown candidates currently surfaced.`,
      tone: "amber",
    },
    {
      title: "Archetype stance",
      copy: `${suggestionSummary.archetype} strategy is active for ${selectedStore?.displayType ?? "the selected store"}.`,
      tone: "green",
    },
  ];

  return (
    <div className={`page-shell ${styles.page}`}>
      <header className="page-header">
        <p className="page-eyebrow">Campaigns</p>
        <h1 className="page-title">AI-Driven Campaign Planning</h1>
        <p className="page-subtitle">
          Generate strategy-aligned campaign windows, review them like an operator, and promote approved ideas into live
          store campaigns.
        </p>
      </header>

      <StoreTabs
        selectedStoreId={bootstrap.selectedStoreId}
        stores={bootstrap.stores}
        onChange={bootstrap.setSelectedStoreId}
      />

      <div className={styles.toolbar}>
        <div className={styles.toolbarGroup}>
          <Button onClick={() => {
            setModalDraft({
              storeId: bootstrap.selectedStoreId,
              name: `${selectedStore?.displayType ?? "Store"} Flash Sale`,
              targetCategory: categories[0] ?? "",
            });
            setModalOpen(true);
          }}>
            Create Campaign
          </Button>
          <Button variant="secondary" onClick={regenerateSuggestion}>
            {loadingSuggestion ? "Refreshing AI" : "Refresh AI Recommendations"}
          </Button>
        </div>

        <div className={styles.toolbarGroup}>
          <Badge tone="blue">{selectedStore?.displayType ?? "Store"}</Badge>
          <Badge tone="gray">{selectedStore?.district ?? "n/a"}</Badge>
          <Badge tone={suggestionPayload?.status === "completed" ? "green" : "amber"}>
            {suggestionPayload?.status ?? "idle"}
          </Badge>
        </div>
      </div>

      {error ? (
        <Card>
          <Card.Body>
            <p className="empty-state__copy">{error}</p>
          </Card.Body>
        </Card>
      ) : null}

      <div className={styles.hero}>
        <Card className={styles.heroPrimary}>
          <Card.Body className={styles.heroBody}>
            <div className={styles.heroTop}>
              <div className="stack" style={{ gap: 10 }}>
                <p className={styles.eyebrow}>AI Campaign Briefing</p>
                <h2 className={styles.heroTitle}>{selectedStore?.name ?? "Selected store unavailable"}</h2>
                <p className={styles.heroCopy}>
                  The planner is reading district archetype, intraday traffic, and live inventory posture to recommend
                  campaign windows for admin review.
                </p>
              </div>

              <div className={styles.heroActions}>
                <Button className={styles.glassButton} variant="secondary" onClick={applyAllWindows} disabled={!editableWindows.length || savingCampaign}>
                  {savingCampaign ? "Applying..." : "Apply All Windows"}
                </Button>
                <Button
                  className={styles.glassButton}
                  variant="secondary"
                  onClick={() => {
                    setModalDraft({
                      storeId: bootstrap.selectedStoreId,
                      name: selectedWindow ? `AI ${selectedWindow.target_category} Recommendation` : `${selectedStore?.displayType ?? "Store"} Campaign`,
                      targetCategory: selectedWindow?.target_category ?? categories[0] ?? "",
                      discountPct: Number(selectedWindow?.discount_pct ?? 15),
                    });
                    setModalOpen(true);
                  }}
                >
                  Open As Draft
                </Button>
              </div>
            </div>

            <div className={styles.insightRow}>
              <div className={styles.insightTile}>
                <p className={styles.insightLabel}>Confidence</p>
                <strong className={styles.insightValue}>{Math.round((suggestionSummary.confidence ?? 0) * 100)}%</strong>
                <span className={styles.insightMeta}>Campaign agent confidence for the current recommendation set.</span>
              </div>
              <div className={styles.insightTile}>
                <p className={styles.insightLabel}>Peak Hours</p>
                <strong className={styles.insightValue}>{suggestionSummary.peakHours[0] ?? "n/a"}</strong>
                <span className={styles.insightMeta}>Observed traffic windows currently steering campaign timing.</span>
              </div>
              <div className={styles.insightTile}>
                <p className={styles.insightLabel}>Live Lots</p>
                <strong className={styles.insightValue}>{suggestionSummary.lotCount}</strong>
                <span className={styles.insightMeta}>Campaignable assortment being considered in this planning cycle.</span>
              </div>
              <div className={styles.insightTile}>
                <p className={styles.insightLabel}>Recommended Windows</p>
                <strong className={styles.insightValue}>{suggestionSummary.windowCount}</strong>
                <span className={styles.insightMeta}>Actionable discount windows generated for manager review.</span>
              </div>
            </div>
          </Card.Body>
        </Card>

        <Card>
          <Card.Body className={styles.briefingPanel}>
            <div>
              <p className="page-eyebrow" style={{ margin: 0 }}>
                Planning Context
              </p>
              <h3 style={{ margin: "6px 0 0" }}>Operator Summary</h3>
            </div>

            <div className={styles.briefingGrid}>
              <div className={styles.briefingTile}>
                <strong>District</strong>
                <span className={styles.muted}>{suggestionSummary.district}</span>
              </div>
              <div className={styles.briefingTile}>
                <strong>Archetype</strong>
                <span className={styles.muted}>{suggestionSummary.archetype}</span>
              </div>
              <div className={styles.briefingTile}>
                <strong>Avg item traffic</strong>
                <span className={styles.muted}>{Number(suggestionSummary.avgTraffic ?? 0).toFixed(2)}x</span>
              </div>
              <div className={styles.briefingTile}>
                <strong>Active campaigns</strong>
                <span className={styles.muted}>{storefront.activeCampaigns?.length ?? 0}</span>
              </div>
            </div>

            <div className={styles.confidenceBlock}>
              <strong>AI note</strong>
              <p className={styles.muted} style={{ margin: "6px 0 0" }}>
                Recommendations do not auto-apply. Admin can edit each window, open it as a campaign draft, or promote
                the whole plan into scheduled campaigns.
              </p>
              {suggestionPayload?.failureReason ? (
                <p className={styles.muted} style={{ margin: "6px 0 0" }}>
                  Fallback used: {suggestionPayload.failureReason}
                </p>
              ) : null}
            </div>
          </Card.Body>
        </Card>
      </div>

      <div className={styles.bento}>
        <Card className={styles.recommendationsCard}>
          <Card.Header
            title="AI Recommendation Windows"
            subtitle="Review, tune, and promote each generated campaign window."
          />
          <Card.Body>
            {loadingSuggestion ? (
              <div className="empty-state">
                <Spinner size="lg" />
              </div>
            ) : editableWindows.length ? (
              <div className={styles.recommendationList}>
                {editableWindows.map((window, index) => (
                  <article
                    className={`${styles.recommendationCard} ${index === selectedWindowIndex ? styles.isSelected : ""}`}
                    key={`${window.start_time}-${window.end_time}-${index}`}
                  >
                    <div className={styles.recommendationHead}>
                      <div>
                        <strong>
                          Window {index + 1}: {window.start_time} - {window.end_time}
                        </strong>
                        <div className={styles.recommendationLine}>
                          <span>{window.target_category || "All categories"}</span>
                          <span>{window.discount_pct}% markdown</span>
                          <span>{selectedStore?.displayType ?? "Store"} strategy</span>
                        </div>
                      </div>
                      <Badge tone={index === selectedWindowIndex ? "blue" : "gray"}>
                        {Math.round((suggestionSummary.confidence ?? 0) * 100)}% confidence
                      </Badge>
                    </div>

                    <div className={styles.recommendationInputs}>
                      <div className={styles.miniField}>
                        <label>Start</label>
                        <input
                          value={window.start_time}
                          onChange={(event) =>
                            setEditableWindows((current) =>
                              current.map((row, rowIndex) =>
                                rowIndex === index ? { ...row, start_time: event.target.value } : row
                              )
                            )
                          }
                        />
                      </div>
                      <div className={styles.miniField}>
                        <label>End</label>
                        <input
                          value={window.end_time}
                          onChange={(event) =>
                            setEditableWindows((current) =>
                              current.map((row, rowIndex) =>
                                rowIndex === index ? { ...row, end_time: event.target.value } : row
                              )
                            )
                          }
                        />
                      </div>
                      <div className={styles.miniField}>
                        <label>Discount %</label>
                        <input
                          type="number"
                          min="5"
                          max="50"
                          value={window.discount_pct}
                          onChange={(event) =>
                            setEditableWindows((current) =>
                              current.map((row, rowIndex) =>
                                rowIndex === index ? { ...row, discount_pct: Number(event.target.value) } : row
                              )
                            )
                          }
                        />
                      </div>
                      <div className={styles.miniField}>
                        <label>Category</label>
                        <select
                          value={window.target_category}
                          onChange={(event) =>
                            setEditableWindows((current) =>
                              current.map((row, rowIndex) =>
                                rowIndex === index ? { ...row, target_category: event.target.value } : row
                              )
                            )
                          }
                        >
                          {[...new Set([window.target_category, ...categories].filter(Boolean))].map((category) => (
                            <option key={category} value={category}>
                              {category}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className={styles.recommendationMeta}>
                      <div className={styles.recommendationLine}>
                        <span>Duration {Math.max(0, hoursToMinutes(window.end_time) - hoursToMinutes(window.start_time))} min</span>
                        <span>Store {selectedStore?.district ?? "n/a"}</span>
                        <span>Status ready for review</span>
                      </div>

                      <div className={styles.recommendationActions}>
                        <Button size="sm" variant="secondary" onClick={() => setSelectedWindowIndex(index)}>
                          Inspect
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setModalDraft({
                              ...buildCampaignPayload(bootstrap.selectedStoreId, window, index),
                              durationMinutes: Math.max(
                                15,
                                hoursToMinutes(window.end_time) - hoursToMinutes(window.start_time)
                              ),
                              startsAt: "now",
                            });
                            setModalOpen(true);
                          }}
                        >
                          Open Draft
                        </Button>
                        <Button size="sm" onClick={() => applyWindow(window, index)} disabled={savingCampaign}>
                          Apply Window
                        </Button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <div className={styles.emptyBox}>No recommendation windows available yet for this store.</div>
            )}
          </Card.Body>
        </Card>

        <Card className={styles.ledgerCard}>
          <Card.Header
            title="Campaign Ledger"
            subtitle="Live status of active, scheduled, and historical campaigns."
          />
          <Card.Body>
            <div className={styles.campaignList}>
              {[["Active", campaignGroups.active], ["Scheduled", campaignGroups.scheduled], ["History", campaignGroups.history]].map(
                ([label, rows]) => (
                  <div key={label} className="stack" style={{ gap: 10 }}>
                    <div className={styles.sectionHeader}>
                      <strong>{label}</strong>
                      <Badge tone="gray">{rows.length}</Badge>
                    </div>

                    {rows.length ? (
                      rows.map((campaign) => (
                        <article
                          className={`${styles.campaignCard} ${
                            campaign.status === "active"
                              ? styles.isActive
                              : campaign.status === "scheduled"
                                ? styles.isScheduled
                                : styles.isExpired
                          }`}
                          key={campaign.id}
                        >
                          <div className={styles.campaignMeta}>
                            <div>
                              <strong>{campaign.name ?? campaign.type}</strong>
                              <div className={styles.muted}>
                                {campaign.targetCategory ?? campaign.targetSkuId ?? "All products"}
                              </div>
                            </div>
                            <Badge tone={campaignTone(campaign.status)}>{campaign.status}</Badge>
                          </div>

                          <div className={styles.recommendationLine}>
                            <span>{campaign.discountPct ?? 0}%</span>
                            <span>{formatAuditTime(campaign.startsAt)}</span>
                          </div>

                          <div className={styles.recommendationActions}>
                            {campaign.status !== "expired" ? (
                              <Button size="sm" variant="danger" onClick={() => stopCampaign(campaign.id)}>
                                Stop Early
                              </Button>
                            ) : null}
                          </div>
                        </article>
                      ))
                    ) : (
                      <div className={styles.emptyBox}>No {String(label).toLowerCase()} campaigns.</div>
                    )}
                  </div>
                )
              )}
            </div>
          </Card.Body>
        </Card>

        <Card className={styles.plannerCard}>
          <Card.Header
            title="Window Timeline"
            subtitle="How the AI recommendation spans the selected store's trading day."
          />
          <Card.Body>
            {editableWindows.length ? (
              <div className={styles.timeline}>
                {editableWindows.map((window, index) => {
                  const start = hoursToMinutes(window.start_time);
                  const end = hoursToMinutes(window.end_time);
                  const left = ((start - 6 * 60) / (16 * 60)) * 100;
                  const width = (Math.max(30, end - start) / (16 * 60)) * 100;

                  return (
                    <div className={styles.timelineLane} key={`${window.start_time}-${window.end_time}-${index}`}>
                      <div className={styles.recommendationMeta}>
                        <strong>
                          Window {index + 1}: {window.target_category}
                        </strong>
                        <span className={styles.muted}>{window.discount_pct}%</span>
                      </div>
                      <div className={styles.timelineTrack}>
                        <span className={styles.timelineSegment} style={{ left: `${left}%`, width: `${width}%` }} />
                      </div>
                      <div className={styles.timelineLegend}>
                        <span>{window.start_time}</span>
                        <span>{window.end_time}</span>
                        <span>{selectedStore?.district ?? "n/a"}</span>
                      </div>
                    </div>
                  );
                })}

                <div className={styles.timelineHours}>
                  {["06", "08", "10", "12", "14", "16", "18", "20"].map((hour) => (
                    <span key={hour}>{hour}:00</span>
                  ))}
                </div>
              </div>
            ) : (
              <div className={styles.emptyBox}>Generate AI recommendations to populate the planner timeline.</div>
            )}
          </Card.Body>
        </Card>

        <Card className={styles.performanceCard}>
          <Card.Header
            title="Recommended Intensity"
            subtitle="Relative discount pressure across the generated windows."
          />
          <Card.Body>
            {editableWindows.length ? (
              <div className={styles.performanceList}>
                {editableWindows.map((window, index) => (
                  <div className={styles.performanceRow} key={`${window.start_time}-${window.end_time}-${index}`}>
                    <div className={styles.recommendationMeta}>
                      <strong>
                        Window {index + 1} · {window.target_category}
                      </strong>
                      <span className={styles.muted}>{window.discount_pct}%</span>
                    </div>
                    <div className={styles.performanceBar}>
                      <span style={{ width: `${(Number(window.discount_pct ?? 0) / maxDiscount) * 100}%` }} />
                    </div>
                    <div className={styles.recommendationLine}>
                      <span>{window.start_time} - {window.end_time}</span>
                      <span>{selectedStore?.displayType ?? "Store"} fit</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className={styles.emptyBox}>No intensity curve available yet.</div>
            )}
          </Card.Body>
        </Card>

        <Card className={styles.strategyCard}>
          <Card.Header
            title="Scenario Notes"
            subtitle="Compact operator framing for the current recommendation cycle."
          />
          <Card.Body>
            <div className={styles.scenarioList}>
              {scenarioRows.map((row) => (
                <article className={styles.scenarioCard} key={row.title}>
                  <div className={styles.scenarioHead}>
                    <strong>{row.title}</strong>
                    <Badge tone={row.tone}>{row.tone}</Badge>
                  </div>
                  <p className={styles.muted} style={{ margin: 0 }}>
                    {row.copy}
                  </p>
                </article>
              ))}
            </div>
          </Card.Body>
        </Card>
      </div>

      <CampaignCreateModal
        categories={categories}
        initialDraft={modalDraft}
        onClose={() => {
          setModalOpen(false);
          setModalDraft(null);
        }}
        onSubmit={createCampaign}
        open={modalOpen}
        stores={bootstrap.stores}
      />
    </div>
  );
}
