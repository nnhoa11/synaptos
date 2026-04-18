"use client";

import { useEffect, useState } from "react";
import Modal from "@/components/ui/Modal";
import Spinner from "@/components/ui/Spinner";
import { fetchJson } from "@/lib/fetch-json";

export default function ModelRunDrawer({
  modelRunId,
  onClose,
  open,
  fallbackContent = null,
  title = "Model Run Detail",
}) {
  const [state, setState] = useState({
    loading: false,
    error: "",
    payload: null,
  });

  useEffect(() => {
    if (!open || !modelRunId) {
      setState({
        loading: false,
        error: "",
        payload: null,
      });
      return undefined;
    }

    let active = true;

    async function load() {
      try {
        setState((current) => ({ ...current, loading: true, error: "" }));
        const payload = await fetchJson(`/api/agent/runs/${encodeURIComponent(modelRunId)}`);
        if (!active) {
          return;
        }
        setState({
          loading: false,
          error: "",
          payload,
        });
      } catch (error) {
        if (!active) {
          return;
        }
        setState({
          loading: false,
          error: error.message,
          payload: null,
        });
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [modelRunId, open]);

  return (
    <Modal onClose={onClose} open={open} title={title} width="960px">
      {state.loading ? (
        <div className="empty-state">
          <Spinner />
        </div>
      ) : state.error ? (
        <div className="empty-state">
          <p className="empty-state__copy">{state.error}</p>
        </div>
      ) : state.payload ? (
        <div className="stack">
          <div className="grid-3">
            <div className="ui-card ui-card--padded">
              <p className="metric-label">Provider</p>
              <strong>{state.payload.modelRun.provider}</strong>
            </div>
            <div className="ui-card ui-card--padded">
              <p className="metric-label">Model</p>
              <strong>{state.payload.modelRun.model}</strong>
            </div>
            <div className="ui-card ui-card--padded">
              <p className="metric-label">Latency</p>
              <strong>{state.payload.modelRun.latencyMs ?? "—"} ms</strong>
            </div>
          </div>
          <div className="grid-3">
            <div className="ui-card ui-card--padded">
              <p className="metric-label">Prompt</p>
              <strong>
                {state.payload.modelRun.promptTemplateName}:{state.payload.modelRun.promptTemplateVersion}
              </strong>
            </div>
            <div className="ui-card ui-card--padded">
              <p className="metric-label">Parse Status</p>
              <strong>{state.payload.modelRun.parseStatus}</strong>
            </div>
            <div className="ui-card ui-card--padded">
              <p className="metric-label">Tokens</p>
              <strong>{state.payload.modelRun.usage?.totalTokens ?? 0}</strong>
            </div>
          </div>
          <details className="json-panel" open>
            <summary>Raw Input JSON</summary>
            <pre>{JSON.stringify(state.payload.inputArtifact?.requestJson ?? state.payload.inputArtifact?.request ?? {}, null, 2)}</pre>
          </details>
          <details className="json-panel">
            <summary>Raw Output JSON</summary>
            <pre>{JSON.stringify(state.payload.outputArtifact?.rawOutputJson ?? state.payload.outputArtifact?.rawJson ?? {}, null, 2)}</pre>
          </details>
          <details className="json-panel">
            <summary>Parsed Output</summary>
            <pre>{JSON.stringify(state.payload.outputArtifact?.parsedOutputJson ?? state.payload.outputArtifact?.parsedOutput ?? {}, null, 2)}</pre>
          </details>
        </div>
      ) : fallbackContent ? (
        fallbackContent
      ) : null}
    </Modal>
  );
}
