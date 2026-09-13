import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it, vi } from "vitest";
import Dashboard from "@/app/workspace";
import {
  demoKeys,
  demoLogs,
  demoModels,
  demoProviders,
  demoUsage,
} from "@/lib/demo";
import { setViewport } from "./setup";

function mockServer(authenticated = false, empty = false) {
  let signedIn = authenticated;
  const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input, window.location.origin);
    const path = url.pathname;
    const method = init?.method || "GET";
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status });
    if (path === "/api/auth/me")
      return signedIn
        ? json({ id: "u1", name: "Alex", email: "alex@example.com" })
        : json({ error: { message: "Sign in required" } }, 401);
    if (path === "/api/auth/login") {
      signedIn = true;
      return json({
        user: { id: "u1", name: "Alex", email: "alex@example.com" },
      });
    }
    if (path === "/api/auth/logout") {
      signedIn = false;
      return new Response(null, { status: 204 });
    }
    if (path === "/api/keys" && method === "POST")
      return json({ key: "gw_test-generated-once" });
    if (method !== "GET") return json({});
    if (path === "/api/providers") return json(empty ? [] : demoProviders);
    if (path === "/api/models")
      return json({
        data: empty ? [] : demoModels,
        total: empty ? 0 : demoModels.length,
      });
    if (path === "/api/keys") return json(empty ? [] : demoKeys);
    if (path === "/api/logs")
      return json({
        data: empty ? [] : demoLogs,
        total: empty ? 0 : demoLogs.length,
      });
    if (path === "/api/usage")
      return json(
        empty
          ? {
              ...demoUsage,
              series: [],
              providers: [],
              summary: {
                requests: 0,
                successes: 0,
                avg_latency_ms: null,
                input_tokens: null,
                output_tokens: null,
                estimated_cost: null,
                priced_requests: 0,
              },
            }
          : demoUsage,
      );
    throw new Error(`Unexpected test API call: ${method} ${path}`);
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
async function mounted(authenticated = false, empty = false) {
  const fetcher = mockServer(authenticated, empty);
  const rendered = render(<Dashboard />);
  await waitFor(() =>
    expect(screen.getByRole("main")).toHaveAttribute("aria-busy", "false"),
  );
  return { ...rendered, fetcher, user: userEvent.setup() };
}
async function go(view: string) {
  await act(async () => {
    window.location.hash = view;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
}
const pages = [
  ["overview", "Gateway overview"],
  ["providers", "Your providers"],
  ["models", "Model explorer"],
  ["playground", "Playground"],
  ["keys", "Gateway API keys"],
  ["requests", "Request history"],
  ["usage", "Usage & performance"],
  ["docs", "Integration guide"],
];

describe("Workspace navigation and accessibility", () => {
  it.each(pages)(
    "renders %s and passes automated DOM accessibility rules",
    async (view, heading) => {
      const { container } = await mounted();
      await go(view);
      expect(
        screen.getByRole("heading", { level: 1, name: heading }),
      ).toBeInTheDocument();
      expect(
        container.querySelector(`a.nav-link[href="#${view}"]`),
      ).toHaveAttribute("aria-current", "page");
      // JSDOM cannot measure pixels; color contrast is verified separately using tokens.
      const result = await axe.run(container, {
        rules: { "color-contrast": { enabled: false } },
      });
      expect(
        result.violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => n.target),
        })),
      ).toEqual([]);
    },
  );
  it("supports native navigation links and returning to an earlier hash", async () => {
    const { container, user } = await mounted();
    await user.click(container.querySelector('a.nav-link[href="#models"]')!);
    expect(
      await screen.findByRole("heading", { name: "Model explorer" }),
    ).toBeInTheDocument();
    await go("overview");
    expect(
      screen.getByRole("heading", { name: "Gateway overview" }),
    ).toBeInTheDocument();
    expect(document.title).toBe("Overview · Nexus AI Gateway");
  });
  it("traps mobile drawer keyboard focus and restores it on Escape", async () => {
    setViewport(390);
    const { user } = await mounted();
    const open = screen.getByRole("button", { name: "Open navigation" });
    await user.click(open);
    const drawer = screen.getByRole("dialog", { name: "Workspace navigation" });
    const close = within(drawer).getByRole("button", {
      name: "Close navigation",
    });
    expect(close).toHaveFocus();
    expect(screen.getByRole("main").parentElement).toHaveAttribute("inert");
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(
      within(drawer).getByRole("link", { name: "Documentation" }),
    ).toHaveFocus();
    await user.keyboard("{Tab}");
    expect(close).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(open).toHaveFocus();
    expect(document.body.style.overflow).toBe("");
  });
  it("filters sample models and retains the complete supported capability list", async () => {
    const { user } = await mounted();
    await go("models");
    await user.type(
      screen.getByRole("textbox", { name: "Search models" }),
      "Gemini",
    );
    const table = screen.getByRole("table");
    expect(within(table).getByText("Gemini 2.5 Flash")).toBeInTheDocument();
    expect(within(table).queryByText("Llama 3.3 70B")).not.toBeInTheDocument();
    expect(within(table).getByText("Reasoning")).toBeInTheDocument();
    await user.selectOptions(
      screen.getByLabelText("Filter capability"),
      "embeddings",
    );
    expect(screen.getByText("No matching models")).toBeInTheDocument();
  });
  it("opens request details with fallback history and filters errors", async () => {
    const { user } = await mounted();
    await go("requests");
    const request = demoLogs.find((log) => log.attempts.length > 1)!;
    const row = screen
      .getAllByRole("row")
      .find((r) => r.textContent?.includes("Fallback"))!;
    await user.click(within(row).getByRole("button"));
    const dialog = screen.getByRole("dialog", { name: "Request details" });
    expect(within(dialog).getByText(request.id)).toBeInTheDocument();
    expect(within(dialog).getByText("Routing attempts")).toBeInTheDocument();
    expect(dialog.querySelectorAll(".attempt")).toHaveLength(
      request.attempts.length,
    );
    fireEvent(dialog, new Event("cancel", { bubbles: false }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Errors only" }));
    expect(screen.getByRole("button", { name: "Errors only" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getAllByRole("row")).toHaveLength(
      demoLogs.filter((log) => log.status >= 400).length + 1,
    );
  });
});

describe("Authenticated workspace actions", () => {
  it("keeps key-creation errors inside the active dialog", async () => {
    const { user, fetcher } = await mounted(true);
    await go("keys");
    await user.click(screen.getByRole("button", { name: "Create API key" }));
    await user.type(screen.getByLabelText("Key name"), "Test agent");
    fetcher.mockRejectedValueOnce(new Error("Gateway unavailable"));
    await user.click(screen.getByRole("button", { name: "Create key" }));
    const dialog = screen.getByRole("dialog", {
      name: "Create a Gateway API key",
    });
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Gateway unavailable",
    );
    expect(
      within(dialog).getByRole("button", { name: "Create key" }),
    ).toBeEnabled();
  });

  it("keeps CSV exports on the existing authenticated routes", async () => {
    await mounted(true);
    await go("requests");
    expect(screen.getByRole("link", { name: "Export CSV" })).toHaveAttribute(
      "href",
      "/api/usage/export",
    );
    await go("usage");
    await userEvent
      .setup()
      .selectOptions(
        screen.getByRole("combobox", { name: "Date range" }),
        "90",
      );
    expect(screen.getByRole("link", { name: "Export usage" })).toHaveAttribute(
      "href",
      "/api/usage/export?days=90",
    );
  });
  it("requires sign-in before exporting demo data", async () => {
    const { user } = await mounted();
    await go("requests");
    await user.click(screen.getByRole("link", { name: "Export CSV" }));
    expect(
      screen.getByRole("dialog", { name: "Welcome back" }),
    ).toBeInTheDocument();
  });

  it("signs in from demo and signs out through existing authentication", async () => {
    const { user, fetcher } = await mounted();
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    const dialog = screen.getByRole("dialog", { name: "Welcome back" });
    await user.type(
      within(dialog).getByLabelText("Email address"),
      "alex@example.com",
    );
    await user.type(
      within(dialog).getByLabelText("Password"),
      "test-password-123",
    );
    await user.click(within(dialog).getByRole("button", { name: "Sign in" }));
    expect(
      await screen.findByRole("button", { name: "Sign out" }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(
      await screen.findByRole("button", { name: "Sign in" }),
    ).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledWith(
      "/api/auth/logout",
      expect.objectContaining({ method: "POST" }),
    );
  });
  it("preserves provider enable, discovery refresh, pin, and deletion actions", async () => {
    const { user, fetcher } = await mounted(true);
    await go("providers");
    const provider = demoProviders[0];
    await user.click(
      screen.getByRole("switch", { name: `Enable ${provider.name}` }),
    );
    await waitFor(() =>
      expect(fetcher).toHaveBeenCalledWith(
        `/api/providers/${provider.id}`,
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ enabled: false }),
        }),
      ),
    );
    await user.click(
      screen.getByRole("button", { name: `Refresh ${provider.name} models` }),
    );
    await waitFor(() =>
      expect(fetcher).toHaveBeenCalledWith(
        `/api/providers/${provider.id}/refresh`,
        expect.objectContaining({ method: "POST" }),
      ),
    );
    await user.click(screen.getByRole("button", { name: "Unpin provider" }));
    await waitFor(() =>
      expect(fetcher).toHaveBeenCalledWith(
        `/api/providers/${provider.id}`,
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ pinned: false }),
        }),
      ),
    );
    await user.click(
      screen.getByRole("button", { name: `Delete ${provider.name}` }),
    );
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Confirm",
      }),
    );
    await waitFor(() =>
      expect(fetcher).toHaveBeenCalledWith(
        `/api/providers/${provider.id}`,
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
  });
  it("creates one-time gateway keys and confirms revocation", async () => {
    const { user, fetcher } = await mounted(true);
    await go("keys");
    await user.click(screen.getByRole("button", { name: "Create API key" }));
    await user.type(screen.getByLabelText("Key name"), "Test agent");
    await user.selectOptions(screen.getByLabelText("Expiration"), "30");
    await user.click(screen.getByRole("button", { name: "Create key" }));
    const saved = await screen.findByRole("dialog", {
      name: "Save your new API key",
    });
    expect(saved).toHaveTextContent("gw_test-generated-once");
    expect(fetcher).toHaveBeenCalledWith(
      "/api/keys",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ name: "Test agent", expires_in_days: 30 }),
      }),
    );
    await user.click(
      within(saved).getByRole("button", { name: "Close dialog" }),
    );
    expect(
      screen.queryByText("gw_test-generated-once"),
    ).not.toBeInTheDocument();
    await user.click(screen.getAllByRole("button", { name: "Revoke" })[0]);
    await user.click(
      within(
        screen.getByRole("dialog", { name: "Revoke this key?" }),
      ).getByRole("button", { name: "Confirm" }),
    );
    await waitFor(() =>
      expect(fetcher).toHaveBeenCalledWith(
        `/api/keys/${demoKeys[0].id}`,
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
  });
  it("uses live model favorite actions and date-range analytics requests", async () => {
    const { user, fetcher } = await mounted(true);
    await go("models");
    await user.click(
      screen.getByRole("button", { name: `Favorite ${demoModels[0].name}` }),
    );
    await waitFor(() =>
      expect(fetcher).toHaveBeenCalledWith(
        `/api/models/${demoModels[0].id}/favorite`,
        expect.objectContaining({ method: "POST" }),
      ),
    );
    await go("usage");
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Date range" }),
      "30",
    );
    await waitFor(() =>
      expect(
        fetcher.mock.calls.some(
          ([url]) => url.startsWith("/api/usage?") && url.includes("days=30"),
        ),
      ).toBe(true),
    );
    expect(screen.getByText("Token & cost breakdown")).toBeInTheDocument();
    expect(screen.getAllByTestId("chart-container")).toHaveLength(3);
  });
  it("shows onboarding only in an empty connected workspace", async () => {
    await mounted(true, true);
    expect(screen.getByText("Your universal endpoint")).toBeInTheDocument();
    expect(screen.getByText("No requests yet")).toBeInTheDocument();
    expect(screen.queryByText("Llama 3.3 70B")).not.toBeInTheDocument();
  });
  it("keeps workspace refresh failures visible and recoverable", async () => {
    const { fetcher, user } = await mounted(true);
    fetcher.mockRejectedValueOnce(new Error("Gateway unavailable"));
    await user.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Workspace couldn’t refresh.",
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Gateway unavailable");
    await user.click(
      within(screen.getByRole("alert")).getByRole("button", { name: "Retry" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
  });
});
