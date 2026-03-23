import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_WAVE_LANE,
  LOCK_RETRY_INTERVAL_MS,
  LOCK_STALE_MS,
  LOCK_TIMEOUT_MS,
  MESSAGEBOARD_PROMPT_MAX_CHARS,
  ORCHESTRATOR_DETAIL_MAX_CHARS,
  REPO_ROOT,
  compactSingleLine,
  ensureDirectory,
  readJsonOrNull,
  sleepSync,
  toIsoTimestamp,
} from "./shared.mjs";
import { resolveEvalTargetsAgainstCatalog } from "./evals.mjs";
import {
  isContEvalImplementationOwningAgent,
  isSecurityReviewAgent,
} from "./role-helpers.mjs";

export const ENTRY_HEADER_REGEX = /^##\s+(.+?)\s+\|\s+Agent\s+([A-Za-z0-9.]+)\s*$/;
export const PLACEHOLDER_TIMESTAMP_REGEX = /\$\{(?:ts|TS)\}/;
export const AGENT_ID_REFERENCE_REGEX = /\b[A-Z]\d+(?:\.\d+)?\b/g;
export const ACTION_NONE_REGEX = /^(none|n\/a|na|-)\.?$/i;
export const RESOLUTION_REGEX =
  /\b(resolved|unblocked|fixed|landed|completed|done|addressed|closed)\b/i;

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readLockMetadata(lockPath) {
  const payload = readJsonOrNull(lockPath);
  let stat = null;
  try {
    stat = fs.statSync(lockPath);
  } catch {
    // no-op
  }
  const createdAtRaw = typeof payload?.createdAt === "string" ? payload.createdAt : null;
  const createdAtMs = createdAtRaw ? Date.parse(createdAtRaw) : Number.NaN;
  const pid = Number.parseInt(String(payload?.pid ?? ""), 10);
  return {
    pid: Number.isInteger(pid) ? pid : null,
    createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : (stat?.mtimeMs ?? Number.NaN),
  };
}

function releaseLock(fd, lockPath) {
  try {
    fs.closeSync(fd);
  } catch {
    // no-op
  }
  fs.rmSync(lockPath, { force: true });
}

export function withFileLock(lockPath, fn, timeoutMs = LOCK_TIMEOUT_MS, options = {}) {
  const staleMs = Math.max(
    LOCK_STALE_MS,
    Number.parseInt(String(options?.staleMs ?? LOCK_STALE_MS), 10) || LOCK_STALE_MS,
  );
  const deadline = Date.now() + timeoutMs;
  while (true) {
    try {
      ensureDirectory(path.dirname(lockPath));
      const fd = fs.openSync(lockPath, "wx");
      fs.writeFileSync(
        fd,
        `${JSON.stringify({ pid: process.pid, createdAt: toIsoTimestamp() }, null, 2)}\n`,
        "utf8",
      );
      let result;
      try {
        result = fn();
      } catch (error) {
        releaseLock(fd, lockPath);
        throw error;
      }
      if (result && typeof result.then === "function") {
        return result.finally(() => releaseLock(fd, lockPath));
      }
      releaseLock(fd, lockPath);
      return result;
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
      const metadata = readLockMetadata(lockPath);
      const ageMs = Number.isFinite(metadata.createdAtMs) ? Date.now() - metadata.createdAtMs : 0;
      if (
        (metadata.pid !== null && !isProcessAlive(metadata.pid)) ||
        (ageMs > 0 && ageMs >= staleMs)
      ) {
        fs.rmSync(lockPath, { force: true });
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for lock ${path.relative(REPO_ROOT, lockPath)}`, {
          cause: error,
        });
      }
      sleepSync(LOCK_RETRY_INTERVAL_MS);
    }
  }
}

export function buildMessageBoardTemplate({ wave, waveFile, agents }) {
  const now = new Date().toISOString();
  return [
    `# Wave ${wave} Message Board`,
    "",
    `- Wave file: \`${waveFile}\``,
    `- Agents: ${agents.map((agent) => agent.agentId).join(", ")}`,
    `- Created: ${now}`,
    "",
    "## Roles",
    "- Wave Orchestrator: creates wave files, initiates wave runs, and manages launch, retry, and completion flow.",
    "- WAVE Executor (agent session): executes the assigned prompt end-to-end and coordinates on this board every turn.",
    "",
    "## Usage Rules",
    "- YOU ARE IN WAVE MODE.",
    "- On every turn, read the latest message board state before doing any work.",
    "- On every turn, append an entry with progress, decisions, blockers, handoffs, or an explicit no-change heartbeat.",
    "- Re-read it before major edits, before commit or push, and before your final report.",
    "- Do not delete or rewrite another agent's entries; append only.",
    "",
    "## Communication Protocol",
    "- Use real ISO-8601 timestamps only; never placeholders like `${ts}` or `${TS}`.",
    "- If `Action requested (if any)` is not `None`, name the owner agent(s) and the exact unblock condition.",
    "- If another agent requests action from you, acknowledge it in your next board turn.",
    "- If requirements are ambiguous, ask for human clarification only when useful, then continue with the best reasonable assumption.",
    "",
    "## Entry Format",
    "```",
    "## <ISO-8601 timestamp> | Agent <ID>",
    "- Change:",
    "- Reason:",
    "- Impact on other agents:",
    "- Action requested (if any):",
    "```",
    "",
    "## Entries",
    "",
  ].join("\n");
}

export function ensureWaveMessageBoard({ wave, waveFile, agents, messageBoardPath }) {
  ensureDirectory(path.dirname(messageBoardPath));
  if (!fs.existsSync(messageBoardPath)) {
    fs.writeFileSync(
      messageBoardPath,
      `${buildMessageBoardTemplate({ wave, waveFile, agents })}\n`,
      "utf8",
    );
  }
}

export function readMessageBoardSnapshot(messageBoardPath) {
  if (!fs.existsSync(messageBoardPath)) {
    return "(message board missing)";
  }
  const raw = fs.readFileSync(messageBoardPath, "utf8").trim();
  if (!raw) {
    return "(message board currently empty)";
  }
  if (raw.length <= MESSAGEBOARD_PROMPT_MAX_CHARS) {
    return raw;
  }
  return [
    `(snapshot truncated to last ${MESSAGEBOARD_PROMPT_MAX_CHARS} chars)`,
    raw.slice(-MESSAGEBOARD_PROMPT_MAX_CHARS),
  ].join("\n");
}

export function buildExecutionPrompt({
  lane,
  wave,
  agent,
  orchestratorId,
  messageBoardPath,
  messageBoardSnapshot,
  sharedSummaryPath = null,
  sharedSummaryText = "",
  inboxPath = null,
  inboxText = "",
  context7 = null,
  componentPromotions = null,
  evalTargets = null,
  benchmarkCatalogPath = null,
  sharedPlanDocs = null,
  contQaAgentId = "A0",
  contEvalAgentId = "E0",
  integrationAgentId = "A8",
  documentationAgentId = "A9",
}) {
  const relativeBoardPath = path.relative(REPO_ROOT, messageBoardPath);
  const relativeSharedSummaryPath = sharedSummaryPath
    ? path.relative(REPO_ROOT, sharedSummaryPath)
    : null;
  const relativeInboxPath = inboxPath ? path.relative(REPO_ROOT, inboxPath) : null;
  const lanePlansDir = lane === DEFAULT_WAVE_LANE ? "docs/plans" : `docs/${lane}/plans`;
  const resolvedSharedPlanDocs =
    sharedPlanDocs && sharedPlanDocs.length > 0
      ? sharedPlanDocs
      : [
          `${lanePlansDir}/master-plan.md`,
          `${lanePlansDir}/current-state.md`,
          `${lanePlansDir}/migration.md`,
        ];
  const sharedPlanDocList = resolvedSharedPlanDocs.map((docPath) => `\`${docPath}\``).join(", ");
  const contEvalImplementationOwning = isContEvalImplementationOwningAgent(agent, {
    contEvalAgentId,
  });
  const resolvedEvalTargets = (() => {
    try {
      return resolveEvalTargetsAgainstCatalog(evalTargets, { benchmarkCatalogPath }).targets;
    } catch {
      return Array.isArray(evalTargets) ? evalTargets : [];
    }
  })();
  const contQaRequirements =
    agent.agentId === contQaAgentId
      ? [
          `- Because you are Agent ${contQaAgentId}, your cont-QA report must end with exactly one standalone line in the form \`Verdict: PASS\`, \`Verdict: CONCERNS\`, or \`Verdict: BLOCKED\`.`,
          "- Also emit one matching structured marker in your terminal output: `[wave-verdict] pass`, `[wave-verdict] concerns`, or `[wave-verdict] blocked`.",
          "- Emit one final structured gate marker: `[wave-gate] architecture=<pass|concerns|blocked> integration=<pass|concerns|blocked> durability=<pass|concerns|blocked> live=<pass|concerns|blocked> docs=<pass|concerns|blocked> detail=<short-note>`.",
          "- Only use `Verdict: PASS` when the wave is coherent enough to unblock the next wave.",
          `- Do not declare PASS until the documentation gate is closed: impacted implementation-owned docs must exist, ${sharedPlanDocList} must reflect plan-affecting outcomes, and no unresolved architecture-versus-plans drift remains.`,
          "- If shared-plan reconciliation is still active inside the wave, require the exact remaining doc delta and an explicit `closed` or `no-change` note from the documentation steward or named owner before finalizing. Do not treat ownership handoff alone as the blocker.",
          "- Treat the last cont-QA section and last structured gate marker as authoritative. Earlier concerns may remain in the append-only report history but do not control final completion if the closure sweep resolves them.",
        ]
      : [];
  const contEvalRequirements =
    agent.agentId === contEvalAgentId
      ? [
          `- Because you are Agent ${contEvalAgentId}, you own the wave's iterative eval tuning loop.`,
          contEvalImplementationOwning
            ? "- You also own explicit non-report files in this wave. For those files, satisfy the same proof, doc-delta, and component-marker obligations as an implementation owner."
            : "- You are report-only in this wave unless the prompt explicitly assigns additional non-report files. Do not edit product code outside explicit ownership; route exact follow-up work to the owning role.",
          "- Read the wave's declared eval targets before selecting benchmarks or making tuning changes.",
          "- Leave an append-only cont-EVAL report that records the selected benchmarks, commands run, observed gaps, regressions, and final disposition.",
          "- Emit one final structured eval marker: `[wave-eval] state=<satisfied|needs-more-work|blocked> targets=<n> benchmarks=<n> regressions=<n> target_ids=<csv> benchmark_ids=<csv> detail=<short-note>`.",
          "- Use `satisfied` only when observed outputs or benchmark results meet the declared target, not when the code merely looks better.",
        ]
      : [];
  const docStewardRequirements =
    agent.agentId === documentationAgentId
      ? [
          "- Emit one final structured closure marker: `[wave-doc-closure] state=<closed|no-change|delta> paths=<comma-separated-paths> detail=<short-note>`.",
          "- If implementation work is still landing, any early closure note is provisional. Your final closure marker must reflect the post-implementation state seen during the closure sweep.",
        ]
      : [];
  const securityRequirements = isSecurityReviewAgent(agent)
    ? [
        "- You are the wave's security reviewer. Default to report-only work and route fixes to the owning agent instead of editing product code.",
        "- Leave a security review report with these sections in order: `Threat Model`, `Risky Surfaces`, `Findings`, `Required Approvals`, `Requested Fixes`, and `Final Disposition`.",
        "- Emit one final structured security marker: `[wave-security] state=<clear|concerns|blocked> findings=<n> approvals=<n> detail=<short-note>`.",
        "- Use `clear` only when no unresolved findings or approvals remain. Use `blocked` only when the wave must stop before integration.",
      ]
    : [];
  const implementationRequirements =
    ![contQaAgentId, documentationAgentId].includes(agent.agentId) &&
    !isSecurityReviewAgent(agent) &&
    (agent.agentId !== contEvalAgentId || contEvalImplementationOwning)
      ? [
          "- Emit one final structured proof marker: `[wave-proof] completion=<contract|integrated|authoritative|live> durability=<none|ephemeral|durable> proof=<unit|integration|live> state=<met|gap> detail=<short-note>`.",
          "- Emit one final structured documentation marker: `[wave-doc-delta] state=<none|owned|shared-plan> paths=<comma-separated-paths> detail=<short-note>`.",
          ...(Array.isArray(agent.components) && agent.components.length > 0
            ? [
                "- Emit one final structured component marker per owned component: `[wave-component] component=<id> level=<level> state=<met|gap> detail=<short-note>`.",
              ]
            : []),
          "- If you leave any material architecture, integration, durability, ops, or docs gap, emit `[wave-gap] kind=<architecture|integration|durability|ops|docs> detail=<short-note>` and make the gap explicit instead of implying completion.",
        ]
      : [];
  const exitContractLines = agent.exitContract
    ? [
        "Exit contract for this run:",
        `- completion: ${agent.exitContract.completion}`,
        `- durability: ${agent.exitContract.durability}`,
        `- proof: ${agent.exitContract.proof}`,
        `- doc-impact: ${agent.exitContract.docImpact}`,
        "- If your landed result is weaker than this contract, mark it as a gap. Do not present package-only, in-memory, or non-authoritative work as complete when the exit contract requires more.",
        "",
      ]
    : [];
  const askCommand = [
    "pnpm exec wave-feedback ask",
    `--lane ${lane}`,
    `--wave ${wave}`,
    `--agent ${agent.agentId}`,
    `--orchestrator-id ${orchestratorId}`,
    '--question "<specific clarification needed>"',
    '--context "<what you tried, options, and impact>"',
    "--timeout-seconds 30",
  ].join(" ");
  const coordinationCommand = [
    "pnpm exec wave coord post",
    `--lane ${lane}`,
    `--wave ${wave}`,
    `--agent ${agent.agentId}`,
    '--kind "<request|ack|claim|evidence|decision|blocker|handoff|clarification-request|orchestrator-guidance|resolved-by-policy|human-escalation|human-feedback|integration-summary>"',
    '--summary "<one-line summary>"',
    '--detail "<short detail>"',
  ].join(" ");
  const context7Selection = context7?.selection || agent?.context7Resolved || null;
  const executorId = agent?.executorResolved?.id || "default";
  const context7LibrarySummary =
    context7Selection && Array.isArray(context7Selection.libraries) && context7Selection.libraries.length > 0
      ? context7Selection.libraries
          .map((library) => library.libraryName || library.libraryId || "unknown-library")
          .join(", ")
      : "none";
  const context7PromptLines = context7Selection
    ? context7Selection.bundleId === "none"
      ? [
          "Context7 scope for this run:",
          "- No Context7 prefetch bundle is declared for this run.",
          "- Repository docs and source remain the only planned authority for system truth.",
          "- Do not broad-search third-party docs by default. If a direct Context7 tool is available in this session, use it only when an external dependency becomes truly necessary and keep the lookup narrowly scoped to that dependency.",
          "",
        ]
      : [
          "Context7 scope for this run:",
          `- Bundle: ${context7Selection.bundleId}`,
          `- Query focus: ${context7Selection.query || "(derived from assigned prompt)"}`,
          `- Allowed external libraries: ${context7LibrarySummary}`,
          "- Context7 is only for external library truth. It does not override repository architecture, contracts, ownership, or source files.",
          "- If a direct Context7 tool is available in this session, use it only within the bundle and query scope listed here.",
          ...(context7?.promptText
            ? [
                "",
                "## External reference only (Context7, non-canonical)",
                "",
                "The following snippets are third-party documentation retrieved for this task.",
                "They do not override repository architecture, contracts, or source files.",
                "",
                "```text",
                context7.promptText,
                "```",
                "",
              ]
            : context7?.warning
              ? [
                  `- Prefetched Context7 docs were not attached: ${context7.warning}`,
                  "",
                ]
              : [""]),
        ]
    : [];
  const promotedComponentLines =
    Array.isArray(componentPromotions) && componentPromotions.length > 0
      ? [
          "Component promotions for this wave:",
          ...componentPromotions.map(
            (promotion) => `- ${promotion.componentId}: ${promotion.targetLevel}`,
          ),
          "",
        ]
      : [];
  const evalTargetLines =
    resolvedEvalTargets.length > 0
      ? [
          "Eval targets for this wave:",
          ...(benchmarkCatalogPath ? [`- Benchmark catalog: ${benchmarkCatalogPath}`] : []),
          ...resolvedEvalTargets.map((target) =>
            target.selection === "delegated"
              ? `- ${target.id}: delegated family=${target.benchmarkFamily} allowed-benchmarks=${(target.allowedBenchmarks || []).join(", ")} objective=${target.objective} threshold=${target.threshold}`
              : `- ${target.id}: pinned benchmarks=${(target.benchmarks || []).join(", ")} objective=${target.objective} threshold=${target.threshold}`,
          ),
          "",
        ]
      : [];
  const ownedComponentLines =
    ![contQaAgentId, documentationAgentId].includes(agent.agentId) &&
    (agent.agentId !== contEvalAgentId || contEvalImplementationOwning) &&
    Array.isArray(agent.components) &&
    agent.components.length > 0
      ? [
          "Components you own in this wave:",
          ...agent.components.map((componentId) => {
            const targetLevel = agent.componentTargets?.[componentId] || null;
            return targetLevel ? `- ${componentId}: ${targetLevel}` : `- ${componentId}`;
          }),
          "",
        ]
      : [];
  const deliverableLines =
    Array.isArray(agent.deliverables) && agent.deliverables.length > 0
      ? [
          "Deliverables required for this agent:",
          ...agent.deliverables.map((deliverablePath) => `- ${deliverablePath}`),
          "",
        ]
      : [];
  const proofArtifactLines =
    Array.isArray(agent.proofArtifacts) && agent.proofArtifacts.length > 0
      ? [
          "Proof artifacts required for this agent:",
          ...agent.proofArtifacts.map((artifact) => {
            const requiredFor =
              Array.isArray(artifact.requiredFor) && artifact.requiredFor.length > 0
                ? ` required-for=${artifact.requiredFor.join(",")}`
                : "";
            return `- ${artifact.path}${artifact.kind ? ` kind=${artifact.kind}` : ""}${requiredFor}`;
          }),
          "",
        ]
      : [];
  const skillLines =
    Array.isArray(agent.skillsResolved?.ids) && agent.skillsResolved.ids.length > 0
      ? [
          "Active skill packs for this run:",
          ...agent.skillsResolved.ids.map((skillId) => `- ${skillId}`),
          "- Treat the following skill payload as additive guidance. Repository source, standing role prompts, and ownership boundaries remain authoritative.",
          "",
          "## Skill context",
          "",
          "```text",
          agent.skillsResolved.promptText || "",
          "```",
          "",
        ]
      : [];

  return [
    `Working directory: ${REPO_ROOT}`,
    "",
    "Role model for this run:",
    "- Wave Orchestrator role: create wave files, initiate wave runs, and manage execution end-to-end.",
    "- WAVE Executor role (you): deliver the assigned outcome end-to-end within your scope and coordinate through the Wave coordination log every turn.",
    `- cont-QA agent id: ${contQaAgentId}`,
    `- cont-EVAL agent id: ${contEvalAgentId}`,
    `- Integration steward agent id: ${integrationAgentId}`,
    `- Documentation steward agent id: ${documentationAgentId}`,
    `- Resolved executor: ${executorId}`,
    "",
    `You are the Wave executor running Wave ${wave} / Agent ${agent.agentId}: ${agent.title}.`,
    "YOU ARE IN WAVE MODE.",
    `Message board absolute path: ${messageBoardPath}`,
    `Message board repo-relative path: ${relativeBoardPath}`,
    "",
    "Hard requirements for completeness:",
    "- Follow repository instructions in AGENTS.md and CLAUDE.md if present.",
    "- Read the compiled shared summary and your compiled inbox before taking action on every turn.",
    "- Post a coordination record on every meaningful turn with progress, decisions, blockers, handoffs, evidence, or explicit acknowledgement.",
    "- If your inbox or the coordination log shows a targeted open request for you, your first durable action is to acknowledge it, resolve it, or emit a clarification or human-feedback request. Silent targeted requests are treated as active blockers.",
    "- Re-read the generated board projection before major edits, before commit or push, and before your final report.",
    "- If you change interfaces or contracts, include exact files and exact keys or fields affected.",
    "- If your task touches persisted state, implement the required schema or migration work instead of leaving TODOs.",
    "- If you are blocked on clarification, first emit a `clarification-request` coordination record with the concrete question, what you checked, and the impact.",
    "- Use the human feedback CLI only when the orchestrator or policy resolution path cannot answer the question inside the wave loop.",
    "- If a clarification is not answered immediately, continue with the best reasonable assumption and log that assumption as a coordination record.",
    `- Human escalation command: \`${askCommand}\``,
    `- Coordination command: \`${coordinationCommand}\``,
    "- Run relevant tests, lint, and build checks for touched workspaces and fix failures caused by your changes.",
    "- Emit explicit progress markers in your output: `[wave-phase] coding`, `[wave-phase] validating`, `[wave-phase] deploying`, `[wave-phase] finalizing`.",
    "- During deployment checks, emit structured deployment markers: `[deploy-status] service=<service-name> state=<deploying|healthy|failed|rolledover> detail=<short-note>`.",
    "- If your task touches machine validation, workload identity, node admission, deployment bootstrap, or approved machine actions, emit structured infra markers: `[infra-status] kind=<conformance|role-drift|dependency|identity|admission|action> target=<machine-or-surface> state=<checking|setup-required|setup-in-progress|conformant|drift|blocked|failed|action-required|action-approved|action-complete> detail=<short-note>`.",
    ...contQaRequirements,
    ...contEvalRequirements,
    ...docStewardRequirements,
    ...securityRequirements,
    ...implementationRequirements,
    `- Update docs impacted by your implementation. If your work changes status, sequencing, ownership, or explicit proof expectations, update the relevant docs. If shared plan docs need changes outside your owned files, post the exact doc paths and exact delta needed for ${sharedPlanDocList} as a coordination record instead of leaving documentation drift for later cleanup.`,
    "- If the wave defines a documentation steward or other explicit owner for shared plan docs, coordinate those updates through that owner, notify them as soon as the delta is known, and stay engaged until they confirm `closed` or `no-change`. Do not treat the ownership boundary as the definition of done.",
    "- In high-fanout waves, do not push to remote by default. A local Conventional Commit is okay when useful; push only when explicitly requested.",
    "- Do not leave watch or dev servers running after completion.",
    "",
    ...(sharedSummaryPath
      ? [
          `Shared summary absolute path: ${sharedSummaryPath}`,
          `Shared summary repo-relative path: ${relativeSharedSummaryPath}`,
        ]
      : []),
    ...(inboxPath
      ? [
          `Agent inbox absolute path: ${inboxPath}`,
          `Agent inbox repo-relative path: ${relativeInboxPath}`,
        ]
      : []),
    "",
    ...(sharedSummaryText
      ? ["Current wave shared summary:", "```markdown", sharedSummaryText, "```", ""]
      : []),
    ...(inboxText
      ? ["Current agent inbox:", "```markdown", inboxText, "```", ""]
      : []),
    ...exitContractLines,
    ...promotedComponentLines,
    ...evalTargetLines,
    ...ownedComponentLines,
    ...deliverableLines,
    ...proofArtifactLines,
    ...skillLines,
    ...context7PromptLines,
    "Assigned implementation prompt:",
    "```",
    agent.prompt.trim(),
    "```",
  ].join("\n");
}

export function buildResidentOrchestratorPrompt({
  lane,
  wave,
  waveFile,
  orchestratorId,
  coordinationLogPath,
  messageBoardPath,
  sharedSummaryPath,
  dashboardPath,
  triagePath = null,
  rolePrompt = "",
}) {
  const coordinationCommand = [
    "pnpm exec wave coord post",
    `--lane ${lane}`,
    `--wave ${wave}`,
    '--agent "launcher"',
    '--kind "<request|ack|decision|blocker|clarification-request|orchestrator-guidance|resolved-by-policy|human-escalation|human-feedback>"',
    '--summary "<one-line summary>"',
    '--detail "<short detail>"',
  ].join(" ");
  const feedbackCommand = [
    "pnpm exec wave-feedback ask",
    `--lane ${lane}`,
    `--wave ${wave}`,
    '--agent "launcher"',
    `--orchestrator-id ${orchestratorId}`,
    '--question "<specific clarification needed>"',
    '--context "<why repo-state or routed ownership was insufficient>"',
    "--timeout-seconds 30",
  ].join(" ");
  const roleSection = String(rolePrompt || "").trim();
  return [
    `Working directory: ${REPO_ROOT}`,
    "",
    `You are the resident Wave orchestrator for lane ${lane}, wave ${wave}.`,
    "Your job is to stay alive for the duration of the wave, monitor coordination state, and intervene when timing, routing, or escalation policy requires it.",
    "The launcher remains the scheduler truth and closure authority. You are an intervention and triage role, not a product-code owner.",
    "",
    "Hard limits:",
    "- Do not edit product code, test code, docs, or owned deliverables.",
    "- Do not claim another agent's ownership slice or emit proof markers for owned implementation work.",
    "- Do not declare the wave complete or override launcher gate results.",
    "",
    "Primary responsibilities:",
    "- Monitor the canonical coordination log, shared summary, wave dashboard, and feedback triage artifacts.",
    "- Keep clarification handling orchestrator-first: resolve from repo state, ownership, prior decisions, or targeted rerouting before opening human escalation.",
    "- Watch for overdue acknowledgements, stale clarification chains, and pending human tickets.",
    "- Post durable coordination records and orchestrator notes when you intervene.",
    "- Stay available. If there is no immediate action to take, keep monitoring instead of exiting early.",
    "",
    "Files for this run:",
    `- Wave file: ${waveFile}`,
    `- Coordination log: ${coordinationLogPath}`,
    `- Shared summary: ${sharedSummaryPath}`,
    `- Wave dashboard: ${dashboardPath}`,
    `- Message board projection: ${messageBoardPath}`,
    ...(triagePath ? [`- Feedback triage log: ${triagePath}`] : []),
    "",
    "Action surface:",
    `- Coordination command: \`${coordinationCommand}\``,
    `- Human feedback command: \`${feedbackCommand}\``,
    "- Use repository inspection and read-only analysis aggressively before escalating anything to a human.",
    "- When you route or reroute work, name the owner, exact unblock condition, and the artifact or decision needed.",
    "",
    "Operating loop:",
    "1. Read the shared summary, dashboard, and coordination log.",
    "2. Identify open clarifications, open clarification-linked requests, overdue acknowledgements, and human-feedback state.",
    "3. If action is needed, write a durable coordination update and explain the policy basis for the action.",
    "4. If nothing needs action, continue monitoring. Do not exit until the wave is clearly terminal or the launcher stops the session.",
    "",
    ...(roleSection
      ? [
          "Resident orchestrator role prompt:",
          "```text",
          roleSection,
          "```",
          "",
        ]
      : []),
  ].join("\n");
}

export function buildOrchestratorBoardTemplate(boardPath) {
  const now = toIsoTimestamp();
  return [
    "# Orchestrator Coordination Board",
    "",
    `- Created: ${now}`,
    `- Path: \`${path.relative(REPO_ROOT, boardPath)}\``,
    "",
    "## Purpose",
    "- Coordinate multiple lane orchestrators running in parallel.",
    "- Publish cross-lane blockers, handoffs, and dependency requests.",
    "- Keep an append-only audit trail for start, retry, failure, and completion flow.",
    "",
    "## Coordination Rules",
    "- Append-only: never edit prior entries.",
    "- Use stable orchestrator IDs.",
    "- If requesting cross-lane action, name the owner lane and explicit done condition.",
    "- Post a follow-up entry when a requested action is resolved.",
    "",
    "## Entry Format",
    "```",
    "## <ISO-8601 timestamp> | Lane <lane> | Orchestrator <id>",
    "- Event:",
    "- Waves:",
    "- Status:",
    "- Details:",
    "- Action requested (if any):",
    "```",
    "",
    "## Entries",
    "",
  ].join("\n");
}

export function ensureOrchestratorBoard(boardPath) {
  ensureDirectory(path.dirname(boardPath));
  if (!fs.existsSync(boardPath)) {
    fs.writeFileSync(boardPath, `${buildOrchestratorBoardTemplate(boardPath)}\n`, "utf8");
  }
}

function formatWaveListForCoordination(waves) {
  if (!Array.isArray(waves) || waves.length === 0) {
    return "n/a";
  }
  return waves.map((wave) => String(wave)).join(", ");
}

function trimCoordinationDetail(value) {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) {
    return "n/a";
  }
  return text.length <= ORCHESTRATOR_DETAIL_MAX_CHARS
    ? text
    : `${text.slice(0, ORCHESTRATOR_DETAIL_MAX_CHARS - 1)}…`;
}

function normalizeCoordinationAction(value) {
  const text = String(value || "").trim();
  if (!text || /^(none|n\/a|na|-)\.?$/i.test(text)) {
    return "None.";
  }
  return text;
}

export function appendOrchestratorBoardEntry({
  boardPath,
  lane,
  orchestratorId,
  event,
  waves,
  status,
  details,
  actionRequested,
}) {
  if (!boardPath) {
    return;
  }
  ensureOrchestratorBoard(boardPath);
  const entry = [
    `## ${toIsoTimestamp()} | Lane ${lane} | Orchestrator ${orchestratorId}`,
    `- Event: ${String(event || "update").trim()}.`,
    `- Waves: ${formatWaveListForCoordination(waves)}.`,
    `- Status: ${String(status || "info").trim()}.`,
    `- Details: ${trimCoordinationDetail(details)}`,
    `- Action requested (if any): ${normalizeCoordinationAction(actionRequested)}`,
    "",
  ].join("\n");
  fs.appendFileSync(boardPath, `${entry}\n`, "utf8");
}

export function parseMessageBoardEntries(raw) {
  const lines = raw.split(/\r?\n/);
  const entriesHeaderIndex = lines.findIndex((line) => line.trim() === "## Entries");
  const scopedLines = entriesHeaderIndex >= 0 ? lines.slice(entriesHeaderIndex + 1) : lines;
  const blocks = [];
  let current = null;
  for (const line of scopedLines) {
    if (line.startsWith("## ")) {
      if (current) {
        blocks.push(current);
      }
      current = { header: line.trimEnd(), lines: [] };
      continue;
    }
    if (current) {
      current.lines.push(line.trimEnd());
    }
  }
  if (current) {
    blocks.push(current);
  }

  return blocks.map((block, index) => {
    const match = block.header.match(ENTRY_HEADER_REGEX);
    let timestampMs = null;
    let agentId = "unknown";
    let headerMalformed = false;
    let placeholderTimestamp = false;
    let timestampRaw = null;

    if (!match) {
      headerMalformed = true;
      placeholderTimestamp = PLACEHOLDER_TIMESTAMP_REGEX.test(block.header);
    } else {
      timestampRaw = String(match[1] || "").trim();
      agentId = String(match[2] || "unknown").trim();
      placeholderTimestamp = PLACEHOLDER_TIMESTAMP_REGEX.test(timestampRaw);
      timestampMs = Date.parse(timestampRaw);
      if (!Number.isFinite(timestampMs)) {
        headerMalformed = true;
      }
    }

    const fields = {
      change: null,
      reason: null,
      impact: null,
      action: null,
    };
    for (const line of block.lines) {
      if (fields.change === null && line.startsWith("- Change:")) {
        fields.change = line.slice("- Change:".length).trim();
      } else if (fields.reason === null && line.startsWith("- Reason:")) {
        fields.reason = line.slice("- Reason:".length).trim();
      } else if (fields.impact === null && line.startsWith("- Impact on other agents:")) {
        fields.impact = line.slice("- Impact on other agents:".length).trim();
      } else if (fields.action === null && line.startsWith("- Action requested (if any):")) {
        fields.action = line.slice("- Action requested (if any):".length).trim();
      }
    }

    const missingRequiredFields = [];
    if (fields.change === null) {
      missingRequiredFields.push("Change");
    }
    if (fields.reason === null) {
      missingRequiredFields.push("Reason");
    }
    if (fields.impact === null) {
      missingRequiredFields.push("Impact on other agents");
    }
    if (fields.action === null) {
      missingRequiredFields.push("Action requested (if any)");
    }

    const actionText = fields.action || "";
    const actionable = Boolean(actionText) && !ACTION_NONE_REGEX.test(actionText);
    const targetOwners = Array.from(
      new Set((actionText.match(AGENT_ID_REFERENCE_REGEX) || []).map((item) => item.trim())),
    );

    return {
      index,
      header: block.header,
      headerMalformed,
      placeholderTimestamp,
      timestampRaw,
      timestampMs,
      agentId,
      actionable,
      actionText,
      targetOwners,
      missingRequiredFields,
      malformed: headerMalformed || missingRequiredFields.length > 0,
      textForResolution: [block.header, ...block.lines].join("\n").toLowerCase(),
    };
  });
}

export function analyzeMessageBoardCommunication(messageBoardPath) {
  const health = {
    available: false,
    reason: null,
    totalEntries: 0,
    actionableRequests: 0,
    unresolvedRequests: 0,
    unacknowledgedRequests: 0,
    malformedEntries: 0,
    placeholderTimestampEntries: 0,
    lastAcknowledgementTimestamp: null,
    oldestUnacknowledgedTimestamp: null,
  };
  if (!messageBoardPath) {
    health.reason = "(message board path unavailable)";
    return health;
  }
  if (!fs.existsSync(messageBoardPath)) {
    health.reason = "(message board missing)";
    return health;
  }
  const raw = fs.readFileSync(messageBoardPath, "utf8");
  if (!raw.trim()) {
    health.reason = "(message board currently empty)";
    return health;
  }
  health.available = true;
  const entries = parseMessageBoardEntries(raw);
  health.totalEntries = entries.length;

  for (const entry of entries) {
    if (entry.malformed) {
      health.malformedEntries += 1;
    }
    if (entry.placeholderTimestamp) {
      health.placeholderTimestampEntries += 1;
    }
  }

  const actionableEntries = entries.filter((entry) => entry.actionable);
  health.actionableRequests = actionableEntries.length;

  for (const request of actionableEntries) {
    const ackOwners = request.targetOwners.length > 0 ? request.targetOwners : [request.agentId];
    const laterEntries = entries.slice(request.index + 1);

    let acknowledged = false;
    for (const later of laterEntries) {
      if (!ackOwners.includes(later.agentId)) {
        continue;
      }
      acknowledged = true;
      if (
        Number.isFinite(later.timestampMs) &&
        (!Number.isFinite(health.lastAcknowledgementTimestamp) ||
          later.timestampMs > health.lastAcknowledgementTimestamp)
      ) {
        health.lastAcknowledgementTimestamp = later.timestampMs;
      }
      break;
    }

    if (!acknowledged && request.targetOwners.length > 0) {
      health.unacknowledgedRequests += 1;
      if (
        Number.isFinite(request.timestampMs) &&
        (!Number.isFinite(health.oldestUnacknowledgedTimestamp) ||
          request.timestampMs < health.oldestUnacknowledgedTimestamp)
      ) {
        health.oldestUnacknowledgedTimestamp = request.timestampMs;
      }
    }

    let resolved = false;
    for (const later of laterEntries) {
      const actorRelevant = later.agentId === request.agentId || ackOwners.includes(later.agentId);
      if (actorRelevant && RESOLUTION_REGEX.test(later.textForResolution)) {
        resolved = true;
        break;
      }
    }
    if (!resolved) {
      health.unresolvedRequests += 1;
    }
  }

  return health;
}

export function readWaveHumanFeedbackRequests({
  feedbackRequestsDir,
  lane,
  waveNumber,
  agentIds,
  orchestratorId,
}) {
  if (!fs.existsSync(feedbackRequestsDir)) {
    return [];
  }
  const agentIdSet = new Set(agentIds || []);
  const entries = [];
  for (const fileName of fs
    .readdirSync(feedbackRequestsDir)
    .filter((name) => name.endsWith(".json"))) {
    const payload = readJsonOrNull(path.join(feedbackRequestsDir, fileName));
    if (!payload || typeof payload !== "object") {
      continue;
    }
    if (
      String(payload.lane || "")
        .trim()
        .toLowerCase() !== lane
    ) {
      continue;
    }
    const parsedWave = Number.parseInt(String(payload.wave ?? ""), 10);
    if (!Number.isFinite(parsedWave) || parsedWave !== waveNumber) {
      continue;
    }
    const agentId = String(payload.agentId || "").trim();
    if (!agentId || (agentIdSet.size > 0 && !agentIdSet.has(agentId))) {
      continue;
    }
    const requestOrchestratorId = String(payload.orchestratorId || "").trim();
    if (requestOrchestratorId && orchestratorId && requestOrchestratorId !== orchestratorId) {
      continue;
    }
    entries.push({
      id: String(payload.id || path.basename(fileName, ".json")).trim(),
      agentId,
      status: String(payload.status || "pending")
        .trim()
        .toLowerCase(),
      question: compactSingleLine(payload.question, 240),
      context: compactSingleLine(payload.context, 240),
      orchestratorId: requestOrchestratorId,
      createdAt: String(payload.createdAt || ""),
      updatedAt: String(payload.updatedAt || payload.createdAt || ""),
      responseOperator: compactSingleLine(payload?.response?.operator || "", 64),
      responseText: compactSingleLine(payload?.response?.text || "", 240),
    });
  }
  entries.sort((a, b) => {
    const aTs = Date.parse(a.createdAt);
    const bTs = Date.parse(b.createdAt);
    if (Number.isFinite(aTs) && Number.isFinite(bTs)) {
      return aTs - bTs;
    }
    return a.id.localeCompare(b.id);
  });
  return entries;
}

export function feedbackStateSignature(request) {
  return [
    request.status || "",
    request.updatedAt || "",
    request.responseOperator || "",
    request.responseText || "",
  ].join("|");
}
