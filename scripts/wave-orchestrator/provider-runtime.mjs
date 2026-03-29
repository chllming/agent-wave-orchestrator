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
