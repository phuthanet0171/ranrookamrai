export function SetupNotice() {
  return (
    <div className="card notice">
      <h1>เชื่อมต่อ Supabase ก่อนเริ่มใช้งาน</h1>
      <p>เว็บนี้ต้องใช้ค่า 2 ค่า ให้คัดลอก <code>web/.env.example</code> เป็น <code>web/.env.local</code> แล้วใส่ค่าเหล่านี้:</p>
      <pre>{`SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=...`}</pre>
      <p>จากนั้นหยุดแล้วรัน <code>npm run dev</code> ใหม่ ขั้นตอนทั้งหมดอยู่ใน README ของโปรเจกต์</p>
    </div>
  );
}

export function ErrorNotice({ message }: { message: string }) {
  return (
    <div className="card notice">
      <h1>โหลดข้อมูลไม่สำเร็จ</h1>
      <p className="error" style={{ wordBreak: "break-word" }}>{message}</p>
      <p>สาเหตุที่พบบ่อย:</p>
      <ul>
        <li>ยังไม่ได้รันไฟล์ SQL ใน <code>supabase/migrations</code> (รัน <code>python pipeline/migrate.py</code>)</li>
        <li>ยังไม่ได้โหลดข้อมูล (รัน <code>python pipeline/load.py --clean data/clean</code>)</li>
        <li>ใส่ key ผิดตัวใน <code>SUPABASE_SERVICE_ROLE_KEY</code> (ต้องเป็น service_role หรือ secret key ไม่ใช่ anon key)</li>
      </ul>
    </div>
  );
}

export function EmptyNotice() {
  return (
    <div className="card notice">
      <h1>ยังไม่มีข้อมูลในฐานข้อมูล</h1>
      <p>เลือกได้ 2 วิธี:</p>
      <ol>
        <li><a href="/import">นำเข้าไฟล์ยอดขาย (CSV หรือ Excel)</a> ผ่านหน้าเว็บ</li>
        <li>หรือรัน pipeline เพื่อ clean และโหลดข้อมูล Olist:
          <pre>{`python pipeline/clean.py --raw data/raw --out data/clean
python pipeline/load.py --clean data/clean`}</pre>
        </li>
      </ol>
    </div>
  );
}
