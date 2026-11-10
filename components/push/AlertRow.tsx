import { CATEGORY_LABEL, type FeedAlert } from "@/types/push";
import { rupees, signedPct, whenLabel } from "./format";
import { PersonCard } from "./PersonCard";
import { ResultsStrip } from "./ResultsStrip";
import { VolumeMeter } from "./VolumeMeter";

const label = (a: FeedAlert) =>
  a.kind === "market" ? "Price and volume" : a.category ? CATEGORY_LABEL[a.category] : "Filing";

/** Names what tripped, since the numbers sit right below. */
function marketHeadline(a: FeedAlert): string {
  const m = a.metrics;
  const vol = (m?.volume_ratio ?? 0) >= (m?.vol_mult ?? 2);
  const px = Math.abs(m?.pct_change ?? 0) >= (m?.price_pct ?? 3);
  if (vol && px) return `${(m!.pct_change ?? 0) > 0 ? "Sharp rise" : "Sharp fall"} on heavy volume`;
  if (vol) return "Unusual trading volume";
  return (m?.pct_change ?? 0) > 0 ? "Large price rise" : "Large price fall";
}

function Filing({ url }: { url: string | null }) {
  return url ? (
    <a className="filing" href={url} target="_blank" rel="noreferrer">
      Open filing
    </a>
  ) : null;
}

/** Needs attention: full-weight card with rail, summary and, where available, the evidence. */
export function AttentionCard({ a, now }: { a: FeedAlert; now: number }) {
  const m = a.metrics;
  const market = a.kind === "market" && m?.pct_change !== undefined;
  const dir = market ? (m!.pct_change! > 0 ? "up" : m!.pct_change! < 0 ? "down" : "flat") : "info";

  return (
    <article className={`card rail-${dir}`}>
      <header className="cardHead">
        <span className="tk">{a.ticker}</span>
        <time dateTime={a.ts}>{whenLabel(a.ts, now)}</time>
        {a.triggered && <span className="trig">Triggered</span>}
        {market && <span className={`move ${dir}`}>{signedPct(m!.pct_change!)}</span>}
      </header>

      <p className="kicker">{label(a)}</p>
      <h3 className="cardTitle">{market ? marketHeadline(a) : a.title}</h3>
      {!market && a.detail && <p className="summary">{a.detail}</p>}

      {a.enrichment?.results && <ResultsStrip data={a.enrichment.results} />}
      {a.enrichment?.person && <PersonCard data={a.enrichment.person} />}

      {market && (
        <div className="evidence">
          {m!.close !== undefined && <p className="px">Closed at <b>{rupees(m!.close)}</b></p>}
          {m!.volume_ratio !== undefined && (
            <VolumeMeter
              ratio={m!.volume_ratio}
              threshold={m!.vol_mult ?? 2}
              volume={m!.volume}
              average={m!.avg_volume}
            />
          )}
        </div>
      )}
      <Filing url={a.source_url} />
    </article>
  );
}

/** Worth a look: two-line row. Ticker and time on the left, content beside it. */
export function ReviewRow({ a, now }: { a: FeedAlert; now: number }) {
  return (
    <li className="rrow">
      <div className="rcol">
        <span className="tk">{a.ticker}</span>
        <time dateTime={a.ts}>{whenLabel(a.ts, now)}</time>
      </div>
      <div className="rbody">
        <p className="rtitle">
          <span className="rtag">{label(a)}</span>
          {a.title}
        </p>
        {a.detail && <p className="rsum">{a.detail}</p>}
        <Filing url={a.source_url} />
      </div>
    </li>
  );
}
