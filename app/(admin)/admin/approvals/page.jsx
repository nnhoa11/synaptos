"use client";

import { useEffect, useState } from "react";
import ApprovalCard from "@/components/admin/ApprovalCard";
import StoreTabs from "@/components/admin/StoreTabs";
import { useAdminBootstrap, useControlTowerDetail } from "@/components/admin/use-admin-data";
import Card from "@/components/ui/Card";
import Spinner from "@/components/ui/Spinner";
import Table from "@/components/ui/Table";
import { fetchJson } from "@/lib/fetch-json";
import { formatAuditTime } from "@/lib/prototype-core";

export default function ApprovalsPage() {
  const bootstrap = useAdminBootstrap();
  const [refreshToken, setRefreshToken] = useState(0);
  const detailState = useControlTowerDetail(bootstrap.selectedStoreId, bootstrap.defaultSnapshot, refreshToken);
  const [busyProposalId, setBusyProposalId] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!bootstrap.selectedStoreId) {
      return undefined;
    }

    const interval = setInterval(() => {
      setRefreshToken((current) => current + 1);
    }, 10000);

    return () => clearInterval(interval);
  }, [bootstrap.selectedStoreId]);

  if (bootstrap.loading || detailState.loading) {
    return (
      <div className="empty-state">
        <Spinner size="lg" />
      </div>
    );
  }

  const detail = detailState.detail;
  const pending = (detail?.proposals ?? []).filter((proposal) => proposal.approvalRequest?.status === "pending");
  const resolved = (detail?.approvals ?? []).filter((approval) => approval.status !== "pending");

  async function review(proposal, decision) {
    try {
      setError("");
      setBusyProposalId(proposal.id);
      await fetchJson(`/api/proposals/${encodeURIComponent(proposal.id)}/${decision === "approved" ? "approve" : "reject"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          storeId: proposal.storeId,
          reviewNotes: decision === "approved" ? "Approved in approvals queue." : "Rejected in approvals queue.",
        }),
      });
      setRefreshToken((current) => current + 1);
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setBusyProposalId(null);
    }
  }

  return (
    <div className="page-shell">
      <header className="page-header">
        <p className="page-eyebrow">Approvals</p>
        <h1 className="page-title">Human Review Queue</h1>
        <p className="page-subtitle">
          High-discount or low-confidence proposals are held here until a manager or admin resolves them.
        </p>
      </header>

      <StoreTabs
        selectedStoreId={bootstrap.selectedStoreId}
        stores={bootstrap.stores}
        onChange={bootstrap.setSelectedStoreId}
      />

      {error ? (
        <Card>
          <Card.Body>
            <p className="empty-state__copy">{error}</p>
          </Card.Body>
        </Card>
      ) : null}

      <Card>
        <Card.Header title="Pending" subtitle="Auto-refreshes every 10 seconds." />
        <Card.Body>
          {pending.length ? (
            <div className="stack">
              {pending.map((proposal) => (
                <ApprovalCard
                  key={proposal.id}
                  busy={busyProposalId === proposal.id}
                  proposal={proposal}
                  onApprove={(item) => review(item, "approved")}
                  onReject={(item) => review(item, "rejected")}
                />
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <p className="empty-state__title">No pending approvals</p>
              <p className="empty-state__copy">Proposals routed for human review will appear here automatically.</p>
            </div>
          )}
        </Card.Body>
      </Card>

      <Card>
        <Card.Header title="Resolved History" subtitle="Review outcomes recorded for this store and snapshot." />
        <Card.Body>
          <Table
            columns={[
              { key: "proposalId", label: "Proposal" },
              { key: "status", label: "Decision" },
              { key: "matchedRule", label: "Rule" },
              {
                key: "reviewedAt",
                label: "Reviewed At",
                render: (row) => (row.reviewedAt ? formatAuditTime(row.reviewedAt) : "—"),
              },
              { key: "reviewNotes", label: "Notes" },
            ]}
            emptyState="No resolved approvals yet."
            rows={resolved}
          />
        </Card.Body>
      </Card>
    </div>
  );
}
