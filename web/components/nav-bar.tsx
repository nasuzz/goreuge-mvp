"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// 정산함은 서비스 핵심이라 하위로 숨기지 않고 독립 메뉴로 둔다(기획서 2장 구조 원칙).
const MENU = [
  { href: "/", label: "홈", hint: "현금흐름" },
  { href: "/calendar", label: "캘린더", hint: "입출금" },
  { href: "/settlements", label: "정산함", hint: "수금" },
  // [이슈 #56] 기획서 2장의 4번째 메뉴. P1이지만 3-11이 "실제로 동작하게 만드는 걸
  // 목표로 한다(화면만 만드는 건 P2)"고 정해 체크하면 D-day가 바뀌는 화면으로 만든다.
  { href: "/wish", label: "위시함", hint: "보호금" },
] as const;

export function NavBar() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-white/65 bg-white/76 shadow-[0_-16px_34px_rgba(54,125,255,0.14)] backdrop-blur md:sticky md:top-0 md:bottom-auto md:mb-6 md:border-b md:border-t-0 md:shadow-[0_14px_30px_rgba(54,125,255,0.1)]">
      <div className="mx-auto hidden w-full max-w-6xl items-center justify-between px-8 py-3 lg:flex lg:px-10">
        <Link href="/" className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <span className="size-2 rounded-full bg-accent-warm shadow-[0_0_0_5px_var(--accent-warm-soft)]" />
          Goreuge
        </Link>
        <p className="text-xs text-muted">Freelance cashflow desk</p>
      </div>
      <ul className="mx-auto flex w-full max-w-6xl px-3 py-2 sm:px-6 md:justify-center md:border-t md:border-line/70 lg:px-8">
        {MENU.map((item) => {
          const active =
            item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <li key={item.href} className="flex-1 md:max-w-36">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-13 flex-col items-center justify-center gap-0.5 rounded-md px-1 text-sm transition-colors md:min-h-11 md:flex-row md:gap-2 ${
                  active
                    ? "bg-[linear-gradient(135deg,var(--accent-soft),var(--lavender-soft))] font-semibold text-accent-strong shadow-[inset_0_1px_0_rgba(255,255,255,0.86),0_8px_16px_rgba(255,85,173,0.16)]"
                    : "text-muted hover:bg-white/72 hover:text-foreground"
                }`}
              >
                <span>{item.label}</span>
                <span className="text-[11px] opacity-70 md:hidden">{item.hint}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
