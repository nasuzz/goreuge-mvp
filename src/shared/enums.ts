// shared/enums.ts
// DRI: A(수경).  상태: 1일차 오전 확정본
// 변경 시 업무분담 8장 "공용 타입 변경 절차"를 따를 것.

// ── 기획서 9-2 원문 enum ──────────────────────────────────

/** 계약 진행 상태. 기획서 4-5 "상태 처리" 표와 1:1 대응 */
export type ContractStatus =
  | "waiting"    // 대기: 예정일 전, 미입금
  | "delayed"    // 지연: 예정일 경과, 미입금
  | "risk"       // 위험: 60일 이상 미입금 또는 사용자 수동 지정
  | "completed"  // 완료: 실제 입금 확인
  | "cancelled"; // 취소: 예상 유입 0원

/** 계약 정보의 확인 단계. "AI가 확정하지 않는다"를 데이터로 강제하는 필드 */
export type ClassificationStatus =
  | "ai_candidate"      // AI 추출만 함. 이 상태로 DB 저장 금지(기획서 8-1)
  | "needs_review"      // 필수값 누락 또는 저신뢰. 사용자 확인 필요
  | "user_confirmed"    // 사용자 확인·수정 완료. 저장 가능, 잠정 실수령액 산출 가능
  | "actual_confirmed"; // 실제 입금 확인 완료. 잠정값 폐기, 실제값으로 교체

/** 소득유형. AI는 후보만 제시하고 확정하지 않는다(기획서 5-1) */
export type IncomeType =
  | "business_personal_service" // 원천징수 대상 인적용역 사업소득 (참조율 3.3%)
  | "qualifying_other_income"   // 일부 기타소득 (참조율 8.8%, 조건 확인 필요)
  | "employment_income"         // 근로소득 (간이세액표에 따라 달라 추정 불가)
  | "no_withholding"            // 공제 없는 수입 (0%)
  | "needs_review";             // 확인 필요 (총액만 표시, 실수령액 추정 불가)

export type SavingsKind = "wish" | "tax";

export type SavingsStatus =
  | "waiting" | "active" | "completed" | "paused" | "cancelled";

export type SpendClass = "essential" | "hobby" | "stress" | "unclassified";

// ── 구현용 추가 enum (1일차 오전 확정) ────────────────────

/**
 * 정산조건. [확정 D1]
 * B의 AI 프롬프트는 이 6개 값 외의 문자열을 절대 출력하지 않는다.
 *
 * 커버하지 못하는 케이스와 처리 방법:
 *  - 선금/잔금 분할 지급 -> 계약 2건으로 나눠 등록 (MVP는 1계약 = 1입금)
 *  - 월 정액 리테이너     -> MVP 범위 밖
 *  - 익익월 말일 등 변칙  -> UNKNOWN 후 사용자가 예정입금일 직접 입력
 */
export type SettlementTerm =
  | "ON_COMPLETION"    // 완료 즉시
  | "SAME_MONTH_END"   // 당월 말일
  | "NEXT_MONTH_END"   // 익월 말일
  | "NEXT_MONTH_DAY"   // 익월 N일       (settlementDay 필요)
  | "NET_DAYS"         // 기준일 + N일   (settlementDay 필요)
  | "UNKNOWN";         // 판단 불가 -> 예정입금일 산출 불가, 사용자 직접 입력

/**
 * 예정입금일이 어떻게 정해졌는가. [추가 D1-a]
 * UNKNOWN이나 변칙 정산조건을 사용자가 직접 입력할 수 있게 하는 탈출구.
 * 이 필드가 있어야 SettlementTerm 6개로 충분해진다.
 */
export type ExpectedDateSource =
  | "calculated" // 완료일·정산조건으로 엔진이 계산
  | "manual";    // 사용자가 직접 입력 (엔진이 덮어쓰지 않는다)

/** 3종 시나리오 (기획서 4-4) */
export type Scenario = "optimistic" | "baseline" | "pessimistic";

/** 상태를 누가 바꿨는가. 위험 수동 지정 구분용 */
export type StatusSource = "system" | "user";

export type OutflowRecurrence = "monthly" | "once";

/** 지연 시나리오 산출 근거. 화면에 "데이터 근거" 문구로 표시(기획서 4-4) */
export type DelayBasis =
  | "client_history" // 완료 이력 3건 이상 -> 중앙값/p90
  | "cold_start";    // 이력 부족 -> 신규 거래처 정책값

/** 실수령액 산출 가능 여부 */
export type NetAmountStatus =
  | "calculated"   // 지급처 안내 금액 또는 사용자 확인 공제율로 산출.
                   // 둘 중 어느 쪽인지는 payerStatedNetAmount가 null인지로 가른다(이슈 #16)
  | "actual"       // 실제 입금으로 확정
  | "unavailable"; // "추정 불가" 배지 대상

/** 캘린더·홈 잔액 3단계 (기획서 6-2) */
export type BalanceLevel = "safe" | "caution" | "danger";
