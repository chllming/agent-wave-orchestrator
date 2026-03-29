export function trimTrailingSlash(input: string): string {
  return input.endsWith("/") ? input.slice(0, -1) : input;
}

export function normalizeApiBaseUrl(input: string): string {
  const trimmed = trimTrailingSlash(String(input || "").trim());
  return trimmed.endsWith("/api/v1") ? trimmed.slice(0, -"/api/v1".length) : trimmed;
}

function envValue(...keys: string[]): string {
  for (const key of keys) {
    const value = String(import.meta.env[key] || "").trim();
    if (value) {
      return value;
    }
  }
  return "";
}

function browserOrigin(): string {
  return typeof window !== "undefined" && window.location?.origin
    ? String(window.location.origin)
    : "";
}

export const appConfig = {
  apiBaseUrl: normalizeApiBaseUrl(
    envValue("VITE_WAVE_CONTROL_API_BASE_URL") || browserOrigin(),
  ),
  stackProjectId: envValue("VITE_STACK_PROJECT_ID", "NEXT_PUBLIC_STACK_PROJECT_ID"),
  stackPublishableClientKey: envValue(
    "VITE_STACK_PUBLISHABLE_CLIENT_KEY",
    "NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY",
  ),
};
