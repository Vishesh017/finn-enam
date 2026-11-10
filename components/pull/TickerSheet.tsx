"use client";

import { useEffect, useMemo, useRef, useState } from "react";

interface Props {
  open: boolean;
  current: string;
  suggestions: string[];
  onSelect: (ticker: string) => void;
  onClose: () => void;
}

const VALID = /^[A-Z0-9&-]{1,20}$/;

export function TickerSheet({ open, current, suggestions, onSelect, onClose }: Props) {
  const [q, setQ] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQ("");
    input.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  const query = q.trim().toUpperCase();
  const matches = useMemo(
    () => suggestions.filter((s) => s.includes(query)),
    [suggestions, query],
  );
  const canAddCustom = VALID.test(query) && !suggestions.includes(query);

  if (!open) return null;

  return (
    <div className="scrim" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Choose a company"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="grabber" aria-hidden />
        <input
          ref={input}
          className="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            if (matches[0]) onSelect(matches[0]);
            else if (canAddCustom) onSelect(query);
          }}
          placeholder="Search your portfolio or type any NSE symbol"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          aria-label="NSE symbol"
        />
        <ul className="picks">
          {matches.map((s) => (
            <li key={s}>
              <button type="button" aria-current={s === current} onClick={() => onSelect(s)}>
                {s}
                {s === current && <span>Viewing</span>}
              </button>
            </li>
          ))}
          {canAddCustom && (
            <li>
              <button type="button" onClick={() => onSelect(query)}>
                Analyse {query}
                <span>Not in portfolio</span>
              </button>
            </li>
          )}
          {matches.length === 0 && !canAddCustom && (
            <li className="note pad">Use letters and numbers only, for example M&amp;M or BAJAJ-AUTO.</li>
          )}
        </ul>
      </div>
    </div>
  );
}