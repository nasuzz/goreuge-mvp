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
        <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 pb-28 pt-6 sm:px-6">
          {children}
          {/* 기획서 13장 고정 문구. 온보딩은 1회성 화면이라 거기에만 두면 데모 경로
              (홈 진입으로 시작)에서 한 번도 노출되지 않는다. 전역으로 올린다. */}
          <footer className="mt-10 border-t border-line pt-4 text-xs leading-relaxed text-muted">
            {FIXED_COPY.serviceDisclaimer}
          </footer>
        </div>
        <NavBar />
      </body>
    </html>
  );
}
