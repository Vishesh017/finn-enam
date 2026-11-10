"use client";

import { useState } from "react";
import type { Commitment, PullAnalysis } from "@/types/pull";
import { VERDICT_LABEL } from "./CommitmentBar";

type DocMeta = PullAnalysis["docs"][number];

function Source({ doc, quote }: { doc?: DocMeta; quote: string }) {
  return (
    <blockquote className="quote">
      <p>{quote}</p>
      <footer>
        {doc?.url ? (
          <a href={doc.url} target="_blank" rel="noreferrer">{doc.title}</a>
        ) : (
          doc?.title ?? "Source document"
        )}
      </footer>
    </blockquote>
  );
}

function Row({ c, docs, open, onToggle }: { c: Commitment; docs: Map<string, DocMeta>; open: boolean; onToggle: () => void }) {
  const bodyId = `body-${c.id}`;
  return (
    <li className={`row v-${c.verdict}`}>
      <button type="button" className="rowHead" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
        <span className="rail" aria-hidden />
        <span className="rowMain">
          <span className="rowTop">
            <strong>{c.metric}</strong>
            <span className="vtag">{VERDICT_LABEL[c.verdict]}</span>
          </span>
          <span className="pair">
            <span>
              <i>Said in {c.madeIn}</i>
              {c.target}
            </span>
            <span>
              <i>Got</i>
              {c.outcome}
            </span>
          </span>
        </span>
        <svg className="chev" width="16" height="16" viewBox="0 0 16 16" aria-hidden>
          <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div id={bodyId} className="rowBody">
          {c.gap && <p className="gap">{c.gap}</p>}
          <h3>What management said</h3>
          <Source doc={docs.get(c.promiseDocId)} quote={c.promiseQuote} />
          {c.deliveredQuote && c.deliveredDocId && (
            <>
              <h3>What the filing shows</h3>
              <Source doc={docs.get(c.deliveredDocId)} quote={c.deliveredQuote} />
            </>
          )}
        </div>
      )}
    </li>
  );
}

export function Ledger({ items, docs }: { items: Commitment[]; docs: DocMeta[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const byId = new Map(docs.map((d) => [d.id, d]));

  if (items.length === 0) return <p className="note pad">Nothing in this category.</p>;

  return (
    <ul className="ledger">
      {items.map((c) => (
        <Row key={c.id} c={c} docs={byId} open={openId === c.id} onToggle={() => setOpenId(openId === c.id ? null : c.id)} />
      ))}
    </ul>
  );
}