"use client";

import { useMemo, useState } from "react";
import type { Verdict } from "@/types/pull";
import { CommitmentBar } from "./CommitmentBar";
import { Ledger } from "./Ledger";
import { ResultsGrid } from "./ResultsGrid";
import { TickerSheet } from "./TickerSheet";
import { usePullAnalysis } from "@/components/pull/usePullAnalysis";


export function PullScreen({ portfolio, initialTicker }: { portfolio: string[]; initialTicker?: string }) {
  const [ticker, setTicker] = useState(initialTicker ?? portfolio[0] ?? "");
  const [sheet, setSheet] = useState(false);
  const [filter, setFilter] = useState<Verdict | null>(null);
  const { status, data, error, retry } = usePullAnalysis(ticker || null);

  const visible = useMemo(
    () => (data ? data.commitments.filter((c) => !filter || c.verdict === filter) : []),
    [data, filter],
  );

  return (
    <main className="pull">
      <header className="top">
        <button type="button" className="tickerBtn" onClick={() => setSheet(true)} aria-haspopup="dialog">
          <span className="sym">{ticker || "Choose company"}</span>
          <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden suppressHydrationWarning>            <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="who">
          <span className="co">{data?.company ?? (status === "loading" ? "Loading" : "")}</span>
          {data?.asOf && <span className="asof">Through {data.asOf}</span>}
        </div>
      </header>

      {status === "loading" && (
        <div className="state" role="status" aria-live="polite">
          <p className="note">Reading transcripts and annual reports for {ticker}. This takes about half a minute the first time.</p>
          <div className="skel hero" /><div className="skel" /><div className="skel" /><div className="skel" />
        </div>
      )}

      {status === "error" && (
        <div className="state" role="alert">
          <h2 className="heroTitle">{error}</h2>
          <div className="actions">
            <button type="button" className="primary" onClick={retry}>Try again</button>
            <button type="button" className="ghost" onClick={() => setSheet(true)}>Choose another company</button>
          </div>
        </div>
      )}

      {status === "ready" && data && (
        <>
          <CommitmentBar commitments={data.commitments} active={filter} onChange={setFilter} />

          <section className="block flush" aria-label="Commitments">
            <Ledger items={visible} docs={data.docs} />
          </section>

          <ResultsGrid quarters={data.quarters} />

          {data.toneShift.summary && (
            <section className="block" aria-labelledby="tone-h">
              <h2 id="tone-h" className="blockTitle">How the language changed</h2>
              <p className="prose">{data.toneShift.summary}</p>
              {data.toneShift.quotes.map((q, i) => (
                <blockquote key={i} className="quote">
                  <p>{q.quote}</p>
                  <footer>{data.docs.find((d) => d.id === q.docId)?.title}</footer>
                </blockquote>
              ))}
            </section>
          )}

          <footer className="foot">
            <p>
              Built only from {data.docs.length} company documents: {data.docs.map((d) => d.period).join(", ")}.
              No broker notes, news or outside knowledge.
            </p>
            {data.dropped > 0 && (
              <p>
                {data.dropped} {data.dropped === 1 ? "claim was" : "claims were"} removed because the quote could not be found in the source.
              </p>
            )}
          </footer>
        </>
      )}

      <TickerSheet
        open={sheet}
        current={ticker}
        suggestions={portfolio}
        onClose={() => setSheet(false)}
        onSelect={(t) => { setTicker(t); setFilter(null); setSheet(false); }}
      />
    </main>
  );
}