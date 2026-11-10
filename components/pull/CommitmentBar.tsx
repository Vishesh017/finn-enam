import type { Commitment, Verdict } from "@/types/pull";

export const VERDICT_LABEL: Record<Verdict, string> = {
  delivered: "Delivered",
  partial: "Partly delivered",
  missed: "Missed",
  unverifiable: "Can't verify",
};

const ORDER: Verdict[] = ["delivered", "partial", "missed", "unverifiable"];

interface Props {
  commitments: Commitment[];
  active: Verdict | null;
  onChange: (v: Verdict | null) => void;
}

export function CommitmentBar({ commitments, active, onChange }: Props) {
  const total = commitments.length;
  const counts = ORDER.map((v) => ({ v, n: commitments.filter((c) => c.verdict === v).length }));
  const delivered = counts[0].n;

  if (total === 0) {
    return (
      <section className="block hero">
        <h2 className="heroTitle">No checkable commitments found in these documents.</h2>
      </section>
    );
  }

  return (
    <section className="block hero" aria-labelledby="hero-h">
      <h2 id="hero-h" className="heroTitle">
        Management delivered on {delivered} of {total} commitments it made.
      </h2>

      <div className="bar" role="img" aria-label={counts.map(({ v, n }) => `${n} ${VERDICT_LABEL[v]}`).join(", ")}>
        {counts.map(({ v, n }) =>
          n === 0 ? null : (
            <span
              key={v}
              className={`seg v-${v}`}
              style={{ flexGrow: n }}
              data-dim={active !== null && active !== v}
            />
          ),
        )}
      </div>

      <div className="chips" role="group" aria-label="Filter commitments by outcome">
        {counts.map(({ v, n }) => (
          <button
            key={v}
            type="button"
            className={`chip v-${v}`}
            aria-pressed={active === v}
            disabled={n === 0}
            onClick={() => onChange(active === v ? null : v)}
          >
            <i className="swatch" aria-hidden />
            {VERDICT_LABEL[v]}
            <b>{n}</b>
          </button>
        ))}
      </div>
    </section>
  );
}