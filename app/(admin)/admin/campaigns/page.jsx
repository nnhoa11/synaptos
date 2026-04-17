"use client";

import { useEffect, useState } from "react";
import CampaignCreateModal from "@/components/admin/CampaignCreateModal";
import GeoStrategyCard from "@/components/admin/GeoStrategyCard";
import StoreTabs from "@/components/admin/StoreTabs";
import { useAdminBootstrap } from "@/components/admin/use-admin-data";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Modal from "@/components/ui/Modal";
import Spinner from "@/components/ui/Spinner";
import { fetchJson } from "@/lib/fetch-json";
import { formatAuditTime } from "@/lib/prototype-core";

const STRATEGY_SEEDS = {
  residential: [
    { start_time: "17:00", end_time: "19:00", discount_pct: "15", target_category: "Produce" },
  ],
  premium_urban: [
    { start_time: "12:00", end_time: "12:30", discount_pct: "8", target_category: "RTE" },
  ],
  transit: [
    { start_time: "20:00", end_time: "22:00", discount_pct: "25", target_category: "Sandwich" },
  ],
};

export default function CampaignsPage() {
  const bootstrap = useAdminBootstrap();
  const [refreshToken, setRefreshToken] = useState(0);
  const [campaigns, setCampaigns] = useState([]);
  const [activeTab, setActiveTab] = useState("flash");
  const [modalOpen, setModalOpen] = useState(false);
  const [suggestion, setSuggestion] = useState(null);
  const [error, setError] = useState("");
  const [strategyRows, setStrategyRows] = useState(STRATEGY_SEEDS);

  useEffect(() => {
    if (!bootstrap.selectedStoreId) {
      return;
    }

    let active = true;
    fetchJson(`/api/campaigns?storeId=${encodeURIComponent(bootstrap.selectedStoreId)}`)
      .then((payload) => {
        if (active) {
          setCampaigns(payload);
        }
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

  if (bootstrap.loading) {
    return (
      <div className="empty-state">
        <Spinner size="lg" />
      </div>
    );
  }

  async function createCampaign(draft) {
    try {
      setError("");
      await fetchJson("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      setModalOpen(false);
      setRefreshToken((current) => current + 1);
    } catch (nextError) {
      setError(nextError.message);
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

  async function suggest(archetype) {
    try {
      setError("");
      const payload = await fetchJson("/api/campaigns/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId: bootstrap.selectedStoreId, archetype }),
      });
      setSuggestion(payload);
    } catch (nextError) {
      setError(nextError.message);
    }
  }

  return (
    <div className="page-shell">
      <header className="page-header">
        <p className="page-eyebrow">Campaigns</p>
        <h1 className="page-title">Flash Sales And Geo Strategies</h1>
        <p className="page-subtitle">
          Launch immediate markdown campaigns or generate district-aware suggestions for manager review.
        </p>
      </header>

      <StoreTabs
        selectedStoreId={bootstrap.selectedStoreId}
        stores={bootstrap.stores}
        onChange={bootstrap.setSelectedStoreId}
      />

      <div className="row">
        <Button variant={activeTab === "flash" ? "primary" : "secondary"} onClick={() => setActiveTab("flash")}>
          Flash Sales
        </Button>
        <Button variant={activeTab === "geo" ? "primary" : "secondary"} onClick={() => setActiveTab("geo")}>
          Geo-Demographic
        </Button>
      </div>

      {error ? (
        <Card>
          <Card.Body>
            <p className="empty-state__copy">{error}</p>
          </Card.Body>
        </Card>
      ) : null}

      {activeTab === "flash" ? (
        <div className="stack">
          <Card>
            <Card.Header
              actions={
                <Button onClick={() => setModalOpen(true)}>Create Campaign</Button>
              }
              title="Flash Sales"
              subtitle="Campaigns apply label updates immediately when the start time is now."
            />
            <Card.Body>
              <div className="stack" style={{ gap: 10 }}>
                {campaigns.length ? (
                  campaigns.map((campaign) => (
                    <div className="alert-row" key={campaign.id}>
                      <div className="stack" style={{ gap: 2 }}>
                        <strong>{campaign.name ?? campaign.type}</strong>
                        <span className="metric-footnote">
                          {campaign.targetCategory ?? campaign.targetSkuId ?? "All products"} · {campaign.discountPct ?? 0}% ·
                          {` ${formatAuditTime(campaign.startsAt)} → ${formatAuditTime(campaign.endsAt)}`}
                        </span>
                      </div>
                      <div className="row">
                        <span className="metric-footnote">{campaign.status}</span>
                        {campaign.status !== "expired" ? (
                          <Button size="sm" variant="danger" onClick={() => stopCampaign(campaign.id)}>
                            Stop Early
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="empty-state">
                    <p className="empty-state__copy">No campaigns are scheduled for the selected store.</p>
                  </div>
                )}
              </div>
            </Card.Body>
          </Card>
        </div>
      ) : (
        <div className="grid-3">
          {[
            {
              key: "residential",
              label: "Residential",
              description: "Progressive volume discounts during the after-work family basket window.",
            },
            {
              key: "premium_urban",
              label: "Premium Urban",
              description: "Defer discounts and favor small midday adjustments on ready-to-eat inventory.",
            },
            {
              key: "transit",
              label: "Transit",
              description: "Hold flat pricing through the day, then clear aggressively at end-of-day.",
            },
          ].map((card) => (
            <GeoStrategyCard
              key={card.key}
              archetype={card.label}
              description={card.description}
              rows={strategyRows[card.key]}
              onAddRow={() =>
                setStrategyRows((current) => ({
                  ...current,
                  [card.key]: [
                    ...current[card.key],
                    { start_time: "12:00", end_time: "13:00", discount_pct: "10", target_category: "Produce" },
                  ],
                }))
              }
              onChange={(index, field, value) =>
                setStrategyRows((current) => ({
                  ...current,
                  [card.key]: current[card.key].map((row, rowIndex) =>
                    rowIndex === index ? { ...row, [field]: value } : row
                  ),
                }))
              }
              onRemoveRow={(index) =>
                setStrategyRows((current) => ({
                  ...current,
                  [card.key]: current[card.key].filter((_, rowIndex) => rowIndex !== index),
                }))
              }
              onSuggest={() => suggest(card.key)}
            />
          ))}
        </div>
      )}

      <CampaignCreateModal
        onClose={() => setModalOpen(false)}
        onSubmit={createCampaign}
        open={modalOpen}
        stores={bootstrap.stores}
      />

      <Modal
        onClose={() => setSuggestion(null)}
        open={Boolean(suggestion)}
        title="AI Campaign Suggestion"
        width="840px"
      >
        <pre className="json-panel__pre">{JSON.stringify(suggestion, null, 2)}</pre>
      </Modal>
    </div>
  );
}
