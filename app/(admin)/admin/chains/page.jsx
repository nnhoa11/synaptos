"use client";

import Spinner from "@/components/ui/Spinner";
import ChainAnalyticsDashboard from "@/components/admin/ChainAnalyticsDashboard";
import StoreTabs from "@/components/admin/StoreTabs";
import { useAdminBootstrap, useControlTowerDetail } from "@/components/admin/use-admin-data";

export default function ChainsPage() {
  const bootstrap = useAdminBootstrap();
  const detailState = useControlTowerDetail(bootstrap.selectedStoreId, bootstrap.defaultSnapshot);

  if (bootstrap.loading || detailState.loading) {
    return (
      <div className="empty-state">
        <Spinner size="lg" />
      </div>
    );
  }

  const detail = detailState.detail;

  return (
    <div className="page-shell">
      <header className="page-header">
        <p className="page-eyebrow">Chain Operations</p>
        <h1 className="page-title">Store State And Source Provenance</h1>
        <p className="page-subtitle">
          Master analytics view for store state, signal provenance, district traffic rhythm, demand outlook, and
          operational follow-through.
        </p>
      </header>

      <StoreTabs
        selectedStoreId={bootstrap.selectedStoreId}
        stores={bootstrap.stores}
        onChange={bootstrap.setSelectedStoreId}
      />

      <ChainAnalyticsDashboard detail={detail} />
    </div>
  );
}
