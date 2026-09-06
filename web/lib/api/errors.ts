import { NextResponse } from "next/server";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * ApiError는 사용자에게 보여줄 목적으로 만든 메시지라 그대로 내보낸다.
 * 그 외(대부분 Supabase/Postgres 오류)는 원문을 브라우저로 내보내지 않는다.
 * 컬럼명·제약조건명·타입 같은 스키마 정보가 그대로 노출되기 때문이다.
 * 실제로 잘못된 id를 넣으면 아래가 그대로 응답에 실려 나갔다.
 *   {"error":"[supabase] invalid input syntax for type uuid: \"not-a-uuid\""}
 * D5-a가 "DB에 닿는 경로는 서버뿐"으로 정한 이상, 오류 원문도 서버에 남긴다.
 * (#27이 provider 오류를 고정 안내로 바꾼 것과 같은 처리다.)
 */
export function errorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error(error);
  return NextResponse.json(
    { error: "서버에서 요청을 처리하지 못했습니다." },
    { status: 500 },
  );
}

export function asObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ApiError(400, "JSON object body is required");
  }
  return value as Record<string, unknown>;
}

export function requiredString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new ApiError(400, `${key} is required`);
  }
  return value.trim();
}

export function nonNegativeNumber(body: Record<string, unknown>, key: string): number {
  const value = body[key];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new ApiError(400, `${key} must be a non-negative number`);
  }
  return value;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 형식이 어긋난 id는 DB까지 보내지 않는다. 보내면 Postgres가 500으로 던진다. */
export function assertUuid(value: string, label: string): string {
  if (!UUID_PATTERN.test(value)) throw new ApiError(400, `${label} must be a UUID`);
  return value;
}
