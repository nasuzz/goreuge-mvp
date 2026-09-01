# engine-interface.md — 확정본

> 이전 이름 `api-contract.md`. **외부 API 명세가 아니라**, A가 만든 계산 엔진을
> C가 어떻게 호출하는지 적은 내부 약속이라 이름을 바꿨다.

## 0. 이 프로젝트가 쓰는 외부 API

| 대상 | 용도 | 담당 |
| --- | --- | --- |
| LLM API | 계약 문장 → 구조화 JSON | **B** |
| 공휴일 API | 예정입금일 주말·공휴일 보정 | A — **P1, MVP는 OFF** |

그 외 외부 API는 없다. **A가 만드는 건 전부 우리 코드 안의 순수 계산 함수다.**

## 1. 구현 형태

- **엔진**: `engine/` 폴더의 순수함수. C가 직접 import.
- **저장**: Supabase(Postgres). `db/schema.sql` 참조.
- **분리 원칙**: 엔진은 Supabase를 전혀 모른다. 스냅샷을 인자로 받아 계산만 한다.
  → "D-day 숫자가 틀리면 A 책임"을 테스트로 증명할 수 있어야 하기 때문.

## 1-a. ⚠️ tsconfig 필수 옵션

`mock-data.ts`가 JSON을 import하므로 **B·C 모두** tsconfig에 이 옵션이 있어야 컴파일된다.

```json
{ "compilerOptions": { "resolveJsonModule": true, "strict": true } }
```

없으면 `Cannot find module './mock-data.json'` 에러가 난다. (실제로 확인함)

**Mock은 JSON을 직접 import하지 말고 `mock-data.ts`에서 가져올 것.**
JSON을 그대로 import하면 TS가 문자열 리터럴을 `string`으로 넓혀서 enum 필드가 전부 타입 에러가 난다.

```ts
import { MOCK, MOCK_ENGINE_INPUT, EXPECTED, TODAY } from "@/shared/mock-data";
```

---

## 2. 공통 규약

- **날짜** `"YYYY-MM-DD"` KST 달력일 문자열. `Date` 객체를 함수 경계에서 주고받지 않는다.
  (타임존 때문에 D-day가 하루씩 어긋나는 게 가장 흔한 사고다.)
- **금액** 원 단위 정수. 함수가 소수를 반환하지 않는다.
- **오늘** 엔진은 `Date.now()`를 **절대 부르지 않는다.** `today`를 인자로 받는다.
- **반올림** [확정 D8] — `policy.ts`의 `round` 헬퍼만 사용
  ```
  공제액        Math.floor(gross × rate)
  실수령액      gross - 공제액
  일별 베이스라인 내부는 소수 유지, 반환 직전 Math.round
  주간 가용금액  Math.floor(v / 4)
  ```

---

## 3. 함수 명세

### 3-1. 예정입금일 계산

```ts
function calculateExpectedDate(
  completionDate: DateString,
  invoiceDate: DateString | null,
  term: SettlementTerm,
  settlementDay: number | null,
): DateString | null;
```

| term | 결과 |
| --- | --- |
| `ON_COMPLETION` | completionDate |
| `SAME_MONTH_END` | completionDate가 속한 달의 말일 |
| `NEXT_MONTH_END` | completionDate 다음 달의 말일 |
| `NEXT_MONTH_DAY` | 다음 달 settlementDay일. 그 달에 없으면 말일로 clamp (2월 31일 → 2/28) |
| `NET_DAYS` | `(invoiceDate ?? completionDate) + settlementDay일` |
| `UNKNOWN` | **`null`** → `classification_status = needs_review`, 사용자에게 직접 입력 요청 |

**[확정 D1-a] `expectedDateSource === "manual"`이면 이 함수를 호출하지 않는다.**
사용자가 직접 넣은 날짜를 엔진이 덮어쓰면 안 된다.

**정산조건 6개로 커버 못 하는 케이스**

| 케이스 | 처리 |
| --- | --- |
| 선금/잔금 분할 지급 | **계약 2건으로 나눠 등록** (MVP는 1계약 = 1입금) |
| 월 정액 리테이너 | MVP 범위 밖 |
| 익익월 말일 등 변칙 | `UNKNOWN` → 사용자가 예정입금일 직접 입력 |

`expectedDateSource: "manual"`이라는 탈출구가 있어서 6개로 충분하다.
이 필드가 없으면 `UNKNOWN` 계약이 영원히 D-day에 못 들어간다.

**주말·공휴일 보정 (P1, 기본 OFF)**
예정입금일이 토·일·공휴일이면 **다음 영업일**로 이동 (돈이 늦게 들어온다고 보는 쪽이 보수적).
> 데모 계약이 실제로 걸린다: 완료일 2026-09-03 + 익월 말일 = **2026-10-31 (토)**.
> MVP는 OFF라 10/31 그대로 쓴다. 켜면 11/2(월).

---

### 3-2. 시나리오별 입금일 [확정 D3]

```ts
function calculateScenarioDate(
  contract: Contract, client: Client, scenario: Scenario, today: DateString,
): { date: DateString | null; delayBasis: DelayBasis; delayDays: number };
```

**핵심 원칙(4-4): 정시율을 금액에 곱하지 않는다. 금액은 유지하고 입금일만 이동한다.**

**대기(waiting) 계약 — 예정입금일 기준**

| 이력 | 낙관 | 기준 | 비관 |
| --- | --- | --- | --- |
| 3건 이상 | 예정입금일 | 예정입금일 + 중앙값 | 예정입금일 + p90 |
| 3건 미만 | 예정입금일 + 0일 | 예정입금일 + 7일 | 예정입금일 + 21일 |

**지연(delayed)·위험(risk) 계약 — 오늘 기준 [확정 D3]**

```
낙관 = 오늘
기준 = 오늘 + (중앙값 또는 7일)
비관 = 오늘 + (p90 또는 21일)
```

`delayBasis`는 `completedCount >= 3`이면 `client_history`, 아니면 `cold_start`.
`cold_start`일 때 화면에 근거 문구를 띄운다(`FIXED_COPY.coldStartBasis`).

---

### 3-3. 예상 실수령액

```ts
function calculateExpectedNetAmount(
  contract: Contract,
): { amount: Won | null; status: NetAmountStatus };
```

```
예상 실수령액 = 계약 총액 - Math.floor(총액 × confirmedExpectedRate)
```

우선순위(4-3):
1. 지급처가 안내한 공제액이 있으면 **그 값 최우선**
2. 사용자가 소득유형·참조율 적용을 확인했으면 → 시스템 참조율로 잠정 산출
3. 실제 입금 확인 후 → 잠정값 폐기, 실제값으로 갱신
4. 어느 것도 없으면 → `status: "unavailable"`, `추정 불가` 배지

⚠️ **`confirmedExpectedRate`가 null인데 `referenceRate`를 몰래 갖다 쓰면 안 된다.**
사용자 확인 전에는 참조율을 적용하지 않는다(5-1).

---

### 3-4. 계약 상태 자동 전이

```ts
function recalculateContractStatus(contract: Contract, today: DateString): Contract;
```

| 현재 | 조건 | 전이 |
| --- | --- | --- |
| waiting | 예정일 경과 & 미입금 | → `delayed` (system) |
| delayed | 60일 이상 미입금 | → `risk` (system) |
| any | 사용자 수동 지정 | → `risk` (user, **statusReason 필수**) |
| any | 입금 확인 | → `completed` |
| any | 계약 취소 | → `cancelled` |

**`statusSource === "user"`인 계약은 자동 전이가 덮어쓰지 않는다.**
사용자가 직접 위험으로 지정한 걸 시스템이 되돌리면 안 된다.

---

### 3-5. D-day 시뮬레이션 ★핵심★

```ts
function runScenario(input: EngineInput, scenario: Scenario): CashflowResult;
function runAllScenarios(input: EngineInput): CashflowSummary;
```

**시작 잔액 (4-1, 4-2)**

```
simulationStartBalance
= user.totalBalance
- Σ savings.reservedAmount (kind = "tax")
- Σ savings.reservedAmount (kind = "wish")
- user.safetyBuffer
```

> **안전예비금은 여기서 한 번만 뺀다.** D-day 판정을 다시 `<= safetyBuffer`로 하면 이중 차감이다.
> MVP는 이 방식으로 고정하고 판정은 `<= 0`으로 한다(4-2 마지막 문단).
> **`plannedAmount`는 여기서 빼지 않는다.** 예정일의 미래 유출로 한 번만 반영한다.

**⚠️ 반복 유출 펼치기 — 놓치기 쉬움**
`recurrence === "monthly"`인 outflow는 `dueDate` 하루만 차감하면 안 된다.
90일 구간 전체에 매월 같은 일자로 펼쳐야 한다(카드 9/14, 10/14, 11/14).
말일은 `min(dueDate의 일, 그 달의 마지막 날)`로 clamp한다.

**일별 루프 (오늘부터 90일)**

```
projected[d] = projected[d-1]
             + 시나리오별 유입
             - 확정 유출 (outflows 중 dueDate == d 이고 includedInBaseline == false)
             - 필수지출 베이스라인 (monthlyFixedOutflow ÷ 30)
             - 신규 적립 예정액 (savings.plannedAmount 중 해당일 예정분)

D-day = projected[d] <= 0 인 최초 날짜
```

**상태별 유입 처리 (4-5)**

| 상태 | 낙관 | 기준 | 비관 |
| --- | --- | --- | --- |
| waiting | 시나리오 날짜에 유입 | 〃 | 〃 |
| delayed | 오늘 | 오늘 + 지연 | 오늘 + p90 |
| risk | 오늘 (포함) | **기간 내 제외** | **기간 내 제외** |
| completed | **유입 없음** (이미 잔액에 반영됨) | 〃 | 〃 |
| cancelled | 0원 | 〃 | 〃 |
| 실수령액 추정 불가 | 0원 + `excludedReason` | 〃 | 〃 |
| expectedDate가 null | 0원 + `excludedReason` | 〃 | 〃 |

> `completed` 계약을 유입에 다시 넣으면 안 된다(9-3). 실수하기 제일 쉬운 지점이다.

---

### 3-6. 이번 주 가용금액 (4-6)

```
28일 안전자금
= simulationStartBalance
+ 28일 내 기준 시나리오 유입
- 28일 내 확정 유출
- 28일 필수지출 베이스라인
- 28일 내 신규 적립 예정액

이번 주 가용금액 = Math.floor(max(0, 28일 안전자금) ÷ 4)
```

화면에서 잔액·유입·유출·보호분을 분해해 **합계가 정확히 일치해야 한다**(4-6 마지막 줄).
→ `CashflowSummary.balanceBreakdown`을 반환하는 이유.

---

### 3-7. 잔액 3단계 [확정 D7 + 보정]

```ts
getBalanceLevel(balance, safetyBuffer, monthlyFixedOutflow)
```

원안대로 하면 데모 계정(`safetyBuffer = 0`)에서 caution 구간이 `[0, 0)`으로 사라져
3단계가 2단계로 무너진다. 그래서 기준선에 fallback을 둔다.

```
referenceAmount = safetyBuffer > 0
                ? safetyBuffer
                : monthlyFixedOutflow × 0.5

safe    : balance >= referenceAmount
caution : referenceAmount × 0.3 <= balance < referenceAmount
danger  : balance < referenceAmount × 0.3
```

데모 계정 검증 결과 (기준 시나리오 60일):
`safe 7일 / caution 18일 / danger 35일`, 최초 caution 9/6, 최초 danger 9/26, D-day 9/30.
캘린더에 색이 자연스럽게 번지는 구간이 나온다.

---

### 3-8. 대응안 가정 비교 (P0, 최대 3개)

```ts
function compareWhatIf(input: EngineInput, assumptions: WhatIfAssumption[]): WhatIfResult[];
```

- 원본 데이터를 **변경하지 않는다.** 입력을 복사해 가정만 반영하고 다시 돌린다.
- 버튼명은 `적용`이 아니라 `가정해 보기` / `시뮬레이션에 반영`(6-1).
- 문구 예시: `선금 500,000원이 9월 15일에 입금된다고 가정하면 D-day가 13일 늘어나요.`

---

### 3-9. 입금 확인 & 공제율 역산 (P1)

```ts
function confirmPayment(contract: Contract, input: PaymentConfirmInput): Contract;
```

```
actualRate = (grossAmount - actualNetAmount) / grossAmount
```

- `classificationStatus → "actual_confirmed"`, `status → "completed"`
- `expectedNetAmount`는 남겨두되 화면은 실제값 우선 표시
- `clients` 지연 통계 재계산 트리거

---

### 3-10. 거래처 지연 통계 갱신

```ts
function recalculateClientStats(client: Client, completedContracts: Contract[]): Client;
```

```
지연일 = actualDate - expectedDate (음수면 0으로 clamp)
completedCount = 완료 건수
medianDelayDays = 중앙값 (3건 미만이면 null)
p90DelayDays    = 90퍼센타일 (3건 미만이면 null)
```

---

### 3-11. 위시함·세금 준비금 (P1)

**P1 = "시간 내 가능하면 구현하는 보조 기능"이다. 화면만 만드는 건 P2다.**
즉 이건 실제로 동작하게 만드는 걸 목표로 한다. 단 착수 시점에 조건이 붙는다.

```
착수 조건: 3일차 통합(P0 전체)이 끝나기 전에는 손대지 않는다
4일차 판단: 시간이 남으면 실제 구현
            안 남으면 정적 화면으로 강등(P2)하고 로드맵에 남긴다
```

**엔진에서 실제로 반영되는 지점**

`simulationStartBalance`에 이미 자리가 잡혀 있다. P0 단계에서는 `reservedAmount`가
항상 0이라 결과가 같고, P1을 구현하면 값만 채워지면서 자동으로 동작한다.

```
simulationStartBalance
= totalBalance
- Σ savings.reservedAmount (kind="tax")   ← P1에서 0이 아니게 됨
- Σ savings.reservedAmount (kind="wish")  ← P1에서 0이 아니게 됨
- safetyBuffer
```

**함수**

```ts
function calculateWishPlan(
  saving: Saving, weeklyAvailableAmount: Won, today: DateString,
): WishPlan;

function applySavingsCheck(
  saving: Saving, check: SavingsCheck,
): Saving;   // planned 감소, reserved 증가
```

```
달성 예정일 = ceil(targetAmount ÷ weeklyAmount) 주 후
경고 조건   = weeklyAmount > weeklyAvailableAmount × 0.30   (저장은 허용)
```

**적립 상태 전이 (기획서 7장)**
```
체크 완료:  plannedAmount 감소, reservedAmount 증가, 추가 차감 없음
구매 완료:  reservedAmount 감소, 실제 구매 유출 증가, 동일 금액이면 D-day 변화 없음
```

**A가 P1에서 추가로 할 일**
1. `simulationStartBalance`에 `reservedAmount` 실제 반영 (공식은 이미 있음)
2. `plannedAmount`를 예정일의 미래 유출로 반영 (이중 차감 금지)
3. `calculateWishPlan` 구현
4. `applySavingsCheck` — DB 트리거가 `reservedAmount > 체크이력 합계`를 막으므로
   엔진에서도 같은 검증을 먼저 한다

**C가 P1에서 추가로 할 일**
위시함 화면을 정적 목업이 아니라 **체크하면 실제로 D-day가 바뀌는** 화면으로 만든다.
앱은 계좌이체를 실행하지 않는다. 항상 `실제 이체는 직접 해주세요.`를 표시한다.

**P1이 완성되면 생기는 데모 비트**
세금 준비금 288,000원을 체크하면 기준 D-day가 **09-30 → 09-23 (7일 앞당겨짐)**.
"보호는 공짜가 아니다"를 숫자로 보여주는 장면이라 데모에 넣을 가치가 있다.

---

## 4. 엣지 케이스 계약 — 5일차 공동 테스트와 1:1 대응

| 입력 | 엔진 동작 |
| --- | --- |
| 계약 0건 | 정상 계산. 유입 없이 베이스라인만 빠져 언젠가 D-day 발생 |
| 계약 0건 + 잔액 충분 | 90일 내 D-day 없음 → `dDay: null` |
| `safetyBuffer = 0` | 정상 계산. 잔액 3단계는 fallback 기준선 사용 |
| `simulationStartBalance <= 0` | D-day = 오늘. 크래시 금지 |
| `actualDate` 있고 `actualNetAmount` 없음 | **즉시 throw** (9-3 위반) |
| `settlementTerm: UNKNOWN` | `expectedDate: null` → 유입 제외 + `excludedReason` |
| `expectedDateSource: "manual"` | 재계산으로 덮어쓰지 않음 |
| `incomeType: needs_review` | 유입 0원 + `netAmountStatus: "unavailable"` |
| `reservedAmount > 체크 이력 합계` | **즉시 throw** (9-3 위반, DB 트리거도 막음) |
| outflow가 baseline에도 포함 | `includedInBaseline: true`면 개별 차감 스킵 |
| 계약 취소 | 유입 0원, 잔액 계산에서 완전 제외 |
| 위험 수동 지정 | 자동 전이가 덮어쓰지 않음 |

---

## 5. C가 알아야 할 함수는 6개뿐

```
runAllScenarios(input)          → 홈 전부 (D-day, 3시나리오, 가용금액, 위험원인)
compareWhatIf(input, [...])     → 대응안 비교 카드
calculateExpectedDate(...)      → 계약 등록 화면 미리보기
calculateExpectedNetAmount(c)   → 예상 실수령액 표시
recalculateContractStatus(c)    → 정산함 상태 배지
getBalanceLevel(...)            → 캘린더 3단계 배경색
```

일별 루프·지연 정책·무결성 검증은 전부 A 내부 사정이다.

---

## 6. 검증된 기대값 — A의 단위 테스트 기준선

`mock-data.json`을 그대로 넣었을 때 엔진이 **반드시** 내야 하는 숫자다.
(실제로 시뮬레이션을 돌려 확인한 값. 이 숫자가 안 나오면 엔진 버그다.)

```
simulationStartBalance = 800,000원   (800,000 - 0 - 0 - 0)
일별 베이스라인        = 40,000원    (1,200,000 ÷ 30)
미수금 총액            = 9,120,000원

D-day
  낙관   2026-10-24  (D-53)
  기준   2026-09-30  (D-29)   ← 홈 상단 핵심 지표
  비관   2026-09-14  (D-13)

28일 안전자금    = 60,400원
이번 주 가용금액 = 15,100원

잔액 3단계 (기준 시나리오 60일)
  safe 7일 / caution 18일 / danger 35일
  최초 caution 2026-09-06, 최초 danger 2026-09-26
```

**데모 클라이맥스 (실측값)**

| 시각 | 동작 | D-day 변화 |
| --- | --- | --- |
| 1:35 | `contract-002`를 위험으로 수동 지정 | 09-30 → 09-14 (**16일 앞당겨짐**) |
| 2:00 | 선금 500,000원 9/15 입금 가정 | 09-30 → 10-13 (**13일 회복**) |
| P1 | 세금 준비금 288,000원 체크 | 09-30 → 09-23 (**7일 앞당겨짐**) — P1 구현 시 |

> 기획서 12장 대본은 원래 "10일 앞당겨짐 / 12일 회복"이라는 기획 단계 예시
> 숫자였는데, **실제 Mock으로 계산하면 16일 / 13일이 나와서 2026-09-01에
> `docs/mvp-spec-v3.md` 12장을 실측값으로 정정했다.** 이 문서(위 표)와
> 기획서 12장, 실제 데모 화면 셋이 모두 16일 / 13일로 일치한다.

**세 번째 비트(세금 준비금 체크)가 좋은 이유**
"288,000원을 세금용으로 보호하면 D-day가 7일 앞당겨져요. 대신 5월에 낼 돈은 지켜집니다."
— 보호가 공짜가 아니라는 걸 숫자로 보여주는 장면이라, P1이 완성되면 데모에 넣을 가치가 있다.

**튜닝 주의**
`totalBalance`, `monthlyFixedOutflow`, `safetyBuffer`, 계약 금액·예정일,
`clients` 지연 통계 중 **하나라도 바꾸면 위 숫자가 전부 바뀐다.**
바꿀 거면 시뮬레이션을 다시 돌려 세 시나리오가 여전히 갈라지는지 확인할 것.
