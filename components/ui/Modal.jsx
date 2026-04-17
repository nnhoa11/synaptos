"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";

function classNames(...values) {
  return values.filter(Boolean).join(" ");
}

export default function Modal({
  children,
  className = "",
  footer = null,
  onClose,
  open,
  title,
  width = "720px",
}) {
  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose?.();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open]);

  if (!open || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="ui-modal-backdrop" onClick={() => onClose?.()}>
      <div
        className={classNames("ui-modal-panel", className)}
        style={{ width }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="ui-modal-header">
          <h2 className="ui-modal-title">{title}</h2>
          <button className="ui-button ui-button--ghost ui-button--sm" onClick={() => onClose?.()}>
            Close
          </button>
        </div>
        <div className="ui-modal-body">{children}</div>
        {footer ? <div className="ui-modal-footer">{footer}</div> : null}
      </div>
    </div>,
    document.body
  );
}
