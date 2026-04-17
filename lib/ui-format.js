export function formatPercent(value, maximumFractionDigits = 0) {
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits,
  }).format(Number(value ?? 0));
}

export function formatRelativeTime(value) {
  if (!value) {
    return "Never";
  }

  const deltaMinutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
  if (deltaMinutes < 1) {
    return "Just now";
  }
  if (deltaMinutes < 60) {
    return `${deltaMinutes}m ago`;
  }

  const deltaHours = Math.round(deltaMinutes / 60);
  if (deltaHours < 24) {
    return `${deltaHours}h ago`;
  }

  const deltaDays = Math.round(deltaHours / 24);
  return `${deltaDays}d ago`;
}

export function formatCountdown(hours) {
  const value = Number(hours ?? 0);
  const sign = value < 0 ? "-" : "";
  const totalMinutes = Math.abs(Math.round(value * 60));
  const hh = Math.floor(totalMinutes / 60);
  const mm = totalMinutes % 60;
  return `${sign}${hh}h ${String(mm).padStart(2, "0")}m`;
}

export function formatCurrencyCompact(value) {
  const amount = Number(value ?? 0);
  if (amount >= 1_000_000_000) return `${(amount / 1_000_000_000).toFixed(1)}B`;
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(1)}K`;
  return `${Math.round(amount)}`;
}

export function toneFromFreshness(status) {
  if (status === "fresh") {
    return "green";
  }
  if (status === "degraded") {
    return "amber";
  }
  return "red";
}

export function toneFromStatus(status) {
  if (["completed", "approved", "dispatched", "active", "connected", "fresh"].includes(status)) {
    return "green";
  }
  if (["pending", "scheduled", "watch", "degraded", "reconnecting"].includes(status)) {
    return "amber";
  }
  if (["failed", "rejected", "expired", "blocked", "disconnected", "stale"].includes(status)) {
    return "red";
  }
  return "gray";
}
