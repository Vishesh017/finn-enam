import type { QuarterMetrics } from "@/types/pull";
import {
  bpsDelta, crore, margin, pctDelta, pickComparisons, sameQuarterLastYear, type Delta,
}   from "@/components/push/format";

const ROWS = [
  ["Revenue", "revenue"],
  ["EBITDA", "ebitda"],
  ["PBT", "pbt"],
  ["PAT", "pat"],
] as const;

function DeltaCell({ d, from }: { d: Delta; from: string }) {
  return (
    <td className={`num delta ${d.tone}`}>
      <span>{d.text}</span>
      <small>{from}</small>
    </td>
  );
}

export function ResultsGrid({ quarters }: { quarters: QuarterMetrics[] }) {
  const { cur, qoq, yoy } = pickComparisons(quarters);
  if (!cur) return null;

  const yoyLabel = sameQuarterLastYear(cur.label);
  const curMargin = margin(cur.ebitda, cur.revenue);
  const qoqMargin = qoq ? margin(qoq.ebitda, qoq.revenue) : null;
  const yoyMargin = yoy ? margin(yoy.ebitda, yoy.revenue) : null;

  return (
    <section aria-labelledby="results-h" className="block">
      <h2 id="results-h" className="blockTitle">
        Results, {cur.label}
        <span className="unit">₹ crore</span>
      </h2>
      <table className="grid">
        <thead>
          <tr>
            <th scope="col" className="sr-only">Metric</th>
            <th scope="col" className="num">{cur.label}</th>
            <th scope="col" className="num">QoQ</th>
            <th scope="col" className="num">YoY</th>
          </tr>
        </thead>
        <tbody>
          {ROWS.map(([label, key]) => (
            <tr key={key}>
              <th scope="row">{label}</th>
              <td className="num strong">{crore(cur[key])}</td>
              <DeltaCell
                d={pctDelta(cur[key], qoq?.[key] ?? null)}
                from={qoq ? crore(qoq[key]) : "–"}
              />
              <DeltaCell
                d={pctDelta(cur[key], yoy?.[key] ?? null)}
                from={yoy ? crore(yoy[key]) : "–"}
              />
            </tr>
          ))}
          <tr className="sub">
            <th scope="row">EBITDA margin</th>
            <td className="num strong">{curMargin === null ? "–" : `${curMargin.toFixed(1)}%`}</td>
            <DeltaCell d={bpsDelta(curMargin, qoqMargin)} from={qoqMargin === null ? "–" : `${qoqMargin.toFixed(1)}%`} />
            <DeltaCell d={bpsDelta(curMargin, yoyMargin)} from={yoyMargin === null ? "–" : `${yoyMargin.toFixed(1)}%`} />
          </tr>
        </tbody>
      </table>
      <p className="note">
        Small figures show the comparison quarter ({qoq?.label ?? "previous quarter unavailable"}
        {" and "}{yoy?.label ?? (yoyLabel ? `${yoyLabel} not in sources` : "year-ago quarter unavailable")}).
        Taken from the results filing; n.m. means the base is zero or a loss.
      </p>
    </section>
  );
}