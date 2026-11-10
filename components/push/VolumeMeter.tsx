import { shares } from "./format";

interface Props {
  ratio: number;
  threshold: number;
  volume?: number;
  average?: number;
}

/** Today's volume as a multiple of its average, with the investor's threshold marked. */
export function VolumeMeter({ ratio, threshold, volume, average }: Props) {
  const scale = Math.max(ratio, threshold * 1.6);
  const fill = Math.min(100, (ratio / scale) * 100);
  const tick = Math.min(100, (threshold / scale) * 100);
  const over = ratio >= threshold;

  return (
    <div className="vol">
      <div className="volTop">
        <span>
          Volume <b>{ratio.toFixed(1)}×</b> average
        </span>
        {volume !== undefined && average !== undefined && (
          <span className="faint">{shares(volume)} vs {shares(average)}</span>
        )}
      </div>
      <div
        className="track"
        role="img"
        aria-label={`Volume is ${ratio.toFixed(1)} times the average; your threshold is ${threshold} times`}
      >
        <span className={`fill${over ? " over" : ""}`} style={{ width: `${fill}%` }} />
        <span className="tick" style={{ left: `${tick}%` }} />
      </div>
    </div>
  );
}