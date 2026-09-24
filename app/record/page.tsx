import type { Metadata } from "next";
import { currentShop } from "@/lib/current";
import { addDays, currencySymbol, dateWithDay, isIsoDate, money } from "@/lib/format";
import { daySummary, getMenu, todayBangkok } from "@/lib/shop";
import { supabaseConfigured } from "@/lib/supabase";
import { SetupNotice } from "@/components/Notice";
import RecordForm from "@/components/shop/RecordForm";
import { VoidEntryButton } from "@/components/shop/ShopActions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "จดยอด" };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function RecordPage({ searchParams }: { searchParams: SP }) {
  if (!supabaseConfigured()) return <SetupNotice />;
  const sp = await searchParams;
  const { owner, shop } = await currentShop();
  if (!shop) return <div className="card notice"><p style={{ margin: 0 }}>ยังไม่มีร้าน <a href="/">สร้างร้านที่หน้าหลัก</a></p></div>;

  const today = todayBangkok();
  const yesterday = addDays(today, -1);
  const date = isIsoDate(sp.date) && sp.date <= today ? sp.date : today;
  const sym = currencySymbol(shop.currency);
  const [menu, day] = await Promise.all([getMenu(shop.id), daySummary(shop.id, date)]);
  const live = day.entries.filter((e) => !e.voided);

  return (
    <>
      <div className="page-head compact">
        <div>
          <h1>จดยอด</h1>
          <p className="muted">{shop.name} · {dateWithDay(date)}</p>
        </div>
        <nav className="seg" aria-label="เลือกวัน">
          <a href="/record" aria-current={date === today ? "true" : undefined}>วันนี้</a>
          <a href={`/record?date=${yesterday}`} aria-current={date === yesterday ? "true" : undefined}>เมื่อวาน</a>
          <form action="/record" method="get" className="date-pick">
            <input type="date" name="date" max={today} defaultValue={date} aria-label="เลือกวันอื่น" />
            <button type="submit" className="btn btn-sm">ไป</button>
          </form>
        </nav>
      </div>

      {live.length > 0 && (
        <details className="card fold" style={{ marginBottom: 12 }}>
          <summary>
            <strong>จดไปแล้ว {live.length} ครั้ง · {money(day.today.revenue, sym)}</strong>
            <span className="muted" style={{ fontSize: 13 }}> · ที่จดใหม่จะรวมกับของเดิม</span>
          </summary>
          <ul className="entries">
            {day.entries.map((e) => (
              <li key={e.id} className={e.voided ? "voided" : ""}>
                <span>
                  {new Date(e.created_at).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Bangkok" })} น.
                  {" · "}{e.source === "line" ? "LINE" : e.source === "demo" ? "ข้อมูลตัวอย่าง" : "เว็บ"}{e.voided ? " · ยกเลิกแล้ว" : ""}
                </span>
                {owner && !e.voided && <VoidEntryButton shopId={shop.id} entryId={e.id} />}
              </li>
            ))}
          </ul>
        </details>
      )}

      <RecordForm key={date} shopId={shop.id} date={date} menu={menu} sym={sym} canEdit={owner} />
    </>
  );
}
