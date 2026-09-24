import type { Metadata } from "next";
import LoginForm from "@/components/LoginForm";
import { authRequired, isOwner } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "เข้าสู่ระบบ" };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function LoginPage({ searchParams }: { searchParams: SP }) {
  const owner = await isOwner();
  const sp = await searchParams;
  const next = typeof sp.next === "string" ? sp.next : "/";
  return (
    <div className="card notice" style={{ maxWidth: 420, marginTop: 24 }}>
      <h1>เข้าสู่ระบบ</h1>
      <p className="muted" style={{ marginTop: 0 }}>ข้อมูลร้านเป็นข้อมูลส่วนตัว ใส่รหัสผ่านของเจ้าของร้านเพื่อเข้าใช้งาน</p>
      {!authRequired() ? (
        <p>เครื่องนี้รันแบบทดลอง (<code>npm run dev</code>) และยังไม่ได้ตั้ง <code>ADMIN_PASSWORD</code> จึงเข้าได้โดยไม่ต้องใส่รหัส</p>
      ) : owner ? (
        <p>เข้าสู่ระบบอยู่แล้ว <a href="/">ไปหน้าหลัก →</a></p>
      ) : !process.env.ADMIN_PASSWORD ? (
        <p className="error">ยังไม่ได้ตั้งค่า <code>ADMIN_PASSWORD</code> บนเซิร์ฟเวอร์ จึงยังเข้าใช้งานไม่ได้</p>
      ) : (
        <LoginForm next={next} />
      )}
    </div>
  );
}
