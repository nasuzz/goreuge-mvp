"use client";

// 오류 상태(#6 완료 조건). 계산이 실패해도 화면이 하얗게 비지 않도록 잡아준다.
// 엔진이 던지는 메시지는 원인이 적혀 있으므로 그대로 보여준다.

import { useEffect } from "react";

export default function ErrorState({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[goreuge]", error);
  }, [error]);

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 py-20 text-center">
      <h1 className="text-lg font-bold">화면을 불러오지 못했어요</h1>
      <p className="max-w-sm text-sm text-muted">
        입력값이나 계산 과정에서 문제가 생겼습니다. 아래 내용을 팀에 알려주세요.
      </p>
      <p className="max-w-sm rounded-xl bg-surface-muted px-3 py-2 text-xs text-muted">
        {error.message}
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-2 rounded-xl bg-foreground px-4 py-2.5 text-sm font-semibold text-background"
      >
        다시 시도
      </button>
    </main>
  );
}
