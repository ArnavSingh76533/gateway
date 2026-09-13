import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AuthForm, ModelForm, ProviderForm } from "@/app/forms";
import { demoModels, demoProviders } from "@/lib/demo";

const result = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status });
const callbacks = () => ({ onClose: vi.fn(), onSaved: vi.fn() });

describe("Authentication", () => {
  it("signs in through the existing cookie/CSRF API contract", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        result({ user: { id: "u1", name: "Alex", email: "alex@example.com" } }),
      );
    vi.stubGlobal("fetch", fetcher);
    const onSuccess = vi.fn();
    render(<AuthForm onClose={vi.fn()} onSuccess={onSuccess} />);
    const user = userEvent.setup();
    expect(screen.getByLabelText("Password")).toHaveAttribute(
      "placeholder",
      "Your password",
    );
    await user.type(screen.getByLabelText("Email address"), "alex@example.com");
    await user.type(screen.getByLabelText("Password"), "test-password-123");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() =>
      expect(onSuccess).toHaveBeenCalledWith(
        expect.objectContaining({ id: "u1" }),
        undefined,
      ),
    );
    expect(fetcher).toHaveBeenCalledWith(
      "/api/auth/login",
      expect.objectContaining({
        method: "POST",
        credentials: "same-origin",
        headers: expect.objectContaining({ "X-CSRF-Token": "test-csrf-token" }),
      }),
    );
  });
  it("registers with invitation code and passes the one-time key to its owner", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        result({ user: { id: "u1" }, gateway_key: "gw_test-only" }),
      );
    vi.stubGlobal("fetch", fetcher);
    const onSuccess = vi.fn();
    render(<AuthForm onClose={vi.fn()} onSuccess={onSuccess} />);
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "New here? Create an account" }),
    );
    await user.type(screen.getByLabelText("Your name"), "Alex");
    await user.type(screen.getByLabelText("Email address"), "alex@example.com");
    await user.type(screen.getByLabelText("Password"), "test-password-123");
    await user.type(
      screen.getByLabelText(/Invitation code/),
      "test-invitation",
    );
    await user.click(screen.getByRole("button", { name: "Create workspace" }));
    await waitFor(() =>
      expect(onSuccess).toHaveBeenCalledWith({ id: "u1" }, "gw_test-only"),
    );
    expect(fetcher.mock.calls[0][0]).toBe("/api/auth/register");
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({
      registration_code: "test-invitation",
      name: "Alex",
    });
  });
  it("associates invalid inputs with inline help and announces server failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          result({ error: { message: "Invalid email or password" } }, 401),
        ),
    );
    render(<AuthForm onClose={vi.fn()} onSuccess={vi.fn()} />);
    const email = screen.getByLabelText("Email address");
    fireEvent.invalid(email);
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveAccessibleDescription();
    const user = userEvent.setup();
    await user.type(email, "alex@example.com");
    await user.type(screen.getByLabelText("Password"), "test-password-123");
    expect(email).toHaveAttribute("aria-invalid", "false");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Invalid email or password",
    );
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });
});

describe("Provider and model forms", () => {
  it("saves custom endpoints and preserves priority zero", async () => {
    const fetcher = vi.fn().mockResolvedValue(result({}));
    vi.stubGlobal("fetch", fetcher);
    const props = callbacks();
    render(<ProviderForm {...props} />);
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Provider"), "custom");
    await user.type(
      screen.getByLabelText("Base URL"),
      "https://models.example/v1",
    );
    fireEvent.change(screen.getByLabelText(/Priority/), {
      target: { value: "0" },
    });
    await user.click(screen.getByText("Advanced · custom headers"));
    fireEvent.change(screen.getByLabelText("Headers as JSON"), {
      target: { value: '{"X-Organization":"test-org"}' },
    });
    await user.click(screen.getByRole("button", { name: "Connect provider" }));
    await waitFor(() => expect(props.onSaved).toHaveBeenCalled());
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({
      kind: "custom",
      priority: 0,
      base_url: "https://models.example/v1",
      headers: { "X-Organization": "test-org" },
    });
  });
  it.each(['{"Authorization":123}', '["token"]', "malformed-test-secret"])(
    "rejects invalid custom-header data without sending it: %s",
    async (headers) => {
      const fetcher = vi.fn();
      vi.stubGlobal("fetch", fetcher);
      render(<ProviderForm provider={demoProviders[0]} {...callbacks()} />);
      const user = userEvent.setup();
      await user.click(screen.getByText("Advanced · custom headers"));
      fireEvent.change(screen.getByLabelText("Headers as JSON"), {
        target: { value: headers },
      });
      await user.click(screen.getByRole("button", { name: "Save connection" }));
      expect(screen.getByLabelText(/Headers as JSON/)).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      expect(screen.getByText(/Enter a JSON object/)).not.toHaveTextContent(
        headers,
      );
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it("editing a provider omits stored credentials unless replaced", async () => {
    const fetcher = vi.fn().mockResolvedValue(result({}));
    vi.stubGlobal("fetch", fetcher);
    const props = callbacks();
    render(
      <ProviderForm
        provider={{ ...demoProviders[0], priority: 0 }}
        {...props}
      />,
    );
    expect(screen.getByLabelText(/Replace API key/)).toHaveValue("");
    expect(screen.getByLabelText(/Priority/)).toHaveValue(0);
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Save connection" }));
    await waitFor(() => expect(props.onSaved).toHaveBeenCalled());
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body).not.toHaveProperty("api_key");
    expect(body).not.toHaveProperty("headers");
    expect(fetcher.mock.calls[0][1].method).toBe("PATCH");
  });
  it("saves capabilities as true, false, or unknown without inventing prices", async () => {
    const fetcher = vi.fn().mockResolvedValue(result({}));
    vi.stubGlobal("fetch", fetcher);
    const props = callbacks();
    render(
      <ModelForm model={demoModels[0]} providers={demoProviders} {...props} />,
    );
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("tools"), "true");
    await user.selectOptions(screen.getByLabelText("vision"), "false");
    await user.selectOptions(screen.getByLabelText("reasoning"), "unknown");
    fireEvent.change(screen.getByLabelText("Input price / 1M tokens (USD)"), {
      target: { value: "" },
    });
    await user.click(screen.getByRole("button", { name: "Save model" }));
    await waitFor(() => expect(props.onSaved).toHaveBeenCalled());
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({
      input_price: null,
      capabilities: { tools: true, vision: false, reasoning: null },
    });
  });
});
