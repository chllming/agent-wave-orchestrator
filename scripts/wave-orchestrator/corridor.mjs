import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_CORRIDOR_BASE_URL,
  DEFAULT_CORRIDOR_SEVERITY_THRESHOLD,
  DEFAULT_WAVE_CONTROL_ENDPOINT,
} from "./config.mjs";
import { writeJsonAtomic, readJsonOrNull } from "./shared.mjs";
import {
  isDefaultWaveControlEndpoint,
  readJsonResponse,
  resolveWaveControlAuthToken,
} from "./provider-runtime.mjs";
import {
  isContEvalImplementationOwningAgent,
  isDesignAgent,
  isSecurityReviewAgent,
} from "./role-helpers.mjs";

const SEVERITY_RANK = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

function normalizeOwnedPath(value) {
  return String(value || "").trim().replaceAll("\\", "/").replace(/\/+$/, "");
}

function isRelevantOwnedPath(value) {
  const normalized = normalizeOwnedPath(value);
  if (!normalized || normalized.startsWith(".tmp/")) {
    return false;
  }
  if (normalized.startsWith("docs/")) {
    return false;
  }
  return !/\.(?:md|txt)$/i.test(normalized);
}

function matchesOwnedPath(findingPath, ownedPath) {
  const normalizedFinding = normalizeOwnedPath(findingPath);
  const normalizedOwned = normalizeOwnedPath(ownedPath);
  if (!normalizedFinding || !normalizedOwned) {
    return false;
  }
  return normalizedFinding === normalizedOwned || normalizedFinding.startsWith(`${normalizedOwned}/`);
}

function shouldIncludeImplementationOwnedPaths(agent, lanePaths = {}) {
  if (!agent || isSecurityReviewAgent(agent) || isDesignAgent(agent)) {
    return false;
  }
  if (agent.agentId === lanePaths.contQaAgentId || agent.agentId === lanePaths.documentationAgentId) {
    return false;
  }
  if (agent.agentId === lanePaths.integrationAgentId) {
    return false;
  }
  if (agent.agentId === lanePaths.contEvalAgentId) {
    return isContEvalImplementationOwningAgent(agent, {
      contEvalAgentId: lanePaths.contEvalAgentId,
    });
  }
  return true;
}

export function waveCorridorContextPath(lanePaths, waveNumber) {
  return path.join(lanePaths.securityDir, `wave-${waveNumber}-corridor.json`);
}

export function readWaveCorridorContext(lanePaths, waveNumber) {
  return readJsonOrNull(waveCorridorContextPath(lanePaths, waveNumber));
}

function corridorArtifactBase({ lanePaths, wave, ownedPaths, providerMode, source }) {
  return {
    schemaVersion: 1,
    wave,
    lane: lanePaths.lane,
    projectId: lanePaths.project,
    providerMode,
    source,
    requiredAtClosure: lanePaths.externalProviders?.corridor?.requiredAtClosure !== false,
    severityThreshold:
      lanePaths.externalProviders?.corridor?.severityThreshold || DEFAULT_CORRIDOR_SEVERITY_THRESHOLD,
    fetchedAt: new Date().toISOString(),
    relevantOwnedPaths: ownedPaths,
  };
}

function summarizeCorridorPayload(base, guardrails, findings) {
  const thresholdRank = SEVERITY_RANK[String(base.severityThreshold || "critical").toLowerCase()] || 4;
  const matchedFindings = (Array.isArray(findings) ? findings : [])
    .map((finding) => {
      const matchedOwnedPaths = base.relevantOwnedPaths.filter((ownedPath) =>
        matchesOwnedPath(finding.affectedFile, ownedPath),
      );
      if (matchedOwnedPaths.length === 0) {
        return null;
      }
      return {
        id: finding.id || null,
        title: finding.title || null,
        affectedFile: finding.affectedFile || null,
        cwe: finding.cwe || null,
        severity: finding.severity || null,
        state: finding.state || null,
        createdAt: finding.createdAt || null,
        matchedOwnedPaths,
      };
    })
    .filter(Boolean);
  const blockingFindings = matchedFindings.filter((finding) => {
    const rank = SEVERITY_RANK[String(finding.severity || "").toLowerCase()] || 0;
    return rank >= thresholdRank;
  });
  return {
    ...base,
    ok: true,
    guardrails: Array.isArray(guardrails?.reports) ? guardrails.reports : [],
    matchedFindings,
    blockingFindings,
    blocking: blockingFindings.length > 0,
    error: null,
  };
}

function failureCorridorPayload(base, error) {
  return {
    ...base,
    ok: false,
    guardrails: [],
    matchedFindings: [],
    blockingFindings: [],
    blocking: base.requiredAtClosure === true,
    error: error instanceof Error ? error.message : String(error),
  };
}

async function requestCorridorJson(fetchImpl, url, token) {
  const response = await fetchImpl(url, {
    method: "GET",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    const payload = await readJsonResponse(response, null);
    throw new Error(
      `Corridor request failed (${response.status}): ${payload?.error || payload?.message || response.statusText || "unknown error"}`,
    );
  }
  return response.json();
}

async function listCorridorFindings(fetchImpl, baseUrl, projectId, token, findingStates) {
  const findings = [];
  const states = findingStates.size > 0 ? [...findingStates] : [null];
  for (const state of states) {
    let nextUrl = new URL(`${baseUrl}/projects/${projectId}/findings`);
    if (state) {
      nextUrl.searchParams.set("state", state);
    }
    let pages = 0;
    while (nextUrl && pages < 10) {
      const payload = await requestCorridorJson(fetchImpl, nextUrl, token);
      if (Array.isArray(payload)) {
        findings.push(...payload);
        break;
      }
      const items = Array.isArray(payload?.items)
        ? payload.items
        : Array.isArray(payload?.findings)
          ? payload.findings
          : Array.isArray(payload?.data)
            ? payload.data
            : [];
      findings.push(...items);
      if (payload?.nextPageUrl) {
        nextUrl = new URL(payload.nextPageUrl);
      } else if (payload?.nextCursor) {
        nextUrl = new URL(`${baseUrl}/projects/${projectId}/findings`);
        if (state) {
          nextUrl.searchParams.set("state", state);
        }
        nextUrl.searchParams.set("cursor", String(payload.nextCursor));
      } else if (payload?.page && payload?.totalPages && Number(payload.page) < Number(payload.totalPages)) {
        nextUrl = new URL(`${baseUrl}/projects/${projectId}/findings`);
        if (state) {
          nextUrl.searchParams.set("state", state);
        }
        nextUrl.searchParams.set("page", String(Number(payload.page) + 1));
      } else {
        nextUrl = null;
      }
      pages += 1;
    }
  }
  return findings;
}

async function fetchCorridorDirect(fetchImpl, lanePaths, ownedPaths) {
  const corridor = lanePaths.externalProviders?.corridor || {};
  const token =
    process.env[corridor.apiTokenEnvVar || "CORRIDOR_API_TOKEN"] ||
    process.env[corridor.apiKeyFallbackEnvVar || "CORRIDOR_API_KEY"] ||
    "";
  if (!token) {
    throw new Error(
      `Corridor token is missing; set ${corridor.apiTokenEnvVar || "CORRIDOR_API_TOKEN"} or ${corridor.apiKeyFallbackEnvVar || "CORRIDOR_API_KEY"}.`,
    );
  }
  const baseUrl = String(corridor.baseUrl || DEFAULT_CORRIDOR_BASE_URL).replace(/\/$/, "");
  const findingStates = new Set((corridor.findingStates || []).map((state) => String(state).trim().toLowerCase()));
  const [guardrails, findings] = await Promise.all([
    requestCorridorJson(fetchImpl, `${baseUrl}/projects/${corridor.projectId}/reports`, token),
    listCorridorFindings(fetchImpl, baseUrl, corridor.projectId, token, findingStates),
  ]);
  const filteredFindings = (Array.isArray(findings) ? findings : []).filter((finding) =>
    findingStates.size === 0 || findingStates.has(String(finding.state || "").trim().toLowerCase()),
  );
  return summarizeCorridorPayload(
    corridorArtifactBase({
      lanePaths,
      wave: null,
      ownedPaths,
      providerMode: "direct",
      source: "corridor-api",
    }),
    guardrails,
    filteredFindings,
  );
}

async function fetchCorridorBroker(fetchImpl, lanePaths, waveNumber, ownedPaths) {
  const waveControl = lanePaths.waveControl || {};
  const endpoint = String(waveControl.endpoint || DEFAULT_WAVE_CONTROL_ENDPOINT).trim();
  if (!endpoint || isDefaultWaveControlEndpoint(endpoint)) {
    throw new Error("Corridor broker mode requires an owned Wave Control endpoint.");
  }
  const authToken = resolveWaveControlAuthToken(waveControl);
  if (!authToken) {
    throw new Error("WAVE_API_TOKEN is not set; Corridor broker mode is unavailable.");
  }
  const response = await fetchImpl(`${endpoint.replace(/\/$/, "")}/providers/corridor/context`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${authToken}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      projectId: lanePaths.project,
      wave: waveNumber,
      ownedPaths,
      severityThreshold:
        lanePaths.externalProviders?.corridor?.severityThreshold || DEFAULT_CORRIDOR_SEVERITY_THRESHOLD,
      findingStates: lanePaths.externalProviders?.corridor?.findingStates || [],
    }),
  });
  if (!response.ok) {
    const payload = await readJsonResponse(response, null);
    throw new Error(
      `Corridor broker request failed (${response.status}): ${payload?.error || payload?.message || response.statusText || "unknown error"}`,
    );
  }
  return response.json();
}

export async function materializeWaveCorridorContext(
  lanePaths,
  waveDefinition,
  {
    fetchImpl = globalThis.fetch,
  } = {},
) {
  const corridor = lanePaths.externalProviders?.corridor || {};
  const waveNumber = waveDefinition?.wave ?? 0;
  const artifactPath = waveCorridorContextPath(lanePaths, waveNumber);
  if (!corridor.enabled) {
    return null;
  }
  const ownedPaths = (Array.isArray(waveDefinition?.agents) ? waveDefinition.agents : [])
    .filter((agent) => shouldIncludeImplementationOwnedPaths(agent, lanePaths))
    .flatMap((agent) => (Array.isArray(agent.ownedPaths) ? agent.ownedPaths : []))
    .map(normalizeOwnedPath)
    .filter(isRelevantOwnedPath);
  const base = corridorArtifactBase({
    lanePaths,
    wave: waveNumber,
    ownedPaths,
    providerMode: corridor.mode || "direct",
    source: null,
  });
  if (ownedPaths.length === 0) {
    const payload = {
      ...base,
      ok: true,
      guardrails: [],
      matchedFindings: [],
      blockingFindings: [],
      blocking: false,
      error: null,
      detail: "No implementation-owned paths were eligible for Corridor matching in this wave.",
    };
    writeJsonAtomic(artifactPath, payload);
    return payload;
  }
  try {
    let payload;
    if (corridor.mode === "broker") {
      payload = await fetchCorridorBroker(fetchImpl, lanePaths, waveNumber, ownedPaths);
    } else if (corridor.mode === "hybrid") {
      try {
        payload = await fetchCorridorBroker(fetchImpl, lanePaths, waveNumber, ownedPaths);
      } catch {
        payload = await fetchCorridorDirect(fetchImpl, lanePaths, ownedPaths);
      }
    } else {
      payload = await fetchCorridorDirect(fetchImpl, lanePaths, ownedPaths);
    }
    const mergedPayload = {
      ...base,
      ...payload,
      wave: waveNumber,
      lane: lanePaths.lane,
      projectId: lanePaths.project,
      relevantOwnedPaths: ownedPaths,
      requiredAtClosure: corridor.requiredAtClosure !== false,
    };
    writeJsonAtomic(artifactPath, mergedPayload);
    return mergedPayload;
  } catch (error) {
    const payload = failureCorridorPayload(base, error);
    writeJsonAtomic(artifactPath, payload);
    return payload;
  }
}

export function renderCorridorPromptContext(corridorContext) {
  if (!corridorContext || corridorContext.ok !== true) {
    if (corridorContext?.error) {
      return `Corridor provider fetch failed: ${corridorContext.error}`;
    }
    return "";
  }
  const lines = [
    `Corridor source: ${corridorContext.source || corridorContext.providerMode || "unknown"}`,
    `Corridor blocking: ${corridorContext.blocking ? "yes" : "no"}`,
    `Corridor threshold: ${corridorContext.severityThreshold || DEFAULT_CORRIDOR_SEVERITY_THRESHOLD}`,
    `Corridor matched findings: ${(corridorContext.matchedFindings || []).length}`,
  ];
  for (const finding of (corridorContext.blockingFindings || []).slice(0, 5)) {
    lines.push(
      `- ${finding.severity || "unknown"} ${finding.affectedFile || "unknown-file"}: ${finding.title || "finding"}`
    );
  }
  return lines.join("\n");
}
