function classNames(...values) {
  return values.filter(Boolean).join(" ");
}

function Card({ as: Tag = "section", children, className = "", padded = false }) {
  return (
    <Tag className={classNames("ui-card", padded && "ui-card--padded", className)}>
      {children}
    </Tag>
  );
}

function CardHeader({ actions = null, children, className = "", subtitle = null, title = null }) {
  return (
    <div className={classNames("ui-card__header", className)}>
      {children ?? (
        <div className="row-between">
          <div>
            {title ? <h3 className="ui-card__title">{title}</h3> : null}
            {subtitle ? <p className="ui-card__subtitle">{subtitle}</p> : null}
          </div>
          {actions}
        </div>
      )}
    </div>
  );
}

function CardBody({ children, className = "" }) {
  return <div className={classNames("ui-card__body", className)}>{children}</div>;
}

function CardFooter({ children, className = "" }) {
  return <div className={classNames("ui-card__footer", className)}>{children}</div>;
}

Card.Header = CardHeader;
Card.Body = CardBody;
Card.Footer = CardFooter;

export default Card;
