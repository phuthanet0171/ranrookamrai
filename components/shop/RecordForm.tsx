"use client";
import { useMemo, useState } from "react";
import type { MenuItem } from "@/lib/shop";
import { money } from "@/lib/format";

type Expense = { category: string; description: string; amount: string };
const EXPENSE_CATEGORIES = ["วัตถุดิบ", "แก๊สและน้ำแข็ง", "ค่าแรง", "ค่าเช่า", "ค่าน้ำค่าไฟ", "บรรจุภัณฑ์", "อื่น ๆ"];
const blankExpense = (): Expense => ({ category: "วัตถุดิบ", description: "", amount: "" });

const toNum = (s: string) => {
  const n = Number(s.replace(/[,\s฿]/g, ""));
  return s.trim() === "" || !Number.isFinite(n) ? null : n;
};

/** Record one day: tap +/- per menu item, optionally money counted and what was spent. */
export default function RecordForm({ shopId, date, menu, sym, canEdit }: {
  shopId: string; date: string; menu: MenuItem[]; sym: string; canEdit: boolean;
}) {
  const active = menu.filter((m) => m.active);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [cash, setCash] = useState("");
  const [transfer, setTransfer] = useState("");
  const [expenses, setExpenses] = useState<Expense[]>([blankExpense()]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const salesTotal = useMemo(() => active.reduce((s, m) => s + (toNum(qty[m.id] ?? "") ?? 0) * m.price, 0), [active, qty]);
  const items = active.filter((m) => (toNum(qty[m.id] ?? "") ?? 0) > 0).length;
  const counted = cash.trim() !== "" || transfer.trim() !== "";
  const gap = (toNum(cash) ?? 0) + (toNum(transfer) ?? 0) - salesTotal;
  const bump = (id: string, d: number) =>
    setQty((q) => ({ ...q, [id]: String(Math.max(0, (toNum(q[id] ?? "") ?? 0) + d)) }));

  async function save() {
    setErr(null);
    const sales = active.map((m) => ({ menu_item_id: m.id, quantity: toNum(qty[m.id] ?? "") }))
      .filter((s): s is { menu_item_id: string; quantity: number } => s.quantity !== null && s.quantity > 0);
    const exp = expenses.map((e) => ({ category: e.category, description: e.description.trim() || null, amount: toNum(e.amount) }))
      .filter((e) => e.amount !== null && e.amount > 0);
    const entry: Record<string, unknown> = { sales, expenses: exp };
    if (cash.trim() !== "") entry.cash = toNum(cash);
    if (transfer.trim() !== "") entry.transfer = toNum(transfer);
    setSaving(true);
    try {
      const res = await fetch(`/api/shops/${shopId}/entries`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date, entry }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? `บันทึกไม่สำเร็จ (${res.status})`);
      window.location.href = "/?saved=1";
    } catch (e) {
      setErr((e as Error).message);
      setSaving(false);
    }
  }

  if (active.length === 0) {
    return <div className="card notice"><p style={{ margin: 0 }}>ยังไม่มีเมนู <a href="/settings#menu">เพิ่มเมนูในหน้าตั้งค่า</a> ก่อนนะ</p></div>;
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="record">
      <fieldset disabled={!canEdit || saving}>
        <section className="card">
          <h2 className="step-title">ขายอะไรไปบ้าง</h2>
          <ul className="steppers">
            {active.map((m) => {
              const v = qty[m.id] ?? "";
              return (
                <li key={m.id} className={(toNum(v) ?? 0) > 0 ? "has-qty" : ""}>
                  <span className="st-name">{m.name}<small>{money(m.price, sym)} / {m.unit}</small></span>
                  <span className="st-ctrl">
                    <button type="button" aria-label={`ลด${m.name}`} onClick={() => bump(m.id, -1)}>−</button>
                    <input inputMode="decimal" value={v} placeholder="0" aria-label={`จำนวน${m.name} (${m.unit})`}
                      onChange={(e) => setQty((q) => ({ ...q, [m.id]: e.target.value }))} />
                    <button type="button" aria-label={`เพิ่ม${m.name}`} onClick={() => bump(m.id, 1)}>+</button>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        <details className="card fold" open={counted}>
          <summary><h2 className="step-title">เงินที่รับ <small className="muted">(ไม่บังคับ · ใช้เช็กเงินขาด)</small></h2></summary>
          <div className="form-grid" style={{ marginTop: 12 }}>
            <div className="field">
              <label htmlFor="cash">เงินสดจากยอดขาย (ไม่รวมเงินทอนตั้งต้น)</label>
              <input id="cash" className="input input-lg" inputMode="decimal" value={cash} placeholder={`${sym} 0`} onChange={(e) => setCash(e.target.value)} />
              <small className="muted">ถ้าหยิบเงินจากยอดขายไปจ่ายของ ให้กรอกยอดก่อนหยิบ และบันทึกค่าใช้จ่ายแยกด้านล่าง</small>
            </div>
            <div className="field">
              <label htmlFor="transfer">เงินโอน / พร้อมเพย์</label>
              <input id="transfer" className="input input-lg" inputMode="decimal" value={transfer} placeholder={`${sym} 0`} onChange={(e) => setTransfer(e.target.value)} />
            </div>
          </div>
        </details>

        <details className="card fold">
          <summary><h2 className="step-title">รายจ่ายวันนี้ <small className="muted">(ไม่บังคับ)</small></h2></summary>
          <div style={{ marginTop: 10 }}>
            {expenses.map((x, i) => (
              <div key={i} className="expense-row">
                <select className="input" aria-label="หมวดรายจ่าย" value={x.category}
                  onChange={(e) => setExpenses((xs) => xs.map((y, j) => (j === i ? { ...y, category: e.target.value } : y)))}>
                  {EXPENSE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                </select>
                <input className="input" aria-label="รายละเอียด" placeholder="เช่น ซื้อไก่" value={x.description}
                  onChange={(e) => setExpenses((xs) => xs.map((y, j) => (j === i ? { ...y, description: e.target.value } : y)))} />
                <input className="input" aria-label="จำนวนเงิน" inputMode="decimal" placeholder={`${sym} 0`} value={x.amount}
                  onChange={(e) => setExpenses((xs) => xs.map((y, j) => (j === i ? { ...y, amount: e.target.value } : y)))} />
              </div>
            ))}
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setExpenses((xs) => [...xs, blankExpense()])}>+ เพิ่มรายจ่าย</button>
          </div>
        </details>
      </fieldset>

      {err && <div className="alert alert-err"><div>{err}</div></div>}
      {!canEdit && <p className="muted"><a href="/login">เข้าสู่ระบบ</a> เพื่อจดยอด</p>}

      <div className="savebar">
        <div>
          <strong className="tabular">{money(salesTotal, sym)}</strong>
          <small className="muted"> · {items} เมนู</small>
          {counted && (
            <div className={Math.abs(gap) < 0.5 ? "delta-up" : "delta-down"} style={{ fontSize: 13 }}>
              {Math.abs(gap) < 0.5 ? "✓ เงินตรงกับยอดขาย" : gap < 0 ? `เงินขาด ${money(-gap, sym)}` : `เงินเกิน ${money(gap, sym)}`}
            </div>
          )}
        </div>
        <button type="submit" className="btn btn-primary btn-lg" disabled={!canEdit || saving}>{saving ? "กำลังบันทึก…" : "บันทึก"}</button>
      </div>
    </form>
  );
}
