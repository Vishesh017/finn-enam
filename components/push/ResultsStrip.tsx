import type { ResultsEnrichment, ResultsFigures } from "@/types/push";
import "./enrichment.css";

type Tone = "up" | "down" | "flat" | "na";
interface Delta { text: string; tone: Tone }

const ROWS = [
  ["Revenue", "revenue"],
  ["EBITDA", "ebitda"],
  ["PBT", "pbt"],
  ["PAT", "pat"],
] as const;

const crore = (n: number | null | undefined) =>
  n === null || n === undefined ? "–" : n.toLocaleString("en-IN", { maximumFractionDigits: 0 });

/** Percent change. "n.m." when the base is zero, negative or missing, since the sign flips meaning. */
function delta(cur: number | null, base: number | null | undefined): Delta {
  if (cur === null || base === null || base === undefined || base <= 0) return { text: "n.m.", tone: "na" };
  const p = ((cur - base) / base) * 100;
  if (Math.abs(p) < 0.05) return { text: "0.0%", tone: "flat" };
  return { text: `${p > 0 ? "+" : "−"}${Math.abs(p).toFixed(1)}%`, tone: p > 0 ? "up" : "down" };
}

function Cell({ d, base }: { d: Delta; base: number | null | undefined }) {
  return (
    <td className={`rs-num rs-${d.tone}`}>
      <span>{d.text}</span>
      <small>{crore(base)}</small>
    </td>
  );
}

export function ResultsStrip({ data }: { data: ResultsEnrichment }) {
  const cur: ResultsFigures = data.current;
  const qoq = data.previous_quarter;
  const yoy = data.year_ago;
  const derived = !!cur.ebitda_derived;

  return (
    <section className="rs" aria-label="Headline results">
      <div className="rs-head">
        <h4>
          {data.periods.current ?? "Latest quarter"}
          <span>{data.basis}</span>
        </h4>
        <span className="rs-unit">₹ crore</span>
        {data.sample && <span className="rs-sample">Sample data</span>}
      </div>

      <table className="rs-grid">
        <thead>
          <tr>
            <th scope="col" className="sr-only">Metric</th>
            <th scope="col" className="rs-num">Now</th>
            <th scope="col" className="rs-num">QoQ<small>{data.periods.qoq ?? "n/a"}</small></th>
            <th scope="col" className="rs-num">YoY<small>{data.periods.yoy ?? "n/a"}</small></th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map(([label, key]) => (
            <tr key={key}>
              <th scope="row">{label}{key === "ebitda" && derived ? <sup>†</sup> : null}</th>
              <td className="rs-num rs-strong">{crore(cur[key])}</td>
              <Cell d={delta(cur[key], qoq?.[key])} base={qoq?.[key]} />
              <Cell d={delta(cur[key], yoy?.[key])} base={yoy?.[key]} />
            </tr>
          ))}
        </tbody>
      </table>

      <p className="rs-note">
        Small figures are the comparison quarter.
        {derived && " † EBITDA derived as PBT + finance costs + depreciation − other income; the filing does not print it."}
        {data.unverified > 0 && ` ${data.unverified} figure${data.unverified === 1 ? "" : "s"} could not be matched to the filing and ${data.unverified === 1 ? "was" : "were"} left out.`}
      </p>
    </section>
  );
}
