import type { Metadata } from "next";
import ImportClient from "@/components/ImportClient";

export const metadata: Metadata = { title: "นำเข้าข้อมูล" };

export default function ImportPage() {
  return (
    <>
      <div className="page-head compact">
        <div>
          <h1>นำเข้าไฟล์ยอดขาย</h1>
          <p>มีไฟล์ CSV หรือ Excel จาก POS หรือแอปอื่นอยู่แล้ว? อัปโหลดแล้วดูกราฟและสรุปด้วย AI ได้ทันที · <a href="/settings">← ตั้งค่า</a></p>
        </div>
      </div>
      <ImportClient />
      <section className="card section-gap prose">
        <h2>อยากกลับไปใช้ข้อมูล Olist?</h2>
        <p style={{ margin: 0 }}>
          รัน <code>python pipeline/load.py --clean data/clean</code> อีกครั้ง ระบบจะล้างข้อมูลที่นำเข้าและโหลดข้อมูล Olist กลับมา
          พร้อมตั้งสกุลเงินกลับเป็นเรอัลบราซิล
        </p>
      </section>
    </>
  );
}
