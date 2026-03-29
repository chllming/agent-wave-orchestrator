import { html, render, type TemplateResult } from "lit";
import { appConfig } from "./config";
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

/* ── Tab routing ───────────────────────────────────────────────────── */

type TabId = "overview" | "runs" | "tokens" | "benchmarks" | "users";

const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "runs", label: "Runs" },
  { id: "tokens", label: "Tokens" },
  { id: "benchmarks", label: "Benchmarks" },
  { id: "users", label: "Users" },
];

function getActiveTab(): TabId {
  const hash = window.location.hash.slice(1);
  if (hash === "runs" || hash === "tokens" || hash === "benchmarks" || hash === "users") return hash;
  return "overview";
}

function setTab(tab: TabId): void {
  window.location.hash = tab;
  setState({ activeTab: tab });
}

function visibleTabs(): { id: TabId; label: string }[] {
  return state.session?.isSuperuser ? TABS : TABS.filter((tab) => tab.id !== "users");
}

/* ── App state ─────────────────────────────────────────────────────── */

type AppState = {
  activeTab: TabId;
  accessRequestReason: string;
  authCapabilities: StackAuthCapabilities | null;
  benchmarks: any[];
  credentialDraftIds: Record<string, string>;
  credentialDraftValues: Record<string, string>;
  error: string;
  loading: boolean;
  me: any | null;
  newUserAccessState: string;
  newUserEmail: string;
  newUserProviderGrants: string[];
  newUserRole: string;
  overview: any | null;
  plaintextToken: string;
  providerCatalog: any[];
  runItems: any[];
  session: any | null;
  signedIn: boolean;
  signInEmail: string;
  signInPassword: string;
  status: string;
  tokenItems: any[];
  tokenLabel: string;
  userCredentialItems: Record<string, any[]>;
  userItems: any[];
};

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
  activeTab: getActiveTab(),
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
    setState({
      activeTab: state.activeTab === "users" && !session.isSuperuser ? "overview" : state.activeTab,
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

/* ── Render: topbar ────────────────────────────────────────────────── */

function renderTopbar(): TemplateResult {
  return html`
    <header class="topbar">
      <div class="brand">
        <div class="brand-copy">
          <span class="brand-name">Wave Control</span>
          <span class="brand-subtitle">internal operator surface</span>
        </div>
      </div>
      <nav class="topnav" aria-label="Primary">
        ${state.signedIn
          ? visibleTabs().map(
              (tab) => html`
                <a
                  class="nav-link ${state.activeTab === tab.id ? "is-active" : ""}"
                  href="#${tab.id}"
                  @click=${(e: Event) => {
                    e.preventDefault();
                    setTab(tab.id);
                  }}
                  >${tab.label}</a
                >
              `,
            )
          : ""}
      </nav>
      <div class="topbar-actions">
        <button class="theme-toggle" @click=${handleThemeToggle}>
          ${getThemeLabel(getStoredTheme())}
        </button>
        ${state.session
          ? html`
              <button class="theme-toggle" @click=${refreshApp}>Refresh</button>
              <button class="theme-toggle" @click=${signOut}>Sign out</button>
            `
          : ""}
      </div>
    </header>
  `;
}

function renderAccessRequest(): TemplateResult {
  const accessState = String(state.session?.accessState || "none");
  const canRequest = accessState === "none" || accessState === "pending";
  return html`
    <section class="signin-hero">
      <h1>Wave Control Access</h1>
      <p class="lead">
        ${accessState === "pending"
          ? "Your access request is pending superuser review."
          : accessState === "rejected"
            ? "This account was rejected for Wave Control access."
            : accessState === "revoked"
              ? "This account no longer has Wave Control access."
              : "Request access to the internal operator surface."}
      </p>
      <p class="supporting">
        Signed in as <code>${state.session?.email || "unknown"}</code>.
        ${state.session?.role ? html`Current role: <code>${state.session.role}</code>.` : ""}
      </p>
      ${canRequest
        ? html`
            <div class="signin-form">
              <textarea
                class="form-input form-textarea"
                .value=${state.accessRequestReason}
                @input=${(event: Event) =>
                  setState({ accessRequestReason: (event.target as HTMLTextAreaElement).value })}
                placeholder="Why do you need Wave Control access?"
              ></textarea>
              <div class="auth-actions">
                <button class="btn btn-primary" ?disabled=${state.loading} @click=${submitAccessRequest}>
                  ${accessState === "pending" ? "Update request" : "Request access"}
                </button>
              </div>
            </div>
          `
        : html``}
      <p class="inline-note" style="margin-top:1.5rem">
        Providers requested after approval are managed per user by Wave Control superusers.
      </p>
    </section>
    ${state.error ? html`<div class="flash error">${state.error}</div>` : ""}
  `;
}

/* ── Render: footer ────────────────────────────────────────────────── */

function renderFooter(): TemplateResult {
  return html`
    <footer class="site-footer">
      <p class="footer-line">
        Wave Control &middot; <code>${appConfig.apiBaseUrl}</code> &middot; ${state.status}
      </p>
    </footer>
  `;
}

/* ── Render: sign-in (pre-auth) ────────────────────────────────────── */

function renderSignedOut(): TemplateResult {
  const auth = state.authCapabilities;
  const supportsEmail = auth?.credentialEnabled || auth?.magicLinkEnabled;
  return html`
    <section class="signin-hero">
      <h1>Wave Control</h1>
      <p class="lead">Internal operator surface for runs, brokers, and closure.</p>
      <p class="supporting">
        Sign in with your Stack Auth internal account. The API verifies your session and enforces
        confirmed internal-team membership.
      </p>
      <div class="signin-form">
        ${supportsEmail
          ? html`
              <input
                class="form-input"
                type="email"
                .value=${state.signInEmail}
                @input=${(event: Event) =>
                  setState({ signInEmail: (event.target as HTMLInputElement).value })}
                placeholder="you@company.com"
              />
            `
          : ""}
        ${auth?.credentialEnabled
          ? html`
              <input
                class="form-input"
                type="password"
                .value=${state.signInPassword}
                @input=${(event: Event) =>
                  setState({ signInPassword: (event.target as HTMLInputElement).value })}
                placeholder="Password"
              />
            `
          : ""}
        <div class="auth-actions">
          ${auth?.credentialEnabled
            ? html`
                <button
                  class="btn btn-primary"
                  ?disabled=${state.loading || !state.signInEmail.trim() || !state.signInPassword.trim()}
                  @click=${signInWithCredentialAction}
                >
                  Sign in
                </button>
              `
            : ""}
          ${auth?.magicLinkEnabled
            ? html`
                <button
                  class="btn"
                  ?disabled=${state.loading || !state.signInEmail.trim()}
                  @click=${sendMagicLink}
                >
                  Email sign-in link
                </button>
              `
            : ""}
          ${auth?.passkeyEnabled
            ? html`
                <button class="btn" ?disabled=${state.loading} @click=${signInWithPasskeyAction}>
                  Use passkey
                </button>
              `
            : ""}
        </div>
        ${auth?.oauthProviders?.length
          ? html`
              <div class="oauth-options">
                ${auth.oauthProviders.map(
                  (providerId) => html`
                    <button
                      class="btn"
                      ?disabled=${state.loading}
                      @click=${() => signInWithOAuthProvider(providerId)}
                    >
                      Continue with ${formatOAuthProviderLabel(providerId)}
                    </button>
                  `,
                )}
              </div>
            `
          : ""}
        ${auth && !auth.hasAnyMethod
          ? html`<p class="inline-note">No Stack sign-in methods are enabled for this project.</p>`
          : auth
            ? html`<p class="inline-note">Available methods are loaded from the Stack project configuration.</p>`
            : html`<p class="inline-note">Loading Stack sign-in methods\u2026</p>`}
      </div>
      <p class="inline-note" style="margin-top:1.5rem">
        API: <code>${appConfig.apiBaseUrl}</code> &middot; Stack project:
        <code>${appConfig.stackProjectId || "missing"}</code>
      </p>
    </section>
    ${state.error ? html`<div class="flash error">${state.error}</div>` : ""}
  `;
}

/* ── Render: metric helper ─────────────────────────────────────────── */

function metric(label: string, value: string | number): TemplateResult {
  return html`<div class="metric">
    <span class="metric-label">${label}</span>
    <span class="metric-value">${value}</span>
  </div>`;
}

/* ── Render: overview tab ──────────────────────────────────────────── */

function renderOverview(): TemplateResult {
  return html`
    <section class="page-hero">
      <h1>${state.me?.displayName || state.me?.email || "Internal user"}</h1>
      <p class="supporting">
        ${state.me?.email || "unknown"} &middot;
        ${state.me?.isSuperuser ? "superuser" : state.me?.role || "member"} &middot;
        grants=${(state.me?.providerGrants || []).join(", ") || "none"}
      </p>
    </section>

    <div class="metrics">
      ${metric("Runs", state.overview?.overview?.runCount || 0)}
      ${metric("Benchmarks", state.overview?.overview?.benchmarkRunCount || 0)}
      ${metric("Artifacts", state.overview?.overview?.artifactCount || 0)}
      ${metric("Proof Bundles", state.overview?.overview?.proofBundleCount || 0)}
    </div>

    <h3 class="section-heading">Recent Runs</h3>
    <div class="data-list">
      ${(state.runItems || []).slice(0, 6).map(
        (run) => html`
          <div class="data-row">
            <div class="data-row-main">
              <div class="data-row-title">
                ${run.projectId || "project"} / ${run.lane || "lane"}
              </div>
              <p class="data-row-meta">
                wave=${run.wave ?? "n/a"} &middot; updated=${run.updatedAt || "n/a"} &middot;
                gate=${run.latestGate || "n/a"}
              </p>
            </div>
            <span class="pill">${run.status || "unknown"}</span>
          </div>
        `,
      )}
    </div>

    <h3 class="section-heading">Future surfaces</h3>
    <div class="placeholder-grid">
      <div class="placeholder">
        <p class="eyebrow">Projects</p>
        <p class="inline-note">
          Project summaries, environment mappings, broker coverage, and cross-run health.
        </p>
      </div>
      <div class="placeholder">
        <p class="eyebrow">Evals</p>
        <p class="inline-note">
          Benchmark trends, validity breakdowns, and run-to-run regression review.
        </p>
      </div>
    </div>

    ${state.error ? html`<div class="flash error">${state.error}</div>` : ""}
  `;
}

/* ── Render: runs tab ──────────────────────────────────────────────── */

function renderRuns(): TemplateResult {
  return html`
    <section class="page-hero">
      <h1>Runs</h1>
      <p class="supporting">All orchestrated runs reported to this control plane.</p>
    </section>

    <div class="data-list">
      ${(state.runItems || []).length === 0
        ? html`<p class="inline-note">No runs found.</p>`
        : (state.runItems || []).map(
            (run) => html`
              <div class="data-row">
                <div class="data-row-main">
                  <div class="data-row-title">
                    ${run.projectId || "project"} / ${run.lane || "lane"}
                  </div>
                  <p class="data-row-meta">
                    wave=${run.wave ?? "n/a"} &middot; updated=${run.updatedAt || "n/a"} &middot;
                    gate=${run.latestGate || "n/a"}
                  </p>
                </div>
                <span class="pill">${run.status || "unknown"}</span>
              </div>
            `,
          )}
    </div>
    ${state.error ? html`<div class="flash error">${state.error}</div>` : ""}
  `;
}

/* ── Render: tokens tab ────────────────────────────────────────────── */

function renderTokens(): TemplateResult {
  const isSuperuser = state.me?.isSuperuser === true;
  return html`
    <section class="page-hero">
      <h1>Tokens</h1>
      <p class="supporting">
        Issue personal tokens for repo runtime access. Approved users can self-issue tokens;
        superusers can manage users and grants separately.
      </p>
    </section>

    <div class="token-form">
      <input
        class="form-input"
        .value=${state.tokenLabel}
        @input=${(event: Event) =>
          setState({ tokenLabel: (event.target as HTMLInputElement).value })}
        placeholder="Token label"
      />
      <div>
        <button class="btn btn-primary" ?disabled=${state.loading} @click=${createToken}>
          Issue token
        </button>
      </div>
    </div>
    <p class="inline-note" style="margin-top:1rem">
      Approved users receive broker, ingest, and <code>credential:read</code> by default. Provider
      grants and stored credentials still gate what each token can actually lease at runtime.
    </p>
    ${state.plaintextToken
      ? html`
          <div class="flash token-plaintext">
            <p class="eyebrow">Plaintext token</p>
            <div class="mono">${state.plaintextToken}</div>
          </div>
        `
      : ""}

    <div class="data-list">
      ${(state.tokenItems || []).map(
        (token) => html`
          <div class="data-row">
            <div class="data-row-main">
              <div class="data-row-title">${token.label || token.id}</div>
              <p class="data-row-meta">
                <span class="mono">${token.id}</span>
              </p>
              <p class="data-row-meta">
                scopes=${(token.scopes || []).join(", ") || "none"} &middot;
                created=${token.createdAt || "n/a"} &middot; last
                used=${token.lastUsedAt || "never"}
              </p>
            </div>
            <div class="data-row-actions">
              <span class=${token.revokedAt ? "pill danger" : "pill success"}>
                ${token.revokedAt ? "revoked" : "active"}
              </span>
              ${!token.revokedAt
                ? html`<button
                    class="btn btn-danger"
                    ?disabled=${state.loading}
                    @click=${() => revokeToken(token.id)}
                  >
                    Revoke
                  </button>`
                : ""}
            </div>
          </div>
        `,
      )}
    </div>
    ${state.error ? html`<div class="flash error">${state.error}</div>` : ""}
  `;
}

/* ── Render: benchmarks tab ────────────────────────────────────────── */

function renderBenchmarks(): TemplateResult {
  return html`
    <section class="page-hero">
      <h1>Benchmarks</h1>
      <p class="supporting">Benchmark runs and evaluation results.</p>
    </section>

    <div class="data-list">
      ${(state.benchmarks || []).length === 0
        ? html`<p class="inline-note">No benchmark runs found.</p>`
        : (state.benchmarks || []).map(
            (bm) => html`
              <div class="data-row">
                <div class="data-row-main">
                  <div class="data-row-title">${bm.benchmarkRunId || bm.id || "benchmark"}</div>
                  <p class="data-row-meta">
                    items=${bm.itemCount ?? "n/a"} &middot; updated=${bm.updatedAt || "n/a"}
                  </p>
                </div>
                <span class="pill">${bm.status || "recorded"}</span>
              </div>
            `,
          )}
    </div>
    ${state.error ? html`<div class="flash error">${state.error}</div>` : ""}
  `;
}

/* ── Render: users tab ─────────────────────────────────────────────── */

function renderUsers(): TemplateResult {
  const providerCatalog = state.providerCatalog || [];
  return html`
    <section class="page-hero">
      <h1>Users</h1>
      <p class="supporting">
        Approve access, assign roles, and grant provider credentials for approved users.
      </p>
    </section>

    <div class="admin-grid">
      <div class="admin-panel">
        <p class="eyebrow">Add Or Approve User</p>
        <div class="token-form">
          <input
            class="form-input"
            .value=${state.newUserEmail}
            @input=${(event: Event) =>
              setState({ newUserEmail: (event.target as HTMLInputElement).value })}
            placeholder="user@company.com"
          />
          <select
            class="form-input"
            .value=${state.newUserRole}
            @change=${(event: Event) =>
              setState({ newUserRole: (event.target as HTMLSelectElement).value })}
          >
            <option value="member">member</option>
            <option value="superuser">superuser</option>
          </select>
          <select
            class="form-input"
            .value=${state.newUserAccessState}
            @change=${(event: Event) =>
              setState({ newUserAccessState: (event.target as HTMLSelectElement).value })}
          >
            <option value="approved">approved</option>
            <option value="pending">pending</option>
            <option value="rejected">rejected</option>
            <option value="revoked">revoked</option>
          </select>
          <div class="checkbox-grid">
            ${providerCatalog.map(
              (provider) => html`
                <label class="checkbox-row">
                  <input
                    type="checkbox"
                    .checked=${state.newUserProviderGrants.includes(provider.id)}
                    @change=${(event: Event) =>
                      setState({
                        newUserProviderGrants: (event.target as HTMLInputElement).checked
                          ? Array.from(new Set([...state.newUserProviderGrants, provider.id])).sort()
                          : state.newUserProviderGrants.filter((entry) => entry !== provider.id),
                      })}
                  />
                  <span>${provider.label}</span>
                  <span class="inline-note">${provider.delivery}${provider.enabled ? "" : " (disabled)"}</span>
                </label>
              `,
            )}
          </div>
          <div>
            <button
              class="btn btn-primary"
              ?disabled=${state.loading || !state.newUserEmail.trim()}
              @click=${createUserAction}
            >
              Save user
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="data-list">
      ${(state.userItems || []).map(
        (user) => html`
          <div class="data-row admin-row">
            <div class="data-row-main">
              <div class="data-row-title">${user.displayName || user.email || user.id}</div>
              <p class="data-row-meta">
                ${user.email || "unknown"} &middot; role=${user.role || "member"} &middot;
                access=${user.accessState || "none"}
              </p>
              <p class="data-row-meta">
                grants=${(user.providerGrants || []).join(", ") || "none"} &middot;
                requested=${user.accessRequestedAt || "n/a"} &middot;
                reviewed=${user.accessReviewedAt || "n/a"}
              </p>
              <div class="credential-list">
                <p class="eyebrow">Stored Credentials</p>
                ${((state.userCredentialItems[user.id] || []) as any[]).length === 0
                  ? html`<p class="inline-note">No credentials stored.</p>`
                  : ((state.userCredentialItems[user.id] || []) as any[]).map(
                      (credential) => html`
                        <div class="credential-row">
                          <div>
                            <div class="data-row-title">${credential.credentialId}</div>
                            <p class="data-row-meta">
                              updated=${credential.updatedAt || "n/a"} &middot;
                              key=${credential.keyVersion || "n/a"}
                            </p>
                          </div>
                          <button
                            class="btn btn-danger"
                            ?disabled=${state.loading}
                            @click=${() => deleteUserCredentialAction(user.id, credential.credentialId)}
                          >
                            Delete
                          </button>
                        </div>
                      `,
                    )}
                <div class="credential-form">
                  <input
                    class="form-input"
                    .value=${state.credentialDraftIds[user.id] || ""}
                    @input=${(event: Event) =>
                      setCredentialDraftId(user.id, (event.target as HTMLInputElement).value)}
                    placeholder="credential id"
                  />
                  <input
                    class="form-input"
                    type="password"
                    .value=${state.credentialDraftValues[user.id] || ""}
                    @input=${(event: Event) =>
                      setCredentialDraftValue(user.id, (event.target as HTMLInputElement).value)}
                    placeholder="secret value"
                  />
                  <div>
                    <button
                      class="btn"
                      ?disabled=${state.loading}
                      @click=${() => upsertUserCredentialAction(user.id)}
                    >
                      Create or rotate
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <div class="admin-actions">
              <div class="auth-actions">
                <button class="btn" ?disabled=${state.loading} @click=${() => setUserStateAction(user.id, "approved")}>
                  Approve
                </button>
                <button class="btn" ?disabled=${state.loading} @click=${() => setUserStateAction(user.id, "pending")}>
                  Pending
                </button>
                <button class="btn btn-danger" ?disabled=${state.loading} @click=${() => setUserStateAction(user.id, "rejected")}>
                  Reject
                </button>
                <button class="btn btn-danger" ?disabled=${state.loading} @click=${() => setUserStateAction(user.id, "revoked")}>
                  Revoke
                </button>
                <button
                  class="btn"
                  ?disabled=${state.loading}
                  @click=${() => setUserRoleAction(user.id, user.role === "superuser" ? "member" : "superuser")}
                >
                  ${user.role === "superuser" ? "Make member" : "Make superuser"}
                </button>
              </div>
              <div class="checkbox-grid">
                ${providerCatalog.map(
                  (provider) => html`
                    <label class="checkbox-row">
                      <input
                        type="checkbox"
                        .checked=${(user.providerGrants || []).includes(provider.id)}
                        @change=${(event: Event) =>
                          setUserProvidersAction(
                            user,
                            provider.id,
                            (event.target as HTMLInputElement).checked,
                          )}
                      />
                      <span>${provider.label}</span>
                      <span class="inline-note">${provider.delivery}${provider.enabled ? "" : " (disabled)"}</span>
                    </label>
                  `,
                )}
              </div>
            </div>
          </div>
        `,
      )}
    </div>
    ${state.error ? html`<div class="flash error">${state.error}</div>` : ""}
  `;
}

/* ── Render: tab content router ────────────────────────────────────── */

function renderTabContent(): TemplateResult {
  switch (state.activeTab) {
    case "runs":
      return renderRuns();
    case "tokens":
      return renderTokens();
    case "benchmarks":
      return renderBenchmarks();
    case "users":
      return renderUsers();
    default:
      return renderOverview();
  }
}

/* ── Render: tab bar ───────────────────────────────────────────────── */

function renderTabBar(): TemplateResult {
  return html`
    <nav class="tab-bar" aria-label="Sections">
      ${visibleTabs().map(
        (tab) => html`
          <a
            class="tab-link ${state.activeTab === tab.id ? "is-active" : ""}"
            href="#${tab.id}"
            @click=${(e: Event) => {
              e.preventDefault();
              setTab(tab.id);
            }}
            >${tab.label}</a
          >
        `,
      )}
    </nav>
  `;
}

/* ── Main redraw ───────────────────────────────────────────────────── */

function redraw() {
  render(
    html`
      <div class="site-shell">
        ${renderTopbar()}
        <main class="main-content ${state.signedIn ? "" : "narrow"}">
          ${state.signedIn
            ? html`${renderTabBar()}${renderTabContent()}`
            : state.session
              ? renderAccessRequest()
              : renderSignedOut()}
        </main>
        ${renderFooter()}
      </div>
    `,
    root,
  );
}

/* ── Bootstrap ─────────────────────────────────────────────────────── */

applyTheme(getStoredTheme());

window.addEventListener("hashchange", () => {
  setState({ activeTab: getActiveTab() });
});

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (getStoredTheme() === "system") {
    applyTheme("system");
    redraw();
  }
});

redraw();
void refreshApp();
