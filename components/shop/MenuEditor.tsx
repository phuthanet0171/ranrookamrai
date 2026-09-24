"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { MenuItem } from "@/lib/shop";

type Row = { id?: string; name: string; category: string; unit: string; price: string; unit_cost: string; aliases: string; active: boolean };

const toRow = (m: MenuItem): Row => ({
  id: m.id, name: m.name, category: m.category, unit: m.unit, price: String(m.price),
  unit_cost: m.unit_cost === null ? "" : String(m.unit_cost), aliases: m.aliases.join(", "), active: m.active,
});
const blank = (): Row => ({ name: "", category: "อาหาร", unit: "จาน", price: "", unit_cost: "", aliases: "", active: true });

export default function MenuEditor({ shopId, menu, canEdit }: { shopId: string; menu: MenuItem[]; canEdit: boolean }) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(menu.length ? menu.map(toRow) : [blank()]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const set = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function save() {
    setMsg(null);
    const items = rows.filter((r) => r.name.trim()).map((r) => ({
      ...(r.id ? { id: r.id } : {}),
      name: r.name.trim(), category: r.category.trim() || "ทั่วไป", unit: r.unit.trim() || "ที่",
      price: Number(r.price), unit_cost: r.unit_cost.trim() === "" ? null : Number(r.unit_cost),
      aliases: r.aliases.split(",").map((a) => a.trim()).filter(Boolean), active: r.active,
    }));
    setSaving(true);
    try {
      const res = await fetch(`/api/shops/${shopId}/menu`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `บันทึกไม่สำเร็จ (${res.status})`);
      setMsg({ ok: true, text: `บันทึกเมนูแล้ว ${data.saved} รายการ` });
      router.refresh();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      {/* one card per menu item: readable on a phone, no sideways scrolling */}
      <ul className="menu-edit">
        {rows.map((r, i) => {
          const price = Number(r.price), cost = r.unit_cost.trim() === "" ? null : Number(r.unit_cost);
          const margin = cost !== null && price > 0 && Number.isFinite(cost) ? Math.round(((price - cost) / price) * 100) : null;
          return (
            <li key={r.id ?? `new-${i}`} className={r.active ? "" : "off"}>
              <input className="input me-name" aria-label="ชื่อเมนู" placeholder="ชื่อเมนู" value={r.name} disabled={!canEdit} onChange={(e) => set(i, { name: e.target.value })} />
              <div className="me-nums">
                <label><span>ราคาขาย</span><input className="input" inputMode="decimal" value={r.price} disabled={!canEdit} onChange={(e) => set(i, { price: e.target.value })} /></label>
                <label><span>ต้นทุน</span><input className="input" inputMode="decimal" placeholder="ยังไม่รู้" value={r.unit_cost} disabled={!canEdit} onChange={(e) => set(i, { unit_cost: e.target.value })} /></label>
                <label><span>หน่วย</span><input className="input" value={r.unit} disabled={!canEdit} onChange={(e) => set(i, { unit: e.target.value })} /></label>
              </div>
              <div className="me-foot">
                <span className="muted">{margin === null ? "ใส่ต้นทุนเพื่อดูกำไร" : `กำไร ${margin}% ต่อ${r.unit || "หน่วย"}`}</span>
                <label className="switch"><input type="checkbox" checked={r.active} disabled={!canEdit} onChange={(e) => set(i, { active: e.target.checked })} /> ขายอยู่</label>
              </div>
              <details className="me-more">
                <summary>หมวดและชื่อเรียกอื่น</summary>
                <div className="me-nums" style={{ marginTop: 8 }}>
                  <label><span>หมวด</span><input className="input" value={r.category} disabled={!canEdit} onChange={(e) => set(i, { category: e.target.value })} /></label>
                  <label style={{ gridColumn: "span 2" }}><span>ชื่อเรียกอื่น (คั่นด้วย ,)</span><input className="input" placeholder="เช่น มันไก่" value={r.aliases} disabled={!canEdit} onChange={(e) => set(i, { aliases: e.target.value })} /></label>
                </div>
              </details>
            </li>
          );
        })}
      </ul>
      {canEdit && (
        <div className="controls" style={{ marginTop: 10 }}>
          <button type="button" className="btn btn-sm" onClick={() => setRows((rs) => [...rs, blank()])}>+ เพิ่มเมนู</button>
          <button type="button" className="btn btn-sm btn-primary" disabled={saving} onClick={() => void save()}>{saving ? "กำลังบันทึก…" : "บันทึกเมนู"}</button>
                  </div>
      )}
      {msg && <div className={`alert ${msg.ok ? "alert-ok" : "alert-err"}`} style={{ marginTop: 10, marginBottom: 0 }}><div>{msg.text}</div></div>}
    </div>
  );
}
