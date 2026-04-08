export type PrimaryViewId = "dashboard" | "operations" | "access" | "account";

export type ViewId =
  | "dashboard"
  | "operations:runs"
  | "operations:benchmarks"
  | "access:requests"
  | "access:directory"
  | "account:tokens";

type NavItem<T extends string> = {
  id: T;
  label: string;
};

const PRIMARY_NAV_ITEMS: NavItem<PrimaryViewId>[] = [
  { id: "dashboard", label: "Dashboard" },
  { id: "operations", label: "Operations" },
  { id: "access", label: "Access" },
  { id: "account", label: "Account" },
];

const SECTION_NAV_ITEMS: Record<PrimaryViewId, NavItem<ViewId>[]> = {
  dashboard: [],
  operations: [
    { id: "operations:runs", label: "Runs" },
    { id: "operations:benchmarks", label: "Benchmarks" },
  ],
  access: [
    { id: "access:requests", label: "Requests" },
    { id: "access:directory", label: "Directory" },
  ],
  account: [{ id: "account:tokens", label: "Tokens" }],
};

const LEGACY_VIEW_ALIASES: Record<string, ViewId> = {
  overview: "dashboard",
  runs: "operations:runs",
  benchmarks: "operations:benchmarks",
  users: "access:directory",
  tokens: "account:tokens",
};

export function getPrimaryNavItems(isSuperuser: boolean): NavItem<PrimaryViewId>[] {
  return isSuperuser ? PRIMARY_NAV_ITEMS : PRIMARY_NAV_ITEMS.filter((item) => item.id !== "access");
}

export function getSectionNavItems(
  primaryView: PrimaryViewId,
  isSuperuser: boolean,
): NavItem<ViewId>[] {
  if (primaryView === "access" && !isSuperuser) {
    return [];
  }
  return SECTION_NAV_ITEMS[primaryView];
}

export function getPrimaryView(view: ViewId): PrimaryViewId {
  return view.includes(":") ? (view.split(":")[0] as PrimaryViewId) : "dashboard";
}

export function getDefaultViewForPrimary(
  primaryView: PrimaryViewId,
  isSuperuser: boolean,
): ViewId {
  if (primaryView === "access" && !isSuperuser) {
    return "dashboard";
  }
  return SECTION_NAV_ITEMS[primaryView][0]?.id || "dashboard";
}

export function resolveInitialView(hash: string, isSuperuser: boolean): ViewId {
  const normalized = String(hash || "")
    .trim()
    .replace(/^#/, "");

  if (!normalized) {
    return "dashboard";
  }

  const resolved = (LEGACY_VIEW_ALIASES[normalized] || normalized) as ViewId | PrimaryViewId;

  if (resolved === "dashboard") {
    return "dashboard";
  }
  if (resolved === "operations" || resolved === "access" || resolved === "account") {
    return getDefaultViewForPrimary(resolved, isSuperuser);
  }
  if (resolved.startsWith("access:") && !isSuperuser) {
    return "dashboard";
  }
  if (resolved === "operations:runs" || resolved === "operations:benchmarks") {
    return resolved;
  }
  if (resolved === "access:requests" || resolved === "access:directory") {
    return isSuperuser ? resolved : "dashboard";
  }
  if (resolved === "account:tokens") {
    return resolved;
  }
  return "dashboard";
}

export function getViewHash(view: ViewId): string {
  return `#${view}`;
}
