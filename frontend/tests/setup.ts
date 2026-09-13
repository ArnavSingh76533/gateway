import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { createElement } from "react";

// Chart geometry and native dialog focus containment require browser QA.
// These shims allow testing their surrounding controls without pretending to render pixels.
vi.mock("next/dynamic", () => ({
  default: () => () =>
    createElement("div", { "data-testid": "chart-container" }),
}));
Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
  configurable: true,
  value() {
    this.open = true;
    this.querySelector("button, input, select, textarea")?.focus();
  },
});
Object.defineProperty(HTMLDialogElement.prototype, "close", {
  configurable: true,
  value() {
    this.open = false;
  },
});
export function setViewport(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn((query: string) => ({
      matches: query.includes("min-width: 1024px") ? width >= 1024 : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}
beforeEach(() => {
  window.scrollTo = vi.fn();
  setViewport(1440);
  window.history.replaceState(null, "", "/");
  document.documentElement.lang = "en";
  document.title = "Nexus tests";
  document.cookie = "gw_csrf=test-csrf-token; path=/";
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.body.style.overflow = "";
});
