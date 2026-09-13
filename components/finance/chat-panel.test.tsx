import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatPanel, describeToolCall } from "./chat-panel";

const originalFetch = global.fetch;

function mockFetchOnce(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body
  });
  global.fetch = fetchMock as unknown as typeof fetch;

  return fetchMock;
}

function answer(reply: string, toolCalls: unknown[] = []) {
  return { ok: true, reply, toolCalls };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe("describeToolCall", () => {
  it("describes a totalling lookup with its period and filters", () => {
    expect(
      describeToolCall({
        name: "aggregate_spending",
        arguments: {
          startDate: "2026-05-01",
          endDate: "2026-05-31",
          category: "Food",
          merchantQuery: "tim hortons"
        },
        ok: true
      })
    ).toBe('Totalled spending: 2026-05-01 to 2026-05-31, Food, "tim hortons"');
  });

  it("describes a listing lookup", () => {
    expect(
      describeToolCall({
        name: "search_transactions",
        arguments: { startDate: "2026-05-01", endDate: "2026-05-31" },
        ok: true
      })
    ).toBe("Listed transactions: 2026-05-01 to 2026-05-31");
  });

  it("collapses a single-day range", () => {
    expect(
      describeToolCall({
        name: "aggregate_spending",
        arguments: { startDate: "2026-05-01", endDate: "2026-05-01" },
        ok: true
      })
    ).toBe("Totalled spending: 2026-05-01");
  });

  it("tolerates absent or non-string arguments", () => {
    expect(
      describeToolCall({
        name: "aggregate_spending",
        arguments: { startDate: null, category: 42 },
        ok: false
      })
    ).toBe("Totalled spending");
  });
});

describe("ChatPanel disabled", () => {
  it("shows the reason and no input when disabled", () => {
    render(
      <ChatPanel
        disabledReason="The assistant is unavailable while the dashboard is showing sample data."
        isEnabled={false}
      />
    );

    expect(
      screen.getByText(/unavailable while the dashboard is showing sample data/i)
    ).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /send question/i })).not.toBeInTheDocument();
  });
});

describe("ChatPanel accessibility", () => {
  it("exposes a polite live region, a labelled input, and a labelled send control", () => {
    render(<ChatPanel isEnabled />);

    const log = screen.getByRole("log", { name: /conversation/i });

    expect(log).toHaveAttribute("aria-live", "polite");
    expect(screen.getByLabelText(/ask a question about your transactions/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send question/i })).toBeInTheDocument();
  });

  it("states the data caveat before any question is asked", () => {
    render(<ChatPanel isEnabled />);

    expect(screen.getByText(/not a complete bank statement/i)).toBeInTheDocument();
  });

  it("disables send while the field is empty", () => {
    render(<ChatPanel isEnabled />);

    expect(screen.getByRole("button", { name: /send question/i })).toBeDisabled();
  });
});

describe("ChatPanel conversation", () => {
  it("renders the question, then the reply, and posts the conversation", async () => {
    const fetchMock = mockFetchOnce(answer("You spent $342.18 on Food in May."));
    const user = userEvent.setup();
    render(<ChatPanel isEnabled />);

    await user.type(
      screen.getByLabelText(/ask a question/i),
      "How much did I spend on food last month?"
    );
    await user.click(screen.getByRole("button", { name: /send question/i }));

    expect(
      await screen.findByText("How much did I spend on food last month?")
    ).toBeInTheDocument();
    expect(await screen.findByText("You spent $342.18 on Food in May.")).toBeInTheDocument();

    const [url, request] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/chat");
    expect(JSON.parse(request.body)).toEqual({
      messages: [{ role: "user", content: "How much did I spend on food last month?" }]
    });
  });

  it("clears the input after a successful send", async () => {
    mockFetchOnce(answer("Answer."));
    const user = userEvent.setup();
    render(<ChatPanel isEnabled />);

    const input = screen.getByLabelText(/ask a question/i);
    await user.type(input, "A question{Enter}");

    await waitFor(() => expect(input).toHaveValue(""));
  });

  it("sends on Enter and inserts a newline on Shift+Enter", async () => {
    const fetchMock = mockFetchOnce(answer("Answer."));
    const user = userEvent.setup();
    render(<ChatPanel isEnabled />);

    const input = screen.getByLabelText(/ask a question/i);
    await user.type(input, "First line{Shift>}{Enter}{/Shift}second line");

    expect(fetchMock).not.toHaveBeenCalled();
    expect(input).toHaveValue("First line\nsecond line");

    await user.type(input, "{Enter}");

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
  });

  it("shows the lookups behind an answer so a misstated period is checkable", async () => {
    mockFetchOnce(
      answer("You spent $342.18 on Food in May.", [
        {
          name: "aggregate_spending",
          arguments: { startDate: "2026-05-01", endDate: "2026-05-31", category: "Food" },
          ok: true
        }
      ])
    );
    const user = userEvent.setup();
    render(<ChatPanel isEnabled />);

    await user.type(screen.getByLabelText(/ask a question/i), "Food last month?{Enter}");

    expect(
      await screen.findByText("Totalled spending: 2026-05-01 to 2026-05-31, Food")
    ).toBeInTheDocument();
  });

  it("sends prior turns so follow-up questions have context", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => answer("It was $87.25.") })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => answer("April was $64.10.") });
    global.fetch = fetchMock as unknown as typeof fetch;

    const user = userEvent.setup();
    render(<ChatPanel isEnabled />);

    const input = screen.getByLabelText(/ask a question/i);
    await user.type(input, "Tim Hortons last month?{Enter}");
    await screen.findByText("It was $87.25.");

    await user.type(input, "What about April?{Enter}");
    await screen.findByText("April was $64.10.");

    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({
      messages: [
        { role: "user", content: "Tim Hortons last month?" },
        { role: "assistant", content: "It was $87.25." },
        { role: "user", content: "What about April?" }
      ]
    });
  });

  it("runs a suggested question when clicked", async () => {
    const fetchMock = mockFetchOnce(answer("You spent $68.97."));
    const user = userEvent.setup();
    render(<ChatPanel isEnabled />);

    await user.click(screen.getByRole("button", { name: "How much did I spend last month?" }));

    expect(await screen.findByText("You spent $68.97.")).toBeInTheDocument();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      messages: [{ role: "user", content: "How much did I spend last month?" }]
    });
  });

  it("shows a thinking indicator and disables input while pending", async () => {
    let release: (value: unknown) => void = () => {};
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    global.fetch = vi.fn().mockReturnValue(
      pending.then(() => ({ ok: true, status: 200, json: async () => answer("Done.") }))
    ) as unknown as typeof fetch;

    const user = userEvent.setup();
    render(<ChatPanel isEnabled />);

    await user.type(screen.getByLabelText(/ask a question/i), "A question{Enter}");

    expect(await screen.findByRole("status")).toHaveTextContent(/looking through your transactions/i);
    expect(screen.getByLabelText(/ask a question/i)).toBeDisabled();

    release(null);

    expect(await screen.findByText("Done.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  });
});

describe("ChatPanel failures", () => {
  it("shows the server message as an alert and keeps the question visible", async () => {
    mockFetchOnce({
      ok: false,
      message: "The assistant is unavailable right now. Please try again."
    });
    const user = userEvent.setup();
    render(<ChatPanel isEnabled />);

    await user.type(screen.getByLabelText(/ask a question/i), "A question{Enter}");

    const alert = await screen.findByRole("alert");

    expect(alert).toHaveTextContent("The assistant is unavailable right now. Please try again.");
    // The user's turn stays on screen so the conversation is not silently lost.
    expect(screen.getByText("A question")).toBeInTheDocument();
  });

  it("reports a network failure without leaving the input disabled", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("offline")) as unknown as typeof fetch;
    const user = userEvent.setup();
    render(<ChatPanel isEnabled />);

    await user.type(screen.getByLabelText(/ask a question/i), "A question{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not reach the assistant/i);
    await waitFor(() => expect(screen.getByLabelText(/ask a question/i)).toBeEnabled());
  });

  it("falls back to a generic message when the server sends none", async () => {
    mockFetchOnce({}, { ok: false, status: 500 });
    const user = userEvent.setup();
    render(<ChatPanel isEnabled />);

    await user.type(screen.getByLabelText(/ask a question/i), "A question{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not answer that/i);
  });

  it("clears a previous error once a later question succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ ok: false, message: "Boom." }) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => answer("Recovered.") });
    global.fetch = fetchMock as unknown as typeof fetch;

    const user = userEvent.setup();
    render(<ChatPanel isEnabled />);

    const input = screen.getByLabelText(/ask a question/i);
    await user.type(input, "First{Enter}");
    await screen.findByRole("alert");

    await user.type(input, "Second{Enter}");

    expect(await screen.findByText("Recovered.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("ignores a blank submission", async () => {
    const fetchMock = mockFetchOnce(answer("Answer."));
    const user = userEvent.setup();
    render(<ChatPanel isEnabled />);

    await user.type(screen.getByLabelText(/ask a question/i), "   {Enter}");

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
