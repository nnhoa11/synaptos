"use client";

import { useEffect, useState } from "react";
import { io } from "socket.io-client";
import AlertFeed from "@/components/admin/AlertFeed";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import styles from "@/components/admin/ControlTowerOverview.module.css";
import { formatAuditTime, shortCurrency } from "@/lib/prototype-core";
import { formatPercent } from "@/lib/ui-format";

function SyncHealthRow({ stores = [] }) {
  const [healthMap, setHealthMap] = useState({});

  useEffect(() => {
    const socket = io({ query: { admin: "1" } });
    socket.on("room:meta", (meta) => {
      if (!meta?.storeId) return;
      setHealthMap((current) => ({
        ...current,
        [meta.storeId]: { clientCount: meta.clientCount ?? 0, at: meta.at },
      }));
    });
    return () => socket.disconnect();
  }, []);

  if (!stores.length) return null;

  return (
    <div className="sync-health-row">
      {stores.map((store) => {
        const health = healthMap[store.id];
        const connected = health?.clientCount > 0;
        const secAgo = health?.at ? Math.round((Date.now() - health.at) / 1000) : null;
        return (
          <div
            key={store.id}
            className={`sync-badge${health && !connected ? " sync-badge--warning" : ""}`}
          >
            <span className={`pipeline-dot ${connected ? "is-green" : health ? "is-amber" : "is-gray"}`} />
            <strong>{store.id}</strong>
            {health ? (
              <>
                <span>· {health.clientCount} client{health.clientCount !== 1 ? "s" : ""}</span>
                {secAgo !== null ? <span>· last event {secAgo}s ago</span> : null}
              </>
            ) : (
              <span className="metric-footnote">· no data</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function compactNumber(value) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Number(value ?? 0));
}

function compactCurrency(value) {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) {
    return "0 VND";
  }

  return `${shortCurrency(amount)} VND`;
}

function pathFromSeries(series, width, height, paddingX = 14, paddingY = 18) {
  const usableWidth = width - paddingX * 2;
  const usableHeight = height - paddingY * 2;
  const cleanSeries = series.filter((point) => Number.isFinite(point?.value));
  const values = cleanSeries.map((point) => Number(point.value));
  const max = Math.max(1, ...values);
  const min = Math.min(0, ...values);
  const span = Math.max(1, max - min);

  const points = series
    .map((point, index) => {
      if (!Number.isFinite(point?.value)) {
        return null;
      }

      const x = paddingX + (index / Math.max(1, series.length - 1)) * usableWidth;
      const y = paddingY + ((max - Number(point.value)) / span) * usableHeight;
      return { ...point, x, y };
    })
    .filter(Boolean);

  if (!points.length) {
    return { path: "", points: [], max, min };
  }

  const path = points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
    .join(" ");

  return { path, points, max, min };
}

function toneColor(tone = "blue") {
  if (tone === "green") {
    return "var(--green)";
  }
  if (tone === "amber") {
    return "var(--amber)";
  }
  if (tone === "red") {
    return "var(--red)";
  }
  return "var(--blue)";
}

function OverviewTrafficChart({ trafficPulse }) {
  const width = 640;
  const height = 236;
  const actual = pathFromSeries(trafficPulse?.actualSeries ?? [], width, height);
  const forecast = pathFromSeries(trafficPulse?.forecastSeries ?? [], width, height);
  const axisHours = (trafficPulse?.hours ?? []).filter((_, index) => index % 2 === 0);
  const highlightedForecast = forecast.points.find((point) => point.hour === trafficPulse?.snapshotHour + 1) ?? null;

  return (
    <div className={styles.heroChartPanel}>
      <div className={styles.legend}>
        <span className={styles.legendLine}>
          <span className={styles.legendStroke} />
          Actual traffic
        </span>
        <span className={styles.legendLine}>
          <span className={styles.legendStrokeDashed} />
          Forecast traffic
        </span>
        <span>Peak window {trafficPulse?.peakWindow ?? "n/a"}</span>
      </div>

      <div className={styles.chartShell}>
        <svg className={styles.chartSvg} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Traffic pulse">
          {[0.25, 0.5, 0.75].map((ratio) => (
            <line
              key={ratio}
              x1="14"
              x2={width - 14}
              y1={18 + (height - 36) * ratio}
              y2={18 + (height - 36) * ratio}
              stroke="rgba(209,217,230,0.7)"
              strokeDasharray="4 6"
            />
          ))}

          {actual.path ? (
            <path d={actual.path} fill="none" stroke="var(--blue)" strokeWidth="1.5" strokeLinecap="round" />
          ) : null}

          {forecast.path ? (
            <path
              d={forecast.path}
              fill="none"
              stroke="var(--amber)"
              strokeWidth="1.5"
              strokeDasharray="6 5"
              strokeLinecap="round"
            />
          ) : null}

          {actual.points.map((point) => (
            <circle key={`actual-${point.hour}`} cx={point.x} cy={point.y} r="2.5" fill="var(--blue)" stroke="#ffffff" strokeWidth="1.5" />
          ))}

          {highlightedForecast ? (
            <>
              <circle cx={highlightedForecast.x} cy={highlightedForecast.y} r="4" fill="var(--amber)" stroke="#ffffff" strokeWidth="2" />
              <text className={styles.chartPointLabel} x={highlightedForecast.x + 8} y={highlightedForecast.y - 8}>
                {highlightedForecast.label}
              </text>
            </>
          ) : null}

          {axisHours.map((point, index) => {
            const x = 14 + (index * 2 / Math.max(1, (trafficPulse?.hours?.length ?? 1) - 1)) * (width - 28);
            return (
              <text className={styles.chartAxisLabel} key={point.hour} x={x} y={height - 2} textAnchor="middle">
                {point.label}
              </text>
            );
          })}
        </svg>
      </div>
    </div>
  );
}

function ChainLeaderboard({ patterns = [], selectedStoreId = null }) {
  const ranked = [...patterns].sort((left, right) => Number(right.avgTraffic ?? 0) - Number(left.avgTraffic ?? 0));
  const maxTraffic = Math.max(1, ...ranked.map((row) => Number(row.avgTraffic ?? 0)));

  return (
    <div className={styles.leaderboard}>
      {ranked.map((row, index) => (
        <div
          className={`${styles.leaderRow} ${row.storeId === selectedStoreId ? styles.isActive : ""}`}
          key={row.storeId}
        >
          <div className={styles.leaderHead}>
            <div>
              <div className={styles.leaderName}>
                {index + 1}. {row.displayType}
              </div>
              <div className={styles.leaderMeta}>
                {row.district} · {row.primeCategory} · next peak {row.nextPeakWindow}
              </div>
            </div>
            <Badge tone={row.storeId === selectedStoreId ? "blue" : "gray"}>{compactNumber(row.avgTraffic)}x</Badge>
          </div>

          <div className={styles.leaderBar}>
            <span style={{ width: `${(Number(row.avgTraffic ?? 0) / maxTraffic) * 100}%` }} />
          </div>

          <div className={styles.leaderFoot}>
            <span>Momentum {formatPercent((row.momentumPct ?? 0) / 100, 1)}</span>
            <span>{compactCurrency(row.avgRevenue)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function ChainHeatmap({ heatmap }) {
  const rows = heatmap?.rows ?? [];
  const hours = heatmap?.hours ?? [];

  return (
    <div className={styles.heatmap}>
      <div className={styles.heatmapHeader}>
        <span className={styles.heatmapLabel}>District</span>
        {hours.map((hour) => (
          <span className={styles.heatmapHour} key={hour.hour}>
            {hour.label.slice(0, 2)}
          </span>
        ))}
      </div>

      {rows.map((row) => (
        <div className={styles.heatmapRow} key={row.storeId}>
          <span className={styles.heatmapLabel}>{row.label}</span>
          {row.values.map((cell) => (
            <span
              className={`${styles.heatCell} ${cell.isPeak ? styles.isPeak : ""}`}
              key={`${row.storeId}-${cell.hour}`}
              title={`${row.label} ${cell.hour}:00 · ${cell.rawValue}`}
              style={{
                background: `rgba(59, 130, 246, ${0.08 + Number(cell.intensity ?? 0) * 0.92})`,
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function SignalWire({ signalWire }) {
  const groups = [
    { label: "Recent", rows: signalWire?.recent ?? [] },
    { label: "Upcoming", rows: signalWire?.upcoming ?? [] },
  ];

  return (
    <div className={styles.signalsGrid}>
      {groups.map((group) => (
        <div className={styles.signalBlock} key={group.label}>
          <strong>{group.label}</strong>
          {group.rows.map((signal) => (
            <article className={styles.signalCard} key={signal.id}>
              <div className={styles.signalKicker} style={{ color: toneColor(signal.tone) }}>
                {signal.kicker}
              </div>
              <strong>{signal.title}</strong>
              <p className={styles.mutedBlock}>{signal.detail}</p>
              <span className={styles.signalMeta}>{signal.meta}</span>
            </article>
          ))}
        </div>
      ))}
    </div>
  );
}

function DemandBoard({ rows = [] }) {
  const maxForecast = Math.max(1, ...rows.map((row) => Number(row.forecastUnits ?? 0)));

  return (
    <div className={styles.demandList}>
      {rows.map((row) => (
        <div className={styles.demandRow} key={row.category}>
          <div className={styles.demandHead}>
            <div>
              <strong>{row.category}</strong>
              <div className={styles.mutedBlock}>{row.summary}</div>
            </div>
            <Badge tone={row.tone === "amber" ? "amber" : "blue"}>{compactNumber(row.forecastUnits)} units</Badge>
          </div>

          <div className={styles.demandBar}>
            <span style={{ width: `${(Number(row.forecastUnits ?? 0) / maxForecast) * 100}%` }} />
          </div>

          <div className={styles.demandMeta}>
            <span>Share {formatPercent(row.sharePct ?? 0, 1)}</span>
            <span>Pull-through {formatPercent(row.pullThroughPct ?? 0, 1)}</span>
            <span>Expiry floor {row.minHoursToExpiry ?? 0}h</span>
            <span>{compactCurrency(row.forecastRevenue)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function ExecutionPressure({ overview, stores = [], selectedStoreId = null }) {
  const selectedStore = stores.find((store) => store.id === selectedStoreId) ?? null;
  const rows = [
    {
      label: "Live sources",
      value: `${overview?.liveSources ?? 0}`,
      meta: "Feeds contributing to the current operational read.",
    },
    {
      label: "Projected units",
      value: compactNumber(overview?.forecastUnits ?? 0),
      meta: "Expected movement across the next decision window.",
    },
    {
      label: "Pending approvals",
      value: `${overview?.pendingApprovals ?? 0}`,
      meta: "Human-gated items waiting before execution.",
    },
    {
      label: "Store active lots",
      value: `${selectedStore?.activeLots ?? 0}`,
      meta: "Current live assortment visible in the selected district.",
    },
  ];

  return (
    <div className={styles.executionList}>
      {rows.map((row) => (
        <div className={styles.executionRow} key={row.label}>
          <div>
            <strong>{row.label}</strong>
            <div className={styles.mutedBlock}>{row.meta}</div>
          </div>
          <span className={styles.spotlightTitle}>{row.value}</span>
        </div>
      ))}
    </div>
  );
}

export default function ControlTowerOverview({
  detail,
  metrics,
  selectedStore,
  stores,
  snapshotKey,
  onRunEngine,
  runningStoreId,
}) {
  const overview = detail?.analytics?.overview ?? {};
  const trafficPulse = detail?.analytics?.trafficPulse ?? {};
  const districtPatterns = detail?.analytics?.districtPatterns ?? [];
  const selectedPattern = districtPatterns.find((row) => row.storeId === selectedStore?.id) ?? null;
  const riskLots = Number(detail?.storeMetrics?.atRiskLots ?? 0);
  const selectedApprovals = detail?.approvals?.filter((item) => item.status === "pending").length ?? 0;

  return (
    <section className={styles.overview}>
      <SyncHealthRow stores={stores ?? []} />
      <div className={styles.heroBand}>
        <Card className={styles.heroPanel}>
          <Card.Body className={styles.heroBody}>
            <div className={styles.heroTop}>
              <div className="stack" style={{ gap: 10 }}>
                <p className={styles.eyebrow}>Control Tower Overview</p>
                <h2 className={styles.heroTitle}>{selectedStore?.name ?? "Selected store unavailable"}</h2>
                <p className={styles.heroCopy}>
                  Current traffic is being read against live mock inventory, current price posture, and forward signals so
                  operators can decide where to run the engine next.
                </p>
              </div>

              <div className={styles.heroActions}>
                <Button onClick={() => onRunEngine?.(selectedStore?.id)} disabled={!selectedStore?.id}>
                  {runningStoreId === selectedStore?.id ? "Engine Running" : "Run Engine"}
                </Button>
                <Button className={styles.ghostButton} variant="secondary">
                  Snapshot {snapshotKey ? formatAuditTime(snapshotKey) : "n/a"}
                </Button>
              </div>
            </div>

            <div className={styles.chipRow}>
              <span className={styles.heroChip}>
                District <strong>{selectedStore?.district ?? "n/a"}</strong>
              </span>
              <span className={styles.heroChip}>
                Archetype <strong>{selectedPattern?.displayType ?? selectedStore?.displayType ?? "n/a"}</strong>
              </span>
              <span className={styles.heroChip}>
                Next peak <strong>{trafficPulse?.nextPeakWindow ?? "n/a"}</strong>
              </span>
              <span className={styles.heroChip}>
                Prime category <strong>{selectedPattern?.primeCategory ?? "n/a"}</strong>
              </span>
            </div>

            <div className={styles.heroMetrics}>
              <div className={styles.heroMetric}>
                <p className={styles.heroMetricLabel}>Rescued GMV</p>
                <strong className={styles.heroMetricValue}>{compactCurrency(metrics?.rescuedGmv ?? 0)}</strong>
                <span className={styles.heroMetricMeta}>Value preserved across the current operating snapshot.</span>
              </div>
              <div className={styles.heroMetric}>
                <p className={styles.heroMetricLabel}>Waste Exposure</p>
                <strong className={styles.heroMetricValue}>{riskLots}</strong>
                <span className={styles.heroMetricMeta}>Lots now within the watch or intervention window.</span>
              </div>
              <div className={styles.heroMetric}>
                <p className={styles.heroMetricLabel}>Traffic Rank</p>
                <strong className={styles.heroMetricValue}>#{overview?.chainTrafficRank ?? 0}</strong>
                <span className={styles.heroMetricMeta}>Selected district position in the current chain rhythm.</span>
              </div>
              <div className={styles.heroMetric}>
                <p className={styles.heroMetricLabel}>Approval Queue</p>
                <strong className={styles.heroMetricValue}>{selectedApprovals}</strong>
                <span className={styles.heroMetricMeta}>Actions still waiting for a manager decision.</span>
              </div>
            </div>

            <OverviewTrafficChart trafficPulse={trafficPulse} />

            <div className={styles.heroFooter}>
              <span>Average traffic {compactNumber(trafficPulse?.avgTraffic ?? 0)}x</span>
              <span>Average revenue {compactCurrency(trafficPulse?.avgRevenue ?? 0)}</span>
              <span>Momentum {formatPercent((trafficPulse?.momentumPct ?? 0) / 100, 1)}</span>
            </div>
          </Card.Body>
        </Card>

        <Card>
          <Card.Body className={styles.spotlightPanel}>
            <div className={styles.spotlightHeader}>
              <p className="page-eyebrow" style={{ margin: 0 }}>
                Decision Posture
              </p>
              <h3 className={styles.spotlightTitle}>Where operators should look first</h3>
              <p className={styles.spotlightCopy}>
                This panel compresses the current store stance into a few decision anchors.
              </p>
            </div>

            <div className={styles.spotlightStack}>
              <div className={styles.spotlightTile}>
                <strong>{overview?.forecastUnits ?? 0}</strong>
                <span>Forecast units across the next trading window</span>
              </div>
              <div className={styles.spotlightTile}>
                <strong>{overview?.liveSources ?? 0}</strong>
                <span>Fresh upstream signals feeding the current snapshot</span>
              </div>
              <div className={styles.spotlightTile}>
                <strong>{overview?.activeMarkdowns ?? 0}</strong>
                <span>Active markdowns already influencing shelf behavior</span>
              </div>
              <div className={styles.spotlightTile}>
                <strong>{compactNumber(selectedPattern?.avgTraffic ?? 0)}x</strong>
                <span>Observed traffic pulse in {selectedStore?.district ?? "the selected district"}</span>
              </div>
            </div>
          </Card.Body>
        </Card>
      </div>

      <div className={styles.bento}>
        <Card className={styles.chainCard}>
          <Card.Header
            title="Chain Pulse"
            subtitle="Compare district momentum, traffic intensity, and next peak windows."
          />
          <Card.Body>
            <ChainLeaderboard patterns={districtPatterns} selectedStoreId={selectedStore?.id} />
          </Card.Body>
        </Card>

        <Card className={styles.heatmapCard}>
          <Card.Header
            title="Peak Heatmap"
            subtitle="Hourly traffic intensity by district. Red outline marks the local peak."
          />
          <Card.Body>
            <ChainHeatmap heatmap={detail?.analytics?.heatmap} />
          </Card.Body>
        </Card>

        <Card className={styles.signalsCard}>
          <Card.Header
            title="Signal Wire"
            subtitle="Recent market context and forward watch items shaping the next interventions."
          />
          <Card.Body>
            <SignalWire signalWire={detail?.analytics?.signalWire} />
          </Card.Body>
        </Card>

        <Card className={styles.demandCard}>
          <Card.Header
            title="Demand Lanes"
            subtitle="Projected demand concentration by category across the upcoming decision window."
          />
          <Card.Body>
            <DemandBoard rows={detail?.analytics?.demandForecast ?? []} />
          </Card.Body>
        </Card>

        <Card className={styles.alertsCard}>
          <Card.Header
            title="Live Alert Feed"
            subtitle="Streaming system events and operator-visible execution signals."
          />
          <Card.Body>
            <AlertFeed embedded storeId={selectedStore?.id} />
          </Card.Body>
        </Card>

        <Card className={styles.executionCard}>
          <Card.Header
            title="Execution Pressure"
            subtitle="A compact read of what is accumulating behind the current store state."
          />
          <Card.Body>
            <ExecutionPressure overview={overview} selectedStoreId={selectedStore?.id} stores={stores} />
          </Card.Body>
        </Card>
      </div>
    </section>
  );
}
