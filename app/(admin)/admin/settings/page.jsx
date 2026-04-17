"use client";

import { useEffect, useState } from "react";
import StoreTabs from "@/components/admin/StoreTabs";
import { useAdminBootstrap } from "@/components/admin/use-admin-data";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Spinner from "@/components/ui/Spinner";
import { fetchJson } from "@/lib/fetch-json";

const ARCHETYPES = ["residential", "premium_urban", "transit"];
const ROLLOUT_MODES = ["disabled", "shadow", "live"];

export default function SettingsPage() {
  const bootstrap = useAdminBootstrap();
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchJson("/api/settings")
      .then(setSettings)
      .catch((nextError) => setError(nextError.message));
  }, []);

  if (bootstrap.loading || !settings) {
    return (
      <div className="empty-state">
        <Spinner size="lg" />
      </div>
    );
  }

  const selectedProfile =
    settings.storeProfiles?.find((profile) => profile.storeId === bootstrap.selectedStoreId) ?? null;

  function updateSelectedProfile(field, value) {
    setSettings((current) => ({
      ...current,
      storeProfiles: (current.storeProfiles ?? []).map((profile) =>
        profile.storeId === bootstrap.selectedStoreId
          ? {
              ...profile,
              [field]: value,
            }
          : profile
      ),
      pipeline: {
        ...(current.pipeline ?? {}),
        defaultRolloutModes: {
          ...(current.pipeline?.defaultRolloutModes ?? {}),
          ...(field === "llmMode" ? { [bootstrap.selectedStoreId]: value } : {}),
        },
      },
    }));
  }

  async function save() {
    try {
      setSaving(true);
      setError("");
      setNotice("");
      const next = await fetchJson("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      setSettings(next);
      setNotice("Settings saved.");
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setSaving(false);
    }
  }

  async function reloadCsv() {
    try {
      setSaving(true);
      setError("");
      setNotice("");
      const payload = await fetchJson("/api/imports", { method: "POST" });
      const summary = payload.batch?.summaryJson ?? {};
      setNotice(
        `Loaded ${summary.rows ?? 0} rows across ${summary.stores ?? 0} stores from ${summary.csvFileName ?? "the selected CSV"}.`
      );
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-shell">
      <header className="page-header">
        <p className="page-eyebrow">Settings</p>
        <h1 className="page-title">Thresholds And Sample Control</h1>
        <p className="page-subtitle">Tune system thresholds, rollout defaults, and sample data controls for the demo environment.</p>
      </header>

      <StoreTabs
        selectedStoreId={bootstrap.selectedStoreId}
        stores={bootstrap.stores}
        onChange={bootstrap.setSelectedStoreId}
      />

      {error ? (
        <Card>
          <Card.Body>
            <p className="empty-state__copy">{error}</p>
          </Card.Body>
        </Card>
      ) : null}

      {notice ? (
        <Card>
          <Card.Body>
            <p className="empty-state__copy">{notice}</p>
          </Card.Body>
        </Card>
      ) : null}

      <div className="stack">
        <Card>
          <Card.Header title="Sample Data" subtitle="Baseline reseed controls." />
          <Card.Body>
            <div className="row">
              <Button disabled={saving} onClick={reloadCsv}>
                Load CSV
              </Button>
              <Button disabled={saving} variant="secondary" onClick={reloadCsv}>
                Reset Database
              </Button>
            </div>
          </Card.Body>
        </Card>

        <Card>
          <Card.Header title="Thresholds" subtitle="Guardrail and freshness settings." />
          <Card.Body>
            <div className="field-row">
              <label className="field">
                <span>Auto-markdown max %</span>
                <input
                  value={settings.thresholds.autoMarkdownMaxPct}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      thresholds: {
                        ...current.thresholds,
                        autoMarkdownMaxPct: Number(event.target.value),
                      },
                    }))
                  }
                />
              </label>
              <label className="field">
                <span>Approval threshold %</span>
                <input
                  value={settings.thresholds.approvalThresholdPct}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      thresholds: {
                        ...current.thresholds,
                        approvalThresholdPct: Number(event.target.value),
                      },
                    }))
                  }
                />
              </label>
            </div>
            <div className="field-row">
              <label className="field">
                <span>Low-confidence threshold</span>
                <input
                  value={settings.thresholds.lowConfidenceThreshold}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      thresholds: {
                        ...current.thresholds,
                        lowConfidenceThreshold: Number(event.target.value),
                      },
                    }))
                  }
                />
              </label>
              <label className="field">
                <span>Fresh window (minutes)</span>
                <input
                  value={settings.thresholds.signalStalenessMinutes.fresh}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      thresholds: {
                        ...current.thresholds,
                        signalStalenessMinutes: {
                          ...current.thresholds.signalStalenessMinutes,
                          fresh: Number(event.target.value),
                        },
                      },
                    }))
                  }
                />
              </label>
            </div>
          </Card.Body>
        </Card>

        <Card>
          <Card.Header title="Pipeline" subtitle="Manager PIN and cache defaults." />
          <Card.Body>
            <div className="field-row">
              <label className="field">
                <span>Manager PIN</span>
                <input
                  value={settings.pipeline.managerPin}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      pipeline: {
                        ...current.pipeline,
                        managerPin: event.target.value,
                      },
                    }))
                  }
                />
              </label>
              <label className="field">
                <span>Exa cache TTL (minutes)</span>
                <input
                  value={settings.pipeline.exaCacheTtlMinutes}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      pipeline: {
                        ...current.pipeline,
                        exaCacheTtlMinutes: Number(event.target.value),
                      },
                    }))
                  }
                />
              </label>
            </div>
          </Card.Body>
        </Card>

        <Card>
          <Card.Header
            title="Store Profile"
            subtitle="Edit the selected store identity and rollout mode used across admin, POS, and E-ink."
          />
          <Card.Body>
            {selectedProfile ? (
              <>
                <div className="field-row">
                  <label className="field">
                    <span>Store name</span>
                    <input
                      value={selectedProfile.name ?? ""}
                      onChange={(event) => updateSelectedProfile("name", event.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>Display type</span>
                    <input
                      value={selectedProfile.displayType ?? ""}
                      onChange={(event) => updateSelectedProfile("displayType", event.target.value)}
                    />
                  </label>
                </div>
                <div className="field-row">
                  <label className="field">
                    <span>District</span>
                    <input
                      value={selectedProfile.district ?? ""}
                      onChange={(event) => updateSelectedProfile("district", event.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>Archetype</span>
                    <select
                      value={selectedProfile.archetype ?? "residential"}
                      onChange={(event) => updateSelectedProfile("archetype", event.target.value)}
                    >
                      {ARCHETYPES.map((archetype) => (
                        <option key={archetype} value={archetype}>
                          {archetype}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="field-row">
                  <label className="field">
                    <span>Default rollout mode</span>
                    <select
                      value={selectedProfile.llmMode ?? "shadow"}
                      onChange={(event) => updateSelectedProfile("llmMode", event.target.value)}
                    >
                      {ROLLOUT_MODES.map((mode) => (
                        <option key={mode} value={mode}>
                          {mode}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              </>
            ) : (
              <p className="empty-state__copy">No settings profile was found for the selected store.</p>
            )}
          </Card.Body>
        </Card>

        <div className="row">
          <Button disabled={saving} onClick={save}>
            Save Settings
          </Button>
        </div>
      </div>
    </div>
  );
}
