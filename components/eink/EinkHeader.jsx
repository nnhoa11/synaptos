"use client";

import { useEffect, useState } from "react";

export default function EinkHeader({ address, clientCount, connectionStatus, storeId, storeName }) {
  const [clock, setClock] = useState("");

  useEffect(() => {
    const syncClock = () => setClock(new Date().toLocaleTimeString());
    syncClock();
    const interval = setInterval(syncClock, 1000);
    return () => clearInterval(interval);
  }, []);

  const isConnected = connectionStatus === "connected";
  const isReconnecting = connectionStatus === "reconnecting";
  const dotClass = isConnected ? "is-green" : isReconnecting ? "is-amber" : "is-red";
  const displayId = storeId ?? storeName;

  return (
    <header className="eink-header eink-header--extended">
      <div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 2 }}>
          <strong style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.18em", textTransform: "uppercase" }}>
            SYNAPTOS E-INK
          </strong>
          <span style={{ fontSize: 11, fontWeight: 700, color: "var(--blue)", letterSpacing: "0.06em" }}>
            {displayId}
          </span>
          {address ? (
            <span className="metric-footnote">{address}</span>
          ) : null}
        </div>
        <div className="store-room-indicator">
          <span className={`pipeline-dot ${dotClass}`} />
          <span>
            Store room: <strong>{displayId}</strong>
            {" · "}
            {isConnected ? "socket.io channel active" : isReconnecting ? "reconnecting…" : "disconnected"}
            {clientCount != null ? ` · ${clientCount} client${clientCount !== 1 ? "s" : ""} connected` : null}
          </span>
        </div>
      </div>
      <div className="row" style={{ gap: 14, fontSize: 12 }}>
        <span className={`pipeline-dot ${dotClass}`} />
        <span>{connectionStatus.toUpperCase()}</span>
        <span>{clock || "--:--:--"}</span>
      </div>
    </header>
  );
}
