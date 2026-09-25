"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AddRule({ shopId, kinds }: { shopId: string; kinds: { kind: string; label: string; description: string; exists: boolean }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div>
      <button className="btn btn-primary" type="button" disabled={busy !== null}
        onClick={async () => {
          setBusy("recommended"); setErr(null);
          try {
            const res = await fetch("/api/automations", { method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ shop_id: shopId, kind: "recommended" }) });
            if (!res.ok) throw new Error((await res.json()).error ?? "เพิ่มกฎไม่สำเร็จ");
            router.refresh();
          } catch (e) { setErr((e as Error).message); }
          finally { setBusy(null); }
        }}>เพิ่มกฎแนะนำที่ยังไม่มี</button>
    <div className="template-grid" style={{ marginTop: 12 }}>
      {kinds.map((k) => (
        <button key={k.kind} type="button" className="template" disabled={busy !== null}
          onClick={async () => {
            setBusy(k.kind); setErr(null);
            const res = await fetch("/api/automations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shop_id: shopId, kind: k.kind }) });
            setBusy(null);
            if (res.ok) router.refresh();
            else setErr((await res.json().catch(() => ({}))).error ?? "เพิ่มกฎไม่สำเร็จ");
          }}>
          <strong>+ {k.label}{k.exists ? " (เพิ่มอีกกฎ)" : ""}</strong>
          <span>{k.description}</span>
        </button>
      ))}
      {err && <div className="alert alert-err"><div>{err}</div></div>}
    </div>
    </div>
  );
}
