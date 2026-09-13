import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { loadAllModels, Model } from "@/lib/api";
import { demoModels, demoProviders } from "@/lib/demo";
import Playground from "@/app/playground";
import MarkdownOutput from "@/app/markdown-output";

const catalog: Model[] = Array.from({ length: 1205 }, (_, i) => ({
  ...demoModels[0],
  id: `model-${i}`,
  name: `Catalog model ${i}`,
  model_id: `catalog/${i}`,
  route_id: `provider::catalog/${i}`,
  input_price: i === 1204 ? 0 : 1,
  output_price: i === 1204 ? 0 : 2,
}));

describe("Complete model catalog", () => {
  it("loads every page, including free models beyond the first thousand", async () => {
    const fetcher = vi.fn(async (url: string) => {
      const offset = Number(
        new URL(url, "http://test").searchParams.get("offset"),
      );
      return new Response(
        JSON.stringify({
          data: catalog.slice(offset, offset + 1000),
          total: catalog.length,
        }),
      );
    });
    vi.stubGlobal("fetch", fetcher);
    const all = await loadAllModels();
    expect(all).toHaveLength(1205);
    expect(all.at(-1)?.input_price).toBe(0);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/api/models?limit=1000&offset=0",
      "/api/models?limit=1000&offset=1000",
    ]);
  });
  it("reports incomplete catalogs instead of silently hiding models", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ data: [], total: 1205 })),
        ),
    );
    await expect(loadAllModels()).rejects.toThrow("complete catalog");
  });
  it("searches the full catalog and keeps selection when the workspace refreshes", async () => {
    const loadCatalog = vi.fn().mockResolvedValue(catalog);
    const props = {
      demo: false,
      providers: demoProviders,
      models: catalog.slice(0, 100),
      loadCatalog,
      requireAccount: (fn: () => void) => fn(),
      notify: vi.fn(),
      onFinish: vi.fn().mockResolvedValue(undefined),
    };
    const fetcher = vi
      .fn()
      .mockImplementation(
        async () =>
          new Response(
            'data: {"choices":[{"delta":{"content":"Selected model worked"}}]}\n\ndata: [DONE]\n\n',
          ),
      );
    vi.stubGlobal("fetch", fetcher);
    const { rerender } = render(<Playground {...props} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Select model" }));
    expect(
      await screen.findByText("1205 matching models · 1205 in this catalog"),
    ).toBeVisible();
    await user.click(screen.getByRole("checkbox", { name: "Free only" }));
    fireEvent.change(
      screen.getByRole("textbox", { name: "Search all models" }),
      { target: { value: "catalog/1204" } },
    );
    await user.click(
      screen.getByRole("button", { name: /Choose Catalog model 1204/ }),
    );
    await user.click(screen.getByRole("button", { name: "Send request" }));
    expect(await screen.findByText("Selected model worked")).toBeVisible();
    rerender(<Playground {...props} models={[]} />);
    expect(
      screen.getByRole("button", { name: "Select model" }),
    ).toHaveTextContent("Catalog model 1204");
    await user.click(screen.getByRole("button", { name: "Send request" }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(
      fetcher.mock.calls.map((call) => JSON.parse(call[1].body).model),
    ).toEqual(["provider::catalog/1204", "provider::catalog/1204"]);
    expect(loadCatalog).toHaveBeenCalledOnce();
  });
  it("blocks manual auto-routing and supports a model selected in explorer", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const props = {
      demo: false,
      providers: demoProviders,
      models: catalog,
      loadCatalog: vi.fn().mockResolvedValue(catalog),
      requireAccount: (fn: () => void) => fn(),
      notify: vi.fn(),
      onFinish: vi.fn().mockResolvedValue(undefined),
    };
    const { unmount } = render(<Playground {...props} />);
    const user = userEvent.setup();
    await user.selectOptions(
      screen.getByLabelText("Routing strategy"),
      "manual",
    );
    expect(screen.getByRole("button", { name: "Send request" })).toBeDisabled();
    fireEvent.keyDown(screen.getByLabelText("Your message"), {
      key: "Enter",
      ctrlKey: true,
    });
    expect(fetcher).not.toHaveBeenCalled();
    unmount();
    render(<Playground {...props} initialModel={catalog[1204]} />);
    expect(
      screen.getByRole("button", { name: "Select model" }),
    ).toHaveTextContent("Catalog model 1204");
    expect(screen.getByLabelText("Routing strategy")).toHaveValue("manual");
  });
  it("renders Markdown and code without loading images or executing HTML", () => {
    const { container } = render(
      <MarkdownOutput
        text={
          "## Result\n\n**Useful** output\n\n```js\nconst answer = 42;\n```\n\n![tracker](https://evil.example/track)\n\n<script>alert(1)</script>\n\n[bad](javascript:alert(1))"
        }
        notify={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "Result" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Copy code" })).toBeEnabled();
    expect(container.querySelector("pre code")).toHaveTextContent(
      "const answer = 42;",
    );
    expect(container.querySelector("img,script")).toBeNull();
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
  });
});
