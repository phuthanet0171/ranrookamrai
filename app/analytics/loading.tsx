export default function Loading() {
  return (
    <div aria-busy="true" aria-label="กำลังโหลดข้อมูล">
      <div className="page-head">
        <div style={{ width: "min(420px, 80%)" }}>
          <div className="skeleton-line" style={{ width: "40%" }} />
          <div className="skeleton-line" style={{ width: "70%", height: 26 }} />
          <div className="skeleton-line" style={{ width: "55%" }} />
        </div>
      </div>
      <div className="grid kpis">
        {[0, 1, 2, 3].map((i) => (
          <div className="card" key={i}>
            <div className="skeleton-line" style={{ width: "50%" }} />
            <div className="skeleton-line" style={{ width: "70%", height: 26 }} />
            <div className="skeleton-line" style={{ width: "60%" }} />
          </div>
        ))}
      </div>
      <div className="card"><div className="skeleton-line" style={{ height: 220 }} /></div>
      <p className="muted" style={{ textAlign: "center" }}>กำลังโหลดข้อมูล…</p>
    </div>
  );
}
