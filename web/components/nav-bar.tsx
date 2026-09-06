"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// 정산함은 서비스 핵심이라 하위로 숨기지 않고 독립 메뉴로 둔다(기획서 2장 구조 원칙).
const MENU = [
  { href: "/", label: "홈", hint: "위클리" },
  { href: "/calendar", label: "캘린더", hint: "먼슬리" },
  { href: "/settlements", label: "정산함", hint: "계약" },
  // [이슈 #56] 기획서 2장의 4번째 메뉴. P1이지만 3-11이 "실제로 동작하게 만드는 걸
  // 목표로 한다(화면만 만드는 건 P2)"고 정해 체크하면 D-day가 바뀌는 화면으로 만든다.
  { href: "/wish", label: "위시함", hint: "적립" },
] as const;

export function NavBar() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 border-t border-line bg-surface/95 backdrop-blur">
      <ul className="mx-auto flex w-full max-w-2xl">
        {MENU.map((item) => {
          const active =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex flex-col items-center gap-0.5 py-3 text-sm transition-colors ${
                  active ? "font-semibold text-accent" : "text-muted hover:text-foreground"
                }`}
              >
                <span>{item.label}</span>
                <span className="text-[11px] opacity-70">{item.hint}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
