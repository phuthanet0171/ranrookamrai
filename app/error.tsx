"use client";
// Any page that throws lands here instead of a blank screen.
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card notice" style={{ marginTop: 24 }}>
      <h1>มีบางอย่างผิดพลาด</h1>
      <p>ลองใหม่อีกครั้ง ถ้ายังไม่ได้ ตรวจอินเทอร์เน็ต หรือกลับไปที่หน้าหลัก</p>
      <div className="controls">
        <button type="button" className="btn btn-primary" onClick={() => reset()}>ลองใหม่</button>
        <a className="btn" href="/">หน้าหลัก</a>
      </div>
      {error.digest && <p className="muted" style={{ fontSize: 12.5 }}>รหัสอ้างอิง: {error.digest}</p>}
    </div>
  );
}
