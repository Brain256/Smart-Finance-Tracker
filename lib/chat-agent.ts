/**
 * Chat assistant agent loop.
 *
 * Owns the conversation with the model: builds the system prompt, offers the tool
 * schemas, dispatches whatever tools the model asks for, and feeds the results back
 * until the model produces prose.
 *
 * Deliberately transport-agnostic. `runChatTurn` takes plain messages and returns a
 * plain result, with no knowledge of HTTP, React, or response encoding. That keeps the
 * tool layer reusable if a streaming variant is added later: a `streamChatTurn` export
 * would share the same registry and validators, and only the route handler and the panel
 * would change.
 */

import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool
} from "openai/resources/chat/completions";

import { dispatchToolCall, TOOL_SCHEMAS } from "@/lib/chat-tools";
import { getFinanceConfig } from "@/lib/finance-config";
import { getFinanceDateKey } from "@/lib/finance-dates";
import { expenseCategories, type ChatMessage, type ChatToolInvocation, type ChatTurnResult } from "@/lib/types";

/** Groq exposes an OpenAI-compatible surface, so the official client works unchanged. */
export const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

/**
 * Production-tier Groq model with stronger multi-step tool selection than the 20B used
 * for notification extraction. Kept in configuration rather than hardcoded because Groq
 * rotates models on roughly a quarterly cadence.
 */
export const DEFAULT_CHAT_MODEL = "openai/gpt-oss-120b";

/**
 * Maximum model round trips that may request tools before the turn is abandoned.
 *
 * Four allows a genuinely multi-step question — two lookups plus a correction after a
 * validation failure — while bounding the cost of a model that never stops calling tools.
 */
export const MAX_TOOL_STEPS = 4;

/**
 * Reasoning budget for the gpt-oss family.
 *
 * These are reasoning models: they emit internal reasoning tokens before answering, and
 * that dominates latency. Measured against live data, the default effort produced 2s
 * responses for simple totals but over 20s for multi-lookup questions. The work here is
 * picking a tool and restating a number the tool already computed, which does not need a
 * long reasoning chain, so the budget is held low deliberately.
 */
export const CHAT_REASONING_EFFORT = "low";

const MISSING_API_KEY_MESSAGE =
  "The assistant is not configured. Set GROQ_API_KEY to enable it.";

const PROVIDER_FAILURE_MESSAGE =
  "The assistant is unavailable right now. Please try again.";

const STEP_LIMIT_MESSAGE =
  "That question needed more lookups than the assistant allows in one turn. Try asking about a narrower period or one thing at a time.";

const EMPTY_REPLY_MESSAGE =
  "The assistant could not produce an answer for that question. Try rephrasing it.";

/**
 * Builds the system prompt.
 *
 * The model has no clock, so today's finance-local date is stated explicitly; every tool
 * takes absolute dates and the model is responsible for resolving "last month" itself.
 * The schema conventions are stated because they are not inferable from the tool
 * signatures: amounts are positive dollars, and income is a category rather than a sign.
 *
 * @param todayDateKey - Today's date in the finance timezone, as YYYY-MM-DD.
 * @param timeZone - Configured IANA finance timezone.
 * @returns The system prompt text.
 */
export function buildSystemPrompt(todayDateKey: string, timeZone: string): string {
  return [
    "You are a personal finance assistant for a single-user expense tracker.",
    "You answer questions about the user's own recorded transactions by calling the provided read-only tools.",
    "",
    "Context:",
    `- Today's date is ${todayDateKey} in the user's finance timezone (${timeZone}).`,
    "- All dates you send to tools, and all dates you report, are in that timezone.",
    `- Transaction categories are: ${expenseCategories.join(", ")}.`,
    "- Amounts are always positive dollar values. Income is identified by the Income category, never by a negative amount.",
    "- Data comes from payment notifications, so it covers only what the tracker captured. It is not a complete bank statement.",
    "",
    "Rules:",
    "- Never state a number that did not come from a tool result. If you have not called a tool, call one.",
    "- Never add up transaction amounts yourself. Use aggregate_spending, which totals every matching row rather than only the rows a listing shows.",
    "- Resolve relative periods such as \"last month\" or \"this week\" into absolute YYYY-MM-DD dates yourself, using today's date above. Weeks start on Monday.",
    "- When a question needs more than one lookup, request them together in a single step rather than one at a time.",
    "- When comparing periods, use identical category and merchant filters for both, and state both totals in your answer, not only the difference.",
    "- If a tool reports that results were truncated, say so rather than implying the list is complete.",
    "- If a tool returns an error, explain the problem in plain language and, when the fix is obvious, retry once with corrected arguments.",
    "- If a question cannot be answered with these tools, say what you cannot determine instead of guessing.",
    "",
    "Style:",
    "- Answer in one or two short sentences. Lead with the number the user asked for.",
    "- Format currency as $1,234.56.",
    "- Mention the period you measured so the user can tell you interpreted the question correctly.",
    "- Write plain text only. Do not use markdown: no asterisks for emphasis, no headings, no bullet lists.",
    "- Do not describe which tools you called or mention JSON, queries, or databases."
  ].join("\n");
}

/**
 * Resolves the configured chat model.
 *
 * Read separately from GROQ_MODEL so notification classification and chat stay
 * independently tunable; changing one must not silently alter the other.
 *
 * @returns The configured model name, or the project default.
 */
export function getChatModelName(): string {
  const configured = process.env.CHAT_GROQ_MODEL?.trim();
  return configured ? configured : DEFAULT_CHAT_MODEL;
}

/**
 * Builds the Groq-backed client.
 *
 * The missing-key case is checked by the caller rather than here, so a construction
 * failure for any other reason is not misreported as a configuration problem. The client
 * is intentionally not permitted to run in a browser-like environment: it holds the API
 * key, so it must stay server-side.
 *
 * @param apiKey - Verified non-empty API key.
 * @returns An OpenAI client pointed at Groq's compatible endpoint.
 * @throws Error when the client cannot be constructed.
 */
function buildClient(apiKey: string): OpenAI {
  return new OpenAI({
    apiKey,
    baseURL: GROQ_BASE_URL,
    // Groq's free tier is capped at 8,000 tokens per minute, and each step of a turn
    // spends roughly 2,000 on the system prompt, tool schemas, and history. Two closely
    // spaced questions can therefore hit a 429 that clears in well under a second, so the
    // client is allowed to honour the provider's retry-after rather than failing the turn.
    maxRetries: 3
  });
}

/**
 * Describes a provider failure without reproducing its message.
 *
 * Provider error text can embed the API key — Groq's 401 response quotes it back — so only
 * the error type and HTTP status are logged.
 *
 * @param error - Thrown value from the provider call.
 * @returns A short, safe description for server logs.
 */
function describeProviderError(error: unknown): string {
  if (typeof error !== "object" || error === null) return "unknown error";

  const name = error instanceof Error ? error.name : "unknown";
  const status = "status" in error ? String((error as { status: unknown }).status) : "none";

  return `${name} (status ${status})`;
}

function failure(message: string): ChatTurnResult {
  return { ok: false, message };
}

/**
 * Converts the transported conversation into provider message parameters.
 *
 * Only user and assistant turns cross the transport, so tool and system turns from an
 * earlier request can never be replayed as if the model had produced them.
 *
 * @param messages - Conversation history from the client.
 * @param systemPrompt - System prompt to prepend.
 * @returns Provider-shaped message parameters.
 */
function toProviderMessages(
  messages: readonly ChatMessage[],
  systemPrompt: string
): ChatCompletionMessageParam[] {
  return [
    { role: "system", content: systemPrompt },
    ...messages.map((message) =>
      message.role === "user"
        ? ({ role: "user", content: message.content } as const)
        : ({ role: "assistant", content: message.content } as const)
    )
  ];
}

/**
 * Runs one assistant turn, resolving any tool calls the model requests.
 *
 * The loop exists because the model may request tools across several steps rather than
 * batching them: it can ask for one lookup, read the result, then ask for another. Each
 * requested call is dispatched and its result appended before the model is asked again,
 * and every call is answered so the provider never sees an unmatched tool_call_id.
 *
 * Tool failures are returned to the model as content rather than aborting the turn, so a
 * rejected argument becomes something the model can correct on the next step.
 *
 * @param messages - Conversation history, oldest first. Only user and assistant roles.
 * @returns The assistant reply plus a record of the tools invoked, or a user-safe message.
 */
export async function runChatTurn(
  messages: readonly ChatMessage[]
): Promise<ChatTurnResult> {
  if (messages.length === 0) {
    return failure("Ask a question to get started.");
  }

  let financeTimezone: string;
  try {
    financeTimezone = getFinanceConfig().financeTimezone;
  } catch {
    return failure(
      "The assistant is unavailable because the finance configuration is incomplete."
    );
  }

  const apiKey = process.env.GROQ_API_KEY?.trim();
  if (!apiKey) {
    return failure(MISSING_API_KEY_MESSAGE);
  }

  let client: OpenAI;
  try {
    client = buildClient(apiKey);
  } catch {
    // A key is present, so this is an environment problem rather than a missing setting.
    return failure(PROVIDER_FAILURE_MESSAGE);
  }

  const todayDateKey = getFinanceDateKey(new Date(), financeTimezone);
  const conversation = toProviderMessages(
    messages,
    buildSystemPrompt(todayDateKey, financeTimezone)
  );
  const toolCalls: ChatToolInvocation[] = [];
  const tools = TOOL_SCHEMAS as unknown as ChatCompletionTool[];

  for (let step = 0; step < MAX_TOOL_STEPS; step += 1) {
    let completion;
    try {
      completion = await client.chat.completions.create({
        model: getChatModelName(),
        messages: conversation,
        tools,
        temperature: 0,
        reasoning_effort: CHAT_REASONING_EFFORT
      });
    } catch (error) {
      console.error(`[chat-agent] provider request failed: ${describeProviderError(error)}`);
      return failure(PROVIDER_FAILURE_MESSAGE);
    }

    const choice = completion.choices?.[0]?.message;
    if (!choice) {
      return failure(PROVIDER_FAILURE_MESSAGE);
    }

    const requestedCalls = choice.tool_calls ?? [];

    if (requestedCalls.length === 0) {
      const reply = choice.content?.trim();
      return reply
        ? { ok: true, data: { reply, toolCalls } }
        : failure(EMPTY_REPLY_MESSAGE);
    }

    // Echoed verbatim: the provider requires the assistant turn that requested the tools
    // to precede their results.
    conversation.push(choice);

    const dispatched = await Promise.all(
      requestedCalls.map(async (call) => {
        const requestedName = "function" in call ? call.function.name : "";
        const rawArguments = "function" in call ? call.function.arguments : "";
        const dispatch = await dispatchToolCall(requestedName, rawArguments ?? "");

        return { id: call.id, dispatch };
      })
    );

    for (const { id, dispatch } of dispatched) {
      toolCalls.push({
        name: dispatch.requestedName,
        arguments: dispatch.arguments,
        ok: dispatch.result.ok
      });

      conversation.push({
        role: "tool",
        tool_call_id: id,
        content: JSON.stringify(
          dispatch.result.ok
            ? dispatch.result.data
            : { error: dispatch.result.message }
        )
      });
    }
  }

  return failure(STEP_LIMIT_MESSAGE);
}
