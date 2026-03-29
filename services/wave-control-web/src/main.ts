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

type TabId = "overview" | "runs" | "tokens" | "benchmarks";

const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "runs", label: "Runs" },
  { id: "tokens", label: "Tokens" },
  { id: "benchmarks", label: "Benchmarks" },
];

function getActiveTab(): TabId {
  const hash = window.location.hash.slice(1);
  if (hash === "runs" || hash === "tokens" || hash === "benchmarks") return hash;
  return "overview";
}

function setTab(tab: TabId): void {
  window.location.hash = tab;
  setState({ activeTab: tab });
}

/* ── App state ─────────────────────────────────────────────────────── */

type AppState = {
  activeTab: TabId;
  authCapabilities: StackAuthCapabilities | null;
  benchmarks: any[];
  error: string;
  loading: boolean;
  me: any | null;
  overview: any | null;
  plaintextToken: string;
  runItems: any[];
  signedIn: boolean;
  signInEmail: string;
  signInPassword: string;
  status: string;
  tokenItems: any[];
  tokenLabel: string;
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
  authCapabilities: null,
  benchmarks: [],
  error: "",
  loading: true,
  me: null,
  overview: null,
  plaintextToken: "",
  runItems: [],
  signedIn: false,
  signInEmail: "",
  signInPassword: "",
  status: "Checking session\u2026",
  tokenItems: [],
  tokenLabel: "",
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

/* ── Actions ───────────────────────────────────────────────────────── */

async function refreshApp() {
  if (!stackApp) {
    setState({
      authCapabilities: null,
      error:
        "Stack client configuration is incomplete. Set VITE_STACK_PROJECT_ID and VITE_STACK_PUBLISHABLE_CLIENT_KEY.",
      loading: false,
      signedIn: false,
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
        authCapabilities,
        benchmarks: [],
        loading: false,
        plaintextToken: "",
        signedIn: false,
        status: authCapabilities.hasAnyMethod
          ? "Sign in to load the internal control plane."
          : "No Stack sign-in methods are enabled for this project.",
        me: null,
        overview: null,
        runItems: [],
        tokenItems: [],
      });
      return;
    }
    const headers = await authHeaders();
    const [me, overview, runs, benchmarks, tokens] = await Promise.all([
      apiGet("/api/v1/app/me", headers),
      apiGet("/api/v1/app/overview", headers),
      apiGet("/api/v1/app/runs", headers),
      apiGet("/api/v1/app/benchmarks", headers),
      apiGet("/api/v1/app/tokens", headers),
    ]);
    setState({
      authCapabilities,
      benchmarks: benchmarks.items || [],
      loading: false,
      me: me.user || null,
      overview,
      runItems: runs.items || [],
      signedIn: true,
      status: "Wave Control is ready.",
      tokenItems: tokens.items || [],
    });
  } catch (error) {
    setState({
      authCapabilities,
      error: errorMessage(error, "Sign-in failed."),
      loading: false,
      signedIn: false,
      status: "Sign in failed or the API rejected the session.",
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
    me: null,
    overview: null,
    plaintextToken: "",
    runItems: [],
    signedIn: false,
    tokenItems: [],
    status: "Signed out.",
  });
  await refreshApp();
}

async function createToken() {
  setState({ loading: true, error: "", status: "Issuing a new Wave Control token\u2026" });
  try {
    const headers = await authHeaders();
    const payload = await apiPost("/api/v1/app/tokens", {
      label: state.tokenLabel || "Wave CLI token",
      scopes: ["broker:read", "ingest:write"],
    }, headers);
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
          ? TABS.map(
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
        ${state.signedIn
          ? html`
              <button class="theme-toggle" @click=${refreshApp}>Refresh</button>
              <button class="theme-toggle" @click=${signOut}>Sign out</button>
            `
          : ""}
      </div>
    </header>
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
        ${state.me?.isAdmin ? "admin-team" : "internal-team"}
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
  const isAdmin = state.me?.isAdmin === true;
  return html`
    <section class="page-hero">
      <h1>Tokens</h1>
      <p class="supporting">
        Use <code>WAVE_API_TOKEN</code> for repo runtime broker access. Default tokens get
        <code>broker:read</code> and <code>ingest:write</code>.
      </p>
    </section>

    ${isAdmin
      ? html`
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
        `
      : html`<p class="inline-note" style="margin-top:1rem">
          Admin-team membership is required to issue or revoke tokens.
        </p>`}
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
              ${isAdmin && !token.revokedAt
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

/* ── Render: tab content router ────────────────────────────────────── */

function renderTabContent(): TemplateResult {
  switch (state.activeTab) {
    case "runs":
      return renderRuns();
    case "tokens":
      return renderTokens();
    case "benchmarks":
      return renderBenchmarks();
    default:
      return renderOverview();
  }
}

/* ── Render: tab bar ───────────────────────────────────────────────── */

function renderTabBar(): TemplateResult {
  return html`
    <nav class="tab-bar" aria-label="Sections">
      ${TABS.map(
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
          ${state.signedIn ? html`${renderTabBar()}${renderTabContent()}` : renderSignedOut()}
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
