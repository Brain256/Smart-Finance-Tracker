"use client";

import { AlertCircle, MessagesSquare, Send, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { ChatMessage, ChatToolInvocation } from "@/lib/types";

/** Mirrors MAX_MESSAGE_LENGTH in app/api/chat/route.ts so the limit is visible before submit. */
const MAX_QUESTION_LENGTH = 2_000;

const SUGGESTIONS = [
  "How much did I spend last month?",
  "What did I spend the most on this month?",
  "Which merchant did I spend the most at this year?",
  "How much did I spend on food last month compared to the month before?"
];

type ChatTurn = ChatMessage & {
  /** Present on assistant turns: the lookups that produced the answer. */
  toolCalls?: ChatToolInvocation[];
};

type ChatResponseBody = {
  ok?: boolean;
  reply?: string;
  message?: string;
  toolCalls?: ChatToolInvocation[];
};

type ChatPanelProps = {
  /** False when the dashboard is showing sample data, where answers would mislead. */
  isEnabled: boolean;
  disabledReason?: string;
};

/**
 * Renders a tool invocation as something a reader can check.
 *
 * The model occasionally restates a date incorrectly in prose even when the lookup was
 * right, so showing the period and filters actually queried makes a wrong answer
 * verifiable rather than mysterious.
 *
 * @param call - Tool invocation recorded by the agent.
 * @returns A short human-readable description of the lookup.
 */
export function describeToolCall(call: ChatToolInvocation): string {
  const args = call.arguments;
  const parts: string[] = [];

  const startDate = typeof args.startDate === "string" ? args.startDate : null;
  const endDate = typeof args.endDate === "string" ? args.endDate : null;
  if (startDate && endDate) {
    parts.push(startDate === endDate ? startDate : `${startDate} to ${endDate}`);
  }
  if (typeof args.category === "string") parts.push(args.category);
  if (typeof args.merchantQuery === "string") parts.push(`"${args.merchantQuery}"`);

  const label = call.name === "search_transactions" ? "Listed transactions" : "Totalled spending";
  const detail = parts.length > 0 ? `: ${parts.join(", ")}` : "";

  return `${label}${detail}`;
}

export function ChatPanel({ isEnabled, disabledReason }: ChatPanelProps) {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [question, setQuestion] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    // Guarded because scrollIntoView is not implemented in every DOM environment.
    const anchor = transcriptEndRef.current;
    if (typeof anchor?.scrollIntoView === "function") {
      anchor.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [turns, isPending]);

  async function ask(rawQuestion: string): Promise<void> {
    const trimmed = rawQuestion.trim();
    if (trimmed.length === 0 || isPending || !isEnabled) return;

    // The history sent to the server excludes the turn being added, then includes it, so
    // the assistant sees the same conversation the user sees.
    const history: ChatMessage[] = [
      ...turns.map(({ role, content }) => ({ role, content })),
      { role: "user", content: trimmed }
    ];

    setTurns((current) => [...current, { role: "user", content: trimmed }]);
    setQuestion("");
    setError(null);
    setIsPending(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: history })
      });
      const body = (await response.json()) as ChatResponseBody;

      if (!response.ok || body.ok !== true || typeof body.reply !== "string") {
        setError(body.message ?? "The assistant could not answer that. Please try again.");
        return;
      }

      setTurns((current) => [
        ...current,
        { role: "assistant", content: body.reply as string, toolCalls: body.toolCalls ?? [] }
      ]);
    } catch {
      setError("Could not reach the assistant. Check your connection and try again.");
    } finally {
      setIsPending(false);
      inputRef.current?.focus();
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>): void {
    // Enter sends; Shift+Enter inserts a newline, matching common chat conventions.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void ask(question);
    }
  }

  const isEmpty = turns.length === 0;

  return (
    <section aria-labelledby="assistant-heading" className="dashboard-card flex min-h-[32rem] flex-col p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2
            className="text-base font-semibold tracking-normal text-slate-950"
            id="assistant-heading"
          >
            Assistant
          </h2>
          <p className="text-sm text-[var(--muted)]">
            Ask questions about your recorded transactions
          </p>
        </div>
        <div className="flex h-9 w-9 shrink-0 items-center justify-center dashboard-icon-tile">
          <MessagesSquare aria-hidden="true" className="h-4 w-4" />
        </div>
      </div>

      {!isEnabled ? (
        <p className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--panel-soft)] px-4 py-6 text-sm text-[var(--muted)]">
          {disabledReason ?? "The assistant is unavailable."}
        </p>
      ) : (
        <>
          <div
            aria-label="Conversation"
            aria-live="polite"
            className="flex-1 space-y-4 overflow-y-auto"
            role="log"
          >
            {isEmpty ? (
              <div className="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--panel-soft)] px-4 py-6">
                <ul aria-label="Example questions" className="mt-4 flex flex-wrap gap-2">
                  {SUGGESTIONS.map((suggestion) => (
                    <li key={suggestion}>
                      <button
                        className="focus-ring rounded-full border border-[var(--border)] bg-[var(--panel)] px-3 py-1.5 text-xs font-semibold text-[var(--foreground)] transition hover:bg-[var(--panel-soft)] motion-reduce:transition-none"
                        onClick={() => void ask(suggestion)}
                        type="button"
                      >
                        {suggestion}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {turns.map((turn, index) => (
              <div
                className="dashboard-chat-turn motion-reduce:animate-none"
                key={`${turn.role}-${index}`}
              >
                {turn.role === "user" ? (
                  <div className="flex justify-end">
                    <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-[var(--primary)] px-4 py-2.5 text-sm font-medium text-white">
                      {turn.content}
                    </p>
                  </div>
                ) : (
                  <div className="flex max-w-[92%] gap-3">
                    <span
                      aria-hidden="true"
                      className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--panel-soft)]"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0">
                      <p className="whitespace-pre-wrap rounded-2xl bg-[var(--panel-soft)] px-4 py-2.5 text-sm text-slate-950">
                        {turn.content}
                      </p>
                      {turn.toolCalls && turn.toolCalls.length > 0 ? (
                        <ul
                          aria-label="Lookups used for this answer"
                          className="mt-1.5 space-y-0.5 pl-1"
                        >
                          {turn.toolCalls.map((call, callIndex) => (
                            <li
                              className="text-xs text-[var(--muted)]"
                              key={`${call.name}-${callIndex}`}
                            >
                              {describeToolCall(call)}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  </div>
                )}
              </div>
            ))}

            {isPending ? (
              <p className="flex items-center gap-2 text-sm text-[var(--muted)]" role="status">
                <span aria-hidden="true" className="dashboard-chat-pulse motion-reduce:animate-none">
                  <Sparkles className="h-3.5 w-3.5" />
                </span>
                Looking through your transactions…
              </p>
            ) : null}

            <div ref={transcriptEndRef} />
          </div>

          {error ? (
            <p
              className="mt-3 flex items-start gap-2 rounded-2xl border border-[var(--border)] bg-[var(--panel-soft)] px-4 py-3 text-sm text-slate-950"
              role="alert"
            >
              <AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </p>
          ) : null}

          <form
            className="mt-4 flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void ask(question);
            }}
          >
            <label className="sr-only" htmlFor="assistant-question">
              Ask a question about your transactions
            </label>
            <textarea
              className="focus-ring min-h-[2.75rem] w-full flex-1 resize-none rounded-2xl border border-[var(--border)] bg-[var(--panel)] px-4 py-2.5 text-sm text-slate-950 placeholder:text-[var(--muted)]"
              disabled={isPending}
              id="assistant-question"
              maxLength={MAX_QUESTION_LENGTH}
              onChange={(event) => setQuestion(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="How much did I spend on food last month?"
              ref={inputRef}
              rows={1}
              value={question}
            />
            <button
              aria-label="Send question"
              className="focus-ring inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--primary)] text-white transition hover:opacity-90 disabled:opacity-50 motion-reduce:transition-none"
              disabled={isPending || question.trim().length === 0}
              type="submit"
            >
              <Send aria-hidden="true" className="h-4 w-4" />
            </button>
          </form>
        </>
      )}
    </section>
  );
}
