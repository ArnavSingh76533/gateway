import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import Playground from "@/app/playground";
import { demoModels, demoProviders } from "@/lib/demo";
import { setViewport } from "./setup";

function mount(demo = false) {
  const props = {
    demo,
    providers: demoProviders,
    models: demoModels,
    requireAccount: vi.fn((fn: () => void) => {
      if (!demo) fn();
    }),
    notify: vi.fn(),
    onFinish: vi.fn().mockResolvedValue(undefined),
  };
  render(<Playground {...props} />);
  return props;
}

describe("Playground", () => {
  it.each([360, 390, 430, 768, 1024, 1280, 1440, 1920])(
    "sets the responsive settings disclosure correctly at %ipx",
    async (width) => {
      setViewport(width);
      mount();
      // Tests breakpoint-dependent React behavior, not CSS geometry or screenshots.
      const settings = screen.getByRole("button", { name: /Request settings/ });
      expect(settings).toHaveAttribute("aria-expanded", String(width >= 1024));
      expect(
        screen.getByText(/System instruction/, { selector: "summary" })
          .parentElement,
      ).not.toHaveAttribute("open");
      if (width < 1024) {
        expect(
          screen.queryByRole("combobox", { name: "Routing strategy" }),
        ).not.toBeInTheDocument();
        await userEvent.setup().click(settings);
      }
      expect(
        screen.getByRole("combobox", { name: "Routing strategy" }),
      ).toBeVisible();
    },
  );
  it("requires an account before sending any demo request", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const props = mount(true);
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Send request" }));
    expect(props.requireAccount).toHaveBeenCalledOnce();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("preserves route selection, retry budget, alternatives, and JSON responses", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "A test response" } }],
        }),
        {
          headers: {
            "X-Gateway-Provider": "Groq",
            "X-Gateway-Model": "test-model",
            "X-Gateway-Attempts": "2",
          },
        },
      ),
    );
    vi.stubGlobal("fetch", fetcher);
    const props = mount();
    const user = userEvent.setup();
    await user.selectOptions(
      screen.getByLabelText("Routing strategy"),
      "coding",
    );
    await user.selectOptions(
      screen.getByLabelText("Provider"),
      demoProviders[1].id,
    );
    await user.selectOptions(screen.getByLabelText("Retry budget"), "3");
    await user.click(screen.getByRole("switch", { name: "Stream response" }));
    await user.click(
      screen.getByRole("switch", { name: "Allow alternative models" }),
    );
    await user.click(screen.getByRole("button", { name: "Send request" }));
    expect(await screen.findByText("A test response")).toBeInTheDocument();
    const [url, request] = fetcher.mock.calls[0];
    expect(url).toBe("/api/playground");
    expect(request.headers["X-CSRF-Token"]).toBe("test-csrf-token");
    expect(JSON.parse(request.body)).toMatchObject({
      model: "auto/coding",
      provider: demoProviders[1].id,
      routing: "coding",
      stream: false,
      max_retries: 3,
      allow_alternatives: true,
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "Groq · test-model · 2 attempt(s)",
    );
    expect(props.onFinish).toHaveBeenCalledOnce();
  });
  it("joins fragmented SSE output and tool calls without dropping tokens", async () => {
    const bytes = new TextEncoder().encode(
      'data: {"choices":[{"delta":{"content":"Hello 🌙"}}]}\n\ndata: {"choices":[{"delta":{"tool_calls":[{"id":"call_1","function":{"name":"lookup"}}]}}]}\n\ndata: [DONE]\n\n',
    );
    const body = new ReadableStream({
      start(controller) {
        // Split inside every multibyte UTF-8 character and SSE line.
        for (let i = 0; i < bytes.length; i += 3)
          controller.enqueue(bytes.slice(i, i + 3));
        controller.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));
    mount();
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Send request" }));
    await waitFor(() =>
      expect(screen.getByText(/Hello 🌙/)).toHaveTextContent("lookup"),
    );
    expect(screen.getByRole("button", { name: "Copy" })).toBeEnabled();
    expect(screen.getByRole("status")).not.toHaveTextContent("null");
  });
  it("announces HTTP failures and offers a working retry", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { message: "Provider rate limit reached" } }),
          { status: 429 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          'data: {"choices":[{"delta":{"content":"Recovered"}}]}\n\ndata: [DONE]\n\n',
        ),
      );
    vi.stubGlobal("fetch", fetcher);
    mount();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Send request" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("HTTP 429");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Provider rate limit reached",
    );
    await user.click(screen.getByRole("button", { name: "Retry request" }));
    expect(await screen.findByText("Recovered")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("stops an in-flight request and disables empty submissions", async () => {
    const fetcher = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    mount();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Send request" }));
    await user.click(await screen.findByRole("button", { name: "Stop" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Request stopped",
    );
    fireEvent.change(screen.getByLabelText("Your message"), {
      target: { value: "  " },
    });
    expect(screen.getByRole("button", { name: "Send request" })).toBeDisabled();
    fireEvent.keyDown(screen.getByLabelText("Your message"), {
      key: "Enter",
      ctrlKey: true,
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
