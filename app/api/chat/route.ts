/**
 * Chat assistant endpoint.
 *
 * Transport only. Authorization, request validation, and response shaping live here; all
 * model and query behaviour lives in lib/chat-agent.ts and lib/chat-tools.ts. Keeping the
 * split means a streaming variant would change this file without touching the tool layer.
 *
 * The proxy matcher in proxy.ts already covers this path, but the session is re-checked
 * in-band so the handler is not protected by routing configuration alone.
 */

import { requireDashboardSession } from "@/app/dashboard/actions";
import { runChatTurn } from "@/lib/chat-agent";
import type { ChatMessage } from "@/lib/types";

/** Characters accepted in one message. Generous for a question, far below the context window. */
const MAX_MESSAGE_LENGTH = 2_000;

/**
 * Turns accepted in one request. Each turn is replayed to the model on every request, so
 * an unbounded history would grow cost and latency without bound.
 */
const MAX_HISTORY_LENGTH = 40;

const INVALID_BODY_MESSAGE = "Send a conversation with at least one message.";

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" }
  });
}

/**
 * Validates the transported conversation.
 *
 * Roles are restricted to user and assistant so a caller cannot inject a system turn to
 * override the agent's instructions, or forge a tool result.
 *
 * @param value - Parsed request body.
 * @returns The validated conversation, or null when the body is unusable.
 */
function parseConversation(value: unknown): ChatMessage[] | null {
  if (typeof value !== "object" || value === null) return null;

  const { messages } = value as { messages?: unknown };
  if (!Array.isArray(messages) || messages.length === 0) return null;
  if (messages.length > MAX_HISTORY_LENGTH) return null;

  const conversation: ChatMessage[] = [];

  for (const message of messages) {
    if (typeof message !== "object" || message === null) return null;

    const { role, content } = message as { role?: unknown; content?: unknown };
    if (role !== "user" && role !== "assistant") return null;
    if (typeof content !== "string") return null;

    const trimmed = content.trim();
    if (trimmed.length === 0 || trimmed.length > MAX_MESSAGE_LENGTH) return null;

    conversation.push({ role, content: trimmed });
  }

  // A turn can only be answered when the newest message is a question.
  if (conversation[conversation.length - 1].role !== "user") return null;

  return conversation;
}

export async function POST(request: Request): Promise<Response> {
  const session = await requireDashboardSession();
  if (!session.ok) {
    return jsonResponse({ ok: false, message: session.message }, 401);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, message: INVALID_BODY_MESSAGE }, 400);
  }

  const conversation = parseConversation(body);
  if (!conversation) {
    return jsonResponse({ ok: false, message: INVALID_BODY_MESSAGE }, 400);
  }

  const turn = await runChatTurn(conversation);
  if (!turn.ok) {
    // A rejected turn is a handled outcome with a user-safe message, not a server fault,
    // so it is reported as such rather than as a 500.
    return jsonResponse({ ok: false, message: turn.message }, 200);
  }

  return jsonResponse(
    { ok: true, reply: turn.data.reply, toolCalls: turn.data.toolCalls },
    200
  );
}
