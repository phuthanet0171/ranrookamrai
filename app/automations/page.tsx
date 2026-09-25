// Automations: "when ... do ..." rules per shop, run by /api/cron every few minutes.
import type { Metadata } from "next";
import { isOwner } from "@/lib/auth";
import { RULE_KINDS, type Rule, type RuleKind } from "@/lib/automations";
import { currentShop } from "@/lib/current";
import { select, supabaseConfigured } from "@/lib/supabase";
import { SetupNotice } from "@/components/Notice";
import RuleCard from "@/components/RuleCard";
import AddRule from "@/components/AddRule";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "การแจ้งเตือนอัตโนมัติ" };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function AutomationsPage({ searchParams }: { searchParams: SP }) {
  if (!supabaseConfigured()) return <SetupNotice />;
  const owner = await isOwner();
  if (!owner) {
    return <div className="card notice"><h1>การแจ้งเตือนอัตโนมัติ</h1><p>หน้านี้สำหรับเจ้าของร้าน <a href="/login">เข้าสู่ระบบ</a></p></div>;
  }
  const sp = await searchParams;
  const { shops, shop } = await currentShop(sp.shop);
  if (!shop) {
    return <div className="card notice"><h1>การแจ้งเตือนอัตโนมัติ</h1><p>สร้างร้านที่ <a href="/">หน้าหลัก</a> ก่อน</p></div>;
  }

  let rules: Rule[];
  try {
    rules = await select<Rule>("automation_rules", `shop_id=eq.${shop.id}&select=*&order=run_at`);
  } catch {
    return (
      <div className="card notice">
        <h1>ยังไม่ได้รัน migration 007</h1>
        <p>รัน <code>python pipeline\migrate.py 007_automations</code> แล้วรีเฟรชหน้านี้</p>
      </div>
    );
  }
  const cronReady = Boolean(process.env.CRON_SECRET);

  return (
    <>
      <div className="page-head compact">
        <div>
          <h1>การแจ้งเตือนอัตโนมัติ</h1>
          <p>ให้ระบบเตือนและสรุปยอดให้ตามเวลาที่ตั้งไว้ · <a href="/settings">← ตั้งค่า</a></p>
        </div>
        {shops.length > 1 && (
          <nav className="seg" aria-label="เลือกร้าน">
            {shops.map((s) => <a key={s.id} href={`/api/shops/select?id=${s.id}&next=/automations`} aria-current={s.id === shop.id ? "true" : undefined}>{s.name}</a>)}
          </nav>
        )}
      </div>

      {!cronReady && (
        <div className="alert alert-warn">
          <span aria-hidden="true">⏱️</span>
          <div>
            <strong>ยังไม่มีตัวเรียกตามเวลา</strong>
            <p>กฎจะทำงานเองเมื่อมีระบบเรียก <code>/api/cron</code> ทุก 5–15 นาที ตั้งค่า <code>CRON_SECRET</code> แล้วใช้ GitHub Actions หรือ n8n
              (ดู <code>docs/automations.md</code>) ระหว่างนี้กด “รันตอนนี้” เพื่อทดลองได้</p>
          </div>
        </div>
      )}
      {cronReady && (
        <div className="alert alert-warn">
          <span aria-hidden="true">⏱️</span>
          <div><strong>ตั้งค่าคีย์เรียกตามเวลาแล้ว</strong>
            <p>กฎจะทำงานเองเมื่อ GitHub Actions, n8n หรือ Cron เรียกเว็บจริง ตรวจรอบล่าสุดที่ “ขั้นสูง → ประวัติการทำงาน” และลอง “ดูตัวอย่างข้อความ” ก่อนเปิดใช้งาน</p>
          </div>
        </div>
      )}

      <div className="stack">
        {rules.length === 0 && <p className="muted">ยังไม่มีกฎ เลือกจากแม่แบบด้านล่าง</p>}
        {rules.map((r) => <RuleCard key={`${r.id}:${r.enabled}:${r.last_fired_on}`} rule={r} meta={RULE_KINDS[r.kind]} canEdit={owner} />)}

        <section className="card">
          <div className="card-head"><div><h2>เพิ่มกฎจากแม่แบบ</h2><span className="sub">เพิ่มแล้วปรับเวลา วัน และช่องทางได้</span></div></div>
          <AddRule shopId={shop.id} kinds={(Object.keys(RULE_KINDS) as RuleKind[]).map((k) => ({
            kind: k, label: RULE_KINDS[k].label, description: RULE_KINDS[k].description, exists: rules.some((r) => r.kind === k),
          }))} />
        </section>
      </div>
    </>
  );
}
