interface SliderFieldProps {
  label: string;
  subLabel?: string;
  value: number;
  min: number;
  max: number;
  onChange: (val: number) => void;
}

export default function SliderField({ label, subLabel, value, min, max, onChange }: SliderFieldProps) {
  const pct = ((value - min) / (max - min)) * 100;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label style={{ color: "var(--text-main)", fontSize: "0.875rem", fontWeight: 500 }}>{label}</label>
        <span
          className="font-display text-xl leading-none px-2 py-0.5 rounded"
          style={{ color: "var(--accent)", background: "color-mix(in srgb, var(--accent) 12%, transparent)" }}
        >
          {value}
        </span>
      </div>
      {subLabel && <p style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>{subLabel}</p>}
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full"
        style={{
          background: `linear-gradient(to right, var(--accent) ${pct}%, var(--bg-input) ${pct}%)`,
        }}
      />
      <div className="flex justify-between" style={{ color: "var(--text-muted)", fontSize: "0.75rem" }}>
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}
