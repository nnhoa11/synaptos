import Button from "@/components/ui/Button";

export default function POSHeader({
  cashier,
  connectionStatus,
  onEndShift,
  onManagerOverride,
  storeName,
}) {
  return (
    <header className="pos-header">
      <div className="row">
        <strong className="pos-header__brand">SYNAPTOS POS</strong>
        <span className="metric-footnote">{storeName}</span>
      </div>
      <div className="row">
        <span className={`pipeline-dot is-${connectionStatus === "connected" ? "green" : connectionStatus === "reconnecting" ? "amber" : "red"}`} />
        <span className="metric-footnote">{connectionStatus}</span>
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
