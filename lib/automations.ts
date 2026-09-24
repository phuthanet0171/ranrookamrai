// Automation rules for shops (007_automations.sql): what each kind checks, the message it
// sends, and where it sends it. Messages are built by code from SQL results - no AI here,
// so a scheduled alert can never contain an invented number.
import { addDays, count, dateWithDay, money } from "./format";
import { WEEKDAY_TH } from "./labels";
import { daySummary, forecast, periodSummary, type DaySummary, type Forecast, type PeriodSummary, type Shop } from "./shop";
import { insert, rpc, update } from "./supabase";
import { startRun } from "./runs";

export type RuleKind = "missing_entry" | "morning_summary" | "money_gap" | "weekly_summary";
export type Rule = {
  id: string; shop_id: string; kind: RuleKind; enabled: boolean; run_at: string; days: number[];
  channel: "web" | "discord"; target: string | null; threshold: number | null;
  last_fired_on: string | null; last_status: string | null; last_message: string | null;
};
export type Message = { title: string; body: string };

export const RULE_KINDS: Record<RuleKind, { label: string; description: string; run_at: string; days: number[]; threshold?: number }> = {
  missing_entry: { label: "เตือนเมื่อยังไม่จดยอด", description: "ถึงเวลาแล้วยังไม่มีการจดยอดของวันนี้ ส่งข้อความเตือน", run_at: "21:00", days: [1, 2, 3, 4, 5, 6] },
  morning_summary: { label: "สรุปตอนเช้า", description: "ยอดขาย กำไร เงินขาดของเมื่อวาน และวันนี้ควรเตรียมอะไร", run_at: "08:00", days: [1, 2, 3, 4, 5, 6] },
  money_gap: { label: "แจ้งเตือนเงินขาด", description: "เงินที่นับได้น้อยกว่ายอดขายตามเมนูเกินที่กำหนด", run_at: "22:00", days: [1, 2, 3, 4, 5, 6, 7], threshold: 100 },
  weekly_summary: { label: "สรุปรายสัปดาห์", description: "ทุกวันจันทร์: 7 วันที่ผ่านมาเทียบกับสัปดาห์ก่อน เมนูเด่น วันขายดี", run_at: "08:30", days: [1] },
};

/** "Now" in Thailand, whatever time zone the server runs in. */
export function localNow(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now).map((p) => [p.type, p.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return { date, time: `${parts.hour}:${parts.minute}` };
}

const pctChange = (now: number, before: number) =>
  before > 0 ? `${now >= before ? "▲" : "▼"} ${Math.abs(((now - before) / before) * 100).toFixed(1)}%` : null;

// ---------------------------------------------------------------- message builders (pure)

export function missingEntryMessage(shop: Shop, day: DaySummary, appUrl?: string): Message | null {
  if (day.entries.some((e) => !e.voided)) return null;                // already recorded today
  return {
    title: `⏰ ยังไม่ได้จดยอดวันนี้ · ${shop.name}`,
    body: [`${dateWithDay(day.date)} ยังไม่มีการจดยอดขาย`, "จดตอนนี้ใช้เวลาไม่ถึงนาที กำไรและพรุ่งนี้ควรเตรียมอะไรจะคำนวณให้ทันที",
      appUrl ? `${appUrl}/shop?shop=${shop.id}` : ""].filter(Boolean).join("\n"),
  };
}

export function morningMessage(shop: Shop, sym: string, y: DaySummary, fc: Forecast, appUrl?: string): Message {
  const t = y.today;
  const lines: string[] = [];
  if (t.revenue === 0) {
    lines.push(`${dateWithDay(y.date)} ไม่มีการจดยอด`);
  } else {
    const vs = pctChange(t.revenue, y.same_day_last_week.revenue);
    lines.push(`ยอดขาย ${money(t.revenue, sym)}${vs ? ` (${vs} เทียบกับสัปดาห์ก่อน)` : ""}`);
    if (t.gross_profit !== null) lines.push(`กำไรโดยประมาณ ${money(t.gross_profit, sym)}${t.menus_without_cost ? " (บางเมนูยังไม่มีต้นทุน)" : ""}`);
    if (t.money_gap !== null && t.money_gap <= -1) lines.push(`⚠️ เงินขาด ${money(-t.money_gap, sym)}`);
    lines.push(`รายจ่าย ${money(t.expenses, sym)} · เงินสุทธิ ${money(t.net_cash, sym)}`);
    const top = y.menus.filter((m) => m.quantity > 0).slice(0, 3);
    if (top.length) lines.push(`ขายดี: ${top.map((m) => `${m.name} ${count(m.quantity)} ${m.unit}`).join(", ")}`);
  }
  if (fc.items.length) {
    lines.push("", `วันนี้ควรเตรียม (จาก ${fc.samples} สัปดาห์ล่าสุด):`);
    for (const f of fc.items.slice(0, 5)) lines.push(`• ${f.name} ~${count(f.expected)} ${f.unit} (ปกติ ${count(f.low)}–${count(f.high)})`);
  }
  if (appUrl) lines.push("", `${appUrl}/shop?shop=${shop.id}`);
  return { title: `☀️ สรุปเมื่อวาน · ${shop.name}`, body: lines.join("\n") };
}

export function moneyGapMessage(shop: Shop, sym: string, day: DaySummary, threshold: number): Message | null {
  const gap = day.today.money_gap;
  if (gap === null || -gap < threshold) return null;
  return {
    title: `⚠️ เงินขาด ${money(-gap, sym)} · ${shop.name}`,
    body: [`${dateWithDay(day.date)}`,
      `เงินที่นับได้ ${money(day.today.money_in ?? 0, sym)} (เงินสด ${money(day.today.cash ?? 0, sym)} · โอน ${money(day.today.transfer ?? 0, sym)})`,
      `ยอดขายตามเมนู ${money(day.today.revenue, sym)}`,
      "ลองเช็กว่าจดจำนวนครบไหม มีเงินทอนผิด หรือมีรายการที่ลืมจด"].join("\n"),
  };
}

export function weeklyMessage(shop: Shop, sym: string, p: PeriodSummary): Message {
  const c = p.current, prev = p.previous;
  const vs = pctChange(c.revenue, prev.revenue);
  const bestDay = [...p.weekday].sort((a, b) => b.avg_revenue - a.avg_revenue)[0];
  const byProfit = p.menus.filter((m) => m.gross_profit !== null && m.quantity > 0).sort((a, b) => (b.gross_profit ?? 0) - (a.gross_profit ?? 0));
  const lines = [
    `ยอดขาย ${money(c.revenue, sym)}${vs ? ` (${vs} เทียบกับสัปดาห์ก่อน)` : ""}`,
    ...(c.gross_profit !== null ? [`กำไรโดยประมาณ ${money(c.gross_profit, sym)}`] : []),
    `รายจ่ายที่จด ${money(c.expenses, sym)} · เปิดร้าน ${count(c.days_recorded)} วัน`,
    ...(byProfit[0] ? [`เมนูทำกำไรสูงสุด: ${byProfit[0].name} (${money(byProfit[0].gross_profit!, sym)})`] : []),
    ...(bestDay ? [`วันที่ขายดีที่สุด: วัน${WEEKDAY_TH[bestDay.dow]}`] : []),
    ...(c.money_gap !== null && c.money_gap <= -1 ? [`⚠️ เงินขาดรวมทั้งสัปดาห์ ${money(-c.money_gap, sym)}`] : []),
  ];
  return { title: `📊 สรุปสัปดาห์ · ${shop.name}`, body: lines.join("\n") };
}

// ---------------------------------------------------------------- running a rule

async function buildMessage(rule: Rule, shop: Shop, sym: string, today: string): Promise<{ message: Message | null; reason: string }> {
  const appUrl = process.env.APP_URL;
  switch (rule.kind) {
    case "missing_entry": {
      const m = missingEntryMessage(shop, await daySummary(shop.id, today), appUrl);
      return { message: m, reason: m ? "ยังไม่มีการจดยอดวันนี้" : "จดยอดแล้ว ไม่ต้องเตือน" };
    }
    case "morning_summary": {
      const [y, fc] = await Promise.all([daySummary(shop.id, addDays(today, -1)), forecast(shop.id, today)]);
      return { message: morningMessage(shop, sym, y, fc, appUrl), reason: "ส่งสรุปตอนเช้า" };
    }
    case "money_gap": {
      const m = moneyGapMessage(shop, sym, await daySummary(shop.id, today), rule.threshold ?? 100);
      return { message: m, reason: m ? "เงินขาดเกินเกณฑ์" : "เงินไม่ขาดเกินเกณฑ์ (หรือยังไม่ได้นับเงิน)" };
    }
    case "weekly_summary": {
      const p = await periodSummary(shop.id, addDays(today, -7), addDays(today, -1));
      return { message: weeklyMessage(shop, sym, p), reason: "ส่งสรุปรายสัปดาห์" };
    }
  }
}

async function deliver(rule: Rule, msg: Message): Promise<string> {
  if (rule.channel === "discord") {
    if (!rule.target?.startsWith("https://discord.com/api/webhooks/")) throw new Error("Discord webhook URL ไม่ถูกต้อง");
    const res = await fetch(rule.target, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: `**${msg.title}**\n${msg.body}`.slice(0, 1900) }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Discord ตอบกลับ ${res.status}`);
    return "ส่งเข้า Discord แล้ว";
  }
  await insert("notifications", [{ shop_id: rule.shop_id, rule_id: rule.id, kind: rule.kind, title: msg.title, body: msg.body }]);
  return "บันทึกเป็นการแจ้งเตือนในหน้าร้านแล้ว";
}

export type RuleResult = { rule_id: string; kind: RuleKind; status: "sent" | "skipped" | "failed" | "preview"; detail: string; message?: Message };

/**
 * Run one rule. `trigger` = schedule (claims today's slot first, so a second caller skips)
 * or manual (the owner pressed "run now" - does not use up today's scheduled run).
 */
export async function executeRule(rule: Rule, shop: Shop, sym: string,
  opts: { trigger: "schedule" | "manual"; dryRun?: boolean; now?: Date }): Promise<RuleResult> {
  const { date } = localNow(opts.now);
  const run = startRun("automation", opts.trigger, { title: `${RULE_KINDS[rule.kind].label} · ${shop.name}`, shopId: shop.id });
  const done = async (r: RuleResult) => {
    await run.finish(r.status === "failed" ? "failed" : "success", { output: { status: r.status, detail: r.detail, title: r.message?.title } });
    if (!opts.dryRun) {
      await update("automation_rules", `id=eq.${rule.id}`, {
        last_status: r.status, last_message: r.message ? `${r.message.title}\n${r.message.body}`.slice(0, 1000) : r.detail,
      }).catch(() => undefined);                   // the rule ran; failing to store its status is not worth an error
    }
    return r;
  };
  try {
    if (opts.trigger === "schedule") {
      const mine = await run.step("claim", () => rpc<boolean>("automation_claim", { p_rule: rule.id, p_date: date }), (x) => (x ? "ได้สิทธิ์รันของวันนี้" : "มีผู้รันไปแล้ว"));
      if (!mine) return { rule_id: rule.id, kind: rule.kind, status: "skipped", detail: "วันนี้รันไปแล้ว" };
    }
    const { message, reason } = await run.step("check", () => buildMessage(rule, shop, sym, date), (x) => x.reason);
    if (!message) return await done({ rule_id: rule.id, kind: rule.kind, status: "skipped", detail: reason });
    if (opts.dryRun) return await done({ rule_id: rule.id, kind: rule.kind, status: "preview", detail: "ตัวอย่าง (ไม่ได้ส่งจริง)", message });
    const sent = await run.step(`send ${rule.channel}`, () => deliver(rule, message), (x) => x);
    return await done({ rule_id: rule.id, kind: rule.kind, status: "sent", detail: sent, message });
  } catch (e) {
    return await done({ rule_id: rule.id, kind: rule.kind, status: "failed", detail: (e as Error).message });
  }
}

