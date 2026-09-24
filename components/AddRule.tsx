"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function AddRule({ shopId, kinds }: { shopId: string; kinds: { kind: string; label: string; description: string; exists: boolean }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="template-grid">
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
  );
}
