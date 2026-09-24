import type { Shop } from "@/lib/shop";

/** Small shop picker; only shown when there is more than one shop. */
export default function ShopSwitcher({ shops, current, next }: { shops: Shop[]; current: string; next: string }) {
  if (shops.length < 2) return null;
  return (
    <form action="/api/shops/select" method="get" className="shop-switch">
      <input type="hidden" name="next" value={next} />
      <label className="sr-only" htmlFor="shop-switch">เลือกร้าน</label>
      <select id="shop-switch" name="id" className="input" defaultValue={current}>
        {shops.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      <button type="submit" className="btn btn-sm">เปลี่ยน</button>
    </form>
  );
}
