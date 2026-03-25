import {
  DEFAULT_CONT_QA_AGENT_ID,
  DEFAULT_CONT_EVAL_AGENT_ID,
  DEFAULT_DESIGN_ROLE_PROMPT_PATH,
  DEFAULT_DOCUMENTATION_AGENT_ID,
  DEFAULT_INTEGRATION_AGENT_ID,
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

export function isDesignRolePromptPath(
  relPath,
  designRolePromptPath = DEFAULT_DESIGN_ROLE_PROMPT_PATH,
) {
  const normalized = cleanPath(relPath);
  const configured = cleanPath(designRolePromptPath);
  return (
    normalized === configured ||
    normalized === DEFAULT_DESIGN_ROLE_PROMPT_PATH ||
    normalized.endsWith("/wave-design-role.md")
  );
}

export function isDesignReportPath(relPath) {
  return /(?:^|\/).*(?:design|handoff|decision-lineage).*\.(?:md|txt)$/i.test(cleanPath(relPath));
}

function normalizedOwnedPaths(agent) {
  return Array.isArray(agent?.ownedPaths)
    ? agent.ownedPaths.map(cleanPath).filter(Boolean)
    : [];
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

export function isDesignAgent(
  agent,
  { designRolePromptPath = DEFAULT_DESIGN_ROLE_PROMPT_PATH } = {},
) {
  if (!agent || typeof agent !== "object") {
    return false;
  }
  const rolePromptPaths = Array.isArray(agent.rolePromptPaths) ? agent.rolePromptPaths : [];
  if (
    rolePromptPaths.some((rolePromptPath) =>
      isDesignRolePromptPath(rolePromptPath, designRolePromptPath),
    )
  ) {
    return true;
  }
  const capabilities = Array.isArray(agent.capabilities)
    ? agent.capabilities.map((entry) => String(entry || "").trim().toLowerCase())
    : [];
  return capabilities.includes("design");
}

export function isImplementationOwningDesignAgent(
  agent,
  { designRolePromptPath = DEFAULT_DESIGN_ROLE_PROMPT_PATH } = {},
) {
  if (!isDesignAgent(agent, { designRolePromptPath })) {
    return false;
  }
  const ownedPaths = normalizedOwnedPaths(agent);
  if (ownedPaths.length === 0) {
    return false;
  }
  return ownedPaths.some((ownedPath) => !isDesignReportPath(ownedPath));
}

export function isDocsOnlyDesignAgent(
  agent,
  { designRolePromptPath = DEFAULT_DESIGN_ROLE_PROMPT_PATH } = {},
) {
  return isDesignAgent(agent, { designRolePromptPath }) &&
    !isImplementationOwningDesignAgent(agent, { designRolePromptPath });
}

export function resolveSecurityReviewReportPath(agent) {
  const ownedPaths = normalizedOwnedPaths(agent);
  return ownedPaths.find((ownedPath) => isSecurityReportPath(ownedPath)) || null;
}

export function resolveDesignReportPath(agent) {
  const ownedPaths = normalizedOwnedPaths(agent);
  return ownedPaths.find((ownedPath) => isDesignReportPath(ownedPath)) || null;
}

export function resolveWaveRoleBindings(wave = {}, lanePaths = {}, agents = wave?.agents || []) {
  const contQaAgentId =
    wave?.contQaAgentId || lanePaths?.contQaAgentId || DEFAULT_CONT_QA_AGENT_ID;
  const contEvalAgentId =
    wave?.contEvalAgentId || lanePaths?.contEvalAgentId || DEFAULT_CONT_EVAL_AGENT_ID;
  const integrationAgentId =
    wave?.integrationAgentId || lanePaths?.integrationAgentId || DEFAULT_INTEGRATION_AGENT_ID;
  const documentationAgentId =
    wave?.documentationAgentId ||
    lanePaths?.documentationAgentId ||
    DEFAULT_DOCUMENTATION_AGENT_ID;
  const securityReviewerAgentIds = Array.from(
    new Set(
      (Array.isArray(agents) ? agents : [])
        .filter((agent) =>
          isSecurityReviewAgent(agent, {
            securityRolePromptPath: lanePaths?.securityRolePromptPath,
          }),
        )
        .map((agent) => agent.agentId)
        .filter(Boolean),
    ),
  ).sort();
  const closureAgentIds = Array.from(
    new Set(
      [
        contEvalAgentId,
        integrationAgentId,
        documentationAgentId,
        contQaAgentId,
        ...securityReviewerAgentIds,
      ].filter(Boolean),
    ),
  ).sort();
  return {
    contQaAgentId,
    contEvalAgentId,
    integrationAgentId,
    documentationAgentId,
    securityReviewerAgentIds,
    closureAgentIds,
  };
}

export function isClosureRoleAgentId(agentId, roleBindings) {
  return (roleBindings?.closureAgentIds || []).includes(agentId);
}
