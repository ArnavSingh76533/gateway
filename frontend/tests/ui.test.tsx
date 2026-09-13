import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { CopyButton, Modal, Capabilities } from "@/app/ui";
import RequestTable from "@/app/request-table";
import { demoLogs } from "@/lib/demo";
import { stamp } from "@/lib/api";

it("labels icon-only copy buttons and confirms successful copying", async () => {
  const user = userEvent.setup();
  const copy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  const notify = vi.fn();
  render(<CopyButton value="provider/model" label="" onCopy={notify} />);
  await user.click(screen.getByRole("button", { name: "Copy to clipboard" }));
  expect(copy).toHaveBeenCalledWith("provider/model");
  expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
});
it("restores focus and body scrolling when a modal closes", () => {
  const trigger = document.createElement("button");
  document.body.append(trigger);
  trigger.focus();
  const { unmount } = render(
    <Modal title="Test connection" onClose={vi.fn()}>
      <input aria-label="Test input" />
    </Modal>,
  );
  expect(
    screen.getByRole("dialog", { name: "Test connection" }),
  ).toHaveAttribute("open");
  expect(document.body.style.overflow).toBe("hidden");
  unmount();
  expect(document.activeElement).toBe(trigger);
  expect(document.body.style.overflow).toBe("");
  trigger.remove();
});
it("retains every supported capability and does not imply unknown capabilities", () => {
  render(
    <Capabilities
      values={{
        chat: true,
        tools: true,
        vision: true,
        streaming: true,
        reasoning: true,
        coding: true,
        embeddings: null,
        images: false,
      }}
    />,
  );
  for (const label of [
    "Chat",
    "Tools",
    "Vision",
    "Streaming",
    "Reasoning",
    "Coding",
  ])
    expect(screen.getByText(label)).toBeInTheDocument();
  expect(screen.queryByText("Embeddings")).not.toBeInTheDocument();
  expect(screen.queryByText("Images")).not.toBeInTheDocument();
});
it("opens a request only once through its keyboard-accessible action", async () => {
  const onSelect = vi.fn();
  render(<RequestTable logs={[demoLogs[0]]} onSelect={onSelect} />);
  const user = userEvent.setup();
  await user.tab();
  expect(screen.getByRole("button")).toHaveFocus();
  await user.keyboard("{Enter}");
  await waitFor(() =>
    expect(onSelect).toHaveBeenCalledExactlyOnceWith(demoLogs[0]),
  );
  for (const label of [
    "Status",
    "Latency",
    "Tokens in / out",
    "Cost",
    "Attempts",
    "Time",
  ])
    expect(
      screen.getByRole("columnheader", { name: label }),
    ).toBeInTheDocument();
});
it("renders log timestamps consistently between static export and client time zones", () => {
  expect(stamp(Date.UTC(2026, 8, 12, 12) / 1000)).toContain("UTC");
  expect(stamp(null)).toBe("Never");
});
it("meets WCAG AA text contrast with the actual shared surface tokens", () => {
  const css = readFileSync("app/tokens.css", "utf8");
  const colors = Object.fromEntries(
    [...css.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6});/g)].map((m) => [
      m[1],
      m[2],
    ]),
  );
  function luminance(hex: string) {
    const [r, g, b] = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((s) => (s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  function ratio(a: string, b: string) {
    const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (high + 0.05) / (low + 0.05);
  }
  for (const surface of ["bg", "surface", "raised", "overlay"]) {
    for (const text of [
      "text",
      "text-2",
      "text-3",
      "accent",
      "success",
      "warning",
      "danger",
      "info",
    ]) {
      expect(
        ratio(colors[text], colors[surface]),
        `${text} on ${surface}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  }
  expect(ratio(colors["accent-ink"], colors.accent)).toBeGreaterThanOrEqual(
    4.5,
  );
});
