"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PushFeed } from "@/types/push";

const STALE_AFTER_MS = 60_000;

/**
 * Keeps the previous window's data on screen while a new window loads, so switching
 * 24h -> 7d never flashes an empty state. Refetches when the tab regains focus.
 */
export function usePushFeed(hours: number) {
  const [data, setData] = useState<PushFeed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fetchedAt = useRef(0);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      try {
        const res = await fetch(`/api/push?hours=${hours}`, { signal, cache: "no-store" });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "The feed could not be loaded.");
        setData(body as PushFeed);
        setError(null);
        fetchedAt.current = Date.now();
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setError((err as Error).message);
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [hours],
  );

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - fetchedAt.current > STALE_AFTER_MS) load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  return { data, error, loading, refresh: () => load() };
}