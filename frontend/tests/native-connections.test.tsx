import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { ProviderForm } from "@/app/forms";
import NativeLogin from "@/app/native-login";
import { Provider } from "@/lib/api";

const provider: Provider = {
  id: "p1",
  kind: "groq",
  name: "My Groq",
  base_url: "https://api.groq.com/openai/v1",
  enabled: true,
  pinned: false,
  priority: 1,
  models_count: 1205,
  health: {},
  discovered_at: null,
  discovery_error: null,
  preferred_models: ["first", "second"],
};

it("searches the full provider catalog, reorders models, and saves restrictions", async () => {
  const fetcher = vi.fn(
    async (url: string) =>
      new Response(
        JSON.stringify(
          url.includes("/models?")
            ? {
                data: [
                  {
                    id: "m1204",
                    model_id: "free-model-1204",
                    name: "Free model 1204",
                    available: true,
                  },
                ],
                total: 1,
              }
            : { updated: true },
        ),
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  const saved = vi.fn();
  render(
    <ProviderForm provider={provider} onSaved={saved} onClose={vi.fn()} />,
  );
  const user = userEvent.setup();
  fireEvent.change(
    screen.getByRole("textbox", { name: "Search models for preferences" }),
    { target: { value: "1204" } },
  );
  await user.click(screen.getByLabelText("Free models only"));
  await user.click(
    await screen.findByRole("button", { name: /Free model 1204/ }),
  );
  await user.click(
    screen.getByRole("button", { name: "Move free-model-1204 up" }),
  );
  await user.click(
    screen.getByRole("button", { name: "Move free-model-1204 up" }),
  );
  await user.click(
    screen.getByLabelText(
      "Only use these models for automatic routing and alternatives",
    ),
  );
  await user.click(screen.getByRole("button", { name: "Save connection" }));
  await waitFor(() => expect(saved).toHaveBeenCalled());
  const search = fetcher.mock.calls.find(
    ([url]) => url.includes("search=1204") && url.includes("free_only=true"),
  );
  expect(search?.[0]).toContain("provider=p1");
  const calls = fetcher.mock.calls as unknown as [string, RequestInit][];
  expect(
    JSON.parse(
      String(calls.find(([url]) => url === "/api/providers/p1")?.[1].body),
    ),
  ).toMatchObject({
    preferred_models: ["free-model-1204", "first", "second"],
    preferred_only: true,
  });
});

it("offers searchable model preferences immediately after connecting", async () => {
  const fetcher = vi.fn(
    async (url: string) =>
      new Response(
        JSON.stringify(
          url.includes("/models?") ? { data: [], total: 0 } : { id: "created" },
        ),
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  const saved = vi.fn();
  render(<ProviderForm initialKind="groq" onSaved={saved} onClose={vi.fn()} />);
  fireEvent.change(screen.getByLabelText("Provider API key"), {
    target: { value: "groq-key" },
  });
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Connect provider" }));
  expect(
    await screen.findByRole("heading", {
      name: "Connected · choose your models",
    }),
  ).toBeInTheDocument();
  expect(saved).not.toHaveBeenCalled();
  await waitFor(() =>
    expect(
      fetcher.mock.calls.some(([url]) => url.includes("provider=created")),
    ).toBe(true),
  );
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Save model preferences" }));
  expect(saved).toHaveBeenCalled();
});

it("starts a native device login and renders only a code and provider authorization link", async () => {
  const flow = {
    flow_id: "x".repeat(43),
    user_code: "ABC-123",
    verification_url: "https://www.kimi.com/code/authorize_device",
    expires_in: 600,
    interval: 5,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(flow))),
  );
  render(
    <ProviderForm initialKind="kimi" onSaved={vi.fn()} onClose={vi.fn()} />,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Sign in with Kimi" }));
  await user.click(
    screen.getByRole("button", { name: "Start secure sign-in" }),
  );
  expect(await screen.findByDisplayValue("ABC-123")).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "Open Kimi authorization" }),
  ).toHaveAttribute("href", flow.verification_url);
  expect(screen.queryByLabelText("Provider API key")).not.toBeInTheDocument();
});

it("cancels native authorization on the server", async () => {
  const fetcher = vi.fn(
    async () => new Response(JSON.stringify({ status: "cancelled" })),
  );
  vi.stubGlobal("fetch", fetcher);
  const cancelled = vi.fn();
  render(
    <NativeLogin
      kind="codex"
      flow={{
        flow_id: "x".repeat(43),
        user_code: "CODE",
        verification_url: "https://auth.openai.com/codex/device",
        expires_in: 600,
        interval: 5,
      }}
      onConnected={vi.fn()}
      onCancel={cancelled}
    />,
  );
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Cancel sign-in" }));
  expect(fetcher).toHaveBeenCalledWith(
    "/api/oauth/codex/cancel",
    expect.objectContaining({ method: "POST" }),
  );
  expect(cancelled).toHaveBeenCalled();
});
