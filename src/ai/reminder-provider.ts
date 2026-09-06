import type { ReminderDraftProvider } from "./reminder-draft";

type FetchLike = typeof fetch;

interface ProviderOptions {
  apiKey: string;
  model?: string;
  fetchImpl?: FetchLike;
}

interface OpenAIResponsesPayload {
  output?: Array<{
    content?: Array<{ type?: string; text?: string }>;
  }>;
  error?: { message?: string };
}

interface GeminiPayload {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  error?: { message?: string };
}

const REMINDER_DRAFT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    subject: { type: ["string", "null"] },
    body: { type: "string" },
    toneReason: { type: "string" },
  },
  required: ["subject", "body", "toneReason"],
} as const;

export class OpenAIReminderDraftProvider implements ReminderDraftProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: ProviderOptions) {
    if (!options.apiKey) throw new Error("OPENAI_API_KEY가 필요합니다.");
    this.apiKey = options.apiKey;
    this.model = options.model ?? "gpt-5.4-mini";
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async create(prompt: string) {
    const response = await this.fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        store: false,
        instructions: "한국어 정산 독촉 초안을 안전하게 작성한다. JSON만 출력한다.",
        input: prompt,
        text: {
          format: {
            type: "json_schema",
            name: "goreuge_reminder_draft",
            strict: true,
            schema: REMINDER_DRAFT_JSON_SCHEMA,
          },
        },
      }),
    });

    const payload = await response.json() as OpenAIResponsesPayload;
    if (!response.ok) throw new Error(payload.error?.message ?? `OpenAI API 오류 (${response.status})`);
    const outputText = getOpenAIOutputText(payload);
    if (!outputText) throw new Error("OpenAI 응답에 output_text가 없습니다.");
    return JSON.parse(outputText) as { subject: string | null; body: string; toneReason: string };
  }
}

export class GeminiReminderDraftProvider implements ReminderDraftProvider {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchImpl: FetchLike;

  constructor(options: ProviderOptions) {
    if (!options.apiKey) throw new Error("GEMINI_API_KEY가 필요합니다.");
    this.apiKey = options.apiKey;
    this.model = options.model ?? "gemini-3-flash-preview";
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async create(prompt: string) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`;
    const response = await this.fetchImpl(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: "한국어 정산 독촉 초안을 안전하게 작성한다. JSON만 출력한다." }],
        },
        contents: [{
          role: "user",
          parts: [{ text: prompt }],
        }],
        generationConfig: {
          responseMimeType: "application/json",
        },
      }),
    });

    const payload = await response.json() as GeminiPayload;
    if (!response.ok) throw new Error(payload.error?.message ?? `Gemini API 오류 (${response.status})`);
    const outputText = getGeminiOutputText(payload);
    if (!outputText) throw new Error("Gemini 응답에 텍스트가 없습니다.");
    return JSON.parse(outputText) as { subject: string | null; body: string; toneReason: string };
  }
}

export function createReminderDraftProviderFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ReminderDraftProvider | undefined {
  if (env.GEMINI_API_KEY || env.GOOGLE_API_KEY) {
    return new GeminiReminderDraftProvider({
      apiKey: env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY ?? "",
      model: env.GEMINI_MODEL,
    });
  }
  if (env.OPENAI_API_KEY) {
    return new OpenAIReminderDraftProvider({
      apiKey: env.OPENAI_API_KEY,
      model: env.OPENAI_MODEL,
    });
  }
  return undefined;
}

function getOpenAIOutputText(payload: OpenAIResponsesPayload): string | null {
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && content.text) return content.text;
    }
  }
  return null;
}

function getGeminiOutputText(payload: GeminiPayload): string | null {
  for (const candidate of payload.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      if (part.text) return part.text;
    }
  }
  return null;
}
