"use client";

import { useEffect, useState } from "react";
import { CATEGORIES, CATEGORY_LABEL, type Category, type FinnConfig } from "@/types/push";

const WATCHABLE = CATEGORIES.filter((c) => c !== "unclassified");

type ConfigResponse = FinnConfig & { writable: boolean };
type Load = { status: "loading" } | { status: "ready" } | { status: "error"; message: string };
type Save = { status: "idle" | "saving" | "saved" | "error"; message: string };

interface Props {
  open: boolean;
  onClose: () => void;
}

/** The server must answer with JSON of this shape; anything else (a 404 page, a 500) is a load failure. */
const isConfig = (b: unknown): b is ConfigResponse => {
  const c = b as ConfigResponse | null;
  return !!c && typeof c.volume_mult === "number" && typeof c.price_pct === "number" && Array.isArray(c.watch_categories);
};

export function SettingsSheet({ open, onClose }: Props) {
  const [cfg, setCfg] = useState<ConfigResponse | null>(null);
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [save, setSave] = useState<Save>({ status: "idle", message: "" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    setLoad({ status: "loading" });
    setSave({ status: "idle", message: "" });

    (async () => {
      try {
        const res = await fetch("/api/push/config", { cache: "no-store", signal: ctrl.signal });
        const body: unknown = await res.json().catch(() => null);
        if (!res.ok || !isConfig(body)) {
          throw new Error(`Could not load your settings (the server answered ${res.status}).`);
        }
        setCfg(body);
        setLoad({ status: "ready" });
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setLoad({ status: "error", message: (err as Error).message || "Could not load your settings." });
      }
    })();

    return () => ctrl.abort();
  }, [open, attempt]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  const toggle = (c: Category) =>
    setCfg((cur) => cur && {
      ...cur,
      watch_categories: cur.watch_categories.includes(c)
        ? cur.watch_categories.filter((x) => x !== c)
        : [...cur.watch_categories, c],
    });

  async function saveSettings() {
    if (!cfg) return;
    setSave({ status: "saving", message: "" });
    try {
      const res = await fetch("/api/push/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ volume_mult: cfg.volume_mult, price_pct: cfg.price_pct, watch_categories: cfg.watch_categories }),
      });
      if (res.ok) {
        setSave({ status: "saved", message: "Saved. New thresholds apply from the next end-of-day run." });
      } else {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setSave({ status: "error", message: body?.error ?? `Could not save (the server answered ${res.status}).` });
      }
    } catch {
      setSave({ status: "error", message: "Could not reach the server. Check your connection and try again." });
    }
  }

  const readOnly = cfg ? !cfg.writable : false;

  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="alerts-h" onClick={(e) => e.stopPropagation()}>
        <div className="grabber" aria-hidden />
        <h2 id="alerts-h" className="sheetTitle">What counts as unusual</h2>

        {load.status === "loading" && <p className="note pad" role="status">Loading your settings</p>}

        {load.status === "error" && (
          <div className="sheetBody" role="alert">
            <p className="note bad">{load.message}</p>
            <div className="actions">
              <button type="button" className="primary" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
              <button type="button" className="ghost" onClick={onClose}>Close</button>
            </div>
          </div>
        )}

        {load.status === "ready" && cfg && (
          <div className="sheetBody">
            <div className="field">
              <label htmlFor="vol">
                Volume
                <output htmlFor="vol">{cfg.volume_mult.toFixed(1)}× the {cfg.volume_lookback}-day average</output>
              </label>
              <input id="vol" type="range" min={1.5} max={6} step={0.5} value={cfg.volume_mult} disabled={readOnly}
                onChange={(e) => setCfg({ ...cfg, volume_mult: Number(e.target.value) })} />
            </div>

            <div className="field">
              <label htmlFor="px">
                Price move in a day
                <output htmlFor="px">±{cfg.price_pct.toFixed(1)}%</output>
              </label>
              <input id="px" type="range" min={1} max={10} step={0.5} value={cfg.price_pct} disabled={readOnly}
                onChange={(e) => setCfg({ ...cfg, price_pct: Number(e.target.value) })} />
            </div>

            <fieldset className="field">
              <legend>Alert me on these filings</legend>
              <div className="chipset">
                {WATCHABLE.map((c) => (
                  <button key={c} type="button" className="pill" disabled={readOnly}
                    aria-pressed={cfg.watch_categories.includes(c)} onClick={() => toggle(c)}>
                    {CATEGORY_LABEL[c]}
                  </button>
                ))}
              </div>
            </fieldset>

            {readOnly && (
              <p className="note" role="status">
                These are the thresholds the alert worker is using. They are read-only on this hosted demo; run FINN locally to change them.
              </p>
            )}
            {save.message && <p className={`note ${save.status === "error" ? "bad" : ""}`} role="status">{save.message}</p>}

            <div className="actions">
              {!readOnly && (
                <button type="button" className="primary" onClick={saveSettings} disabled={save.status === "saving"}>
                  {save.status === "saving" ? "Saving" : "Save thresholds"}
                </button>
              )}
              <button type="button" className="ghost" onClick={onClose}>Close</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}