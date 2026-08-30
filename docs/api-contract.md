# API 계약

## 원칙

- 공용 타입의 DRI는 A입니다.
- B와 C는 변경을 제안할 수 있지만 A가 영향 범위를 확인하고 반영합니다.
- 3일차 이후 치명적 오류가 아니면 공용 타입을 변경하지 않습니다.
- 날짜는 ISO 8601, 금액은 원 단위 정수로 전달합니다.

## AI 계약 파싱

`POST /api/ai/parse-contract`

입력:

```json
{ "text": "편집본은 9월 3일 납품이고 총 240만원입니다." }
```

출력은 `AIContractCandidate`를 사용합니다. 사용자 확인 전에는 계약을 저장하지 않습니다.

## 계약 저장

`POST /api/contracts`

필수 필드: 거래처, 계약 총액, 완료일, 정산조건 또는 예정입금일. AI 후보값은 사용자가 확인·수정한 뒤 전달합니다.

## 계약 상태 변경

`PATCH /api/contracts/:id/status`

```json
{
  "status": "risk",
  "statusSource": "user",
  "statusReason": "거래처 연락 두절"
}
```

## 현금흐름 계산

`POST /api/cashflow/simulate`

출력은 `CashflowResult`를 사용합니다. 정시율을 금액에 곱하지 않고 시나리오별 입금일을 이동합니다.

## 공용 타입 변경 요청

```text
변경 요청자:
변경 필드:
변경 이유:
영향받는 담당:
Mock 수정 필요 여부:
적용 예정 시점:
```

