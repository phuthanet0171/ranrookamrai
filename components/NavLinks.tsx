"use client";
import type { ReactNode } from "react";
import { usePathname } from "next/navigation";

// Five destinations, same order everywhere: top bar on desktop, tab bar at the bottom on phones.
const ICON: Record<string, ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  record: <><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></>,
  ai: <path d="M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7-4.7-1.8 4.7-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />,
  reports: <path d="M4 20V10M10 20V4M16 20v-8M22 20H2" />,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1" /></>,
};

const LINKS = [
  { href: "/", label: "หน้าหลัก", icon: "home", match: (p: string) => p === "/" || p.startsWith("/shop") },
  { href: "/record", label: "จดยอด", icon: "record", match: (p: string) => p.startsWith("/record") },
  { href: "/assistant", label: "ถาม AI", icon: "ai", match: (p: string) => p.startsWith("/assistant") },
  { href: "/reports", label: "รายงาน", icon: "reports", match: (p: string) => p.startsWith("/reports") || p.startsWith("/analytics") },
  {
    href: "/settings", label: "ตั้งค่า", icon: "settings",
    // whole path segments only: "/report" must not match "/reports"
    match: (p: string) => ["/settings", "/automations", "/import", "/runs", "/report", "/about", "/login"].some((x) => p === x || p.startsWith(`${x}/`)),
  },
];

const Icon = ({ name }: { name: string }) => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {ICON[name]}
  </svg>
);

export function TopNav() {
  const path = usePathname();
  return (
    <nav className="nav" aria-label="เมนูหลัก">
      {LINKS.map((l) => (
        <a key={l.href} href={l.href} aria-current={l.match(path) ? "page" : undefined}>{l.label}</a>
      ))}
    </nav>
  );
}

export function BottomNav() {
  const path = usePathname();
  return (
    <nav className="tabbar" aria-label="เมนูหลัก">
      {LINKS.map((l) => (
        <a key={l.href} href={l.href} aria-current={l.match(path) ? "page" : undefined} className={l.icon === "record" ? "tab-primary" : undefined}>
          <Icon name={l.icon} />
          <span>{l.label}</span>
        </a>
      ))}
    </nav>
  );
}
