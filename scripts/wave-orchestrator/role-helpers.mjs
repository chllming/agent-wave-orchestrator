import { DEFAULT_CONT_EVAL_AGENT_ID } from "./config.mjs";

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
