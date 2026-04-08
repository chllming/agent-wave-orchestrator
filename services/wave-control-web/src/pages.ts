import { html, nothing, type TemplateResult } from "lit";
import { buildAccessSummary, getPendingAccessUsers } from "./access-summary";
import type { AppRecord, AppState, AppViewActions, BenchmarkSummary, CountMap, RunSummary } from "./app-state";
import {
  buildDashboardSummary,
  getSortedCountEntries,
  isHealthyGate,
  type DashboardAttentionItem,
} from "./dashboard-summary";

function metric(label: string, value: string | number): TemplateResult {
  return html`<div class="metric">
    <span class="metric-label">${label}</span>
    <span class="metric-value">${value}</span>
  </div>`;
}

function formatTimestampLabel(value: string | null | undefined): string {
  return value ? value.replace("T", " ").replace(".000Z", "Z") : "n/a";
}

function toneClass(value: string | null | undefined): string {
  const normalized = String(value || "").trim().toLowerCase();
  if (["approved", "completed", "comparison-valid", "pass", "ready", "success"].includes(normalized)) {
    return "pill success";
  }
  if (
    ["blocked", "failed", "invalid", "pending", "rejected", "revoked", "running"].includes(normalized) ||
    normalized.includes("barrier")
  ) {
    return "pill danger";
  }
  return "pill";
}

function hasBenchmarkReviewIssues(reviewBreakdown: CountMap): boolean {
  return Object.entries(reviewBreakdown || {}).some(
    ([label, count]) =>
      !["comparison-valid", "review-only"].includes(label) && Number(count || 0) > 0,
  );
}

export function getRunBadge(run: Pick<RunSummary, "status" | "latestGate">): {
  label: string;
  className: string;
} {
  const status = String(run.status || "unknown");
  if (status !== "completed") {
    return { label: status, className: "pill danger" };
  }
  if (!isHealthyGate(run.latestGate)) {
    return { label: "needs follow-up", className: "pill danger" };
  }
  return { label: "healthy", className: "pill success" };
}

export function getBenchmarkBadge(
  benchmark: Pick<BenchmarkSummary, "status" | "comparisonReady" | "reviewBreakdown">,
): { label: string; className: string } {
  const status = String(benchmark.status || "unknown");
  if (status !== "completed") {
    return { label: status, className: "pill danger" };
  }
  if (hasBenchmarkReviewIssues(benchmark.reviewBreakdown || {}) || benchmark.comparisonReady === false) {
    return { label: "needs follow-up", className: "pill danger" };
  }
  if (benchmark.comparisonReady === true) {
    return { label: "ready", className: "pill success" };
  }
  return { label: "snapshot", className: "pill" };
}

function renderBreakdownChips(counts: CountMap): TemplateResult {
  const entries = getSortedCountEntries(counts).slice(0, 4);
  if (entries.length === 0) {
    return html`<p class="inline-note">No snapshot data yet.</p>`;
  }

  return html`
    <div class="chip-row">
      ${entries.map(
        (entry) => html`<span class=${toneClass(entry.label)}>${entry.label} ${entry.count}</span>`,
      )}
    </div>
  `;
}

function renderPanelStats(stats: Array<{ label: string; value: string | number }>): TemplateResult {
  return html`
    <div class="panel-stats">
      ${stats.map(
        (stat) => html`
          <div class="panel-stat">
            <span class="panel-stat-value">${stat.value}</span>
            <span class="panel-stat-label">${stat.label}</span>
          </div>
        `,
      )}
    </div>
  `;
}

function renderSummaryPanel(
  eyebrow: string,
  copy: string,
  stats: Array<{ label: string; value: string | number }>,
  breakdowns: Array<{ label: string; counts: CountMap }>,
): TemplateResult {
  return html`
    <section class="summary-panel">
      <p class="eyebrow">${eyebrow}</p>
      <p class="panel-copy">${copy}</p>
      ${renderPanelStats(stats)}
      ${breakdowns.map(
        (breakdown) => html`
          <div class="panel-breakdown">
            <span class="panel-breakdown-label">${breakdown.label}</span>
            ${renderBreakdownChips(breakdown.counts)}
          </div>
        `,
      )}
    </section>
  `;
}

function comparisonStateLabel(benchmark: Pick<BenchmarkSummary, "comparisonReady">): string {
  if (benchmark.comparisonReady === true) {
    return "ready";
  }
  if (benchmark.comparisonReady === false) {
    return "pending";
  }
  return "unknown";
}

function reviewBreakdownLabel(reviewBreakdown: CountMap): string {
  const entries = getSortedCountEntries(reviewBreakdown).slice(0, 3);
  if (entries.length === 0) {
    return "no review signals";
  }
  return entries.map((entry) => `${entry.label}=${entry.count}`).join(", ");
}

function renderRunsList(runItems: RunSummary[], limit?: number): TemplateResult {
  const items = typeof limit === "number" ? runItems.slice(0, limit) : runItems;
  if (items.length === 0) {
    return html`<p class="inline-note">No runs found.</p>`;
  }

  return html`
    <div class="data-list">
      ${items.map(
        (run) => {
          const badge = getRunBadge(run);
          return html`
            <div class="data-row">
              <div class="data-row-main">
                <div class="data-row-title">
                  ${run.projectId || "project"} / ${run.lane || "lane"} / wave ${run.wave ?? "n/a"}
                </div>
                <p class="data-row-meta">
                  status=${run.status || "unknown"} &middot; gate=${run.latestGate || "n/a"} &middot;
                  updated=${formatTimestampLabel(run.updatedAt)}
                </p>
                <p class="data-row-meta">
                  ${run.attemptCount} attempts &middot; ${(run.agentIds || []).length} agents &middot;
                  ${run.proofBundleCount} proofs &middot; ${run.coordinationRecordCount} coordination &middot;
                  ${run.artifactCount} artifacts
                </p>
              </div>
              <span class=${badge.className}>${badge.label}</span>
            </div>
          `;
        },
      )}
    </div>
  `;
}

function renderBenchmarkList(benchmarks: BenchmarkSummary[], limit?: number): TemplateResult {
  const items = typeof limit === "number" ? benchmarks.slice(0, limit) : benchmarks;
  if (items.length === 0) {
    return html`<p class="inline-note">No benchmark runs found.</p>`;
  }

  return html`
    <div class="data-list">
      ${items.map(
        (benchmark) => {
          const badge = getBenchmarkBadge(benchmark);
          return html`
            <div class="data-row">
              <div class="data-row-main">
                <div class="data-row-title">${benchmark.benchmarkRunId || "benchmark"}</div>
                <p class="data-row-meta">
                  status=${benchmark.status || "recorded"} &middot; comparison=${comparisonStateLabel(benchmark)} &middot;
                  updated=${formatTimestampLabel(benchmark.updatedAt)}
                </p>
                <p class="data-row-meta">
                  ${benchmark.itemCount ?? 0} items &middot; ${benchmark.reviewCount ?? 0} reviews &middot;
                  ${benchmark.verificationCount ?? 0} verifications &middot;
                  ${reviewBreakdownLabel(benchmark.reviewBreakdown || {})}
                </p>
              </div>
              <span class=${badge.className}>${badge.label}</span>
            </div>
          `;
        },
      )}
    </div>
  `;
}

function sortUsersForDirectory(users: AppRecord[]): AppRecord[] {
  const accessRank: Record<string, number> = {
    pending: 0,
    approved: 1,
    revoked: 2,
    rejected: 3,
    none: 4,
  };

  return [...users].sort((left, right) => {
    const leftRank = accessRank[String(left.accessState || "none")] ?? 99;
    const rightRank = accessRank[String(right.accessState || "none")] ?? 99;
    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }
    return String(left.email || left.id || "").localeCompare(String(right.email || right.id || ""));
  });
}

function renderCreateUserPanel(
  state: AppState,
  actions: Pick<
    AppViewActions,
    | "createUserAction"
    | "setNewUserAccessState"
    | "setNewUserEmail"
    | "setNewUserProviderGrant"
    | "setNewUserRole"
  >,
): TemplateResult {
  const providerCatalog = state.providerCatalog || [];

  return html`
    <div class="admin-panel">
      <p class="eyebrow">Add Or Approve User</p>
      <div class="token-form">
        <input
          class="form-input"
          .value=${state.newUserEmail}
          @input=${(event: Event) => actions.setNewUserEmail((event.target as HTMLInputElement).value)}
          placeholder="user@company.com"
        />
        <select
          class="form-input"
          .value=${state.newUserRole}
          @change=${(event: Event) => actions.setNewUserRole((event.target as HTMLSelectElement).value)}
        >
          <option value="member">member</option>
          <option value="superuser">superuser</option>
        </select>
        <select
          class="form-input"
          .value=${state.newUserAccessState}
          @change=${(event: Event) => actions.setNewUserAccessState((event.target as HTMLSelectElement).value)}
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
                    actions.setNewUserProviderGrant(
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
        <div>
          <button
            class="btn btn-primary"
            ?disabled=${state.loading || !state.newUserEmail.trim()}
            @click=${actions.createUserAction}
          >
            Save user
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderPendingRequestRows(
  pendingUsers: AppRecord[],
  loading: boolean,
  actions: Pick<AppViewActions, "setUserStateAction" | "setView">,
): TemplateResult {
  if (pendingUsers.length === 0) {
    return html`
      <div class="admin-panel">
        <p class="eyebrow">Pending Review</p>
        <p class="inline-note">No access requests are waiting for review.</p>
      </div>
    `;
  }

  return html`
    <div class="data-list">
      ${pendingUsers.map(
        (user) => html`
          <div class="data-row admin-row">
            <div class="data-row-main">
              <div class="data-row-title">${user.displayName || user.email || user.id}</div>
              <p class="data-row-meta">
                ${user.email || "unknown"} &middot; role=${user.role || "member"} &middot;
                requested=${user.accessRequestedAt || "n/a"}
              </p>
              <p class="data-row-meta">${user.accessRequestReason || "No access reason provided."}</p>
            </div>
            <div class="data-row-actions">
              <button
                class="btn btn-primary"
                ?disabled=${loading}
                @click=${() => actions.setUserStateAction(user.id, "approved")}
              >
                Approve
              </button>
              <button
                class="btn btn-danger"
                ?disabled=${loading}
                @click=${() => actions.setUserStateAction(user.id, "rejected")}
              >
                Reject
              </button>
              <button class="btn" @click=${() => actions.setView("access:directory")}>Open directory</button>
            </div>
          </div>
        `,
      )}
    </div>
  `;
}

function renderUserDirectoryRow(
  user: AppRecord,
  state: AppState,
  actions: Pick<
    AppViewActions,
    | "deleteUserCredentialAction"
    | "setCredentialDraftId"
    | "setCredentialDraftValue"
    | "setUserProvidersAction"
    | "setUserRoleAction"
    | "setUserStateAction"
    | "upsertUserCredentialAction"
  >,
): TemplateResult {
  const providerCatalog = state.providerCatalog || [];
  const credentialItems = state.userCredentialItems[user.id] || [];

  return html`
    <div class="data-row admin-row">
      <div class="data-row-main">
        <div class="data-row-title">${user.displayName || user.email || user.id}</div>
        <p class="data-row-meta">
          ${user.email || "unknown"} &middot; role=${user.role || "member"} &middot;
          access=${user.accessState || "none"}
        </p>
        <p class="data-row-meta">
          grants=${(user.providerGrants || []).join(", ") || "none"} &middot;
          requested=${user.accessRequestedAt || "n/a"} &middot; reviewed=${user.accessReviewedAt || "n/a"}
        </p>
        <div class="credential-list">
          <p class="eyebrow">Stored Credentials</p>
          ${credentialItems.length === 0
            ? html`<p class="inline-note">No credentials stored.</p>`
            : credentialItems.map(
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
                      @click=${() => actions.deleteUserCredentialAction(user.id, credential.credentialId)}
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
              @input=${(event: Event) => actions.setCredentialDraftId(user.id, (event.target as HTMLInputElement).value)}
              placeholder="credential id"
            />
            <input
              class="form-input"
              type="password"
              .value=${state.credentialDraftValues[user.id] || ""}
              @input=${(event: Event) =>
                actions.setCredentialDraftValue(user.id, (event.target as HTMLInputElement).value)}
              placeholder="secret value"
            />
            <div>
              <button class="btn" ?disabled=${state.loading} @click=${() => actions.upsertUserCredentialAction(user.id)}>
                Create or rotate
              </button>
            </div>
          </div>
        </div>
      </div>
      <div class="admin-actions">
        <div class="auth-actions">
          <button class="btn" ?disabled=${state.loading} @click=${() => actions.setUserStateAction(user.id, "approved")}>
            Approve
          </button>
          <button class="btn" ?disabled=${state.loading} @click=${() => actions.setUserStateAction(user.id, "pending")}>
            Pending
          </button>
          <button
            class="btn btn-danger"
            ?disabled=${state.loading}
            @click=${() => actions.setUserStateAction(user.id, "rejected")}
          >
            Reject
          </button>
          <button
            class="btn btn-danger"
            ?disabled=${state.loading}
            @click=${() => actions.setUserStateAction(user.id, "revoked")}
          >
            Revoke
          </button>
          <button
            class="btn"
            ?disabled=${state.loading}
            @click=${() => actions.setUserRoleAction(user.id, user.role === "superuser" ? "member" : "superuser")}
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
                    actions.setUserProvidersAction(
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
  `;
}

export function renderAccountView(
  state: AppState,
  actions: Pick<AppViewActions, "createToken" | "revokeToken" | "setTokenLabel">,
): TemplateResult {
  const activeTokens = state.tokenItems.filter((token) => !token.revokedAt).length;

  return html`
    <section class="page-hero">
      <h1>Account</h1>
      <p class="supporting">
        ${state.me?.email || "unknown"} &middot; ${state.me?.isSuperuser ? "superuser" : state.me?.role || "member"}
        &middot; grants=${(state.me?.providerGrants || []).join(", ") || "none"}
      </p>
    </section>

    <div class="metrics">
      ${metric("Tokens", state.tokenItems.length)}
      ${metric("Active", activeTokens)}
      ${metric("Revoked", state.tokenItems.length - activeTokens)}
      ${metric("Grants", (state.me?.providerGrants || []).length)}
    </div>

    <h3 class="section-heading">Personal Tokens</h3>
    <p class="inline-note">
      Issue personal tokens for repo runtime access. Provider grants and stored credentials still gate
      what each token can lease at runtime.
    </p>
    <div class="token-form">
      <input
        class="form-input"
        .value=${state.tokenLabel}
        @input=${(event: Event) => actions.setTokenLabel((event.target as HTMLInputElement).value)}
        placeholder="Token label"
      />
      <div>
        <button class="btn btn-primary" ?disabled=${state.loading} @click=${actions.createToken}>
          Issue token
        </button>
      </div>
    </div>
    ${state.plaintextToken
      ? html`
          <div class="flash token-plaintext">
            <p class="eyebrow">Plaintext token</p>
            <div class="mono">${state.plaintextToken}</div>
          </div>
        `
      : nothing}

    <div class="data-list">
      ${state.tokenItems.map(
        (token) => html`
          <div class="data-row">
            <div class="data-row-main">
              <div class="data-row-title">${token.label || token.id}</div>
              <p class="data-row-meta"><span class="mono">${token.id}</span></p>
              <p class="data-row-meta">
                scopes=${(token.scopes || []).join(", ") || "none"} &middot; created=${token.createdAt || "n/a"}
                &middot; last used=${token.lastUsedAt || "never"}
              </p>
            </div>
            <div class="data-row-actions">
              <span class=${token.revokedAt ? "pill danger" : "pill success"}>
                ${token.revokedAt ? "revoked" : "active"}
              </span>
              ${!token.revokedAt
                ? html`
                    <button
                      class="btn btn-danger"
                      ?disabled=${state.loading}
                      @click=${() => actions.revokeToken(token.id)}
                    >
                      Revoke
                    </button>
                  `
                : nothing}
            </div>
          </div>
        `,
      )}
    </div>
    ${state.error ? html`<div class="flash error">${state.error}</div>` : nothing}
  `;
}

export function renderAccessView(
  state: AppState,
  actions: Pick<
    AppViewActions,
    | "createUserAction"
    | "deleteUserCredentialAction"
    | "setCredentialDraftId"
    | "setCredentialDraftValue"
    | "setNewUserAccessState"
    | "setNewUserEmail"
    | "setNewUserProviderGrant"
    | "setNewUserRole"
    | "setUserProvidersAction"
    | "setUserRoleAction"
    | "setUserStateAction"
    | "setView"
    | "upsertUserCredentialAction"
  >,
): TemplateResult {
  if (state.session?.isSuperuser !== true) {
    return html`
      <section class="page-hero">
        <h1>Access</h1>
        <p class="supporting">Access management is available to superusers only.</p>
      </section>
    `;
  }

  const summary = buildAccessSummary(state.userItems, state.userCredentialItems);
  const pendingUsers = getPendingAccessUsers(state.userItems);
  const directoryUsers = sortUsersForDirectory(state.userItems);

  return html`
    <section class="page-hero">
      <h1>Access</h1>
      <p class="supporting">
        Review approvals, roles, provider grants, and stored credentials from one admin surface.
      </p>
    </section>

    <div class="metrics">
      ${metric("Pending", summary.pendingRequests)}
      ${metric("Approved", summary.approvedUsers)}
      ${metric("Superusers", summary.superusers)}
      ${metric("Credentials", summary.credentialCount)}
    </div>

    <div class="admin-grid">
      ${renderCreateUserPanel(state, actions)}
      <div class="admin-panel">
        <p class="eyebrow">Access Snapshot</p>
        <p class="inline-note">
          ${summary.pendingRequests} requests awaiting review &middot; ${summary.usersWithCredentials} users with
          stored credentials &middot; ${(state.providerCatalog || []).length} providers available
        </p>
      </div>
    </div>

    ${state.activeView === "access:requests"
      ? html`
          <h3 class="section-heading">Pending Review</h3>
          ${renderPendingRequestRows(pendingUsers, state.loading, actions)}
        `
      : html`
          <h3 class="section-heading">Directory</h3>
          <div class="data-list">
            ${directoryUsers.map((user) => renderUserDirectoryRow(user, state, actions))}
          </div>
        `}
    ${state.error ? html`<div class="flash error">${state.error}</div>` : nothing}
  `;
}

export function renderDashboardView(
  state: AppState,
  actions: Pick<AppViewActions, "setView">,
): TemplateResult {
  const isSuperuser = state.me?.isSuperuser === true;
  const summary = buildDashboardSummary({
    overview: state.overview,
    runItems: state.runItems,
    benchmarks: state.benchmarks,
    userItems: state.userItems,
    userCredentialItems: state.userCredentialItems,
  });

  const attentionQueue =
    summary.attentionItems.length === 0
      ? html`<p class="inline-note">No access or operations follow-up items are currently queued.</p>`
      : html`
          <div class="data-list">
            ${summary.attentionItems.map(
              (item: DashboardAttentionItem) => html`
                <div class="data-row">
                  <div class="data-row-main">
                    <div class="data-row-title">${item.label}</div>
                    <p class="data-row-meta">${item.detail}</p>
                  </div>
                  <div class="data-row-actions">
                    <span class=${item.tone === "danger" ? "pill danger" : "pill"}>${item.kind}</span>
                    <button class="btn" @click=${() => actions.setView(item.view)}>Open</button>
                  </div>
                </div>
              `,
            )}
          </div>
        `;

  return html`
    <section class="page-hero">
      <h1>${isSuperuser ? "Admin Dashboard" : "Dashboard"}</h1>
      <p class="supporting">
        ${state.me?.email || "unknown"} &middot; ${isSuperuser ? "superuser" : state.me?.role || "member"}
        &middot; latest activity ${formatTimestampLabel(summary.latestActivityAt)}
      </p>
    </section>

    <div class="summary-grid">
      ${renderSummaryPanel(
        "Run Health",
        `Latest run update ${formatTimestampLabel(summary.runs.latestUpdatedAt)}.`,
        [
          { label: "Total", value: summary.runs.total },
          { label: "Active", value: summary.runs.active },
          { label: "Healthy", value: summary.runs.healthy },
          { label: "Attention", value: summary.runs.needsAttention },
        ],
        [
          { label: "Status Mix", counts: summary.runs.statusCounts },
          { label: "Gate Mix", counts: summary.runs.gateCounts },
        ],
      )}
      ${renderSummaryPanel(
        "Benchmark Health",
        `Latest benchmark update ${formatTimestampLabel(summary.benchmarks.latestUpdatedAt)}.`,
        [
          { label: "Total", value: summary.benchmarks.total },
          { label: "Active", value: summary.benchmarks.active },
          { label: "Ready", value: summary.benchmarks.ready },
          { label: "Pending", value: summary.benchmarks.pending },
        ],
        [
          { label: "Status Mix", counts: summary.benchmarks.statusCounts },
          { label: "Validity Mix", counts: summary.benchmarks.validityCounts },
        ],
      )}
      ${renderSummaryPanel(
        "Downstream Activity",
        `${summary.downstream.proofBundleCount} proofs, ${summary.downstream.reviewCount} review signals, and ${summary.downstream.verificationCount} verifications recorded.`,
        [
          { label: "Attempts", value: summary.downstream.attemptCount },
          { label: "Agents", value: summary.downstream.activeAgentCount },
          { label: "Artifacts", value: summary.downstream.artifactCount },
          { label: "Coordination", value: summary.downstream.coordinationRecordCount },
        ],
        [],
      )}
      ${isSuperuser
        ? renderSummaryPanel(
            "Access Snapshot",
            `${summary.access.pendingRequests} requests waiting for review; ${summary.access.usersWithCredentials} users have stored credentials.`,
            [
              { label: "Pending", value: summary.access.pendingRequests },
              { label: "Approved", value: summary.access.approvedUsers },
              { label: "Superusers", value: summary.access.superusers },
              { label: "Credentials", value: summary.access.credentialCount },
            ],
            [],
          )
        : renderSummaryPanel(
            "Control Snapshot",
            `${state.providerCatalog.length} runtime providers available to this account.`,
            [
              { label: "Ready", value: summary.benchmarks.ready },
              { label: "Unknown", value: summary.benchmarks.unknown },
              { label: "Reviews", value: summary.downstream.reviewCount },
              { label: "Verifications", value: summary.downstream.verificationCount },
            ],
            [],
          )}
    </div>

    <h3 class="section-heading">Attention Queue</h3>
    ${attentionQueue}

    <h3 class="section-heading">Recent Runs</h3>
    ${renderRunsList(state.runItems, 6)}

    <h3 class="section-heading">Benchmark Pulse</h3>
    ${renderBenchmarkList(state.benchmarks, 4)}
    ${state.error ? html`<div class="flash error">${state.error}</div>` : nothing}
  `;
}

export function renderOperationsView(state: AppState): TemplateResult {
  const showingBenchmarks = state.activeView === "operations:benchmarks";
  const summary = buildDashboardSummary({
    overview: state.overview,
    runItems: state.runItems,
    benchmarks: state.benchmarks,
    userItems: state.userItems,
    userCredentialItems: state.userCredentialItems,
  });

  return html`
    <section class="page-hero">
      <h1>Operations</h1>
      <p class="supporting">
        ${showingBenchmarks
          ? "Review benchmark runs and evaluation results."
          : "Review orchestrated runs reported to this control plane."}
      </p>
    </section>

    <div class="summary-grid summary-grid-compact">
      ${showingBenchmarks
        ? renderSummaryPanel(
            "Benchmark Health",
            `Latest benchmark update ${formatTimestampLabel(summary.benchmarks.latestUpdatedAt)}.`,
            [
              { label: "Total", value: summary.benchmarks.total },
              { label: "Active", value: summary.benchmarks.active },
              { label: "Pending", value: summary.benchmarks.pending },
              { label: "Review Issues", value: summary.benchmarks.reviewIssues },
            ],
            [
              { label: "Status Mix", counts: summary.benchmarks.statusCounts },
              { label: "Validity Mix", counts: summary.benchmarks.validityCounts },
            ],
          )
        : renderSummaryPanel(
            "Run Health",
            `Latest run update ${formatTimestampLabel(summary.runs.latestUpdatedAt)}.`,
            [
              { label: "Total", value: summary.runs.total },
              { label: "Active", value: summary.runs.active },
              { label: "Healthy", value: summary.runs.healthy },
              { label: "Attention", value: summary.runs.needsAttention },
            ],
            [
              { label: "Status Mix", counts: summary.runs.statusCounts },
              { label: "Gate Mix", counts: summary.runs.gateCounts },
            ],
          )}
      ${renderSummaryPanel(
        "Downstream Activity",
        `${summary.downstream.artifactCount} artifacts, ${summary.downstream.proofBundleCount} proofs, and ${summary.downstream.coordinationRecordCount} coordination records are in the current snapshot.`,
        showingBenchmarks
          ? [
              { label: "Items", value: summary.downstream.benchmarkItemCount },
              { label: "Reviews", value: summary.downstream.reviewCount },
              { label: "Verifications", value: summary.downstream.verificationCount },
              { label: "Ready", value: summary.benchmarks.ready },
            ]
          : [
              { label: "Attempts", value: summary.downstream.attemptCount },
              { label: "Agents", value: summary.downstream.activeAgentCount },
              { label: "Artifacts", value: summary.downstream.artifactCount },
              { label: "Coordination", value: summary.downstream.coordinationRecordCount },
            ],
        [],
      )}
    </div>

    ${showingBenchmarks ? renderBenchmarkList(state.benchmarks) : renderRunsList(state.runItems)}
    ${state.error ? html`<div class="flash error">${state.error}</div>` : nothing}
  `;
}
