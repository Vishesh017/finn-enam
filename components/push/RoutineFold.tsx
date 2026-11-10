"use client";

import { useState } from "react";
import { CATEGORY_LABEL, type FeedAlert } from "@/types/push";
import { plural, whenLabel } from "./format";

/** Everything routine collapses into one quiet line. Expanding shows single-line entries only. */
export function RoutineFold({ items, now }: { items: FeedAlert[]; now: number }) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;

  const companies = new Set(items.map((i) => i.ticker)).size;
  const kinds = [...new Set(items.map((i) => (i.category ? CATEGORY_LABEL[i.category] : "Filing")))];

  return (
    <section className="fold" aria-label="Routine filings">
      <button type="button" className="foldHead" aria-expanded={open} aria-controls="routine-list" onClick={() => setOpen(!open)}>
        <span>
          <span className="foldTitle">
            {plural(items.length, "routine filing")} from {plural(companies, "company", "companies")}
          </span>
          <span className="foldKinds">{kinds.slice(0, 3).join(", ")}{kinds.length > 3 ? ` and ${kinds.length - 3} more` : ""}</span>
        </span>
        <svg className="chev" width="16" height="16" viewBox="0 0 16 16" aria-hidden>
          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <ul id="routine-list" className="mini">
          {items.map((a) => (
            <li key={a.id}>
              <span className="tk">{a.ticker}</span>
              {a.source_url ? (
                <a href={a.source_url} target="_blank" rel="noreferrer">{a.title}</a>
              ) : (
                <span className="mtitle">{a.title}</span>
              )}
              <time dateTime={a.ts}>{whenLabel(a.ts, now)}</time>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}