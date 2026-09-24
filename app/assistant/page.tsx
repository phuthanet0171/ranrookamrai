import type { Metadata } from "next";
import { currentShop } from "@/lib/current";
import { hasData, loadBounds } from "@/lib/data";
import { supabaseConfigured } from "@/lib/supabase";
import AssistantClient from "@/components/AssistantClient";
import { SetupNotice } from "@/components/Notice";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "ถาม AI" };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function AssistantPage({ searchParams }: { searchParams: SP }) {
  if (!supabaseConfigured()) return <SetupNotice />;
  const sp = await searchParams;
  const { shops, shop } = await currentShop();
  // the current shop first, then other shops, then the imported-file analysis
  const scopes: { id: string; label: string; kind: "dataset" | "shop" }[] = [];
  if (shop) scopes.push({ id: shop.id, label: shop.name, kind: "shop" });
  for (const s of shops) if (s.id !== shop?.id) scopes.push({ id: s.id, label: s.name, kind: "shop" });
  const bounds = await loadBounds().catch(() => null);
  if (bounds && hasData(bounds)) scopes.push({ id: "dataset", label: `ไฟล์ที่นำเข้า: ${bounds.dataset_name ?? "ข้อมูลวิเคราะห์"}`, kind: "dataset" });
  const q = typeof sp.q === "string" ? sp.q.slice(0, 400) : "";

  return (
    <>
      <div className="page-head compact">
        <div>
          <h1>ถาม AI</h1>
          <p className="muted">ถามเป็นภาษาปกติ ตัวเลขในคำตอบมาจากข้อมูลร้านจริงทุกตัว</p>
        </div>
      </div>
      <AssistantClient scopes={scopes} initialQuestion={q} />
    </>
  );
}
