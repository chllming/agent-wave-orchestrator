import { html, render, type TemplateResult } from "lit";
import type { AppState } from "./app-state";
import { renderAccessRequest, renderFooter, renderSectionNav, renderSignedOut, renderTopbar } from "./chrome";
import { appConfig } from "./config";
import {
  getDefaultViewForPrimary,
  getPrimaryView,
  getViewHash,
  resolveInitialView,
  type PrimaryViewId,
  type ViewId,
} from "./navigation";
import { renderAccountView, renderAccessView, renderDashboardView, renderOperationsView } from "./pages";
import {
  completePendingStackCallback,
  createStackApp,
  currentAppCallbackUrl,
  formatOAuthProviderLabel,
  resolveStackAuthCapabilities,
  type StackAuthCapabilities,
} from "./stack-auth";
import "./styles.css";

/* ── Theme system ──────────────────────────────────────────────────── */

type ThemePreference = "system" | "light" | "dark";
type ResolvedTheme = "light" | "dark";

const THEME_KEY = "wc-theme";

function getStoredTheme(): ThemePreference {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return "system";
}

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function applyTheme(mode: ThemePreference): void {
  const resolved: ResolvedTheme = mode === "system" ? getSystemTheme() : mode;
  document.documentElement.setAttribute("data-theme-mode", resolved);
  localStorage.setItem(THEME_KEY, mode);
}

function getThemeLabel(pref: ThemePreference): string {
  switch (pref) {
    case "system":
      return "Auto";
    case "light":
      return "Light";
    case "dark":
      return "Dark";
  }
}

function handleThemeToggle(): void {
  const current = getStoredTheme();
  const next: ThemePreference =
    current === "system" ? "light" : current === "light" ? "dark" : "system";
  applyTheme(next);
  redraw();
}

const root = document.querySelector("#app");

if (!root) {
  throw new Error("Missing #app root.");
}

const stackApp =
  appConfig.stackProjectId && appConfig.stackPublishableClientKey
    ? createStackApp(
        appConfig.stackProjectId,
        appConfig.stackPublishableClientKey,
        window.location.pathname,
      )
    : null;

const state: AppState = {
  activeView: resolveInitialView(window.location.hash, true),
  accessRequestReason: "",
  authCapabilities: null,
  benchmarks: [],
  credentialDraftIds: {},
  credentialDraftValues: {},
  error: "",
  loading: true,
  me: null,
  newUserAccessState: "approved",
  newUserEmail: "",
  newUserProviderGrants: [],
  newUserRole: "member",
  overview: null,
  plaintextToken: "",
  providerCatalog: [],
  runItems: [],
  session: null,
  signedIn: false,
  signInEmail: "",
  signInPassword: "",
  status: "Checking session\u2026",
  tokenItems: [],
  tokenLabel: "",
  userCredentialItems: {},
  userItems: [],
};

function replaceViewHash(view: ViewId): void {
  const nextHash = getViewHash(view);
  if (window.location.hash === nextHash) {
    return;
  }
  const nextUrl = new URL(window.location.href);
  nextUrl.hash = nextHash;
  window.history.replaceState({}, "", nextUrl.toString());
}

function setView(view: ViewId): void {
  window.location.hash = getViewHash(view);
  setState({ activeView: view });
}

function setPrimaryView(primaryView: PrimaryViewId): void {
  setView(getDefaultViewForPrimary(primaryView, state.session?.isSuperuser === true));
}

function setState(next: Partial<AppState>) {
  Object.assign(state, next);
  redraw();
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error || fallback) || fallback;
}

/* ── API helpers ───────────────────────────────────────────────────── */

async function authHeaders(): Promise<Record<string, string>> {
  if (!stackApp) {
    return {};
  }
  const auth = await stackApp.getAuthJson();
  return auth?.accessToken ? { "x-stack-access-token": auth.accessToken } : {};
}

async function apiGet(path: string, cachedAuthHeaders: Record<string, string> | null = null) {
  const response = await fetch(`${appConfig.apiBaseUrl}${path}`, {
    headers: {
      ...(cachedAuthHeaders || (await authHeaders())),
      accept: "application/json",
    },
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || `Request failed (${response.status})`);
  }
  return payload;
}

async function apiPost(path: string, body: unknown, cachedAuthHeaders: Record<string, string> | null = null) {
  const response = await fetch(`${appConfig.apiBaseUrl}${path}`, {
    method: "POST",
    headers: {
      ...(cachedAuthHeaders || (await authHeaders())),
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || `Request failed (${response.status})`);
  }
  return payload;
}

async function apiPut(path: string, body: unknown, cachedAuthHeaders: Record<string, string> | null = null) {
  const response = await fetch(`${appConfig.apiBaseUrl}${path}`, {
    method: "PUT",
    headers: {
      ...(cachedAuthHeaders || (await authHeaders())),
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || `Request failed (${response.status})`);
  }
  return payload;
}

async function apiDelete(path: string, cachedAuthHeaders: Record<string, string> | null = null) {
  const response = await fetch(`${appConfig.apiBaseUrl}${path}`, {
    method: "DELETE",
    headers: {
      ...(cachedAuthHeaders || (await authHeaders())),
      accept: "application/json",
    },
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload?.error || `Request failed (${response.status})`);
  }
  return payload;
}

/* ── Actions ───────────────────────────────────────────────────────── */

function sessionStatusMessage(session: any, authCapabilities: StackAuthCapabilities | null): string {
  const accessState = String(session?.accessState || "none");
  if (accessState === "approved") {
    return "Wave Control is ready.";
  }
  if (accessState === "pending") {
    return "Your Wave Control access request is pending review.";
  }
  if (accessState === "rejected") {
    return "Your Wave Control access request was rejected.";
  }
  if (accessState === "revoked") {
    return "Your Wave Control access was revoked.";
  }
  return authCapabilities?.hasAnyMethod
    ? "Request access to load the internal control plane."
    : "No Stack sign-in methods are enabled for this project.";
}

async function refreshApp() {
  if (!stackApp) {
    setState({
      accessRequestReason: "",
      authCapabilities: null,
      benchmarks: [],
      error:
        "Stack client configuration is incomplete. Set VITE_STACK_PROJECT_ID and VITE_STACK_PUBLISHABLE_CLIENT_KEY.",
      loading: false,
      me: null,
      overview: null,
      plaintextToken: "",
      providerCatalog: [],
      runItems: [],
      session: null,
      signedIn: false,
      tokenItems: [],
      userCredentialItems: {},
      userItems: [],
      status: "Stack client is not configured.",
    });
    return;
  }
  setState({ loading: true, error: "", status: "Loading Wave Control data\u2026" });
  let authCapabilities = state.authCapabilities;
  try {
    authCapabilities = resolveStackAuthCapabilities(await stackApp.getProject());
    await completePendingStackCallback(stackApp, {
      href: window.location.href,
      historyLike: window.history,
    });
    const user = await stackApp.getUser();
    if (!user) {
      setState({
        activeView: resolveInitialView(window.location.hash, false),
        accessRequestReason: "",
        authCapabilities,
        benchmarks: [],
        loading: false,
        providerCatalog: [],
        plaintextToken: "",
        session: null,
        signedIn: false,
        status: authCapabilities.hasAnyMethod
          ? "Sign in to load the internal control plane."
          : "No Stack sign-in methods are enabled for this project.",
        me: null,
        overview: null,
        runItems: [],
        tokenItems: [],
        userCredentialItems: {},
        userItems: [],
      });
      return;
    }
    const headers = await authHeaders();
    const sessionPayload = await apiGet("/api/v1/app/session", headers);
    const session = sessionPayload.session || null;
    const providerCatalog = sessionPayload.providerCatalog || [];
    if (!session || session.accessState !== "approved") {
      setState({
        activeView: resolveInitialView(window.location.hash, false),
        accessRequestReason: session?.accessRequestReason || "",
        authCapabilities,
        benchmarks: [],
        loading: false,
        me: null,
        overview: null,
        plaintextToken: "",
        providerCatalog,
        runItems: [],
        session,
        signedIn: false,
        status: sessionStatusMessage(session, authCapabilities),
        tokenItems: [],
        userCredentialItems: {},
        userItems: [],
      });
      return;
    }
    const [overview, runs, benchmarks, tokens, adminUsers] = await Promise.all([
      apiGet("/api/v1/app/overview", headers),
      apiGet("/api/v1/app/runs", headers),
      apiGet("/api/v1/app/benchmarks", headers),
      apiGet("/api/v1/app/tokens", headers),
      session.isSuperuser
        ? apiGet("/api/v1/app/admin/users", headers)
        : Promise.resolve({ items: [] }),
    ]);
    const userItems = adminUsers.items || [];
    const userCredentialEntries = session.isSuperuser
      ? await Promise.all(
          userItems.map(async (user: any) => {
            const credentialPayload = await apiGet(`/api/v1/app/admin/users/${user.id}/credentials`, headers);
            return [user.id, credentialPayload.items || []];
          }),
        )
      : [];
    const activeView = resolveInitialView(window.location.hash, session.isSuperuser === true);
    replaceViewHash(activeView);
    setState({
      activeView,
      accessRequestReason: session.accessRequestReason || "",
      authCapabilities,
      benchmarks: benchmarks.items || [],
      loading: false,
      me: session,
      overview,
      providerCatalog,
      runItems: runs.items || [],
      session,
      signedIn: true,
      status: sessionStatusMessage(session, authCapabilities),
      tokenItems: tokens.items || [],
      userCredentialItems: Object.fromEntries(userCredentialEntries),
      userItems,
    });
  } catch (error) {
    setState({
      authCapabilities,
      error: errorMessage(error, "Sign-in failed."),
      loading: false,
      providerCatalog: [],
      session: null,
      signedIn: false,
      status: "Sign in failed or the API rejected the session.",
      userCredentialItems: {},
      userItems: [],
    });
  }
}

async function signInWithCredentialAction() {
  if (!stackApp) {
    return;
  }
  setState({ loading: true, error: "", status: "Signing in\u2026" });
  try {
    const result: any = await stackApp.signInWithCredential({
      email: state.signInEmail,
      password: state.signInPassword,
      noRedirect: true,
    });
    if (result && (result.status === "error" || result.ok === false || result.error)) {
      throw new Error(errorMessage(result.error || result.message, "Sign-in failed."));
    }
    setState({ signInPassword: "" });
    await refreshApp();
  } catch (error) {
    setState({
      error: errorMessage(error, "Sign-in failed."),
      loading: false,
      status: "Sign-in failed.",
    });
  }
}

async function sendMagicLink() {
  if (!stackApp) {
    return;
  }
  setState({ loading: true, error: "", status: "Sending sign-in link\u2026" });
  try {
    await stackApp.sendMagicLinkEmail(state.signInEmail, {
      callbackUrl: currentAppCallbackUrl(window.location.href),
    });
    setState({
      loading: false,
      status: "Sign-in link sent. Open it in this browser to complete sign-in.",
    });
  } catch (error) {
    setState({
      error: errorMessage(error, "Failed to send sign-in link."),
      loading: false,
      status: "Sign-in failed.",
    });
  }
}

async function signInWithPasskeyAction() {
  if (!stackApp) {
    return;
  }
  setState({ loading: true, error: "", status: "Waiting for passkey confirmation\u2026" });
  try {
    const result = await stackApp.signInWithPasskey();
    if (result && result.status === "error") {
      throw new Error(errorMessage(result.error, "Passkey sign-in failed."));
    }
    await refreshApp();
  } catch (error) {
    setState({
      error: errorMessage(error, "Passkey sign-in failed."),
      loading: false,
      status: "Sign-in failed.",
    });
  }
}

async function signInWithOAuthProvider(providerId: string) {
  if (!stackApp) {
    return;
  }
  const providerLabel = formatOAuthProviderLabel(providerId);
  setState({
    loading: true,
    error: "",
    status: `Redirecting to ${providerLabel}\u2026`,
  });
  try {
    await stackApp.signInWithOAuth(providerId);
  } catch (error) {
    setState({
      error: errorMessage(error, "OAuth sign-in failed."),
      loading: false,
      status: "Sign-in failed.",
    });
  }
}

async function signOut() {
  if (!stackApp) {
    return;
  }
  await stackApp.signOut();
  setState({
    accessRequestReason: "",
    me: null,
    overview: null,
    plaintextToken: "",
    providerCatalog: [],
    runItems: [],
    session: null,
    signedIn: false,
    tokenItems: [],
    userCredentialItems: {},
    userItems: [],
    status: "Signed out.",
  });
  await refreshApp();
}

async function submitAccessRequest() {
  setState({ loading: true, error: "", status: "Submitting access request\u2026" });
  try {
    const headers = await authHeaders();
    await apiPost(
      "/api/v1/app/access-request",
      {
        reason: state.accessRequestReason,
      },
      headers,
    );
    await refreshApp();
  } catch (error) {
    setState({
      error: errorMessage(error, "Access request failed."),
      loading: false,
      status: "Access request failed.",
    });
  }
}

async function createToken() {
  setState({ loading: true, error: "", status: "Issuing a new Wave Control token\u2026" });
  try {
    const headers = await authHeaders();
    const payload = await apiPost(
      "/api/v1/app/tokens",
      {
        label: state.tokenLabel || "Wave CLI token",
      },
      headers,
    );
    setState({
      loading: false,
      plaintextToken: payload.token || "",
      status: "Token created. Copy it now; the plaintext is only shown once.",
      tokenLabel: "",
    });
    await refreshApp();
  } catch (error) {
    setState({
      error: error instanceof Error ? error.message : String(error),
      loading: false,
      status: "Token creation failed.",
    });
  }
}

async function revokeToken(tokenId: string) {
  setState({ loading: true, error: "", status: "Revoking token\u2026" });
  try {
    const headers = await authHeaders();
    await apiPost(`/api/v1/app/tokens/${tokenId}/revoke`, {}, headers);
    setState({
      loading: false,
      plaintextToken: "",
      status: "Token revoked.",
    });
    await refreshApp();
  } catch (error) {
    setState({
      error: error instanceof Error ? error.message : String(error),
      loading: false,
      status: "Token revocation failed.",
    });
  }
}

async function createUserAction() {
  setState({ loading: true, error: "", status: "Saving user access\u2026" });
  try {
    const headers = await authHeaders();
    await apiPost(
      "/api/v1/app/admin/users",
      {
        email: state.newUserEmail,
        role: state.newUserRole,
        accessState: state.newUserAccessState,
        providerGrants:
          state.newUserProviderGrants.length > 0 ? state.newUserProviderGrants : undefined,
      },
      headers,
    );
    setState({
      loading: false,
      newUserEmail: "",
      newUserProviderGrants: [],
      status: "User access updated.",
    });
    await refreshApp();
  } catch (error) {
    setState({
      error: errorMessage(error, "User update failed."),
      loading: false,
      status: "User update failed.",
    });
  }
}

async function setUserStateAction(userId: string, accessState: string) {
  setState({ loading: true, error: "", status: `Setting access state to ${accessState}\u2026` });
  try {
    const headers = await authHeaders();
    await apiPost(`/api/v1/app/admin/users/${userId}/state`, { accessState }, headers);
    await refreshApp();
  } catch (error) {
    setState({
      error: errorMessage(error, "User state update failed."),
      loading: false,
      status: "User state update failed.",
    });
  }
}

async function setUserRoleAction(userId: string, role: string) {
  setState({ loading: true, error: "", status: `Setting role to ${role}\u2026` });
  try {
    const headers = await authHeaders();
    await apiPost(`/api/v1/app/admin/users/${userId}/role`, { role }, headers);
    await refreshApp();
  } catch (error) {
    setState({
      error: errorMessage(error, "User role update failed."),
      loading: false,
      status: "User role update failed.",
    });
  }
}

async function setUserProvidersAction(user: any, providerId: string, enabled: boolean) {
  const nextProviderGrants = enabled
    ? Array.from(new Set([...(user.providerGrants || []), providerId])).sort()
    : (user.providerGrants || []).filter((entry: string) => entry !== providerId);
  setState({ loading: true, error: "", status: `Updating provider grants for ${user.email || "user"}\u2026` });
  try {
    const headers = await authHeaders();
    await apiPost(
      `/api/v1/app/admin/users/${user.id}/providers`,
      { providerGrants: nextProviderGrants },
      headers,
    );
    await refreshApp();
  } catch (error) {
    setState({
      error: errorMessage(error, "Provider grant update failed."),
      loading: false,
      status: "Provider grant update failed.",
    });
  }
}

function setCredentialDraftId(userId: string, value: string) {
  setState({
    credentialDraftIds: {
      ...state.credentialDraftIds,
      [userId]: value,
    },
  });
}

function setCredentialDraftValue(userId: string, value: string) {
  setState({
    credentialDraftValues: {
      ...state.credentialDraftValues,
      [userId]: value,
    },
  });
}

async function upsertUserCredentialAction(userId: string) {
  const credentialId = String(state.credentialDraftIds[userId] || "").trim();
  const value = state.credentialDraftValues[userId] || "";
  if (!credentialId || !value) {
    setState({
      error: "Credential id and value are required.",
      loading: false,
      status: "Credential update failed.",
    });
    return;
  }
  setState({ loading: true, error: "", status: `Saving credential ${credentialId}\u2026` });
  try {
    const headers = await authHeaders();
    await apiPut(`/api/v1/app/admin/users/${userId}/credentials/${encodeURIComponent(credentialId)}`, { value }, headers);
    setState({
      credentialDraftIds: {
        ...state.credentialDraftIds,
        [userId]: "",
      },
      credentialDraftValues: {
        ...state.credentialDraftValues,
        [userId]: "",
      },
      loading: false,
      status: "Credential saved.",
    });
    await refreshApp();
  } catch (error) {
    setState({
      error: errorMessage(error, "Credential update failed."),
      loading: false,
      status: "Credential update failed.",
    });
  }
}

async function deleteUserCredentialAction(userId: string, credentialId: string) {
  setState({ loading: true, error: "", status: `Deleting credential ${credentialId}\u2026` });
  try {
    const headers = await authHeaders();
    await apiDelete(`/api/v1/app/admin/users/${userId}/credentials/${encodeURIComponent(credentialId)}`, headers);
    setState({
      loading: false,
      status: "Credential deleted.",
    });
    await refreshApp();
  } catch (error) {
    setState({
      error: errorMessage(error, "Credential deletion failed."),
      loading: false,
      status: "Credential deletion failed.",
    });
  }
}

function renderSignedInView(): TemplateResult {
  switch (getPrimaryView(state.activeView)) {
    case "operations":
      return renderOperationsView(state);
    case "access":
      return renderAccessView(state, {
        createUserAction,
        deleteUserCredentialAction,
        setCredentialDraftId,
        setCredentialDraftValue,
        setNewUserAccessState: (value: string) => setState({ newUserAccessState: value }),
        setNewUserEmail: (value: string) => setState({ newUserEmail: value }),
        setNewUserProviderGrant: (providerId: string, enabled: boolean) =>
          setState({
            newUserProviderGrants: enabled
              ? Array.from(new Set([...state.newUserProviderGrants, providerId])).sort()
              : state.newUserProviderGrants.filter((entry) => entry !== providerId),
          }),
        setNewUserRole: (value: string) => setState({ newUserRole: value }),
        setUserProvidersAction,
        setUserRoleAction,
        setUserStateAction,
        setView,
        upsertUserCredentialAction,
      });
    case "account":
      return renderAccountView(state, {
        createToken,
        revokeToken,
        setTokenLabel: (value: string) => setState({ tokenLabel: value }),
      });
    default:
      return renderDashboardView(state, {
        setUserStateAction,
        setView,
      });
  }
}

function redraw() {
  render(
    html`
      <div class="site-shell">
        ${renderTopbar(
          state,
          {
            handleThemeToggle,
            refreshApp,
            setPrimaryView,
            signOut,
          },
          getThemeLabel(getStoredTheme()),
        )}
        <main class="main-content ${state.signedIn ? "" : "narrow"}">
          ${state.signedIn
            ? html`
                ${renderSectionNav(state, { setView })}
                ${renderSignedInView()}
              `
            : state.session
              ? renderAccessRequest(state, {
                  setAccessRequestReason: (value: string) => setState({ accessRequestReason: value }),
                  submitAccessRequest,
                })
              : renderSignedOut(
                  state,
                  {
                    sendMagicLink,
                    setSignInEmail: (value: string) => setState({ signInEmail: value }),
                    setSignInPassword: (value: string) => setState({ signInPassword: value }),
                    signInWithCredentialAction,
                    signInWithOAuthProvider,
                    signInWithPasskeyAction,
                  },
                  appConfig.stackProjectId,
                )}
        </main>
        ${renderFooter(appConfig.apiBaseUrl, state.status)}
      </div>
    `,
    root,
  );
}

applyTheme(getStoredTheme());

window.addEventListener("hashchange", () => {
  const nextView = resolveInitialView(window.location.hash, state.session?.isSuperuser === true);
  if (nextView !== state.activeView) {
    setState({ activeView: nextView });
  }
});

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (getStoredTheme() === "system") {
    applyTheme("system");
    redraw();
  }
});

redraw();
void refreshApp();
