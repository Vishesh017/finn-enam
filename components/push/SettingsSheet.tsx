"use client";

import { useEffect } from "react";
import { CATEGORIES, CATEGORY_LABEL, type Category } from "@/types/push";
import { DEFAULT_PREFS, LIMITS, type Prefs } from "./prefs";

const WATCHABLE = CATEGORIES.filter((c) => c !== "unclassified");

interface Props {
  open: boolean;
  prefs: Prefs;
  /** Number of alerts currently needing attention, shown live so the effect of a change is visible. */
  attentionCount: number;
  onChange: (next: Prefs) => void;
  onClose: () => void;
}

export function SettingsSheet({ open, prefs, attentionCount, onChange, onClose }: Props) {
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
    onChange({
      ...prefs,
      watch_categories: prefs.watch_categories.includes(c)
        ? prefs.watch_categories.filter((x) => x !== c)
        : [...prefs.watch_categories, c],
    });

  const isDefault =
    prefs.volume_mult === DEFAULT_PREFS.volume_mult &&
    prefs.price_pct === DEFAULT_PREFS.price_pct &&
    prefs.watch_categories.length === DEFAULT_PREFS.watch_categories.length &&
    DEFAULT_PREFS.watch_categories.every((c) => prefs.watch_categories.includes(c));

  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="alerts-h" onClick={(e) => e.stopPropagation()}>
        <div className="grabber" aria-hidden />
        <h2 id="alerts-h" className="sheetTitle">What counts as unusual</h2>

        <div className="sheetBody">
          <div className="field">
            <label htmlFor="vol">
              Volume
              <output htmlFor="vol">{prefs.volume_mult.toFixed(1)}× the 20-day average</output>
            </label>
            <input id="vol" type="range" {...LIMITS.volume} value={prefs.volume_mult}
              onChange={(e) => onChange({ ...prefs, volume_mult: Number(e.target.value) })} />
          </div>

          <div className="field">
            <label htmlFor="px">
              Price move in a day
              <output htmlFor="px">±{prefs.price_pct.toFixed(1)}%</output>
            </label>
            <input id="px" type="range" {...LIMITS.price} value={prefs.price_pct}
              onChange={(e) => onChange({ ...prefs, price_pct: Number(e.target.value) })} />
          </div>

          <fieldset className="field">
            <legend>Alert me on these filings</legend>
            <div className="chipset">
              {WATCHABLE.map((c) => (
                <button key={c} type="button" className="pill"
                  aria-pressed={prefs.watch_categories.includes(c)} onClick={() => toggle(c)}>
                  {CATEGORY_LABEL[c]}
                </button>
              ))}
            </div>
          </fieldset>

          <p className="note" role="status" aria-live="polite">
            {attentionCount === 0 ? "Nothing needs attention" : `${attentionCount} ${attentionCount === 1 ? "item needs" : "items need"} attention`} with these settings.
            Changes apply instantly and are saved on this device.
          </p>

          <div className="actions">
            <button type="button" className="primary" onClick={onClose}>Done</button>
            <button type="button" className="ghost" disabled={isDefault} onClick={() => onChange(DEFAULT_PREFS)}>
              Reset to defaults
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}