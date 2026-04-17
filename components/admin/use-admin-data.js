"use client";

import { useEffect, useState } from "react";
import { fetchJson } from "@/lib/fetch-json";
import { resolveStoreId } from "@/lib/store-identity";

export function useAdminBootstrap(initialStoreHint = null) {
  const [state, setState] = useState({
    loading: true,
    error: "",
    user: null,
    stores: [],
    defaultSnapshot: null,
    selectedStoreId: null,
  });

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const payload = await fetchJson("/api/admin/bootstrap");
        if (!active) {
          return;
        }

        setState({
          loading: false,
          error: "",
          user: payload.user,
          stores: payload.stores ?? [],
          defaultSnapshot: payload.defaultSnapshot ?? null,
          selectedStoreId: resolveStoreId(initialStoreHint, payload.stores ?? []),
        });
      } catch (error) {
        if (!active) {
          return;
        }

        setState((current) => ({
          ...current,
          loading: false,
          error: error.message,
        }));
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [initialStoreHint]);

  return {
    ...state,
    setSelectedStoreId(selectedStoreId) {
      setState((current) => ({ ...current, selectedStoreId }));
    },
  };
}

export function useControlTowerStores(refreshToken = 0) {
  const [state, setState] = useState({
    loading: true,
    error: "",
    stores: [],
  });

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const stores = await fetchJson("/api/stores");
        if (!active) {
          return;
        }

        setState({
          loading: false,
          error: "",
          stores,
        });
      } catch (error) {
        if (!active) {
          return;
        }

        setState({
          loading: false,
          error: error.message,
          stores: [],
        });
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [refreshToken]);

  return state;
}

export function useControlTowerDetail(storeId, snapshotKey, refreshToken = 0) {
  const [state, setState] = useState({
    loading: true,
    error: "",
    detail: null,
  });

  useEffect(() => {
    if (!storeId) {
      setState({
        loading: false,
        error: "",
        detail: null,
      });
      return undefined;
    }

    let active = true;

    async function load() {
      try {
        const query = snapshotKey ? `?snapshot=${encodeURIComponent(snapshotKey)}` : "";
        const detail = await fetchJson(`/api/stores/${encodeURIComponent(storeId)}/control-tower${query}`);
        if (!active) {
          return;
        }

        setState({
          loading: false,
          error: "",
          detail,
        });
      } catch (error) {
        if (!active) {
          return;
        }

        setState({
          loading: false,
          error: error.message,
          detail: null,
        });
      }
    }

    load();
    return () => {
      active = false;
    };
  }, [refreshToken, snapshotKey, storeId]);

  return state;
}
