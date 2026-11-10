"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/", label: "Feed", d: "M5 17h14M7 17V11a5 5 0 0110 0v6M10.5 20.5h3" },
  { href: "/pull", label: "Research", d: "M4 19V5m0 14h16M8 15l3-4 3 2 5-7" },
] as const;

export function TabBar() {
  const pathname = usePathname();
  return (
    <div className="tabbar">
      <nav aria-label="Primary">
        {TABS.map((t) => {
          const active = t.href === "/" ? pathname === "/" : pathname.startsWith(t.href);
          return (
            <Link key={t.href} href={t.href} aria-current={active ? "page" : undefined}>
              <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
                <path d={t.d} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}