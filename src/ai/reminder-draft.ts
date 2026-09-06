import type { Client, Contract, DateString, EngineInput } from "../shared/types";

export type ReminderTone = "soft" | "standard" | "firm";
export type ReminderChannel = "message" | "email";

export interface ReminderDraftInput {
  contractId: string;
  /** 사용자가 고르는 어조. 기본은 soft */
  tone: ReminderTone;
  /** 카톡/메일. 길이와 인사 형식이 달라진다 */
  channel: ReminderChannel;
}

export interface ReminderDraft {
  subject: string | null;
  body: string;
  /** 문장이 근거로 삼은 사실. 화면에서 그대로 보여줘 사용자가 검증한다 */
  facts: { label: string; value: string }[];
  /** 이 어조를 고른 이유 */
  toneReason: string;
}

export interface ReminderDraftProvider {
  create(prompt: string): Promise<Pick<ReminderDraft, "subject" | "body" | "toneReason">>;
}

export interface ReminderDraftResult {
  draft: ReminderDraft;
  recommendedTone: ReminderTone;
  source: "ai" | "deterministic_fallback";
  fallbackReason: string | null;
}

interface ReminderDraftContext {
  contract: Contract;
  client: Client;
  clientName: string;
  amount: number;
  overdueDays: number;
  today: DateString;
}

const TONE_LABEL: Record<ReminderTone, string> = {
  soft: "부드럽게",
  standard: "일반",
  firm: "단호하게",
};

const TERM_LABEL: Record<Contract["settlementTerm"], string> = {
  ON_COMPLETION: "완료 즉시",
  SAME_MONTH_END: "당월 말일",
  NEXT_MONTH_END: "익월 말일",
  NEXT_MONTH_DAY: "익월 지정일",
  NET_DAYS: "기준일 후 지정일수",
  UNKNOWN: "직접 입력",
};

const UNSAFE_PATTERNS = [
  /법적\s*조치/,
  /소송/,
  /내용증명/,
  /이자/,
  /지연\s*손해금/,
  /연체료/,
  /손해배상/,
];

export function createReminderDraft(
  input: EngineInput,
  request: ReminderDraftInput,
): ReminderDraftResult {
  const context = buildReminderDraftContext(input, request.contractId);
  const recommendedTone = recommendReminderTone(context);
  return {
    draft: buildTemplateDraft(context, request.tone, request.channel),
    recommendedTone,
    source: "deterministic_fallback",
    fallbackReason: "AI provider가 설정되지 않아 템플릿 초안을 사용했습니다.",
  };
}

export async function createReminderDraftWithFallback(
  input: EngineInput,
  request: ReminderDraftInput,
  provider?: ReminderDraftProvider,
): Promise<ReminderDraftResult> {
  const context = buildReminderDraftContext(input, request.contractId);
  const recommendedTone = recommendReminderTone(context);
  const fallback = buildTemplateDraft(context, request.tone, request.channel);

  if (!provider) {
    return {
      draft: fallback,
      recommendedTone,
      source: "deterministic_fallback",
      fallbackReason: "AI provider가 설정되지 않아 템플릿 초안을 사용했습니다.",
    };
  }

  try {
    const generated = await provider.create(buildReminderDraftPrompt(context, request));
    const draft = {
      subject: request.channel === "email" ? generated.subject : null,
      body: generated.body,
      facts: fallback.facts,
      toneReason: generated.toneReason,
    };
    const errors = validateReminderDraft(draft, request.channel);
    if (errors.length > 0) {
      return {
        draft: fallback,
        recommendedTone,
        source: "deterministic_fallback",
        fallbackReason: `AI 출력 검증 실패: ${errors.join(" ")}`,
      };
    }
    return { draft, recommendedTone, source: "ai", fallbackReason: null };
  } catch (error) {
    return {
      draft: fallback,
      recommendedTone,
      source: "deterministic_fallback",
      fallbackReason: `AI 호출 실패: ${error instanceof Error ? error.message : "알 수 없는 오류"}`,
    };
  }
}

export function buildReminderDraftContext(
  input: EngineInput,
  contractId: string,
): ReminderDraftContext {
  const contract = input.contracts.find((c) => c.id === contractId);
  if (!contract) throw new Error("contract not found");
  if (contract.status !== "delayed" && contract.status !== "risk") {
    throw new Error("reminder draft is only available for delayed or risk contracts");
  }
  if (!contract.expectedDate) throw new Error("expectedDate is required for reminder draft");
  const client = input.clients.find((c) => c.id === contract.clientId);
  if (!client) throw new Error("client not found");

  return {
    contract,
    client,
    clientName: client.name,
    amount: contract.expectedNetAmount ?? contract.grossAmount,
    overdueDays: Math.max(0, daysBetween(contract.expectedDate, input.today)),
    today: input.today,
  };
}

export function recommendReminderTone(context: ReminderDraftContext): ReminderTone {
  if (context.contract.status === "risk" || context.overdueDays > 30) return "firm";
  if (context.overdueDays <= 7 && context.client.completedCount >= 3) return "soft";
  return "standard";
}

export function buildReminderDraftPrompt(
  context: ReminderDraftContext,
  request: ReminderDraftInput,
): string {
  const facts = buildFacts(context)
    .map((fact) => `- ${fact.label}: ${fact.value}`)
    .join("\n");

  return [
    "프리랜서가 거래처에 보낼 미입금 독촉 초안을 작성한다.",
    `채널: ${request.channel === "email" ? "메일" : "카톡/문자"}`,
    `어조: ${TONE_LABEL[request.tone]}`,
    "",
    "반드시 지킬 규칙:",
    "- 자동 발송하지 않는다. 복사 가능한 초안만 만든다.",
    "- 법적 조치, 이자, 지연손해금, 연체료, 손해배상은 언급하지 않는다.",
    "- 아래 사실의 금액과 날짜를 바꾸거나 새 숫자를 만들지 않는다.",
    "- 관계를 해치지 않되 회신 요청은 분명하게 쓴다.",
    "",
    "근거 사실:",
    facts,
    "",
    "JSON으로만 답한다: {\"subject\": string|null, \"body\": string, \"toneReason\": string}",
  ].join("\n");
}

export function buildTemplateDraft(
  context: ReminderDraftContext,
  tone: ReminderTone,
  channel: ReminderChannel,
): ReminderDraft {
  const amount = won(context.amount);
  const expectedDate = dateLabel(context.contract.expectedDate);
  const clientName = context.clientName;
  const overdue = `${context.overdueDays}일`;
  const facts = buildFacts(context);
  const toneReason = toneReasonFor(context, tone);

  if (channel === "email") {
    return {
      subject: `[입금 확인 요청] ${clientName} 정산 예정 건`,
      body: emailBody({ clientName, amount, expectedDate, overdue, tone }),
      facts,
      toneReason,
    };
  }

  return {
    subject: null,
    body: messageBody({ clientName, amount, expectedDate, overdue, tone }),
    facts,
    toneReason,
  };
}

export function validateReminderDraft(draft: ReminderDraft, channel: ReminderChannel): string[] {
  const errors: string[] = [];
  if (channel === "email" && (!draft.subject || draft.subject.trim() === "")) {
    errors.push("메일 제목이 필요합니다.");
  }
  if (channel === "message" && draft.subject !== null) {
    errors.push("메시지 채널의 제목은 null이어야 합니다.");
  }
  if (!draft.body.trim()) errors.push("본문이 비어 있습니다.");
  if (!draft.toneReason.trim()) errors.push("어조 선택 이유가 비어 있습니다.");
  if (UNSAFE_PATTERNS.some((pattern) => pattern.test(draft.body) || pattern.test(draft.subject ?? ""))) {
    errors.push("법률 영역 표현이 포함되어 있습니다.");
  }
  return errors;
}

function buildFacts(context: ReminderDraftContext): ReminderDraft["facts"] {
  const { contract, client } = context;
  return [
    { label: "거래처", value: context.clientName },
    { label: "정산 예정일", value: dateLabel(contract.expectedDate) },
    { label: "미입금 경과", value: `${context.overdueDays}일` },
    { label: "요청 금액", value: won(context.amount) },
    { label: "정산 조건", value: TERM_LABEL[contract.settlementTerm] },
    { label: "지연 통계 표본", value: `${client.completedCount}건` },
  ];
}

function toneReasonFor(context: ReminderDraftContext, tone: ReminderTone): string {
  if (tone === "firm") {
    return context.contract.status === "risk" || context.overdueDays > 30
      ? "위험 상태이거나 지연 기간이 길어 사실과 회신 요청을 분명히 적는 어조입니다."
      : "사용자가 단호한 확인 요청을 선택했습니다.";
  }
  if (tone === "soft") {
    return context.overdueDays <= 7 && context.client.completedCount >= 3
      ? "거래 이력이 있고 지연 초기라 관계를 보존하는 확인형 어조입니다."
      : "사용자가 부드러운 확인 요청을 선택했습니다.";
  }
  return "금액과 예정일을 명시하고 회신을 요청하는 기본 어조입니다.";
}

function messageBody({
  clientName,
  amount,
  expectedDate,
  overdue,
  tone,
}: {
  clientName: string;
  amount: string;
  expectedDate: string;
  overdue: string;
  tone: ReminderTone;
}): string {
  if (tone === "soft") {
    return [
      `${clientName} 담당자님, 안녕하세요.`,
      `${expectedDate} 예정이었던 정산 건이 아직 확인되지 않아 연락드립니다.`,
      `혹시 ${amount} 입금 일정 확인 부탁드려도 될까요?`,
    ].join("\n");
  }
  if (tone === "firm") {
    return [
      `${clientName} 담당자님, 안녕하세요.`,
      `${expectedDate} 예정이었던 ${amount} 정산 건이 현재 ${overdue} 미입금 상태입니다.`,
      "확인 가능한 입금 일정이나 처리 현황을 오늘 중 회신 부탁드립니다.",
    ].join("\n");
  }
  return [
    `${clientName} 담당자님, 안녕하세요.`,
    `${expectedDate} 예정이었던 ${amount} 정산 건 입금이 아직 확인되지 않아 연락드립니다.`,
    "확인 후 입금 예정일을 회신 부탁드립니다.",
  ].join("\n");
}

function emailBody(args: {
  clientName: string;
  amount: string;
  expectedDate: string;
  overdue: string;
  tone: ReminderTone;
}): string {
  const body = messageBody(args);
  if (args.tone === "soft") {
    return `${body}\n\n확인해 주시면 감사하겠습니다.`;
  }
  return `${body}\n\n감사합니다.`;
}

function won(amount: number): string {
  return `${new Intl.NumberFormat("ko-KR").format(amount)}원`;
}

function dateLabel(date: DateString | null): string {
  if (!date) return "-";
  const [year, month, day] = date.split("-").map(Number);
  return `${year}년 ${month}월 ${day}일`;
}

function daysBetween(from: DateString, to: DateString): number {
  const [y1, m1, d1] = from.split("-").map(Number);
  const [y2, m2, d2] = to.split("-").map(Number);
  const a = Date.UTC(y1, m1 - 1, d1);
  const b = Date.UTC(y2, m2 - 1, d2);
  return Math.round((b - a) / 86_400_000);
}
