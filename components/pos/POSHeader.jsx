import Button from "@/components/ui/Button";

export default function POSHeader({
  address,
  cashier,
  clientCount,
  connectionStatus,
  onEndShift,
  onManagerOverride,
  storeId,
  storeName,
}) {
  const isConnected = connectionStatus === "connected";
  const isReconnecting = connectionStatus === "reconnecting";
  const dotClass = isConnected ? "is-green" : isReconnecting ? "is-amber" : "is-red";

  return (
    <header className="pos-header pos-header--extended">
      <div>
        <div className="row" style={{ gap: 6, marginBottom: 1 }}>
          <strong className="pos-header__brand">SYNAPTOS POS</strong>
          <span className="metric-footnote">{storeId ?? storeName}</span>
        </div>
        {address ? (
          <div className="pos-header__address">{address}</div>
        ) : null}
        <div className="store-room-indicator">
          <span className={`pipeline-dot ${dotClass}`} />
          <span>
            Store room: <strong>{storeId}</strong>
            {" · "}
            {isConnected ? "socket.io channel active" : isReconnecting ? "reconnecting…" : "disconnected"}
            {clientCount != null ? ` · ${clientCount} client${clientCount !== 1 ? "s" : ""} connected` : null}
          </span>
        </div>
      </div>
      <div className="row">
        <span className="metric-footnote">{cashier}</span>
        <Button size="sm" variant="secondary" onClick={onManagerOverride}>
          Manager Override
        </Button>
        <Button size="sm" variant="ghost" onClick={onEndShift}>
          End Shift
        </Button>
      </div>
    </header>
  );
}
