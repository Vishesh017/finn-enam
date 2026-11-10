"use client";

import { useCallback, useEffect, useState } from "react";
import type { PullAnalysis } from "@/types/pull";

type State =
  | { status: "idle" | "loading"; data: null; error: null }
  | { status: "ready"; data: PullAnalysis; error: null }
  | { status: "error"; data: null; error: string };

const session = new Map<string, PullAnalysis>(); // survives ticker switches within a visit

export function usePullAnalysis(ticker: string | null) {
  const [state, setState] = useState<State>({ status: "idle", data: null, error: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!ticker) return;
    const hit = session.get(ticker);
    if (hit) {
      setState({ status: "ready", data: hit, error: null });
      return;
    }
    const ctrl = new AbortController();
    setState({ status: "loading", data: null, error: null });

    fetch(`/api/pull/analyze?ticker=${encodeURIComponent(ticker)}`, { signal: ctrl.signal })
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Something went wrong.");
        session.set(ticker, body);
        setState({ status: "ready", data: body, error: null });
      })
      .catch((err: unknown) => {
        if ((err as Error).name === "AbortError") return;
        setState({ status: "error", data: null, error: (err as Error).message });
      });

    return () => ctrl.abort();
  }, [ticker, attempt]);

  const retry = useCallback(() => {
    if (ticker) session.delete(ticker);
    setAttempt((n) => n + 1);
  }, [ticker]);

  return { ...state, retry };
}