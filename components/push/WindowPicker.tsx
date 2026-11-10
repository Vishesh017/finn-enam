const OPTIONS = [
  { hours: 6, label: "6h" },
  { hours: 24, label: "24h" },
  { hours: 72, label: "3d" },
  { hours: 168, label: "7d" },
] as const;

export function WindowPicker({ value, onChange }: { value: number; onChange: (h: number) => void }) {
  return (
    <div className="seg" role="radiogroup" aria-label="Time window">
      {OPTIONS.map((o) => (
        <button
          key={o.hours}
          type="button"
          role="radio"
          aria-checked={value === o.hours}
          onClick={() => onChange(o.hours)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}