// หน้าหลัก: the first screen a shop owner sees - like a POS dashboard app, today first.
import { currentShop } from "@/lib/current";
import { addDays, count, currencySymbol, dateShort, dateWithDay, money } from "@/lib/format";
import { daySummary, forecast, periodSummary, todayBangkok } from "@/lib/shop";
import { select, supabaseConfigured } from "@/lib/supabase";
import { DeltaPill } from "@/components/Blocks";
import { SetupNotice } from "@/components/Notice";
import { CreateShop, MarkReadButton } from "@/components/shop/ShopActions";
import ShopSwitcher from "@/components/shop/ShopSwitcher";

export const dynamic = "force-dynamic";

type SP = Promise<Record<string, string | string[] | undefined>>;
type Note = { id: string; title: string; body: string; created_at: string; read_at: string | null };

const growth = (now: number, before: number) => (before > 0 ? Math.round(((now - before) / before) * 1000) / 10 : null);

export default async function Home({ searchParams }: { searchParams: SP }) {
  if (!supabaseConfigured()) return <SetupNotice />;
  const sp = await searchParams;
  const { owner, shops, shop, ready } = await currentShop(sp.shop);

  if (!ready) {
    return <div className="card notice"><h1>ต้องตั้งค่าฐานข้อมูลก่อน</h1><p>รัน <code>python pipeline\migrate.py</code> แล้วรีเฟรชหน้านี้</p></div>;
  }
  if (!shop) {
    return (
      <>
        <div className="hero">
          <h1>จดยอดวันละครั้ง<br />รู้กำไร รู้เงินขาด รู้ว่าพรุ่งนี้ควรเตรียมเท่าไหร่</h1>
          <p>สำหรับร้านอาหาร ร้านเครื่องดื่ม และแผงลอยที่ไม่มีเครื่อง POS ใช้บนมือถือได้</p>
        </div>
        {owner ? (
          <section className="card onboard">
            <h2 style={{ marginTop: 0 }}>เริ่มใช้ใน 3 ขั้น</h2>
            <ol>
              <li>ตั้งชื่อร้าน</li>
              <li>ใส่เมนู ราคา และต้นทุน (ถ้ารู้)</li>
              <li>ตอนปิดร้าน กด “จดยอด” แล้วกด + ตามจำนวนที่ขายได้</li>
            </ol>
            <CreateShop />
          </section>
        ) : (
          <div className="card notice"><p style={{ margin: 0 }}><a href="/login">เข้าสู่ระบบ</a> เพื่อเริ่มใช้งาน</p></div>
        )}
      </>
    );
  }

  const sym = currencySymbol(shop.currency);
  const today = todayBangkok();
  const [day, yesterday, week, notes] = await Promise.all([
    daySummary(shop.id, today),
    daySummary(shop.id, addDays(today, -1)),
    periodSummary(shop.id, addDays(today, -6), today),
    owner
      ? select<Note>("notifications", `shop_id=eq.${shop.id}&read_at=is.null&select=id,title,body,created_at,read_at&order=created_at.desc&limit=3`).catch(() => [] as Note[])
      : Promise.resolve([] as Note[]),
  ]);
  const recorded = day.entries.some((e) => !e.voided);
  // before today's entry the useful question is "what to prepare today"; after it, "tomorrow"
  const prepDate = recorded ? addDays(today, 1) : today;
  const fc = await forecast(shop.id, prepDate);
  const t = day.today;
  const y = yesterday.today;
  const maxDay = Math.max(1, ...week.daily.map((d) => d.revenue));

  return (
    <>
      {sp.saved === "1" && <div className="toast" role="status">✓ บันทึกแล้ว</div>}

      <div className="home-head">
        <div>
          <h1>{shop.name}</h1>
          <p className="muted">{dateWithDay(today)}</p>
        </div>
        <ShopSwitcher shops={shops} current={shop.id} next="/" />
      </div>

      {notes.length > 0 && (
        <section className="card notif-card">
          <div className="card-head" style={{ marginBottom: 8 }}>
            <h2>🔔 แจ้งเตือนใหม่ {notes.length}</h2>
            <MarkReadButton shopId={shop.id} />
          </div>
          <ul className="notif">
            {notes.map((n) => <li key={n.id} className="unread"><strong>{n.title}</strong><div>{n.body}</div></li>)}
          </ul>
        </section>
      )}

      {recorded ? (
        <section className="card today-card">
          <div className="card-head" style={{ marginBottom: 6 }}>
            <h2>วันนี้</h2>
            <a className="btn btn-sm" href="/record">+ จดเพิ่ม / แก้ไข</a>
          </div>
          <div className="big-number tabular">{money(t.revenue, sym)}</div>
          <div className="kpi-foot"><DeltaPill value={growth(t.revenue, day.same_day_last_week.revenue)} /> <span>เทียบกับวันเดียวกันสัปดาห์ก่อน</span></div>
          <div className="mini-stats">
            <div><span>กำไรโดยประมาณ</span><strong>{t.gross_profit === null ? "–" : money(t.gross_profit, sym)}</strong></div>
            <div><span>เงินที่รับ</span><strong>{t.money_in === null ? "ยังไม่นับ" : money(t.money_in, sym)}</strong></div>
            <div className={t.money_gap !== null && t.money_gap <= -1 ? "bad" : ""}>
              <span>เงินขาด/เกิน</span>
              <strong>{t.money_gap === null ? "–" : Math.abs(t.money_gap) < 1 ? "✓ ตรง" : t.money_gap < 0 ? `ขาด ${money(-t.money_gap, sym)}` : `เกิน ${money(t.money_gap, sym)}`}</strong>
            </div>
          </div>
        </section>
      ) : (
        <section className="card cta-card">
          <div>
            <h2>วันนี้ยังไม่ได้จดยอด</h2>
            <p className="muted">ตอนปิดร้าน กรอกว่าขายอะไรไปเท่าไหร่ ใช้เวลาไม่ถึงนาที</p>
          </div>
          {owner && <a className="btn btn-primary btn-lg" href="/record">+ จดยอดวันนี้</a>}
          {y.revenue > 0 && (
            <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>
              เมื่อวานขายได้ <strong>{money(y.revenue, sym)}</strong>
              {y.gross_profit !== null ? <> · กำไรโดยประมาณ <strong>{money(y.gross_profit, sym)}</strong></> : null}
              {y.money_gap !== null && y.money_gap <= -1 ? <> · <span className="error">เงินขาด {money(-y.money_gap, sym)}</span></> : null}
            </p>
          )}
        </section>
      )}

      <div className="grid two home-grid">
        <section className="card">
          <div className="card-head"><h2>{recorded ? "พรุ่งนี้ควรเตรียม" : "วันนี้ควรเตรียม"}</h2></div>
          {fc.items.length === 0 ? (
            <p className="muted" style={{ margin: 0 }}>จดยอดให้ครบ 2 สัปดาห์ก่อน ระบบจะบอกได้ว่าควรเตรียมแต่ละเมนูประมาณเท่าไหร่</p>
          ) : (
            <ul className="prep">
              {fc.items.slice(0, 6).map((f) => (
                <li key={f.menu_item_id}>
                  <span>{f.name}</span>
                  <strong>~{count(f.expected)} {f.unit}</strong>
                  <small className="muted">ปกติ {count(f.low)}–{count(f.high)}</small>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <h2>7 วันล่าสุด</h2>
            <a href="/reports" className="btn btn-sm btn-ghost">ดูรายงาน →</a>
          </div>
          <div className="week-bars" role="img" aria-label="ยอดขาย 7 วันล่าสุด">
            {week.daily.map((d) => (
              <div key={d.date} className={d.date === today ? "today" : ""}>
                <span className="bar" style={{ height: `${Math.max(3, (d.revenue / maxDay) * 100)}%` }} title={`${dateShort(d.date)}: ${money(d.revenue, sym)}`} />
                <small>{dateShort(d.date).split(" ")[0]}</small>
              </div>
            ))}
          </div>
          <p className="muted" style={{ margin: "8px 0 0", fontSize: 13.5 }}>
            รวม {money(week.current.revenue, sym)}{week.current.gross_profit !== null ? ` · กำไรโดยประมาณ ${money(week.current.gross_profit, sym)}` : ""}
          </p>
        </section>
      </div>

      <form action="/assistant" method="get" className="card ask-card">
        <label htmlFor="q"><strong>ถามอะไรก็ได้เกี่ยวกับร้าน</strong></label>
        <div className="ask-row">
          <input id="q" name="q" className="input" placeholder="เช่น เดือนนี้เมนูไหนได้กำไรมากที่สุด" maxLength={400} />
          <button type="submit" className="btn btn-primary">ถาม</button>
        </div>
      </form>
    </>
  );
}
