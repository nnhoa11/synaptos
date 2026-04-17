"use client";

import Badge from "@/components/ui/Badge";
import Card from "@/components/ui/Card";
import InventoryTable from "@/components/admin/InventoryTable";
import { currency, formatAuditTime, formatNumber, shortCurrency } from "@/lib/prototype-core";
import { formatPercent, formatRelativeTime, toneFromFreshness, toneFromStatus } from "@/lib/ui-format";
import styles from "./ChainAnalyticsDashboard.module.css";

const HERO_WIDTH = 720;
const HERO_HEIGHT = 284;
const HERO_PADDING = { top: 24, right: 18, bottom: 42, left: 16 };

function classNames(...values) {
  return values.filter(Boolean).join(" ");
}

function formatSignedPercent(value) {
  const numeric = Number(value ?? 0);
  const rounded = Math.round(numeric * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)}%`;
}

function formatSourceLabel(value) {
  return String(value ?? "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function buildMetricBars(values = [], length = 10) {
  const sample = values.filter((value) => Number.isFinite(Number(value))).slice(-length);
  const maxValue = Math.max(1, ...sample.map((value) => Number(value)));

  return sample.map((value, index) => ({
    id: `${index}-${value}`,
    heightPct: Math.max(16, Math.round((Number(value) / maxValue) * 100)),
  }));
}

function projectSeries(series = [], width, height, padding, maxValue) {
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const safeMax = Math.max(1, Number(maxValue ?? 0));

  return series.map((point, index) => {
    const value = point?.value;
    if (value == null) {
      return { ...point, x: null, y: null };
    }

    const x = padding.left + (innerWidth * index) / Math.max(1, Math.max(0, series.length - 1));
    const y = height - padding.bottom - (Number(value) / safeMax) * innerHeight;
    return { ...point, x, y };
  });
}

function buildLinePath(points = []) {
  let path = "";
  let segmentActive = false;

  for (const point of points) {
    if (point.x == null || point.y == null) {
      segmentActive = false;
      continue;
    }

    path += `${segmentActive ? " L" : "M"} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
    segmentActive = true;
  }

  return path.trim();
}

function buildAreaPath(points = [], height, padding) {
  const visible = points.filter((point) => point.x != null && point.y != null);
  if (!visible.length) {
    return "";
  }

  const baseline = height - padding.bottom;
  const first = visible[0];
  const last = visible[visible.length - 1];
  let path = `M ${first.x.toFixed(2)} ${baseline.toFixed(2)} L ${first.x.toFixed(2)} ${first.y.toFixed(2)}`;

  for (let index = 1; index < visible.length; index += 1) {
    const point = visible[index];
    path += ` L ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
  }

  path += ` L ${last.x.toFixed(2)} ${baseline.toFixed(2)} Z`;
  return path;
}

function getLastVisiblePoint(points = []) {
  return [...points].reverse().find((point) => point.x != null && point.y != null) ?? null;
}

function getPeakPoint(points = []) {
  return points.reduce(
    (best, point) =>
      point?.value != null && (best == null || Number(point.value) > Number(best.value)) ? point : best,
    null
  );
}

function OverviewTiles({ analytics, detail }) {
  const trafficBars = buildMetricBars(analytics?.trafficPulse?.actualSeries?.map((point) => point.value) ?? []);
  const demandBars = buildMetricBars(analytics?.demandForecast?.map((row) => row.forecastUnits) ?? []);
  const freshnessBars = buildMetricBars(
    analytics?.freshnessBoard?.map((row) => Math.max(0, 240 - Number(row.freshnessMinutes ?? 0))) ?? []
  );
  const districtBars = buildMetricBars(analytics?.districtPatterns?.map((row) => row.avgTraffic) ?? []);
  const totalStores = Math.max(1, analytics?.districtPatterns?.length ?? 0);

  const tiles = [
    {
      id: "units",
      label: "Units On Hand",
      value: formatNumber(detail?.storeMetrics?.totalQuantity ?? 0),
      detail: `${formatNumber(detail?.storeMetrics?.activeLots ?? 0)} live lots in this store state`,
      tone: "blue",
      bars: trafficBars,
    },
    {
      id: "forecast",
      label: "Forecast Next 4h",
      value: formatNumber(analytics?.overview?.forecastUnits ?? 0),
      detail: analytics?.demandForecast?.[0]
        ? `${analytics.demandForecast[0].category} leads projected pull-through`
        : "Demand forecast will appear once active lots are available",
      tone: "green",
      bars: demandBars,
    },
    {
      id: "critical",
      label: "Critical Expiry",
      value: formatNumber(analytics?.overview?.criticalLots ?? 0),
      detail: `${formatNumber(detail?.storeMetrics?.atRiskLots ?? 0)} lots are running above the spoilage watch line`,
      tone: "red",
      bars: demandBars,
    },
    {
      id: "sources",
      label: "Live Signal Coverage",
      value: `${formatNumber(analytics?.overview?.liveSources ?? 0)}/${formatNumber(
        analytics?.freshnessBoard?.length ?? 0
      )}`,
      detail: `${formatNumber(analytics?.overview?.pendingApprovals ?? 0)} approvals still open in the workflow`,
      tone: "amber",
      bars: freshnessBars,
    },
    {
      id: "rank",
      label: "Chain Traffic Rank",
      value: analytics?.overview?.chainTrafficRank ? `#${analytics.overview.chainTrafficRank}/${totalStores}` : "-",
      detail: analytics?.trafficPulse?.nextPeakWindow
        ? `Next acceleration window: ${analytics.trafficPulse.nextPeakWindow}`
        : "Next peak window is not yet available",
      tone: "blue",
      bars: districtBars,
    },
  ];

  return (
    <div className={styles.metricsGrid}>
      {tiles.map((tile) => (
        <Card className={styles.metricCard} key={tile.id}>
          <Card.Body className={styles.metricBody}>
            <div className={styles.metricLabel}>{tile.label}</div>
            <div className={styles.metricValue}>{tile.value}</div>
            <div className={styles.metricDetail}>{tile.detail}</div>
            <div className={styles.metricSpark}>
              {tile.bars.length ? (
                tile.bars.map((bar) => (
                  <span
                    className={classNames(styles.metricBar, styles[`metricBar${tile.tone}`])}
                    key={bar.id}
                    style={{ height: `${bar.heightPct}%` }}
                  />
                ))
              ) : (
                <span
                  className={classNames(styles.metricBar, styles[`metricBar${tile.tone}`])}
                  style={{ height: "28%" }}
                />
              )}
            </div>
          </Card.Body>
        </Card>
      ))}
    </div>
  );
}

function TrafficPulseCard({ analytics, detail }) {
  const actualSeries = analytics?.trafficPulse?.actualSeries ?? [];
  const forecastSeries = analytics?.trafficPulse?.forecastSeries ?? [];
  const hours = analytics?.trafficPulse?.hours ?? [];
  const maxValue = Math.max(
    1,
    ...actualSeries.map((point) => Number(point?.value ?? 0)),
    ...forecastSeries.map((point) => Number(point?.value ?? 0))
  );
  const projectedActual = projectSeries(actualSeries, HERO_WIDTH, HERO_HEIGHT, HERO_PADDING, maxValue);
  const projectedForecast = projectSeries(forecastSeries, HERO_WIDTH, HERO_HEIGHT, HERO_PADDING, maxValue);
  const actualPath = buildLinePath(projectedActual);
  const actualAreaPath = buildAreaPath(projectedActual, HERO_HEIGHT, HERO_PADDING);
  const forecastPath = buildLinePath(projectedForecast);
  const lastActual = getLastVisiblePoint(projectedActual);
  const peakForecast = getPeakPoint(
    projectedForecast.filter((point) => point.hour >= (analytics?.trafficPulse?.snapshotHour ?? 0))
  );
  const gridValues = Array.from({ length: 4 }, (_, index) => Math.round((maxValue * (4 - index)) / 4));
  const chartHeight = HERO_HEIGHT - HERO_PADDING.bottom;

  return (
    <Card className={classNames(styles.bentoCard, styles.span8, styles.heroCard)}>
      <Card.Header
        title="Traffic Pulse"
        subtitle="Observed intraday traffic against the forward forecast for the selected store."
        actions={<Badge tone="blue">{detail?.store?.district ?? "Store"}</Badge>}
      />
      <Card.Body className={styles.heroBody}>
        <div className={styles.heroMetaGrid}>
          <div className={styles.heroStat}>
            <span className={styles.heroStatLabel}>Peak Window</span>
            <strong>{analytics?.trafficPulse?.peakWindow ?? "n/a"}</strong>
          </div>
          <div className={styles.heroStat}>
            <span className={styles.heroStatLabel}>Next Wave</span>
            <strong>{analytics?.trafficPulse?.nextPeakWindow ?? "n/a"}</strong>
          </div>
          <div className={styles.heroStat}>
            <span className={styles.heroStatLabel}>Momentum</span>
            <strong>{formatSignedPercent(analytics?.trafficPulse?.momentumPct ?? 0)}</strong>
          </div>
          <div className={styles.heroStat}>
            <span className={styles.heroStatLabel}>Avg Revenue / Hr</span>
            <strong>{currency(analytics?.trafficPulse?.avgRevenue ?? 0)}</strong>
          </div>
        </div>

        <div className={styles.legendRow}>
          <span className={styles.legendItem}>
            <span className={classNames(styles.legendLine, styles.legendLineActual)} />
            Actual traffic
          </span>
          <span className={styles.legendItem}>
            <span className={classNames(styles.legendLine, styles.legendLineForecast)} />
            Forecast traffic
          </span>
          <span className={styles.heroContext}>
            Snapshot {detail?.snapshotKey ? formatAuditTime(detail.snapshotKey) : "n/a"} | Updated{" "}
            {formatRelativeTime(analytics?.generatedAt)}
          </span>
        </div>

        <div className={styles.chartShell}>
          <svg
            aria-label="Traffic pulse chart"
            className={styles.heroChart}
            role="img"
            viewBox={`0 0 ${HERO_WIDTH} ${HERO_HEIGHT}`}
          >
            <defs>
              <linearGradient id="traffic-area" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.24" />
                <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.02" />
              </linearGradient>
            </defs>

            {gridValues.map((value, index) => {
              const y =
                HERO_PADDING.top +
                ((chartHeight - HERO_PADDING.top) * index) / Math.max(1, gridValues.length - 1);
              return (
                <g key={value}>
                  <line
                    className={styles.gridLine}
                    x1={HERO_PADDING.left}
                    x2={HERO_WIDTH - HERO_PADDING.right}
                    y1={y}
                    y2={y}
                  />
                  <text className={styles.yAxisLabel} x={HERO_PADDING.left} y={Math.max(14, y - 6)}>
                    {value}
                  </text>
                </g>
              );
            })}

            {actualAreaPath ? <path className={styles.actualArea} d={actualAreaPath} /> : null}
            {forecastPath ? <path className={styles.forecastPath} d={forecastPath} /> : null}
            {actualPath ? <path className={styles.actualPath} d={actualPath} /> : null}

            {hours.map((point, index) => {
              const x =
                HERO_PADDING.left +
                ((HERO_WIDTH - HERO_PADDING.left - HERO_PADDING.right) * index) /
                  Math.max(1, Math.max(0, hours.length - 1));
              return (
                <text className={styles.xAxisLabel} key={point.hour} x={x} y={HERO_HEIGHT - 12}>
                  {point.label}
                </text>
              );
            })}

            {lastActual ? <circle className={styles.actualDot} cx={lastActual.x} cy={lastActual.y} r="5" /> : null}
            {peakForecast ? (
              <circle className={styles.forecastDot} cx={peakForecast.x} cy={peakForecast.y} r="4" />
            ) : null}
          </svg>
        </div>
      </Card.Body>
    </Card>
  );
}

function MiniSparkline({ series = [] }) {
  const width = 220;
  const height = 54;
  const padding = { top: 10, right: 4, bottom: 8, left: 4 };
  const maxValue = Math.max(1, ...series.map((point) => Number(point?.value ?? 0)));
  const projected = projectSeries(series, width, height, padding, maxValue);
  const path = buildLinePath(projected);

  return (
    <svg className={styles.sparkline} role="img" viewBox={`0 0 ${width} ${height}`}>
      <path
        className={styles.sparklineTrack}
        d={`M ${padding.left} ${height - padding.bottom} H ${width - padding.right}`}
      />
      {path ? <path className={styles.sparklinePath} d={path} /> : null}
    </svg>
  );
}

function DistrictRhythmCard({ analytics }) {
  const patterns = analytics?.districtPatterns ?? [];

  return (
    <Card className={classNames(styles.bentoCard, styles.span5)}>
      <Card.Header
        title="District Rhythm"
        subtitle="Historical peak-hour signatures by store archetype across the chain."
      />
      <Card.Body className={styles.districtBody}>
        <div className={styles.districtGrid}>
          {patterns.map((pattern) => (
            <article className={styles.districtCard} key={pattern.storeId}>
              <div className={styles.districtHeader}>
                <div>
                  <div className={styles.districtName}>{pattern.displayType}</div>
                  <div className={styles.districtMeta}>
                    {pattern.district} | peak {pattern.peakWindow}
                  </div>
                </div>
                <Badge tone={pattern.momentumPct >= 0 ? "blue" : "amber"}>
                  {formatSignedPercent(pattern.momentumPct)}
                </Badge>
              </div>
              <MiniSparkline series={pattern.series} />
              <div className={styles.districtFooter}>
                <span>Prime category: {pattern.primeCategory}</span>
                <strong>{shortCurrency(pattern.avgRevenue)}/h</strong>
              </div>
            </article>
          ))}
        </div>
      </Card.Body>
    </Card>
  );
}

function HeatmapCard({ analytics }) {
  const heatmap = analytics?.heatmap ?? { hours: [], rows: [] };

  return (
    <Card className={classNames(styles.bentoCard, styles.span7)}>
      <Card.Header
        title="Traffic Heatmap"
        subtitle="Intensity by district and hour, normalized across the current data window."
      />
      <Card.Body className={styles.heatmapBody}>
        <div className={styles.heatmapTable}>
          <div className={styles.heatmapHeaderRow}>
            <div className={styles.heatmapCorner}>District</div>
            {heatmap.hours.map((hour) => (
              <div className={styles.heatmapHour} key={hour.hour}>
                {hour.label}
              </div>
            ))}
          </div>
          {heatmap.rows.map((row) => (
            <div className={styles.heatmapRow} key={row.storeId}>
              <div className={styles.heatmapLabel}>
                <strong>{row.label}</strong>
                <span>{row.peakWindow}</span>
              </div>
              {row.values.map((cell) => (
                <div
                  className={classNames(styles.heatmapCell, cell.isPeak && styles.heatmapCellPeak)}
                  key={`${row.storeId}-${cell.hour}`}
                  style={{
                    background: `rgba(59, 130, 246, ${Math.max(0.08, Number(cell.intensity ?? 0) * 0.92)})`,
                  }}
                  title={`${row.label} ${cell.hour}:00 traffic ${cell.rawValue}`}
                >
                  <span>{Math.round((cell.intensity ?? 0) * 100)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </Card.Body>
    </Card>
  );
}

function DemandForecastCard({ analytics }) {
  const rows = analytics?.demandForecast ?? [];
  const maxUnits = Math.max(1, ...rows.map((row) => Number(row.forecastUnits ?? 0)));

  return (
    <Card className={classNames(styles.bentoCard, styles.span5)}>
      <Card.Header
        title="Demand Forecast"
        subtitle="Projected category pull-through over the next four operating hours."
      />
      <Card.Body className={styles.demandBody}>
        <div className={styles.demandList}>
          {rows.map((row) => (
            <div className={styles.demandRow} key={row.category}>
              <div className={styles.demandHead}>
                <div>
                  <strong>{row.category}</strong>
                  <div className={styles.demandMeta}>
                    {row.forecastUnits} units | {formatPercent(row.pullThroughPct ?? 0, 0)} pull-through
                  </div>
                </div>
                <Badge tone={row.tone}>{shortCurrency(row.forecastRevenue)} VND</Badge>
              </div>
              <div className={styles.demandBarTrack}>
                <div
                  className={classNames(styles.demandBarFill, styles[`demandTone${row.tone}`])}
                  style={{
                    width: `${Math.max(10, Math.round((Number(row.forecastUnits ?? 0) / maxUnits) * 100))}%`,
                  }}
                />
              </div>
              <div className={styles.demandFoot}>
                <span>{row.summary}</span>
                <span>{row.minHoursToExpiry}h to expiry</span>
              </div>
            </div>
          ))}
        </div>
      </Card.Body>
    </Card>
  );
}

function SignalWireCard({ analytics }) {
  const recent = analytics?.signalWire?.recent ?? [];
  const upcoming = analytics?.signalWire?.upcoming ?? [];

  return (
    <Card className={classNames(styles.bentoCard, styles.span4)}>
      <Card.Header
        title="Chain Signal Wire"
        subtitle="Recent signals and forward watches synthesized from source provenance and store state."
      />
      <Card.Body className={styles.signalBody}>
        <div className={styles.signalColumns}>
          <div className={styles.signalColumn}>
            <div className={styles.sectionLabel}>Recent</div>
            {recent.map((item) => (
              <article className={styles.signalItem} key={item.id}>
                <div className={styles.signalItemTop}>
                  <span className={classNames(styles.signalDot, styles[`signalDot${item.tone}`])} />
                  <span className={styles.signalKicker}>{item.kicker}</span>
                </div>
                <h4>{item.title}</h4>
                <p>{item.detail}</p>
                <div className={styles.signalMeta}>{item.meta}</div>
              </article>
            ))}
          </div>
          <div className={styles.signalColumn}>
            <div className={styles.sectionLabel}>Upcoming</div>
            {upcoming.map((item) => (
              <article className={styles.signalItem} key={item.id}>
                <div className={styles.signalItemTop}>
                  <span className={classNames(styles.signalDot, styles[`signalDot${item.tone}`])} />
                  <span className={styles.signalKicker}>{item.kicker}</span>
                </div>
                <h4>{item.title}</h4>
                <p>{item.detail}</p>
                <div className={styles.signalMeta}>{item.meta}</div>
              </article>
            ))}
          </div>
        </div>
      </Card.Body>
    </Card>
  );
}

function FreshnessCard({ analytics }) {
  const rows = analytics?.freshnessBoard ?? [];

  return (
    <Card className={classNames(styles.bentoCard, styles.span3)}>
      <Card.Header
        title="Source Provenance"
        subtitle="Freshness, provenance, and payload interpretation for each signal feed."
      />
      <Card.Body className={styles.freshnessBody}>
        <div className={styles.freshnessList}>
          {rows.map((row) => {
            const freshnessWidth = Math.max(10, 100 - Math.min(92, Math.round((row.freshnessMinutes ?? 0) / 3)));
            return (
              <div className={styles.freshnessRow} key={row.id}>
                <div className={styles.freshnessHead}>
                  <div>
                    <strong>{formatSourceLabel(row.label)}</strong>
                    <div className={styles.freshnessMeta}>
                      {row.summary} | {formatRelativeTime(row.observedAt)}
                    </div>
                  </div>
                  <div className={styles.badgeStack}>
                    <Badge
                      tone={row.provenance === "live" ? "green" : row.provenance === "cached" ? "amber" : "gray"}
                    >
                      {row.provenance}
                    </Badge>
                    <Badge tone={toneFromFreshness(row.freshnessStatus)}>{row.freshnessStatus}</Badge>
                  </div>
                </div>
                <div className={styles.freshnessTrack}>
                  <span className={styles.freshnessFill} style={{ width: `${freshnessWidth}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </Card.Body>
    </Card>
  );
}

function HistoryCard({ detail }) {
  const modelHistory = detail?.modelRunHistory ?? [];
  const aggregationHistory = detail?.aggregationHistory ?? [];
  const historyMode = modelHistory.length ? "model" : "aggregation";
  const rows = (historyMode === "model" ? modelHistory : aggregationHistory).slice(0, 6);

  return (
    <Card className={classNames(styles.bentoCard, styles.span4)}>
      <Card.Header
        title="Aggregation History"
        subtitle="Recent model runs, aggregation health, and source-state checkpoints for this store."
      />
      <Card.Body className={styles.historyBody}>
        <div className={styles.historyList}>
          {rows.length ? (
            rows.map((row) => (
              <div className={styles.historyItem} key={row.id}>
                <div className={styles.historyTop}>
                  <div>
                    <strong>{historyMode === "model" ? row.stageName ?? "legacy" : row.sourceHealth ?? "healthy"}</strong>
                    <div className={styles.historyMeta}>
                      {formatAuditTime(row.createdAt)} | {historyMode === "model" ? row.provider : row.snapshotKey}
                    </div>
                  </div>
                  <Badge tone={toneFromStatus(row.status)}>{row.status}</Badge>
                </div>
                <div className={styles.historyCopy}>
                  {historyMode === "model"
                    ? `${row.model} | ${row.parseStatus} | ${row.latencyMs ?? "-"} ms`
                    : `${row.summary?.observedSourceCount ?? 0} sources | ${row.summary?.storeCount ?? 0} stores | ${
                        row.summary?.degradedStores ?? 0
                      } degraded`}
                </div>
              </div>
            ))
          ) : (
            <div className={styles.emptyCopy}>No aggregation checkpoints are available for this store yet.</div>
          )}
        </div>
      </Card.Body>
    </Card>
  );
}

function InventoryCard({ detail }) {
  return (
    <Card className={classNames(styles.bentoCard, styles.span12)}>
      <Card.Header
        title="Inventory State"
        subtitle="Lot-level table remains available after the analytics surface for operational follow-through."
      />
      <Card.Body>
        <InventoryTable rows={detail?.inventoryLots ?? []} />
      </Card.Body>
    </Card>
  );
}

export default function ChainAnalyticsDashboard({ detail }) {
  const analytics = detail?.analytics ?? {};

  return (
    <div className={styles.dashboard}>
      <OverviewTiles analytics={analytics} detail={detail} />
      <TrafficPulseCard analytics={analytics} detail={detail} />
      <SignalWireCard analytics={analytics} />
      <DistrictRhythmCard analytics={analytics} />
      <HeatmapCard analytics={analytics} />
      <DemandForecastCard analytics={analytics} />
      <FreshnessCard analytics={analytics} />
      <HistoryCard detail={detail} />
      <InventoryCard detail={detail} />
    </div>
  );
}
