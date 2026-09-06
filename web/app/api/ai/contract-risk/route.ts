import { NextRequest, NextResponse } from "next/server";
import { detectContractRisks } from "@/ai/contract-risk";
import { parseContractParseRequest } from "@/ai/parse-request";

export const runtime = "nodejs";

// 계약 문장의 구조적 위험 신호 (#49).
//
// 후보 추출(/api/ai/contract-candidate)과 라우트를 나눈 이유:
//  - 위험 신호는 실패해도 계약 등록을 막지 않아야 한다. 한 라우트에 묶으면
//    위험 탐지가 죽을 때 파싱까지 같이 죽는다.
//  - 화면에서 후보를 먼저 띄우고 위험 신호는 뒤이어 채울 수 있다.
//
// provider 연결: #53에서 Gemini provider가 들어오면 여기서 주입한다.
// 지금은 provider 없이 결정적 규칙으로 동작하고, 응답의 source가 그걸 알려준다.
export async function POST(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON 요청 본문을 확인해 주세요." }, { status: 400 });
  }

  // 입력 검증은 후보 추출과 같은 규칙을 쓴다(빈 입력·10,000자 초과·기준일 형식).
  const parsed = parseContractParseRequest(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const result = await detectContractRisks(parsed.value.text);
  return NextResponse.json(result);
}
