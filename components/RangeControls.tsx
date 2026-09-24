// Plain links + a GET form: works without JavaScript and every view has a shareable URL.
import { PRESETS } from "@/lib/range";

export default function RangeControls({ preset, start, end, min, max }: {
  preset: string; start: string; end: string; min: string; max: string;
}) {
  return (
    <div className="controls">
      <nav className="seg" aria-label="ช่วงเวลา">
        {PRESETS.map((p) => (
          <a key={p.id} href={`/analytics?range=${p.id}`} aria-current={preset === p.id ? "true" : undefined}>
            {p.label}
          </a>
        ))}
      </nav>
      <form className="date-form" action="/analytics" method="get">
        <input type="date" name="start" defaultValue={start} min={min} max={max} aria-label="วันเริ่มต้น" />
        <span className="muted">ถึง</span>
        <input type="date" name="end" defaultValue={end} min={min} max={max} aria-label="วันสิ้นสุด" />
        <button className="btn" type="submit">ดูข้อมูล</button>
      </form>
    </div>
  );
}
