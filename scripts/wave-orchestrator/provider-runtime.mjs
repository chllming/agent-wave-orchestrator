import { DEFAULT_WAVE_CONTROL_ENDPOINT } from "./config.mjs";

export function resolveEnvValue(envVars, env = process.env) {
  for (const envVar of Array.isArray(envVars) ? envVars : [envVars]) {
    const value = envVar ? String(env[envVar] || "").trim() : "";
    if (value) {
      return value;
    }
  }
  return "";
}

export function resolveWaveControlAuthToken(waveControl = {}, env = process.env) {
  const envVars = Array.isArray(waveControl?.authTokenEnvVars)
    ? waveControl.authTokenEnvVars
    : [waveControl?.authTokenEnvVar].filter(Boolean);
  return resolveEnvValue(envVars, env);
}

export function isDefaultWaveControlEndpoint(endpoint) {
  const normalized = String(endpoint || "").trim().replace(/\/+$/, "");
  return normalized === String(DEFAULT_WAVE_CONTROL_ENDPOINT).trim().replace(/\/+$/, "");
}

export async function readJsonResponse(response, fallback = null) {
  try {
    return await response.json();
  } catch {
    return fallback;
  }
}

export async function requestProvider(fetchImpl, url, options = {}) {
  const response = await fetchImpl(url, options);
  if (response.ok) {
    return response;
  }
  const payload = await readJsonResponse(response, null);
  throw new Error(
    `${options.method || "GET"} ${url} failed (${response.status}): ${payload?.error || payload?.message || response.statusText || "unknown error"}`,
  );
}

export async function requestWaveControlProviderEnv(fetchImpl, waveControl = {}, providers = []) {
  const endpoint = String(waveControl.endpoint || DEFAULT_WAVE_CONTROL_ENDPOINT).trim();
  if (!endpoint) {
    throw new Error("Wave Control endpoint is not configured.");
  }
  if (isDefaultWaveControlEndpoint(endpoint)) {
    throw new Error("Wave Control provider credential leasing requires an owned Wave Control deployment.");
  }
  const token = resolveWaveControlAuthToken(waveControl);
  if (!token) {
    throw new Error("WAVE_API_TOKEN is not set; Wave Control credential leasing is unavailable.");
  }
  const response = await requestProvider(
    fetchImpl,
    `${endpoint.replace(/\/$/, "")}/runtime/provider-env`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ providers }),
    },
  );
  const payload = await readJsonResponse(response, null);
  return payload?.env && typeof payload.env === "object" && !Array.isArray(payload.env)
    ? payload.env
    : {};
}

export async function requestWaveControlCredentialEnv(fetchImpl, waveControl = {}, credentials = []) {
  const endpoint = String(waveControl.endpoint || DEFAULT_WAVE_CONTROL_ENDPOINT).trim();
  if (!endpoint) {
    throw new Error("Wave Control endpoint is not configured.");
  }
  if (isDefaultWaveControlEndpoint(endpoint)) {
    throw new Error("Wave Control credential leasing requires an owned Wave Control deployment.");
  }
  const token = resolveWaveControlAuthToken(waveControl);
  if (!token) {
    throw new Error("WAVE_API_TOKEN is not set; Wave Control credential leasing is unavailable.");
  }
  const response = await requestProvider(
    fetchImpl,
    `${endpoint.replace(/\/$/, "")}/runtime/credential-env`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ credentials }),
    },
  );
  const payload = await readJsonResponse(response, null);
  return payload?.env && typeof payload.env === "object" && !Array.isArray(payload.env)
    ? payload.env
    : {};
}
