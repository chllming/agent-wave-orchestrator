import { html, nothing, type TemplateResult } from "lit";
import type { AppState, AppViewActions } from "./app-state";
import {
  getDefaultViewForPrimary,
  getPrimaryNavItems,
  getPrimaryView,
  getSectionNavItems,
  getViewHash,
} from "./navigation";
import { formatOAuthProviderLabel } from "./stack-auth";

export function renderTopbar(
  state: AppState,
  actions: Pick<AppViewActions, "handleThemeToggle" | "refreshApp" | "setPrimaryView" | "signOut">,
  themeLabel: string,
): TemplateResult {
  const isSuperuser = state.session?.isSuperuser === true;

  return html`
    <header class="topbar">
      <div class="brand">
        <div class="brand-copy">
          <span class="brand-name">Wave Control</span>
          <span class="brand-subtitle">internal admin and operator surface</span>
        </div>
      </div>
      <nav class="topnav" aria-label="Primary">
        ${state.signedIn
          ? getPrimaryNavItems(isSuperuser).map(
              (item) => html`
                <a
                  class="nav-link ${getPrimaryView(state.activeView) === item.id ? "is-active" : ""}"
                  href=${getViewHash(getDefaultViewForPrimary(item.id, isSuperuser))}
                  @click=${(event: Event) => {
                    event.preventDefault();
                    actions.setPrimaryView(item.id);
                  }}
                >
                  ${item.label}
                </a>
              `,
            )
          : nothing}
      </nav>
      <div class="topbar-actions">
        <button class="theme-toggle" @click=${actions.handleThemeToggle}>${themeLabel}</button>
        ${state.session
          ? html`
              <button class="theme-toggle" @click=${actions.refreshApp}>Refresh</button>
              <button class="theme-toggle" @click=${actions.signOut}>Sign out</button>
            `
          : nothing}
      </div>
    </header>
  `;
}

export function renderSectionNav(
  state: AppState,
  actions: Pick<AppViewActions, "setView">,
): TemplateResult {
  const items = getSectionNavItems(getPrimaryView(state.activeView), state.session?.isSuperuser === true);
  if (items.length <= 1) {
    return html``;
  }

  return html`
    <nav class="tab-bar" aria-label="Section">
      ${items.map(
        (item) => html`
          <a
            class="tab-link ${state.activeView === item.id ? "is-active" : ""}"
            href=${getViewHash(item.id)}
            @click=${(event: Event) => {
              event.preventDefault();
              actions.setView(item.id);
            }}
          >
            ${item.label}
          </a>
        `,
      )}
    </nav>
  `;
}

export function renderAccessRequest(
  state: AppState,
  actions: Pick<AppViewActions, "setAccessRequestReason" | "submitAccessRequest">,
): TemplateResult {
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
        ${state.session?.role ? html`Current role: <code>${state.session.role}</code>.` : nothing}
      </p>
      ${canRequest
        ? html`
            <div class="signin-form">
              <textarea
                class="form-input form-textarea"
                .value=${state.accessRequestReason}
                @input=${(event: Event) =>
                  actions.setAccessRequestReason((event.target as HTMLTextAreaElement).value)}
                placeholder="Why do you need Wave Control access?"
              ></textarea>
              <div class="auth-actions">
                <button class="btn btn-primary" ?disabled=${state.loading} @click=${actions.submitAccessRequest}>
                  ${accessState === "pending" ? "Update request" : "Request access"}
                </button>
              </div>
            </div>
          `
        : nothing}
      <p class="inline-note" style="margin-top:1.5rem">
        Providers requested after approval are managed per user by Wave Control superusers.
      </p>
    </section>
    ${state.error ? html`<div class="flash error">${state.error}</div>` : nothing}
  `;
}

export function renderFooter(apiBaseUrl: string, status: string): TemplateResult {
  return html`
    <footer class="site-footer">
      <p class="footer-line">
        Wave Control &middot; <code>${apiBaseUrl}</code> &middot; ${status}
      </p>
    </footer>
  `;
}

export function renderSignedOut(
  state: AppState,
  actions: Pick<
    AppViewActions,
    | "sendMagicLink"
    | "setSignInEmail"
    | "setSignInPassword"
    | "signInWithCredentialAction"
    | "signInWithOAuthProvider"
    | "signInWithPasskeyAction"
  >,
  stackProjectId: string,
): TemplateResult {
  const auth = state.authCapabilities;
  const supportsEmail = auth?.credentialEnabled || auth?.magicLinkEnabled;

  return html`
    <section class="signin-hero">
      <h1>Wave Control</h1>
      <p class="lead">Internal operator surface for runs, access, and closure.</p>
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
                @input=${(event: Event) => actions.setSignInEmail((event.target as HTMLInputElement).value)}
                placeholder="you@company.com"
              />
            `
          : nothing}
        ${auth?.credentialEnabled
          ? html`
              <input
                class="form-input"
                type="password"
                .value=${state.signInPassword}
                @input=${(event: Event) => actions.setSignInPassword((event.target as HTMLInputElement).value)}
                placeholder="Password"
              />
            `
          : nothing}
        <div class="auth-actions">
          ${auth?.credentialEnabled
            ? html`
                <button
                  class="btn btn-primary"
                  ?disabled=${state.loading || !state.signInEmail.trim() || !state.signInPassword.trim()}
                  @click=${actions.signInWithCredentialAction}
                >
                  Sign in
                </button>
              `
            : nothing}
          ${auth?.magicLinkEnabled
            ? html`
                <button
                  class="btn"
                  ?disabled=${state.loading || !state.signInEmail.trim()}
                  @click=${actions.sendMagicLink}
                >
                  Email sign-in link
                </button>
              `
            : nothing}
          ${auth?.passkeyEnabled
            ? html`
                <button class="btn" ?disabled=${state.loading} @click=${actions.signInWithPasskeyAction}>
                  Use passkey
                </button>
              `
            : nothing}
        </div>
        ${auth?.oauthProviders?.length
          ? html`
              <div class="oauth-options">
                ${auth.oauthProviders.map(
                  (providerId) => html`
                    <button
                      class="btn"
                      ?disabled=${state.loading}
                      @click=${() => actions.signInWithOAuthProvider(providerId)}
                    >
                      Continue with ${formatOAuthProviderLabel(providerId)}
                    </button>
                  `,
                )}
              </div>
            `
          : nothing}
        ${auth && !auth.hasAnyMethod
          ? html`<p class="inline-note">No Stack sign-in methods are enabled for this project.</p>`
          : auth
            ? html`<p class="inline-note">Available methods are loaded from the Stack project configuration.</p>`
            : html`<p class="inline-note">Loading Stack sign-in methods…</p>`}
      </div>
      <p class="inline-note" style="margin-top:1.5rem">
        Stack project: <code>${stackProjectId || "missing"}</code>
      </p>
    </section>
    ${state.error ? html`<div class="flash error">${state.error}</div>` : nothing}
  `;
}
