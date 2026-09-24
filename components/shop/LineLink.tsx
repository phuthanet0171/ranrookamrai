"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export type LinkedUser = { line_user_id: string; display_name: string | null; linked_at: string };

/** Settings -> เชื่อม LINE: make a one-time code, send it to the bot, done. */
export default function LineLink({ shopId, users, addFriend, botId }: {
  shopId: string; users: LinkedUser[]; addFriend: string | null; botId: string | null;
}) {
  const router = useRouter();
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function newCode() {
    setBusy(true); setErr(null);
    const res = await fetch(`/api/shops/${shopId}/line`, { method: "POST" });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (res.ok) setCode(data.code); else setErr(data.error ?? "สร้างรหัสไม่สำเร็จ");
  }
  async function unlink(user: string) {
    if (!confirm("เลิกเชื่อม LINE นี้กับร้าน?")) return;
    const res = await fetch(`/api/shops/${shopId}/line?user=${user}`, { method: "DELETE" });
    if (res.ok) router.refresh(); else alert((await res.json().catch(() => ({}))).error ?? "ไม่สำเร็จ");
  }

  return (
    <div className="stack" style={{ gap: 12 }}>
      {users.length > 0 && (
        <ul className="entries" style={{ marginTop: 0 }}>
          {users.map((u) => (
            <li key={u.line_user_id}>
              <span>✅ {u.display_name ?? "ผู้ใช้ LINE"}</span>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => void unlink(u.line_user_id)}>เลิกเชื่อม</button>
            </li>
          ))}
        </ul>
      )}
      {code ? (
        <div className="line-code">
          <ol>
            <li>เพิ่มเพื่อน LINE ของร้าน{botId ? <> <strong>{botId}</strong></> : null}{addFriend && <> · <a href={addFriend} target="_blank" rel="noreferrer">เปิดใน LINE</a></>}</li>
            <li>ส่งรหัสนี้ในแชต (ใช้ได้ 15 นาที)</li>
          </ol>
          <div className="big-number tabular" aria-label="รหัสเชื่อม LINE">{code}</div>
          <button type="button" className="btn btn-sm" onClick={() => router.refresh()}>เชื่อมแล้ว รีเฟรช</button>
        </div>
      ) : (
        <button type="button" className="btn btn-primary" style={{ width: "fit-content" }} disabled={busy} onClick={() => void newCode()}>
          {busy ? "กำลังสร้าง…" : users.length ? "+ เชื่อม LINE อีกคน (เช่น พนักงาน)" : "สร้างรหัสเชื่อม LINE"}
        </button>
      )}
      {err && <p className="error" style={{ margin: 0 }}>{err}</p>}
    </div>
  );
}
