import type { PersonEnrichment } from "@/types/push";
import "./enrichment.css";

const HEADLINE: Record<PersonEnrichment["action"], string> = {
  appointed: "Joining as",
  reappointed: "Reappointed as",
  resigned: "Stepping down as",
  retired: "Retiring as",
  other: "Change at",
};

const host = (url: string) => {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
};

export function PersonCard({ data }: { data: PersonEnrichment }) {
  return (
    <section className="pc" aria-label={`Background on ${data.name}`}>
      <div className="pc-head">
        <div>
          <p className="pc-kicker">{HEADLINE[data.action]} {data.role}</p>
          <h4 className="pc-name">{data.name}</h4>
        </div>
        {data.sample && <span className="rs-sample">Sample data</span>}
      </div>

      {data.found ? (
        <>
          {data.summary && <p className="pc-sum">{data.summary}</p>}
          {data.career && data.career.length > 0 && (
            <ol className="pc-career">
              {data.career.map((c, i) => (
                <li key={i}>
                  <span className="pc-role">{c.role}</span>
                  <span className="pc-org">{c.org}</span>
                  {c.years && <span className="pc-years">{c.years}</span>}
                </li>
              ))}
            </ol>
          )}
          {data.education && <p className="pc-edu">{data.education}</p>}
          {data.sources && data.sources.length > 0 && (
            <p className="pc-src">
              Sources:{" "}
              {data.sources.map((s, i) => (
                <span key={s.url}>
                  {i > 0 && ", "}
                  <a href={s.url} target="_blank" rel="noreferrer">{host(s.url)}</a>
                </span>
              ))}
            </p>
          )}
        </>
      ) : (
        <p className="pc-miss">Background could not be confirmed from public sources.</p>
      )}
    </section>
  );
}
