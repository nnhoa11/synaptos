"use client";

import { useEffect, useMemo, useState } from "react";
import Badge from "@/components/ui/Badge";
import StoreTabs from "@/components/admin/StoreTabs";
import { useAdminBootstrap, useControlTowerDetail } from "@/components/admin/use-admin-data";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import Spinner from "@/components/ui/Spinner";
import Table from "@/components/ui/Table";
import { fetchJson } from "@/lib/fetch-json";
import { generateTaxWriteoffPDF } from "@/lib/client/pdf/tax-writeoff-pdf";
import { currency } from "@/lib/prototype-core";
import styles from "@/components/admin/OpsWorkbench.module.css";

function buildRange(range) {
  const now = new Date();
  const from = new Date(now.getTime() - range * 24 * 60 * 60 * 1000);
  return {
    from: from.toISOString(),
    to: now.toISOString(),
  };
}

async function copyText(value, setCopiedKey, key) {
  try {
    await navigator.clipboard.writeText(value);
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey(""), 1600);
  } catch {
    setCopiedKey("");
  }
}

function urgencyTone(level) {
  if (level === "immediate") {
    return "red";
  }
  if (level === "high") {
    return "amber";
  }
  if (level === "watch") {
    return "blue";
  }
  return "gray";
}

export default function TaxWriteoffPage() {
  const bootstrap = useAdminBootstrap();
  const detailState = useControlTowerDetail(bootstrap.selectedStoreId, bootstrap.defaultSnapshot);
  const [range, setRange] = useState("7");
  const [events, setEvents] = useState([]);
  const [error, setError] = useState("");
  const [copiedKey, setCopiedKey] = useState("");

  useEffect(() => {
    if (!bootstrap.selectedStoreId) {
      return;
    }

    const { from, to } = buildRange(Number(range));
    fetchJson(
      `/api/eol-events?storeId=${encodeURIComponent(bootstrap.selectedStoreId)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
    )
      .then((payload) => {
        setEvents(Array.isArray(payload) ? payload : []);
        setError("");
      })
      .catch((nextError) => setError(nextError.message));
  }, [bootstrap.selectedStoreId, range]);

  const fallbackEvents = useMemo(() => {
    const detail = detailState.detail;
    const store = detail?.store;
    if (!store) {
      return [];
    }

    return (detail.inventoryLots ?? [])
      .filter((lot) => Number(lot.hoursToExpiry ?? 999) <= 10 || Number(lot.spoilageRisk ?? 0) >= 0.76)
      .sort((left, right) => Number(left.hoursToExpiry ?? 999) - Number(right.hoursToExpiry ?? 999))
      .slice(0, 6)
      .map((lot, index) => {
        const routeLabel = Number(lot.hoursToExpiry ?? 999) <= 6 ? "tax write-off hold" : "cross-dock rescue";
        const routePriority = Number(lot.hoursToExpiry ?? 999) <= 6 ? "immediate" : "high";
        const quantity = Number(lot.quantity ?? 0);
        const originalValue = Math.round(Number(lot.originalPrice ?? lot.currentPrice ?? 0) * quantity);
        const writeoffValue = Math.round((Number(lot.cost ?? 0) || originalValue) * 0.35);
        return {
          id: `fallback-eol-${lot.lotId}-${index}`,
          store_id: detail.storeId,
          sku_id: lot.lotId,
          product_name: lot.productName,
          category: lot.category,
          quantity,
          original_value: originalValue,
          writeoff_value: writeoffValue,
          eol_at: new Date(new Date(detail.snapshotKey).getTime() + Math.max(30, Number(lot.hoursToExpiry ?? 1) * 60) * 60000).toISOString(),
          routing_destination: routeLabel.includes("tax") ? "eol" : "cross_dock",
          route_label: routeLabel,
          route_priority: routePriority,
          store_name: store.name,
          district: store.district,
          coordinator_name: `${store.district} Logistics`,
          coordinator_email: `${detail.storeId}.logistics@synaptos.local`,
          pickup_window: routePriority === "immediate" ? "within 60 min" : "before next peak window",
          handoff_message: `${store.name} should isolate ${quantity} units of ${lot.productName} for ${routeLabel}.`,
          call_script: `Call ${store.district} Logistics and confirm ${quantity} units of ${lot.productName} are staged for ${routeLabel}.`,
          checklist: [
            "Pull units from the sale floor.",
            "Verify counts against the live ledger.",
            "Attach finance note for the write-off packet.",
          ],
        };
      });
  }, [detailState.detail]);

  const displayEvents = events.length ? events : fallbackEvents;

  const totals = useMemo(() => {
    const quantity = displayEvents.reduce((sum, event) => sum + Number(event.quantity ?? 0), 0);
    const original = displayEvents.reduce((sum, event) => sum + Number(event.original_value ?? 0), 0);
    const writeoff = displayEvents.reduce((sum, event) => sum + Number(event.writeoff_value ?? 0), 0);
    const routes = new Map();

    for (const event of displayEvents) {
      const key = event.route_label ?? event.routing_destination ?? "Unclassified";
      const current = routes.get(key) ?? {
        label: key,
        count: 0,
        quantity: 0,
        writeoff: 0,
        priority: event.route_priority ?? "normal",
      };
      current.count += 1;
      current.quantity += Number(event.quantity ?? 0);
      current.writeoff += Number(event.writeoff_value ?? 0);
      routes.set(key, current);
    }

    return {
      quantity,
      original,
      writeoff,
      routeCount: routes.size,
      routeRows: [...routes.values()].sort((left, right) => right.writeoff - left.writeoff),
    };
  }, [displayEvents]);

  const handoffDraft = useMemo(() => {
    const lead = displayEvents[0];
    if (!lead) {
      return null;
    }

    const subject = `[SynaptOS][EOL Write-off] ${lead.store_name} has ${displayEvents.length} lots staged for tax routing`;
    const body = [
      `To: ${lead.coordinator_name} <${lead.coordinator_email}>`,
      "",
      `Store: ${lead.store_name} (${lead.store_id})`,
      `Period: last ${range} days`,
      `Lots staged: ${displayEvents.length}`,
      `Total quantity: ${totals.quantity}`,
      `Estimated write-off: ${totals.writeoff.toLocaleString()} VND`,
      "",
      "Routing queue:",
      ...displayEvents.slice(0, 8).map(
        (event, index) =>
          `${index + 1}. ${event.product_name} | ${event.quantity} units | ${event.route_label} | pickup ${event.pickup_window ?? "next wave"}`
      ),
      "",
      "Please confirm collection sequence, route receipt, and finance packet handoff.",
    ].join("\n");

    return {
      subject,
      body,
      callScript: lead.call_script,
      checklist: lead.checklist ?? [],
    };
  }, [displayEvents, range, totals.quantity, totals.writeoff]);

  if (bootstrap.loading || detailState.loading) {
    return (
      <div className="empty-state">
        <Spinner size="lg" />
      </div>
    );
  }

  const store = bootstrap.stores.find((item) => item.id === bootstrap.selectedStoreId);

  return (
    <div className="page-shell">
      <header className="page-header">
        <p className="page-eyebrow">Reports</p>
        <h1 className="page-title">Tax Write-off And EOL Routing</h1>
        <p className="page-subtitle">
          Move beyond compliance export: stage physical EOL handoff, brief logistics, and prepare the finance packet from one console.
        </p>
      </header>

      <StoreTabs
        selectedStoreId={bootstrap.selectedStoreId}
        stores={bootstrap.stores}
        onChange={bootstrap.setSelectedStoreId}
      />

      <div className={styles.kpiGrid}>
        <div className={styles.kpiCard}>
          <p className={styles.kpiLabel}>Lots Staged</p>
          <p className={styles.kpiValue}>{displayEvents.length}</p>
          <p className={styles.kpiMeta}>Tax write-off candidates in the selected window.</p>
        </div>
        <div className={styles.kpiCard}>
          <p className={styles.kpiLabel}>Units Removed</p>
          <p className={styles.kpiValue}>{totals.quantity}</p>
          <p className={styles.kpiMeta}>Units already pushed off the sale floor.</p>
        </div>
        <div className={styles.kpiCard}>
          <p className={styles.kpiLabel}>Original Value</p>
          <p className={styles.kpiValue}>{currency(totals.original)}</p>
          <p className={styles.kpiMeta}>Gross value before EOL routing.</p>
        </div>
        <div className={styles.kpiCard}>
          <p className={styles.kpiLabel}>Write-off Packet</p>
          <p className={styles.kpiValue}>{currency(totals.writeoff)}</p>
          <p className={styles.kpiMeta}>{totals.routeCount} routing lane(s) active.</p>
        </div>
      </div>

      <div className={styles.bento}>
        <Card>
          <Card.Header
            actions={
              <div className="row">
                {[7, 30].map((value) => (
                  <Button
                    key={value}
                    size="sm"
                    variant={range === String(value) ? "primary" : "secondary"}
                    onClick={() => setRange(String(value))}
                  >
                    Last {value}d
                  </Button>
                ))}
              </div>
            }
            title="Route Pressure"
            subtitle="Write-off load by route and priority, tuned for physical handoff."
          />
          <Card.Body className={styles.shell}>
            {error ? <p className="metric-footnote">{error}</p> : null}
            {totals.routeRows.length ? (
              <div className={styles.barList}>
                {totals.routeRows.map((route) => {
                  const pct = totals.writeoff ? Math.round((route.writeoff / totals.writeoff) * 100) : 0;
                  return (
                    <div className={styles.barRow} key={route.label}>
                      <div className={styles.barHeader}>
                        <span>{route.label}</span>
                        <span>
                          {route.count} lots · {currency(route.writeoff)}
                        </span>
                      </div>
                      <div className={styles.barTrack}>
                        <div
                          className={`${styles.barFill} ${
                            route.priority === "immediate"
                              ? styles.barFillRed
                              : route.priority === "high"
                                ? styles.barFillAmber
                                : ""
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className={styles.empty}>No EOL routes were generated in this window.</div>
            )}
            <ul className={styles.checklist}>
              <li className={styles.checklistItem}>Withdraw units from the sale floor before pickup confirmation.</li>
              <li className={styles.checklistItem}>Cross-check physical quantity against the control tower ledger.</li>
              <li className={styles.checklistItem}>Attach Decision 222 / finance reference in the route packet.</li>
            </ul>
          </Card.Body>
        </Card>

        <Card>
          <Card.Header
            actions={
              <Button
                onClick={() =>
                  generateTaxWriteoffPDF(displayEvents, store?.name ?? bootstrap.selectedStoreId, `last-${range}-days`)
                }
              >
                Export PDF
              </Button>
            }
            title="Logistics Handoff"
            subtitle="Auto-drafted route brief and call script for the EOL coordinator."
          />
          <Card.Body className={styles.shell}>
            {handoffDraft ? (
              <>
                <div className={styles.codePanel}>
                  <p className={styles.codeLabel}>Subject</p>
                  <pre className={styles.codeBody}>{handoffDraft.subject}</pre>
                </div>
                <div className={styles.codePanel}>
                  <p className={styles.codeLabel}>Coordinator Brief</p>
                  <pre className={styles.codeBody}>{handoffDraft.body}</pre>
                </div>
                <div className={styles.codePanel}>
                  <p className={styles.codeLabel}>Call Script</p>
                  <pre className={styles.codeBody}>{handoffDraft.callScript}</pre>
                </div>
                <div className={styles.actionRow}>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => copyText(handoffDraft.subject, setCopiedKey, "eol-subject")}
                  >
                    {copiedKey === "eol-subject" ? "Copied Subject" : "Copy Subject"}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => copyText(handoffDraft.body, setCopiedKey, "eol-body")}
                  >
                    {copiedKey === "eol-body" ? "Copied Brief" : "Copy Brief"}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => copyText(handoffDraft.callScript, setCopiedKey, "eol-call")}
                  >
                    {copiedKey === "eol-call" ? "Copied Script" : "Copy Call Script"}
                  </Button>
                </div>
              </>
            ) : (
              <div className={styles.empty}>No active EOL handoff is needed for the selected range.</div>
            )}
          </Card.Body>
        </Card>
      </div>

      <div className={styles.split}>
        <Card>
          <Card.Header title="Route Queue" subtitle="The highest-pressure lots waiting on logistics and finance closure." />
          <Card.Body>
            {displayEvents.length ? (
              <div className={styles.list}>
                {displayEvents.slice(0, 6).map((event) => (
                  <div className={styles.listItem} key={event.id}>
                    <div className={styles.listItemHeader}>
                      <div>
                        <div className={styles.titleRow}>
                          <h3 className={styles.itemTitle}>{event.product_name}</h3>
                          <Badge tone={urgencyTone(event.route_priority)}>{event.route_priority}</Badge>
                        </div>
                        <p className={styles.itemMeta}>
                          {event.category} · {event.quantity} units · pickup {event.pickup_window ?? "next wave"}
                        </p>
                      </div>
                      <Badge tone="gray">{event.route_label}</Badge>
                    </div>
                    <div className={styles.metricRow}>
                      <div className={styles.metricCell}>
                        <p className={styles.metricCellLabel}>Original</p>
                        <p className={styles.metricCellValue}>{currency(event.original_value)}</p>
                      </div>
                      <div className={styles.metricCell}>
                        <p className={styles.metricCellLabel}>Write-off</p>
                        <p className={styles.metricCellValue}>{currency(event.writeoff_value)}</p>
                      </div>
                      <div className={styles.metricCell}>
                        <p className={styles.metricCellLabel}>Coordinator</p>
                        <p className={styles.metricCellValue}>{event.coordinator_name}</p>
                      </div>
                    </div>
                    <p className={styles.note}>{event.handoff_message}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className={styles.empty}>No EOL queue items are active for this store.</div>
            )}
          </Card.Body>
        </Card>

        <Card>
          <Card.Header title="Finance Checklist" subtitle="Operational proof points to support the write-off packet." />
          <Card.Body className={styles.shell}>
            <ul className={styles.checklist}>
              {(handoffDraft?.checklist ?? []).map((item) => (
                <li className={styles.checklistItem} key={item}>
                  {item}
                </li>
              ))}
            </ul>
            <p className={styles.note}>
              Each event now carries coordinator email, pickup window, and route message so the packet can move from store to logistics to finance without re-keying.
            </p>
          </Card.Body>
        </Card>
      </div>

      <Card>
        <Card.Header title="EOL Event Ledger" subtitle="End-of-life routing records surfaced from the current control-tower state." />
        <Card.Body>
          <Table
            columns={[
              { key: "sku_id", label: "SKU" },
              { key: "category", label: "Category" },
              { key: "quantity", label: "Qty" },
              {
                key: "original_value",
                label: "Original",
                render: (row) => currency(row.original_value),
              },
              {
                key: "writeoff_value",
                label: "Write-off",
                render: (row) => currency(row.writeoff_value),
              },
              {
                key: "eol_at",
                label: "EOL Time",
                render: (row) => new Date(row.eol_at).toLocaleString(),
              },
              {
                key: "routing_destination",
                label: "Routing",
                render: (row) => (
                  <div className="stack" style={{ gap: 4 }}>
                    <strong>{row.route_label}</strong>
                    <span className="metric-footnote">{row.coordinator_email}</span>
                  </div>
                ),
              },
            ]}
            rows={displayEvents}
          />
        </Card.Body>
      </Card>
    </div>
  );
}
