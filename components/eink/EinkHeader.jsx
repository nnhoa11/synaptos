"use client";

import { useEffect, useState } from "react";

export default function EinkHeader({ connectionStatus, storeName }) {
  const [clock, setClock] = useState(() => new Date().toLocaleTimeString());

  useEffect(() => {
    const interval = setInterval(() => setClock(new Date().toLocaleTimeString()), 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="eink-header">
      <strong>SYNAPTOS E-INK · {storeName}</strong>
      <div className="row">
        <span className={`pipeline-dot is-${connectionStatus === "connected" ? "green" : connectionStatus === "reconnecting" ? "amber" : "red"}`} />
        <span>{connectionStatus.toUpperCase()}</span>
        <span>{clock}</span>
      </div>
    </header>
  );
}
