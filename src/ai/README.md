# B — 계약 텍스트 파싱

## 제공 범위

- `contract-parser.ts`: API 장애 시에도 동작하는 수기 확인용 로컬 파서
- `parser-service.ts`: 실제 AI provider를 주입하고 출력 검증 후 자동 fallback
- `openai-provider.ts`: 서버 전용 OpenAI Responses API Structured Outputs provider
- `review-rules.ts`: C 확인 모달의 confidence 단계와 저장 가능 여부 계산
- `prompt.ts`: 실제 모델에 전달할 시스템 규칙
- `data/ground-truth/contract-evaluation.json`: 합성 평가 문장 20건과 정답
- `data/fixtures/demo-contract-messages.json`: 시연에 사용할 대표 문장 5건

모든 결과는 `AIContractCandidate`이며, 사용자 확인 전 계약 DB에 저장하면 안 됩니다.

## C 연결 방법

AI 연결 전에는 아래 함수만 호출해 확인 모달을 만들 수 있습니다.

```ts
import { parseContractWithFallback } from "../ai/parser-service";

const result = await parseContractWithFallback(text, "2026-09-01");
// result.candidate: 확인 모달에 표시
// result.source: deterministic_fallback 배지 또는 개발 로그
// result.fallbackReason: AI 미연결/장애 안내
```

실제 AI API를 붙일 때는 `AIContractProvider`의 `parse()`를 구현해 세 번째 인자로 전달합니다. AI가 잘못된 JSON, 범위 밖 confidence, 잘못된 날짜 형식 등을 반환하면 로컬 파서로 자동 전환됩니다.

OpenAI를 사용할 때는 서버 코드에서만 provider를 생성합니다.

```ts
import { createOpenAIProviderFromEnv } from "../ai/openai-provider";

const provider = createOpenAIProviderFromEnv();
const result = await parseContractWithFallback(text, referenceDate, provider);
```

`OPENAI_API_KEY`는 서버 환경변수로만 설정하며 `NEXT_PUBLIC_` 접두사를 붙이지 않습니다. 기본 모델은 `gpt-5.4-mini`이고 `OPENAI_MODEL`로 교체할 수 있습니다.

## UI 규칙

- confidence `0.8` 이상: 일반 표시
- `0.5` 이상 `0.8` 미만: 노란색 확인
- `0.5` 미만: 빨간색 확인
- `missingFields`는 빈 입력칸으로 보여주고 사용자가 직접 입력
- AI 후보는 confidence와 관계없이 사용자가 한 번 확인해야 저장 가능
- 낮은 confidence는 사용자 확인·수정 후 저장 가능하지만 필수값 누락은 항상 차단
- 소득유형은 항상 “AI 후보”로 표시하고 사용자가 선택해야 함
- VAT·분할지급·정보 충돌 warning은 확인 모달 상단에 노출

C는 임계값을 화면에 다시 하드코딩하지 않고 아래 헬퍼를 사용합니다.

```ts
import {
  getCandidateFieldReviews,
  getConfirmationGate,
} from "../ai/review-rules";

const fields = getCandidateFieldReviews(candidate);
const gate = getConfirmationGate(candidate, userReviewed, manualExpectedDate);
// gate.canSave를 저장 버튼 disabled의 반대값으로 사용
// gate.errors는 모달 오류 안내로 표시
```

## 검증

```bash
npm run test:ai
```

평가 결과에는 반드시 “합성 데이터 기준”이라고 표시합니다. 이 평가는 실제 사용자 메시지에 대한 일반 성능을 의미하지 않습니다.
