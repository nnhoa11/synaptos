function classNames(...values) {
  return values.filter(Boolean).join(" ");
}

export default function Spinner({ className = "", size = "md" }) {
  return <span aria-label="Loading" className={classNames("ui-spinner", `ui-spinner--${size}`, className)} />;
}
