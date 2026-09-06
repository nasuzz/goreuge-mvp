import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { NavBar } from "@/components/nav-bar";
import { FIXED_COPY } from "@/shared/policy";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "고르게 — 프리랜서 현금흐름 D-day",
  description:
    "미수금 지연이 현금흐름에 미치는 영향을 계산하고, 언제까지 버틸 수 있는지 D-day로 보여줍니다.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <NavBar />
        <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-5 pb-28 pt-8 sm:px-8 lg:px-10">
          {children}
          {/* 기획서 13장 고지. 온보딩 한 화면에만 두면 데모처럼 곧바로 홈으로
              들어가는 경로에서는 한 번도 노출되지 않는다. 문구는 임의로 바꾸지
              않고 policy.ts의 FIXED_COPY를 그대로 쓴다. */}
          <footer className="mt-8 border-t border-line pt-3 text-xs leading-relaxed text-muted">
            {FIXED_COPY.serviceDisclaimer}
          </footer>
        </div>
      </body>
    </html>
  );
}
