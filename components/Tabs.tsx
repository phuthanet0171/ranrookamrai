"use client";
import { useId, useState, type ReactNode } from "react";

/** Accessible tabs; panels are rendered on the server and passed in. */
export default function Tabs({ tabs, label }: { tabs: { id: string; label: string; content: ReactNode }[]; label: string }) {
  const [active, setActive] = useState(tabs[0]?.id);
  const base = useId();
  return (
    <div>
      <div className="seg" role="tablist" aria-label={label} style={{ marginBottom: 12 }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`${base}-${t.id}-tab`}
            aria-controls={`${base}-${t.id}`}
            aria-selected={active === t.id}
            tabIndex={active === t.id ? 0 : -1}
            onClick={() => setActive(t.id)}
            onKeyDown={(e) => {
              const i = tabs.findIndex((x) => x.id === active);
              if (e.key === "ArrowRight") setActive(tabs[(i + 1) % tabs.length].id);
              if (e.key === "ArrowLeft") setActive(tabs[(i - 1 + tabs.length) % tabs.length].id);
            }}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tabs.map((t) => (
        <div key={t.id} role="tabpanel" id={`${base}-${t.id}`} aria-labelledby={`${base}-${t.id}-tab`} hidden={active !== t.id}>
          {t.content}
        </div>
      ))}
    </div>
  );
}
