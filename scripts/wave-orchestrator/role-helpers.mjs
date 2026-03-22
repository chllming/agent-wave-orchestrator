import {
  DEFAULT_CONT_EVAL_AGENT_ID,
  DEFAULT_SECURITY_ROLE_PROMPT_PATH,
} from "./config.mjs";

function cleanPath(value) {
  return String(value || "")
    .trim()
    .replaceAll("\\", "/");
}

export function isContQaReportPath(relPath) {
  return /(?:^|\/)(?:reviews?|.*cont[-_]?qa).*\.(?:md|txt)$/i.test(cleanPath(relPath));
}

export function isContEvalReportPath(relPath) {
  return /(?:^|\/)(?:reviews?|.*cont[-_]?eval|.*eval).*\.(?:md|txt)$/i.test(cleanPath(relPath));
}

export function isSecurityRolePromptPath(
  relPath,
  securityRolePromptPath = DEFAULT_SECURITY_ROLE_PROMPT_PATH,
) {
  const normalized = cleanPath(relPath);
  const configured = cleanPath(securityRolePromptPath);
  return (
    normalized === configured ||
    normalized === DEFAULT_SECURITY_ROLE_PROMPT_PATH ||
    normalized.endsWith("/wave-security-role.md")
  );
}

export function isSecurityReportPath(relPath) {
  return /(?:^|\/).*security.*\.(?:md|txt)$/i.test(cleanPath(relPath));
}

export function isContEvalImplementationOwningAgent(
  agent,
  { contEvalAgentId = DEFAULT_CONT_EVAL_AGENT_ID } = {},
) {
  if (!agent || agent.agentId !== contEvalAgentId) {
    return false;
  }
  const ownedPaths = Array.isArray(agent.ownedPaths) ? agent.ownedPaths.map(cleanPath).filter(Boolean) : [];
  if (ownedPaths.length === 0) {
    return false;
  }
  return ownedPaths.some((ownedPath) => !isContEvalReportPath(ownedPath));
}

export function isContEvalReportOnlyAgent(
  agent,
  { contEvalAgentId = DEFAULT_CONT_EVAL_AGENT_ID } = {},
) {
  return agent?.agentId === contEvalAgentId && !isContEvalImplementationOwningAgent(agent, {
    contEvalAgentId,
  });
}

export function isSecurityReviewAgent(
  agent,
  { securityRolePromptPath = DEFAULT_SECURITY_ROLE_PROMPT_PATH } = {},
) {
  if (!agent || typeof agent !== "object") {
    return false;
  }
  const rolePromptPaths = Array.isArray(agent.rolePromptPaths) ? agent.rolePromptPaths : [];
  if (
    rolePromptPaths.some((rolePromptPath) =>
      isSecurityRolePromptPath(rolePromptPath, securityRolePromptPath),
    )
  ) {
    return true;
  }
  const capabilities = Array.isArray(agent.capabilities)
    ? agent.capabilities.map((entry) => String(entry || "").trim().toLowerCase())
    : [];
  return capabilities.includes("security-review");
}

export function resolveSecurityReviewReportPath(agent) {
  const ownedPaths = Array.isArray(agent?.ownedPaths) ? agent.ownedPaths.map(cleanPath).filter(Boolean) : [];
  return ownedPaths.find((ownedPath) => isSecurityReportPath(ownedPath)) || null;
}
