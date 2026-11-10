"use client";

import { useEffect, useState } from "react";
import { CATEGORIES, CATEGORY_LABEL, type Category, type FinnConfig } from "@/types/push";

const WATCHABLE = CATEGORIES.filter((c) => c !== "unclassified");

interface Props {
  open: boolean;
  onClose: () => void;
}

export function SettingsSheet({ open, onClose }: Props) {
  const [cfg, setCfg] = useState<FinnConfig | null>(null);
  const [state, setState] = useState<"loading" | "idle" | "saving" | "saved" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!open) return;
    setState("loading");
    fetch("/api/push/config", { cache: "no-store" })
      .then((r) => r.json())
      .then((c: FinnConfig) => { setCfg(c); setState("idle"); })
      .catch(() => { setState("error"); setMessage("Your settings could not be loaded."); });

    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [open, onClose]);

  if (!open) return null;

  const toggle = (c: Category) =>
    setCfg((cur) => cur && {
      ...cur,
      watch_categories: cur.watch_categories.includes(c)
        ? cur.watch_categories.filter((x) => x !== c)
        : [...cur.watch_categories, c],
    });

  async function save() {
    if (!cfg) return;
    setState("saving");
    const res = await fetch("/api/push/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ volume_mult: cfg.volume_mult, price_pct: cfg.price_pct, watch_categories: cfg.watch_categories }),
    });
    if (res.ok) { setState("saved"); setMessage("Saved. New thresholds apply from the next end-of-day run."); }
    else { setState("error"); setMessage((await res.json()).error ?? "Could not save."); }
  }

  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="alerts-h" onClick={(e) => e.stopPropagation()}>
        <div className="grabber" aria-hidden />
        <h2 id="alerts-h" className="sheetTitle">What counts as unusual</h2>

        {cfg ? (
          <div className="sheetBody">
            <div className="field">
              <label htmlFor="vol">
                Volume
                <output htmlFor="vol">{cfg.volume_mult.toFixed(1)}× the {cfg.volume_lookback}-day average</output>
              </label>
              <input id="vol" type="range" min={1.5} max={6} step={0.5} value={cfg.volume_mult}
                onChange={(e) => setCfg({ ...cfg, volume_mult: Number(e.target.value) })} />
            </div>

            <div className="field">
              <label htmlFor="px">
                Price move in a day
                <output htmlFor="px">±{cfg.price_pct.toFixed(1)}%</output>
              </label>
              <input id="px" type="range" min={1} max={10} step={0.5} value={cfg.price_pct}
                onChange={(e) => setCfg({ ...cfg, price_pct: Number(e.target.value) })} />
            </div>

            <fieldset className="field">
              <legend>Alert me on these filings</legend>
              <div className="chipset">
                {WATCHABLE.map((c) => (
                  <button key={c} type="button" className="pill" aria-pressed={cfg.watch_categories.includes(c)} onClick={() => toggle(c)}>
                    {CATEGORY_LABEL[c]}
                  </button>
                ))}
              </div>
            </fieldset>

            {message && <p className={`note ${state === "error" ? "bad" : ""}`} role="status">{message}</p>}

            <div className="actions">
              <button type="button" className="primary" onClick={save} disabled={state === "saving"}>
                {state === "saving" ? "Saving" : "Save thresholds"}
              </button>
              <button type="button" className="ghost" onClick={onClose}>Close</button>
            </div>
          </div>
        ) : (
          <p className="note pad" role="status">{state === "error" ? message : "Loading your settings"}</p>
        )}
      </div>
    </div>
  );
}