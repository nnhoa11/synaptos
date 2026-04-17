function classNames(...values) {
  return values.filter(Boolean).join(" ");
}

export default function Badge({ children, className = "", size = "md", tone = "gray" }) {
  return (
    <span className={classNames("ui-badge", `ui-badge--${tone}`, `ui-badge--${size}`, className)}>
      {children}
    </span>
  );
}
