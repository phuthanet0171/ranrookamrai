"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

/** Void one recording (kept in history, removed from the numbers). */
export function VoidEntryButton({ shopId, entryId }: { shopId: string; entryId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" className="btn btn-sm btn-ghost" disabled={busy}
      onClick={async () => {
        if (!confirm("ยกเลิกรายการนี้? ตัวเลขของวันนี้จะไม่นับรายการนี้ (ประวัติยังเก็บไว้)")) return;
        setBusy(true);
        const res = await fetch(`/api/shops/${shopId}/entries?entry=${entryId}`, { method: "DELETE" });
        setBusy(false);
        if (res.ok) router.refresh();
        else alert((await res.json().catch(() => ({}))).error ?? "ยกเลิกไม่สำเร็จ");
      }}>
      {busy ? "…" : "ยกเลิก"}
    </button>
  );
}

/** Start a shop: just a name. The next stop is the menu (Settings), then the first day. */
export function CreateShop() {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function create() {
    setErr(null); setBusy(true);
    try {
      const res = await fetch("/api/shops", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `สร้างร้านไม่สำเร็จ (${res.status})`);
      window.location.href = `/api/shops/select?id=${data.id}&next=${encodeURIComponent("/settings?welcome=1#menu")}`;
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); void create(); }} className="field">
      <label htmlFor="shopname">ชื่อร้าน</label>
      <input id="shopname" className="input input-lg" value={name} maxLength={80} placeholder="เช่น ร้านก๋วยเตี๋ยวลุงชัย" onChange={(e) => setName(e.target.value)} />
      <button type="submit" className="btn btn-primary btn-lg" disabled={busy || !name.trim()} style={{ marginTop: 6 }}>
        {busy ? "กำลังสร้าง…" : "สร้างร้าน →"}
      </button>
      {err && <p className="error" style={{ margin: 0 }}>{err}</p>}
    </form>
  );
}

/** Delete a shop and everything in it; the owner types the name back to confirm. */
export function DeleteShopButton({ shopId, name }: { shopId: string; name: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" className="btn btn-sm btn-danger" disabled={busy}
      onClick={async () => {
        const typed = prompt(`ลบร้าน "${name}" พร้อมเมนูและยอดที่จดทั้งหมด (กู้คืนไม่ได้)
พิมพ์ชื่อร้านเพื่อยืนยัน:`);
        if (typed === null) return;
        if (typed.trim() !== name) { alert("ชื่อร้านไม่ตรง ยังไม่ได้ลบ"); return; }
        setBusy(true);
        const res = await fetch(`/api/shops/${shopId}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirm: typed }) });
        if (res.ok) { window.location.href = "/"; return; }
        setBusy(false);
        alert((await res.json().catch(() => ({}))).error ?? "ลบไม่สำเร็จ");
      }}>
      {busy ? "กำลังลบ…" : "ลบร้านนี้"}
    </button>
  );
}

/** Remove every imported sales file (the /analytics data). */
export function ClearImportedButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" className="btn btn-sm btn-danger" disabled={busy}
      onClick={async () => {
        if (!confirm("ลบข้อมูลจากไฟล์ที่นำเข้าทั้งหมด? (ร้านและยอดที่จดไว้ไม่ถูกลบ)")) return;
        setBusy(true);
        const res = await fetch("/api/data", { method: "DELETE" });
        setBusy(false);
        if (res.ok) router.refresh();
        else alert((await res.json().catch(() => ({}))).error ?? "ลบไม่สำเร็จ");
      }}>
      {busy ? "กำลังลบ…" : "ลบข้อมูลที่นำเข้า"}
    </button>
  );
}

/** Mark every notification of a shop as read. */
export function MarkReadButton({ shopId }: { shopId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" className="btn btn-sm btn-ghost" disabled={busy}
      onClick={async () => {
        setBusy(true);
        await fetch("/api/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shop_id: shopId }) });
        setBusy(false);
        router.refresh();
      }}>
      อ่านทั้งหมดแล้ว
    </button>
  );
}
