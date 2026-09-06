// 계약 위험 신호 탐지 검증 (#49)
//
// 이 기능은 오탐이 나면 그 순간 죽는다. 모든 계약에 경고가 붙으면 사용자는 전부
// 무시하고, 그러면 정말 위험한 계약에서도 안 본다. 그래서 정상 문장에서 0건이
// 나오는지를 위험 탐지율만큼 중요하게 본다.

import {
  detectContractRisksDeterministically,
  validateRiskSignals,
  type ContractRiskKind,
  type ContractRiskSignal,
} from "../src/ai/contract-risk";

let failures = 0;

function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "  ✓" : "  ✗"} ${label}${detail ? ` — ${detail}` : ""}`);
}

function kinds(signals: ContractRiskSignal[]): ContractRiskKind[] {
  return signals.map((s) => s.kind);
}

function detect(text: string): ContractRiskSignal[] {
  return validateRiskSignals(detectContractRisksDeterministically(text), text);
}

console.log("\n[1] 위험 문장 — 종류별 탐지");

const positives: { label: string; text: string; expect: ContractRiskKind }[] = [
  {
    label: "정산 시점이 상대 재량",
    text: "[D에이전시] 편집본 총 240만원입니다. 검수 끝나면 정산해드릴게요.",
    expect: "open_ended_condition",
  },
  {
    label: "금액 미확정",
    text: "이번 건은 일단 진행하시고 금액은 나중에 협의해요.",
    expect: "amount_unfixed",
  },
  {
    label: "완료 기준이 열려 있음",
    text: "총 200만원이고 익월 말일 정산입니다. 수정은 몇 번 더 있을 수 있어요.",
    expect: "scope_creep",
  },
  {
    label: "계산서 발행이 기산일을 좌우",
    text: "총 300만원입니다. 세금계산서는 다음 달에 끊어드릴게요.",
    expect: "invoice_dependency",
  },
  {
    label: "구두 합의만",
    text: "지난번 통화로 합의한 대로 진행하겠습니다. 총 150만원이요.",
    expect: "verbal_only",
  },
];

for (const c of positives) {
  const found = detect(c.text);
  check(c.label, kinds(found).includes(c.expect), kinds(found).join(", ") || "탐지 0건");
}

console.log("\n[2] 정상 문장 — 오탐이 없어야 한다");

const negatives: { label: string; text: string }[] = [
  {
    label: "기한이 명시된 검수",
    text: "[D에이전시] 총 240만원. 검수 완료 후 7일 이내 정산해드립니다.",
  },
  {
    label: "표준 정산조건",
    text: "[K스튜디오] 홍보영상 320만원, 납품 후 30일 정산입니다.",
  },
  {
    label: "수정 횟수가 정해짐",
    text: "총 200만원, 익월 말일 정산. 수정은 2회까지 포함입니다.",
  },
  {
    label: "계산서 발행일 명시",
    text: "총 300만원입니다. 세금계산서는 9월 10일에 발행해 드립니다.",
  },
  {
    label: "서면 계약 존재",
    text: "통화로 협의한 내용은 계약서에 그대로 반영했습니다. 총 150만원입니다.",
  },
  {
    label: "금액·완료일·조건이 모두 명확",
    text: "[M프로덕션] 총 180만원, 완료 2026-09-10, 익월 말일 정산입니다.",
  },
];

for (const c of negatives) {
  const found = detect(c.text);
  check(c.label, found.length === 0, found.length > 0 ? `오탐 ${kinds(found).join(", ")}` : "");
}

console.log("\n[3] 환각 가드 — 원문에 없는 근거는 버린다");

const originalText = "[D에이전시] 총 240만원입니다. 검수 끝나면 정산해드릴게요.";
const fabricated: ContractRiskSignal[] = [
  {
    kind: "open_ended_condition",
    quote: "검수 끝나면 정산해드릴게요.",
    severity: "warning",
    suggestedQuestion: "며칠 걸릴까요?",
  },
  {
    kind: "amount_unfixed",
    quote: "금액은 추후 협의하겠습니다.", // 원문에 없다
    severity: "warning",
    suggestedQuestion: "총액을 확정해 주세요.",
  },
];
const guarded = validateRiskSignals(fabricated, originalText);
check("원문에 있는 근거는 남는다", kinds(guarded).includes("open_ended_condition"));
check("원문에 없는 근거는 버린다", !kinds(guarded).includes("amount_unfixed"));
check("빈 근거는 버린다", validateRiskSignals(
  [{ kind: "verbal_only", quote: "  ", severity: "info", suggestedQuestion: "" }],
  originalText,
).length === 0);

console.log("\n[4] 같은 종류를 여러 번 띄우지 않는다");

const duplicated: ContractRiskSignal[] = [
  { kind: "open_ended_condition", quote: "검수 끝나면 정산해드릴게요.", severity: "warning", suggestedQuestion: "a" },
  { kind: "open_ended_condition", quote: "총 240만원입니다.", severity: "warning", suggestedQuestion: "b" },
];
check("중복 종류 제거", validateRiskSignals(duplicated, originalText).length === 1);

console.log("\n[5] 근거는 원문 문장 그대로여야 한다");

const signal = detect(positives[0].text)[0];
check(
  "quote가 원문에 포함됨",
  !!signal && positives[0].text.replace(/\s+/g, "").includes(signal.quote.replace(/\s+/g, "")),
  signal?.quote ?? "탐지 0건",
);
check("물어볼 질문이 비어 있지 않음", !!signal?.suggestedQuestion?.trim());

console.log(
  failures === 0
    ? "\n✅ 계약 위험 신호: 탐지·오탐 방지·환각 가드 전부 통과"
    : `\n❌ 계약 위험 신호 검증 실패 ${failures}건`,
);
if (failures > 0) process.exitCode = 1;
