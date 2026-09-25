import type { Metadata } from "next";
import { authRequired } from "@/lib/auth";
import { currentShop } from "@/lib/current";
import { getMenu } from "@/lib/shop";
import { supabaseConfigured } from "@/lib/supabase";
import { SetupNotice } from "@/components/Notice";
import MenuEditor from "@/components/shop/MenuEditor";
import { ClearImportedButton, CreateShop, DeleteShopButton } from "@/components/shop/ShopActions";
import { hasData, loadBounds } from "@/lib/data";
import ShopSwitcher from "@/components/shop/ShopSwitcher";
import SignOutButton from "@/components/SignOutButton";
import LineLink, { type LinkedUser } from "@/components/shop/LineLink";
import { addFriendUrl, lineConfigured } from "@/lib/line";
import { select } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "ตั้งค่า" };

function Row({ href, title, text }: { href: string; title: string; text: string }) {
  return (
    <a className="settings-row" href={href}>
      <span><strong>{title}</strong><small className="muted">{text}</small></span>
      <span aria-hidden="true" className="muted">›</span>
    </a>
  );
}

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function SettingsPage({ searchParams }: { searchParams: SP }) {
  if (!supabaseConfigured()) return <SetupNotice />;
  const sp = await searchParams;
  const { owner, shops, shop } = await currentShop();
  const [menu, bounds] = await Promise.all([shop ? getMenu(shop.id) : [], loadBounds().catch(() => null)]);
  const imported = Boolean(bounds && hasData(bounds));
  // null = table missing (migration 009 not run yet)
  const lineUsers = shop
    ? await select<LinkedUser>("line_links", `shop_id=eq.${shop.id}&select=line_user_id,display_name,linked_at&order=linked_at`).catch(() => null)
    : [];

  return (
    <>
      <div className="page-head compact"><div><h1>ตั้งค่า</h1>{shop && <p className="muted">{shop.name}</p>}</div></div>

      {sp.welcome === "1" && (
        <div className="alert alert-ok"><span aria-hidden="true">🎉</span>
          <div><strong>สร้างร้านแล้ว!</strong> ขั้นต่อไป: ใส่เมนูที่ขาย ราคา และต้นทุนด้านล่าง กด “บันทึกเมนู” แล้วไป <a href="/record">จดยอด</a> ได้เลย</div></div>
      )}

      <div className="stack">
        {shop && (
          <section className="card" id="menu">
            <div className="card-head">
              <div><h2>เมนูและต้นทุน</h2><span className="sub">ใส่ต้นทุนต่อหน่วย ระบบจะคำนวณกำไรโดยประมาณให้ · ถ้ายังไม่รู้เว้นว่างได้</span></div>
            </div>
            <MenuEditor key={menu.map((m) => m.id).join()} shopId={shop.id} menu={menu} canEdit={owner} />
          </section>
        )}

        {shop && owner && (
          <section className="card" id="line">
            <div className="card-head">
              <div><h2>เชื่อม LINE</h2><span className="sub">จดยอดด้วยการพิมพ์ใน LINE · ถาม AI · รับสรุปตอนเช้าเข้า LINE</span></div>
            </div>
            {!lineConfigured() ? (
              <p className="muted" style={{ margin: 0 }}>ยังไม่ได้ตั้งค่า LINE บนเซิร์ฟเวอร์ (LINE_CHANNEL_SECRET, LINE_CHANNEL_ACCESS_TOKEN) ดูวิธีใน docs/line.md</p>
            ) : lineUsers === null ? (
              <p className="muted" style={{ margin: 0 }}>รัน <code>python pipelinemigrate.py 009_line</code> ก่อน แล้วรีเฟรชหน้านี้</p>
            ) : (
              <LineLink shopId={shop.id} users={lineUsers} addFriend={addFriendUrl()} botId={process.env.LINE_BOT_ID ?? null} />
            )}
          </section>
        )}

        <section className="card settings-list">
          <Row href="/automations" title="การแจ้งเตือนอัตโนมัติ" text="สรุปตอนเช้า · เตือนเมื่อยังไม่จดยอด · ส่งเข้า LINE หรือเว็บ" />
        </section>

        <details className="card fold">
          <summary><strong>ส่วนเสริม · ระยะถัดไป</strong></summary>
          <p className="muted">หลายร้านและการนำเข้าไฟล์สำหรับการใช้งานเพิ่มเติม งานหลักคือจดยอดและดูสรุปของร้านนี้</p>
          {shop && <ShopSwitcher shops={shops} current={shop.id} next="/settings" />}
          {owner && <details className="fold-plain"><summary>+ เพิ่มร้านใหม่</summary><div style={{ marginTop: 12 }}><CreateShop /></div></details>}
          <div className="settings-list">
            <Row href="/import" title="นำเข้าไฟล์ยอดขาย" text="CSV หรือ Excel จาก POS / แอปอื่น" />
            {imported && <Row href="/analytics" title="วิเคราะห์ไฟล์ที่นำเข้า" text="กราฟและสรุปข้อมูลที่นำเข้า" />}
            {imported && <Row href="/report" title="รายงานจากไฟล์ที่นำเข้า" text="รายงานประจำวันของชุดข้อมูลเพิ่มเติม" />}
          </div>
        </details>

        <details className="card fold">
          <summary><strong>ขั้นสูง</strong> <span className="muted" style={{ fontSize: 13 }}>สำหรับผู้พัฒนาระบบ</span></summary>
          <div className="settings-list" style={{ marginTop: 8 }}>
            <Row href="/runs" title="ประวัติการทำงานของระบบ" text="AI และงานอัตโนมัติแต่ละครั้ง: ขั้นตอน เวลา สถานะ token" />
            <Row href="/about" title="ระบบนี้ทำงานอย่างไร" text="สถาปัตยกรรม และวิธีป้องกันไม่ให้ AI แต่งตัวเลข" />
          </div>
        </details>

        {owner && (shop || imported) && (
          <details className="card fold">
            <summary><strong>ลบข้อมูล</strong> <span className="muted" style={{ fontSize: 13 }}>กู้คืนไม่ได้</span></summary>
            <div style={{ marginTop: 8 }}>
              {shop && (
                <div className="danger-row">
                  <span><strong>ลบร้าน “{shop.name}”</strong><small className="muted">ลบเมนู ยอดที่จด และการแจ้งเตือนของร้านนี้ทั้งหมด</small></span>
                  <DeleteShopButton shopId={shop.id} name={shop.name} />
                </div>
              )}
              {imported && (
                <div className="danger-row">
                  <span><strong>ลบข้อมูลจากไฟล์ที่นำเข้า</strong><small className="muted">{bounds?.dataset_name ?? "ไฟล์ที่นำเข้า"} · ร้านและยอดที่จดไม่ถูกลบ</small></span>
                  <ClearImportedButton />
                </div>
              )}
            </div>
          </details>
        )}

        <section className="card">
          <h2 style={{ marginTop: 0 }}>บัญชี</h2>
          {!authRequired() ? <p className="muted" style={{ margin: 0 }}>โหมดทดลองบนเครื่องนี้ ไม่ต้องเข้าสู่ระบบ</p>
            : owner ? <SignOutButton />
            : <a className="btn btn-primary" href="/login">เข้าสู่ระบบ</a>}
        </section>
      </div>
    </>
  );
}
