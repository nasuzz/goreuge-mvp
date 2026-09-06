// 근거 구간 기반 confidence 자기 검증 회귀 테스트 — 이슈 #48.
//
// 여기서 고정하려는 것은 "틀린 값에 높은 확신도가 붙지 않는다"이다. 개별 추출
// 패턴이 바뀌어도 이 성질은 유지돼야 한다.

import { parseContractDeterministically } from "../src/ai/contract-parser";
import { getCandidateFieldReviews, getConfidenceTone } from "../src/ai/review-rules";
import { CONFIDENCE_THRESHOLD } from "../src/shared/policy";
import type { EvidenceField } from "../src/ai/evidence";

const REFERENCE_DATE = "2026-09-01";
const failures: string[] = [];

function check(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "✅" : "❌"} ${label}: actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
  if (!ok) failures.push(label);
}

function parse(text: string) {
  return parseContractDeterministically(text, { referenceDate: REFERENCE_DATE });
}

function evidenceOf(text: string, field: EvidenceField) {
  const result = parse(text);
  const entry = result.evidence.find((item) => item.field === field);
  if (!entry) throw new Error(`${field} 근거가 없습니다.`);
  return { result, entry, confidence: result.candidate.confidence[field] };
}

console.log("\n── 규칙 1: 교차 오염 (#35형 과다 캡처) ──");

// #35는 "거래처:" 라벨 형식에서 발견돼 그 패턴만 고쳐졌다. 같은 오류가 대괄호
// 형식에서 그대로 재현되고, 개별 패치 방식으로는 형식마다 다시 나온다.
{
  const text = "[A스튜디오 편집 240만원] 9월 3일 납품, 익월 말일";
  const { entry, confidence } = evidenceOf(text, "clientName");
  check("과다 캡처된 거래처 값은 그대로 남는다(값은 바꾸지 않는다)", parse(text).candidate.clientName, "A스튜디오 편집 240만원");
  check("자기 검증 전 confidence는 높았다", entry.rawConfidence, 0.96);
  check("자기 검증이 confidence를 warning 아래로 내린다", confidence < CONFIDENCE_THRESHOLD.warning, true);
  check("확인 모달 톤이 danger가 된다", getConfidenceTone(confidence), "danger");
  check("하향 사유가 남는다", entry.demotedReason !== null, true);
}

console.log("\n── 정상 케이스는 건드리지 않는다 ──");

for (const [label, text, field, expected] of [
  ["대괄호 정상", "[K스튜디오] 총액 240만원, 9월 3일 납품, 익월 말일 정산", "clientName", 0.96],
  ["라벨 정상", "거래처: M프로덕션 총 180만원, 9월 20일 납품, 익월 말일 정산", "clientName", 0.96],
  ["무라벨 정상", "K스튜디오 측에서 총액 320만원, 9월 20일 납품, 익월 말일", "clientName", 0.7],
] as [string, string, EvidenceField, number][]) {
  const { entry, confidence } = evidenceOf(text, field);
  check(`${label}: confidence 유지`, confidence, expected);
  check(`${label}: 하향 사유 없음`, entry.demotedReason, null);
}

console.log("\n── 규칙 2: 근거 없는 확신 (#41형 놓친 값) ──");

{
  // "96만 7천원"은 순수 한글 수사도 순수 아라비아 숫자도 아니라 패턴 밖이다.
  const text = "[D에이전시] 총액 100만원, 실수령액 96만 7천원입니다. 9월 3일 납품, 익월 말일";
  const { confidence } = evidenceOf(text, "payerStatedNetAmountCandidate");
  check("못 읽은 지급처 금액에 높은 확신도가 붙지 않는다", confidence < CONFIDENCE_THRESHOLD.warning, true);
}

{
  // 원문에 지급처 안내가 아예 없으면 null + 높은 확신도가 정상이다.
  const text = "[K스튜디오] 총액 240만원, 9월 3일 납품, 익월 말일 정산";
  const { confidence } = evidenceOf(text, "payerStatedNetAmountCandidate");
  check("안내가 없는 경우는 확신도를 내리지 않는다", confidence >= CONFIDENCE_THRESHOLD.normal, true);
}

console.log("\n── 근거 구간이 원문을 실제로 가리킨다 ──");

{
  const text = "[K스튜디오] 총액 240만원, 9월 3일 납품, 익월 말일 정산, 3.3% 공제";
  const result = parse(text);
  for (const entry of result.evidence) {
    if (entry.span === null) continue;
    const sliced = result.normalizedText.slice(entry.span.start, entry.span.end);
    check(`${entry.field} span이 normalizedText와 일치`, sliced, entry.span.text);
  }
  const gross = result.evidence.find((item) => item.field === "grossAmount")!;
  check("금액 근거 구간이 총액 표현을 가리킨다", gross.span?.text.includes("240만원"), true);
}

console.log("\n── 확인 모달 연결 ──");

{
  const text = "[A스튜디오 편집 240만원] 9월 3일 납품, 익월 말일";
  const result = parse(text);
  const reviews = getCandidateFieldReviews(result.candidate, result.evidence);
  const clientReview = reviews.find((item) => item.field === "clientName")!;
  check("리뷰 항목에 근거가 실린다", clientReview.evidence !== null, true);
  check("리뷰 항목의 하향 사유가 노출된다", clientReview.evidence?.demotedReason !== null, true);

  // 근거를 넘기지 않아도 기존 호출부가 그대로 동작해야 한다(AI 출력 경로).
  const withoutEvidence = getCandidateFieldReviews(result.candidate);
  check("근거 없이 호출하면 evidence는 null", withoutEvidence[0].evidence, null);
  check("근거 없이 호출해도 항목 수는 같다", withoutEvidence.length, reviews.length);
}

console.log(
  failures.length === 0
    ? "\n✅ 전부 통과 (0건 실패)"
    : `\n❌ ${failures.length}건 실패\n- ${failures.join("\n- ")}`,
);
process.exitCode = failures.length === 0 ? 0 : 1;
