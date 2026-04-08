import { StackClientApp } from "@stackframe/js";

type StackProjectLike = {
  config?: {
    credential_enabled?: boolean;
    credentialEnabled?: boolean;
    magic_link_enabled?: boolean;
    magicLinkEnabled?: boolean;
    passkey_enabled?: boolean;
    passkeyEnabled?: boolean;
    enabled_oauth_providers?: Array<{ id?: string | null } | null> | null;
    oauthProviders?: Array<{ id?: string | null } | null> | null;
  } | null;
} | null;

type StackCallbackClient = {
  callOAuthCallback(): Promise<boolean>;
  signInWithMagicLink(code: string, options?: { noRedirect?: boolean }): Promise<any>;
};

type HistoryLike = {
  replaceState(data: any, unused: string, url?: string | URL | null): void;
};

export type StackAuthCapabilities = {
  credentialEnabled: boolean;
  magicLinkEnabled: boolean;
  passkeyEnabled: boolean;
  oauthProviders: string[];
  hasAnyMethod: boolean;
};

export type PendingStackCallback =
  | { type: "none" }
  | { type: "oauth" }
  | { type: "magic-link"; code: string };

const OAUTH_PROVIDER_LABELS = {
  apple: "Apple",
  bitbucket: "Bitbucket",
  discord: "Discord",
  facebook: "Facebook",
  github: "GitHub",
  gitlab: "GitLab",
  google: "Google",
  linkedin: "LinkedIn",
  microsoft: "Microsoft",
  spotify: "Spotify",
  twitch: "Twitch",
  x: "X",
};

export function normalizeStackAppPathname(pathname: string): string {
  const trimmed = String(pathname || "").trim();
  return trimmed || "/";
}

export function currentAppCallbackUrl(href: string): string {
  const url = new URL(href);
  url.hash = "";
  url.search = "";
  return url.toString();
}

export function buildStackAppOptions(projectId: string, publishableClientKey: string, pathname: string) {
  const appPathname = normalizeStackAppPathname(pathname);
  return {
    projectId,
    publishableClientKey,
    tokenStore: "cookie" as const,
    urls: {
      home: appPathname,
      afterSignIn: appPathname,
      afterSignOut: appPathname,
      afterSignUp: appPathname,
      oauthCallback: appPathname,
      magicLinkCallback: appPathname,
    },
  };
}

export function createStackApp(projectId: string, publishableClientKey: string, pathname: string) {
  return new StackClientApp(buildStackAppOptions(projectId, publishableClientKey, pathname));
}

export function resolveStackAuthCapabilities(project: StackProjectLike): StackAuthCapabilities {
  const config = project?.config || {};
  const oauthProviderEntries = Array.isArray(config.oauthProviders)
    ? config.oauthProviders
    : Array.isArray(config.enabled_oauth_providers)
      ? config.enabled_oauth_providers
      : [];
  const credentialEnabled =
    config.credentialEnabled === true || config.credential_enabled === true;
  const magicLinkEnabled =
    config.magicLinkEnabled === true || config.magic_link_enabled === true;
  const passkeyEnabled =
    config.passkeyEnabled === true || config.passkey_enabled === true;
  const oauthProviders = oauthProviderEntries
        .map((provider) => String(provider?.id || "").trim())
        .filter(Boolean);
  return {
    credentialEnabled,
    magicLinkEnabled,
    passkeyEnabled,
    oauthProviders,
    hasAnyMethod: credentialEnabled || magicLinkEnabled || passkeyEnabled || oauthProviders.length > 0,
  };
}

export function detectPendingStackCallback(href: string): PendingStackCallback {
  const url = new URL(href);
  const code = String(url.searchParams.get("code") || "").trim();
  const state = String(url.searchParams.get("state") || "").trim();
  if (code && state) {
    return { type: "oauth" };
  }
  if (code) {
    return {
      type: "magic-link",
      code,
    };
  }
  return { type: "none" };
}

function clearQueryParams(href: string, historyLike: HistoryLike, names: string[]) {
  const url = new URL(href);
  let changed = false;
  for (const name of names) {
    if (url.searchParams.has(name)) {
      url.searchParams.delete(name);
      changed = true;
    }
  }
  if (changed) {
    historyLike.replaceState({}, "", url.toString());
  }
}

function normalizeStackAuthError(error: any, fallback: string) {
  if (error instanceof Error) {
    return error;
  }
  return new Error(error?.message || error?.code || fallback);
}

export async function completePendingStackCallback(
  stackApp: StackCallbackClient,
  options: {
    href: string;
    historyLike: HistoryLike;
  },
) {
  const pending = detectPendingStackCallback(options.href);
  if (pending.type === "none") {
    return false;
  }
  if (pending.type === "oauth") {
    return stackApp.callOAuthCallback();
  }
  const result = await stackApp.signInWithMagicLink(pending.code, {
    noRedirect: true,
  });
  if (result?.status === "error") {
    throw normalizeStackAuthError(result.error, "Magic-link sign-in failed.");
  }
  clearQueryParams(options.href, options.historyLike, ["code"]);
  return true;
}

export function formatOAuthProviderLabel(providerId: string): string {
  const normalized = String(providerId || "").trim().toLowerCase();
  return OAUTH_PROVIDER_LABELS[normalized] || normalized.slice(0, 1).toUpperCase() + normalized.slice(1);
}
