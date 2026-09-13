import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  constructOpenAI: vi.fn(),
  dispatchToolCall: vi.fn()
}));

vi.mock("openai", () => ({
  default: class FakeOpenAI {
    chat = { completions: { create: mocks.create } };

    constructor(options: unknown) {
      mocks.constructOpenAI(options);
    }
  }
}));

vi.mock("@/lib/chat-tools", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chat-tools")>();
  return { ...actual, dispatchToolCall: mocks.dispatchToolCall };
});

import {
  buildSystemPrompt,
  DEFAULT_CHAT_MODEL,
  getChatModelName,
  GROQ_BASE_URL,
  MAX_TOOL_STEPS,
  runChatTurn
} from "./chat-agent";
import type { ChatMessage } from "./types";

const TIME_ZONE = "America/Toronto";
const QUESTION: ChatMessage[] = [{ role: "user", content: "How much did I spend on food last month?" }];

/** Assistant turn requesting one or more tools, shaped like a provider response. */
function toolCallResponse(
  calls: { id: string; name: string; args: string }[]
) {
  return {
    choices: [
      {
        message: {
          role: "assistant",
          content: null,
          tool_calls: calls.map((call) => ({
            id: call.id,
            type: "function",
            function: { name: call.name, arguments: call.args }
          }))
        }
      }
    ]
  };
}

/** Assistant turn producing prose, which ends the loop. */
function textResponse(content: string | null) {
  return { choices: [{ message: { role: "assistant", content } }] };
}

function okDispatch(requestedName: string, args: Record<string, unknown>, data: unknown) {
  return { requestedName, arguments: args, result: { ok: true, data } };
}

function failedDispatch(requestedName: string, message: string) {
  return { requestedName, arguments: {}, result: { ok: false, message } };
}

/** Messages the agent sent to the provider on a given call, 1-indexed. */
function sentMessages(callIndex: number) {
  return mocks.create.mock.calls[callIndex - 1][0].messages;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("FINANCE_TIMEZONE", TIME_ZONE);
  vi.stubEnv("GROQ_API_KEY", "test-key");
  vi.stubEnv("CHAT_GROQ_MODEL", "");
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-06-17T16:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("buildSystemPrompt", () => {
  it("states today's date and timezone, since the model has no clock", () => {
    const prompt = buildSystemPrompt("2026-06-17", TIME_ZONE);

    expect(prompt).toContain("2026-06-17");
    expect(prompt).toContain("America/Toronto");
  });

  it("states the conventions that are not inferable from the tool signatures", () => {
    const prompt = buildSystemPrompt("2026-06-17", TIME_ZONE);

    expect(prompt).toContain("positive dollar values");
    expect(prompt).toContain("Income category");
    expect(prompt).toContain("Never add up transaction amounts yourself");
    expect(prompt).toContain("Never state a number that did not come from a tool result");
  });

  it("lists every category the schema allows", () => {
    const prompt = buildSystemPrompt("2026-06-17", TIME_ZONE);

    for (const category of ["Food", "Transport", "Entertainment", "Bills", "Shopping", "Income", "Miscellaneous"]) {
      expect(prompt).toContain(category);
    }
  });

  it("instructs batching and symmetric comparison filters", () => {
    const prompt = buildSystemPrompt("2026-06-17", TIME_ZONE);

    expect(prompt).toContain("request them together in a single step");
    expect(prompt).toContain("state both totals");
  });

  it("forbids markdown, since the panel renders replies as plain text", () => {
    const prompt = buildSystemPrompt("2026-06-17", TIME_ZONE);

    expect(prompt).toContain("Write plain text only");
  });
});

describe("getChatModelName", () => {
  it("falls back to the production default when unset", () => {
    vi.stubEnv("CHAT_GROQ_MODEL", "");

    expect(getChatModelName()).toBe(DEFAULT_CHAT_MODEL);
    expect(DEFAULT_CHAT_MODEL).toBe("openai/gpt-oss-120b");
  });

  it("honours an override", () => {
    vi.stubEnv("CHAT_GROQ_MODEL", "openai/gpt-oss-20b");

    expect(getChatModelName()).toBe("openai/gpt-oss-20b");
  });

  it("treats a whitespace-only override as unset", () => {
    vi.stubEnv("CHAT_GROQ_MODEL", "   ");

    expect(getChatModelName()).toBe(DEFAULT_CHAT_MODEL);
  });
});

describe("runChatTurn configuration", () => {
  it("returns a configuration message when the API key is absent", async () => {
    vi.stubEnv("GROQ_API_KEY", "");

    await expect(runChatTurn(QUESTION)).resolves.toEqual({
      ok: false,
      message: "The assistant is not configured. Set GROQ_API_KEY to enable it."
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("returns a configuration message when the finance timezone is invalid", async () => {
    vi.stubEnv("FINANCE_TIMEZONE", "Not/AZone");

    const result = await runChatTurn(QUESTION);

    expect(result.ok).toBe(false);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("rejects an empty conversation without calling the provider", async () => {
    await expect(runChatTurn([])).resolves.toMatchObject({ ok: false });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("points the client at Groq's OpenAI-compatible endpoint and allows retries", async () => {
    mocks.create.mockResolvedValue(textResponse("You spent $342.18."));

    await runChatTurn(QUESTION);

    // Retries matter because the free tier's 8,000 TPM cap produces 429s that clear in
    // well under a second.
    expect(mocks.constructOpenAI).toHaveBeenCalledWith({
      apiKey: "test-key",
      baseURL: GROQ_BASE_URL,
      maxRetries: 3
    });
  });

  it("requests a low reasoning budget, which dominates latency on these models", async () => {
    mocks.create.mockResolvedValue(textResponse("Answer."));

    await runChatTurn(QUESTION);

    expect(mocks.create.mock.calls[0][0].reasoning_effort).toBe("low");
  });
});

describe("runChatTurn without tools", () => {
  it("returns prose directly when the model calls no tools", async () => {
    mocks.create.mockResolvedValue(textResponse("  You spent $342.18 on Food.  "));

    await expect(runChatTurn(QUESTION)).resolves.toEqual({
      ok: true,
      data: { reply: "You spent $342.18 on Food.", toolCalls: [] }
    });
    expect(mocks.create).toHaveBeenCalledTimes(1);
  });

  it("sends the system prompt first, then the conversation, with tools and temperature 0", async () => {
    mocks.create.mockResolvedValue(textResponse("Answer."));

    await runChatTurn([
      { role: "user", content: "First question" },
      { role: "assistant", content: "First answer" },
      { role: "user", content: "Second question" }
    ]);

    const request = mocks.create.mock.calls[0][0];

    expect(request.temperature).toBe(0);
    expect(request.model).toBe(DEFAULT_CHAT_MODEL);
    expect(request.tools.map((tool: { function: { name: string } }) => tool.function.name)).toEqual([
      "search_transactions",
      "aggregate_spending"
    ]);
    expect(request.messages).toEqual([
      { role: "system", content: expect.stringContaining("2026-06-17") },
      { role: "user", content: "First question" },
      { role: "assistant", content: "First answer" },
      { role: "user", content: "Second question" }
    ]);
  });

  it("injects today's finance-local date, not the UTC date", async () => {
    // 03:00Z on 18 June is still 23:00 on 17 June in Toronto.
    vi.setSystemTime(new Date("2026-06-18T03:00:00.000Z"));
    mocks.create.mockResolvedValue(textResponse("Answer."));

    await runChatTurn(QUESTION);

    expect(sentMessages(1)[0].content).toContain("2026-06-17");
  });

  it("returns a safe message when the model produces empty content", async () => {
    mocks.create.mockResolvedValue(textResponse("   "));

    await expect(runChatTurn(QUESTION)).resolves.toMatchObject({ ok: false });
  });
});

describe("runChatTurn tool loop", () => {
  it("dispatches a single tool call and returns the follow-up prose", async () => {
    mocks.create
      .mockResolvedValueOnce(
        toolCallResponse([
          {
            id: "call_1",
            name: "aggregate_spending",
            args: '{"startDate":"2026-05-01","endDate":"2026-05-31","category":"Food"}'
          }
        ])
      )
      .mockResolvedValueOnce(textResponse("You spent $342.18 on Food in May."));
    mocks.dispatchToolCall.mockResolvedValue(
      okDispatch(
        "aggregate_spending",
        { startDate: "2026-05-01", endDate: "2026-05-31", category: "Food" },
        { total: 342.18, transactionCount: 27 }
      )
    );

    await expect(runChatTurn(QUESTION)).resolves.toEqual({
      ok: true,
      data: {
        reply: "You spent $342.18 on Food in May.",
        toolCalls: [
          {
            name: "aggregate_spending",
            arguments: { startDate: "2026-05-01", endDate: "2026-05-31", category: "Food" },
            ok: true
          }
        ]
      }
    });

    expect(mocks.dispatchToolCall).toHaveBeenCalledWith(
      "aggregate_spending",
      '{"startDate":"2026-05-01","endDate":"2026-05-31","category":"Food"}'
    );
    expect(mocks.create).toHaveBeenCalledTimes(2);
  });

  it("appends the requesting assistant turn before the tool result", async () => {
    mocks.create
      .mockResolvedValueOnce(
        toolCallResponse([{ id: "call_1", name: "aggregate_spending", args: "{}" }])
      )
      .mockResolvedValueOnce(textResponse("Answer."));
    mocks.dispatchToolCall.mockResolvedValue(okDispatch("aggregate_spending", {}, { total: 0 }));

    await runChatTurn(QUESTION);

    const second = sentMessages(2);

    // The provider rejects a tool result that is not preceded by the assistant turn
    // which requested it.
    expect(second[second.length - 2]).toMatchObject({ role: "assistant" });
    expect(second[second.length - 1]).toMatchObject({
      role: "tool",
      tool_call_id: "call_1",
      content: JSON.stringify({ total: 0 })
    });
  });

  it("answers every call in a batched request with a matching tool_call_id", async () => {
    mocks.create
      .mockResolvedValueOnce(
        toolCallResponse([
          { id: "call_may", name: "aggregate_spending", args: '{"startDate":"2026-05-01","endDate":"2026-05-31"}' },
          { id: "call_apr", name: "aggregate_spending", args: '{"startDate":"2026-04-01","endDate":"2026-04-30"}' }
        ])
      )
      .mockResolvedValueOnce(textResponse("May was $342.18 and April was $289.50."));
    mocks.dispatchToolCall
      .mockResolvedValueOnce(okDispatch("aggregate_spending", { startDate: "2026-05-01" }, { total: 342.18 }))
      .mockResolvedValueOnce(okDispatch("aggregate_spending", { startDate: "2026-04-01" }, { total: 289.5 }));

    const result = await runChatTurn(QUESTION);

    expect(result.ok === true && result.data.toolCalls).toHaveLength(2);
    expect(mocks.create).toHaveBeenCalledTimes(2);

    const toolTurns = sentMessages(2).filter(
      (message: { role: string }) => message.role === "tool"
    );

    expect(toolTurns.map((turn: { tool_call_id: string }) => turn.tool_call_id)).toEqual([
      "call_may",
      "call_apr"
    ]);
  });

  it("handles sequential tool calls across separate steps", async () => {
    mocks.create
      .mockResolvedValueOnce(
        toolCallResponse([{ id: "call_1", name: "aggregate_spending", args: '{"startDate":"2026-05-01","endDate":"2026-05-31"}' }])
      )
      .mockResolvedValueOnce(
        toolCallResponse([{ id: "call_2", name: "aggregate_spending", args: '{"startDate":"2026-04-01","endDate":"2026-04-30"}' }])
      )
      .mockResolvedValueOnce(textResponse("May was higher than April."));
    mocks.dispatchToolCall
      .mockResolvedValueOnce(okDispatch("aggregate_spending", { startDate: "2026-05-01" }, { total: 342.18 }))
      .mockResolvedValueOnce(okDispatch("aggregate_spending", { startDate: "2026-04-01" }, { total: 289.5 }));

    const result = await runChatTurn(QUESTION);

    // Batching is a model behaviour, not a guarantee, so the unbatched path must work too.
    expect(result).toMatchObject({ ok: true, data: { reply: "May was higher than April." } });
    expect(result.ok === true && result.data.toolCalls).toHaveLength(2);
    expect(mocks.create).toHaveBeenCalledTimes(3);
  });

  it("returns a tool failure to the model as content rather than aborting the turn", async () => {
    mocks.create
      .mockResolvedValueOnce(
        toolCallResponse([{ id: "call_1", name: "aggregate_spending", args: '{"startDate":"last month"}' }])
      )
      .mockResolvedValueOnce(
        toolCallResponse([{ id: "call_2", name: "aggregate_spending", args: '{"startDate":"2026-05-01","endDate":"2026-05-31"}' }])
      )
      .mockResolvedValueOnce(textResponse("You spent $342.18 in May."));
    mocks.dispatchToolCall
      .mockResolvedValueOnce(failedDispatch("aggregate_spending", "Provide both dates in YYYY-MM-DD format."))
      .mockResolvedValueOnce(okDispatch("aggregate_spending", { startDate: "2026-05-01" }, { total: 342.18 }));

    const result = await runChatTurn(QUESTION);

    expect(result).toMatchObject({ ok: true, data: { reply: "You spent $342.18 in May." } });

    // The validation message is handed back so the model can correct itself.
    const firstToolTurn = sentMessages(2).find(
      (message: { role: string }) => message.role === "tool"
    );
    expect(firstToolTurn.content).toBe(
      JSON.stringify({ error: "Provide both dates in YYYY-MM-DD format." })
    );

    // Both attempts are recorded, with the failure marked.
    expect(result.ok === true && result.data.toolCalls.map((call) => call.ok)).toEqual([
      false,
      true
    ]);
  });

  it("records an invented tool name in the diagnostics", async () => {
    mocks.create
      .mockResolvedValueOnce(toolCallResponse([{ id: "call_1", name: "drop_table", args: "{}" }]))
      .mockResolvedValueOnce(textResponse("I cannot do that."));
    mocks.dispatchToolCall.mockResolvedValue(failedDispatch("drop_table", "Unknown tool."));

    const result = await runChatTurn(QUESTION);

    expect(result.ok === true && result.data.toolCalls[0]).toEqual({
      name: "drop_table",
      arguments: {},
      ok: false
    });
  });

  it(`gives up after ${MAX_TOOL_STEPS} tool steps instead of looping forever`, async () => {
    mocks.create.mockResolvedValue(
      toolCallResponse([{ id: "call_x", name: "aggregate_spending", args: "{}" }])
    );
    mocks.dispatchToolCall.mockResolvedValue(okDispatch("aggregate_spending", {}, { total: 0 }));

    const result = await runChatTurn(QUESTION);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toContain("narrower period");
    expect(mocks.create).toHaveBeenCalledTimes(MAX_TOOL_STEPS);
  });
});

describe("runChatTurn provider failures", () => {
  it("returns a safe message when the provider request throws", async () => {
    mocks.create.mockRejectedValue(new Error("401 Invalid API Key provided: gsk_abc123"));

    const result = await runChatTurn(QUESTION);

    expect(result).toEqual({
      ok: false,
      message: "The assistant is unavailable right now. Please try again."
    });
    expect(result.ok === false && result.message).not.toContain("gsk_");
  });

  it("logs the provider error type without reproducing a message that may embed the key", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const rateLimit = Object.assign(new Error("401 Invalid API Key provided: gsk_secret"), {
      name: "RateLimitError",
      status: 429
    });
    mocks.create.mockRejectedValue(rateLimit);

    await runChatTurn(QUESTION);

    const line = logged.mock.calls[0][0] as string;

    expect(line).toContain("RateLimitError");
    expect(line).toContain("429");
    expect(line).not.toContain("gsk_secret");

    logged.mockRestore();
  });

  it("returns a safe message when the provider omits a message", async () => {
    mocks.create.mockResolvedValue({ choices: [] });

    await expect(runChatTurn(QUESTION)).resolves.toMatchObject({ ok: false });
  });

  it("survives a provider failure on the second step, after a tool already ran", async () => {
    mocks.create
      .mockResolvedValueOnce(
        toolCallResponse([{ id: "call_1", name: "aggregate_spending", args: "{}" }])
      )
      .mockRejectedValueOnce(new Error("503 upstream unavailable"));
    mocks.dispatchToolCall.mockResolvedValue(okDispatch("aggregate_spending", {}, { total: 0 }));

    await expect(runChatTurn(QUESTION)).resolves.toEqual({
      ok: false,
      message: "The assistant is unavailable right now. Please try again."
    });
  });
});
