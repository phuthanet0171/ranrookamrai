import type { Metadata } from "next";

export const metadata: Metadata = { title: "วิธีการทำงาน" };

const FLOW = [
  { tag: "Web / LINE", title: "จดยอดร้าน", text: "เมนู ราคา ต้นทุน ยอดรายวัน รายจ่าย เงินสดและเงินโอน; LINE ต้องกดยืนยันก่อนบันทึก" },
  { tag: "Supabase", title: "เก็บข้อมูล", text: "เก็บต้นทุน ณ วันที่ขายและประวัติการยกเลิก" },
  { tag: "SQL", title: "คำนวณตัวเลข", text: "ยอดขาย กำไรโดยประมาณ เงินขาด/เกิน และข้อมูลย้อนหลัง 7 วัน" },
  { tag: "Gemini", title: "ถาม AI", text: "เรียกเครื่องมือ SQL ที่กำหนดไว้ แล้วอธิบายด้วย placeholder จากข้อเท็จจริง" },
  { tag: "TypeScript", title: "ตรวจคำตอบ", text: "ตรวจ placeholder ก่อนเติมตัวเลข หากไม่ผ่านใช้ข้อมูลจากระบบแทน" },
  { tag: "Scheduler / LINE", title: "แจ้งเตือน", text: "สรุปตอนเช้าและเตือนเมื่อยังไม่จดยอด ผ่าน LINE หรือเว็บ" },
];

export default function AboutPage() {
  return (
    <>
      <div className="page-head">
        <div>
          <span className="eyebrow">Data Analytics + AI Automation</span>
          <h1>ระบบนี้ทำงานอย่างไร</h1>
          <p>จดยอด → คำนวณกำไรโดยประมาณ → ดูสรุป 7 วัน → ถาม AI และรับแจ้งเตือน</p>
        </div>
      </div>

      <div className="flow">
        {FLOW.map((f, i) => (
          <div className="flow-step" key={f.title}>
            <span className="tag">{i + 1}. {f.tag}</span>
            <h3>{f.title}</h3>
            <p>{f.text}</p>
          </div>
        ))}
      </div>

      <div className="grid two">
        <section className="card prose">
          <h2>ทำไม AI แต่งตัวเลขหรือกลับทิศทางไม่ได้</h2>
          <ol className="steps">
            <li><h3>SQL คำนวณทุกอย่าง</h3><p>ตัวเลข การเทียบช่วงเวลา และสัดส่วนของการเปลี่ยนแปลง มาจากฟังก์ชันในฐานข้อมูลทั้งหมด</p></li>
            <li><h3>AI ได้รับข้อเท็จจริงเป็น “ช่องว่างที่มีชื่อ”</h3><p>เช่น <code>{"{revenue.now}"}</code> = ฿ 110,000 และ <code>{"{revenue.dir}"}</code> = เพิ่มขึ้น AI เขียนประโยคด้วยช่องเหล่านี้เท่านั้น ห้ามพิมพ์ตัวเลขหรือคำว่าเพิ่ม/ลดเอง และห้ามเดาสาเหตุ</p></li>
            <li><h3>ตรวจก่อนเติมค่า</h3><p>ถ้าข้อความของ AI มีตัวเลข คำบอกทิศทาง หรือช่องที่ไม่มีอยู่จริง ระบบให้เขียนใหม่ 1 ครั้ง ถ้ายังผิดจะใช้สรุปจากระบบแทน ผ่านแล้วระบบจึงเติมค่าจริงลงไป</p></li>
            <li><h3>เก็บผลไว้ใช้ซ้ำ</h3><p>สรุปที่ผ่านการตรวจแล้วถูกเก็บไว้ในตาราง <code>ai_insights</code> เพื่อไม่ให้เปลืองโควตาฟรี</p></li>
          </ol>
        </section>

        <section className="card prose">
          <h2>ส่วนเสริม · ระยะถัดไป</h2><p>การวิเคราะห์ไฟล์นำเข้า หลายร้าน Power BI และช่องทางเพิ่มเติมไม่ใช่ core MVP</p>
          <ul>
            <li>ยอดขายช่วงนี้ดีขึ้นหรือแย่ลง (รายได้ คำสั่งซื้อ ยอดเฉลี่ย ลูกค้า การส่งของตรงเวลา)</li>
            <li>ถ้ายอดเปลี่ยน เปลี่ยนเพราะหมวดสินค้า สาขา/พื้นที่ หรือช่วงเวลาไหน และคิดเป็นกี่ %</li>
            <li>สินค้าไหนขายดี สินค้าไหนขายน้อย และโตขึ้นหรือลดลง</li>
            <li>ลูกค้าซื้อช่วงเวลาไหนและวันไหนมากที่สุด</li>
            <li>เมื่อวานยอดขายผิดปกติหรือไม่ (ต่างจากค่าเฉลี่ย 7 วันเกิน 25%)</li>
          </ul>
          <h2 style={{ marginTop: 16 }}>เครื่องมือที่ใช้</h2>
          <div className="chips">
            {["Python", "pandas", "SQL", "PostgreSQL", "Supabase", "Next.js", "TypeScript", "Gemini API", "n8n",
              "Gmail", "Discord", "Telegram", "Google Sheets", "Excel", "Power BI"].map((t) => <span className="chip" key={t}>{t}</span>)}
          </div>
        </section>
      </div>

      <section className="card section-gap prose">
        <h2>ข้อจำกัดที่ควรรู้</h2>
        <ul style={{ marginBottom: 0 }}>
          <li><strong>ตัวเลข หน่วย และคำว่าเพิ่ม/ลด</strong> มาจากระบบทั้งหมด แต่ AI ยังเลือกได้ว่าจะพูดถึงเรื่องไหน และระบบตรวจ <strong>เหตุผล</strong> ไม่ได้ จึงให้ AI บอกเฉพาะว่า “ส่วนไหนเปลี่ยน” ส่วน “ทำไม” เป็นข้อเสนอว่าควรไปตรวจอะไรต่อ คำแนะนำควรให้คนตรวจก่อนตัดสินใจ</li>
          <li>ข้อมูล Olist จบในปี 2018 จึงจำลอง “วันนี้” ด้วยการเลื่อนวันที่ไปวันละ 1 วันทุกครั้งที่ n8n ทำงาน</li>
          <li>ข้อมูลที่นำเข้าเองจะใช้วันล่าสุดในไฟล์เป็น “วันนี้”</li>
        </ul>
      </section>
    </>
  );
}
