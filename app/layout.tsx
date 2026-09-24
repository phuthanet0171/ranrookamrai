import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { IBM_Plex_Sans_Thai } from "next/font/google";
import { BottomNav, TopNav } from "@/components/NavLinks";
import "./globals.css";

const font = IBM_Plex_Sans_Thai({
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-sans",
});

export const metadata: Metadata = {
  title: { default: "ร้านรู้กำไร · ผู้ช่วยร้านค้า", template: "%s · ร้านรู้กำไร" },
  description: "จดยอดขายวันละครั้ง รู้กำไร รู้เงินขาด รู้ว่าพรุ่งนี้ควรเตรียมของเท่าไหร่",
  appleWebApp: { capable: true, title: "ร้านรู้กำไร", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7f9" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1115" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="th" className={font.variable}>
      <body>
        <a className="skip-link" href="#main">ข้ามไปที่เนื้อหา</a>
        <header className="topbar">
          <div className="topbar-inner">
            <a href="/" className="brand" aria-label="ร้านรู้กำไร หน้าหลัก">
              <span className="brand-mark" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 19V11M10 19V5M16 19v-6M22 19H2" />
                </svg>
              </span>
              <span>ร้านรู้กำไร</span>
            </a>
            <TopNav />
          </div>
        </header>
        <main id="main" className="container">{children}</main>
        <BottomNav />
      </body>
    </html>
  );
}
