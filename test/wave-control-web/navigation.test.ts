import { describe, expect, it } from "vitest";
import {
  getPrimaryNavItems,
  getSectionNavItems,
  getViewHash,
  resolveInitialView,
} from "../../services/wave-control-web/src/navigation";

describe("wave-control web navigation", () => {
  it("defaults to the dashboard when no hash is present", () => {
    expect(resolveInitialView("", false)).toBe("dashboard");
    expect(resolveInitialView("#", true)).toBe("dashboard");
  });

  it("maps the legacy tab hashes into the grouped IA", () => {
    expect(resolveInitialView("#overview", false)).toBe("dashboard");
    expect(resolveInitialView("#runs", false)).toBe("operations:runs");
    expect(resolveInitialView("#benchmarks", false)).toBe("operations:benchmarks");
    expect(resolveInitialView("#tokens", false)).toBe("account:tokens");
    expect(resolveInitialView("#users", true)).toBe("access:directory");
  });

  it("falls back to the dashboard when a non-superuser requests an admin-only hash", () => {
    expect(resolveInitialView("#users", false)).toBe("dashboard");
    expect(resolveInitialView("#access:directory", false)).toBe("dashboard");
  });

  it("returns the grouped top-level navigation for superusers", () => {
    expect(getPrimaryNavItems(true)).toEqual([
      { id: "dashboard", label: "Dashboard" },
      { id: "operations", label: "Operations" },
      { id: "access", label: "Access" },
      { id: "account", label: "Account" },
    ]);
  });

  it("hides the access section for non-superusers", () => {
    expect(getPrimaryNavItems(false)).toEqual([
      { id: "dashboard", label: "Dashboard" },
      { id: "operations", label: "Operations" },
      { id: "account", label: "Account" },
    ]);
  });

  it("returns section-level navigation only where it is needed", () => {
    expect(getSectionNavItems("dashboard", true)).toEqual([]);
    expect(getSectionNavItems("operations", false)).toEqual([
      { id: "operations:runs", label: "Runs" },
      { id: "operations:benchmarks", label: "Benchmarks" },
    ]);
    expect(getSectionNavItems("access", true)).toEqual([
      { id: "access:requests", label: "Requests" },
      { id: "access:directory", label: "Directory" },
    ]);
  });

  it("serializes grouped views back into hashes", () => {
    expect(getViewHash("dashboard")).toBe("#dashboard");
    expect(getViewHash("operations:benchmarks")).toBe("#operations:benchmarks");
    expect(getViewHash("account:tokens")).toBe("#account:tokens");
  });
});
