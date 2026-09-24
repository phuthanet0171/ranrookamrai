"use client";
import { useState } from "react";

export default function LoginForm({ next = "/" }: { next?: string }) {
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form className="field" onSubmit={async (e) => {
      e.preventDefault();
      setErr(null); setBusy(true);
      const res = await fetch("/api/auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      setBusy(false);
      if (res.ok) window.location.href = next.startsWith("/") && !next.startsWith("//") ? next : "/";
      else setErr((await res.json().catch(() => ({}))).error ?? "เข้าสู่ระบบไม่สำเร็จ");
    }}>
      <label htmlFor="pw">รหัสผ่าน</label>
      <input id="pw" className="input input-lg" type="password" autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
      <button type="submit" className="btn btn-primary" disabled={busy || !password} style={{ width: "fit-content", marginTop: 6 }}>
        {busy ? "กำลังตรวจ…" : "เข้าสู่ระบบ"}
      </button>
      {err && <p className="error" style={{ margin: 0 }}>{err}</p>}
    </form>
  );
}
