import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { expect, it, vi } from "vitest";
import Dashboard from "@/app/workspace";
import ProviderDirectory from "@/app/provider-directory";
import { ProviderForm } from "@/app/forms";
import QuotaPanel, { Quota, resetLabel } from "@/app/quota-panel";

it("shows the landing page immediately while account loading is pending", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => new Promise(() => {})),
  );
  const { container } = render(<Dashboard />);
  expect(
    screen.getByRole("heading", { level: 1, name: /Every model/ }),
  ).toBeInTheDocument();
  expect(screen.queryByText(/Loading your workspace/)).not.toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: /Explore the demo/ }),
  ).toHaveAttribute("href", "#overview");
  expect(
    (
      await axe.run(container, {
        rules: { "color-contrast": { enabled: false } },
      })
    ).violations,
  ).toEqual([]);
});

it("searches the complete provider directory and routes subscription choices to 9router", async () => {
  const onConnect = vi.fn();
  render(<ProviderDirectory onConnect={onConnect} />);
  const user = userEvent.setup();
  const search = screen.getByRole("textbox", {
    name: "Search provider directory",
  });
  await user.type(search, "deepseek");
  await user.click(screen.getByRole("button", { name: /DeepSeek/ }));
  expect(onConnect).toHaveBeenLastCalledWith("deepseek");
  await user.clear(search);
  await user.selectOptions(
    screen.getByLabelText("Connection method"),
    "bridge",
  );
  expect(
    screen.queryByRole("button", { name: /DeepSeek/ }),
  ).not.toBeInTheDocument();
  const choices = screen.getAllByRole("button", {
    name: /Via private 9router/,
  });
  expect(choices.length).toBeGreaterThan(30);
  await user.click(choices[0]);
  expect(onConnect).toHaveBeenLastCalledWith("9router");
});

it("offers OpenRouter OAuth without requiring an API key and reports failed initiation", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { message: "Choose a different connection name." },
        }),
        { status: 409 },
      ),
    );
  vi.stubGlobal("fetch", fetcher);
  render(<ProviderForm onClose={vi.fn()} onSaved={vi.fn()} />);
  const user = userEvent.setup();
  await user.click(
    screen.getByRole("button", { name: "Sign in with OpenRouter" }),
  );
  expect(screen.queryByLabelText("Provider API key")).not.toBeInTheDocument();
  await user.click(
    screen.getByRole("button", { name: "Continue to OpenRouter" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Choose a different connection name.",
  );
  expect(fetcher).toHaveBeenCalledWith(
    "/api/oauth/openrouter/start",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ name: "OpenRouter" }),
    }),
  );
});

it("connects a private 9router endpoint using its gateway key", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify({ id: "bridge" })));
  vi.stubGlobal("fetch", fetcher);
  const saved = vi.fn();
  render(
    <ProviderForm initialKind="9router" onClose={vi.fn()} onSaved={saved} />,
  );
  fireEvent.change(screen.getByLabelText("Base URL"), {
    target: { value: "https://bridge.example/v1" },
  });
  fireEvent.change(screen.getByLabelText("9router gateway API key"), {
    target: { value: "test-bridge-key" },
  });
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Connect provider" }));
  await waitFor(() => expect(saved).toHaveBeenCalled());
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({
    kind: "9router",
    base_url: "https://bridge.example/v1",
    api_key: "test-bridge-key",
  });
});

it("distinguishes expired token windows, unknown values, and credit balances", async () => {
  const now = Date.now() / 1000;
  const row: Quota = {
    provider_id: "p1",
    provider_name: "My provider",
    kind: "openrouter",
    enabled: true,
    model: "model-a",
    observed_at: now - 90,
    retry_at: null,
    status: "healthy",
    windows: [
      {
        resource: "tokens",
        limit: 1000,
        remaining: 123,
        reset_at: now - 1,
        observed_at: now - 90,
      },
    ],
    balance: {
      label: "API key spending limit",
      unit: "USD",
      remaining: 4.5,
      observed_at: now,
    },
    can_refresh: true,
    gateway_usage_24h: { requests: 4, input_tokens: null, output_tokens: 20 },
  };
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ data: [row], server_time: now })),
      ),
  );
  render(<QuotaPanel demo={false} onSignIn={vi.fn()} />);
  expect(await screen.findByText("Awaiting update")).toBeInTheDocument();
  expect(screen.queryByText("123")).not.toBeInTheDocument();
  expect(screen.getByText(/\$4.50/)).toBeInTheDocument();
  expect(screen.getByText("Money, not tokens")).toBeInTheDocument();
  expect(screen.getByText("—")).toBeInTheDocument();
  expect(resetLabel(null, now)).toBe("Reset time not reported");
  expect(resetLabel(now + 65, now)).toBe("Resets in 1m 5s");
});
