export function trimTrailingSlash(input: string): string {
  return input.endsWith("/") ? input.slice(0, -1) : input;
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

export const appConfig = {
  apiBaseUrl: trimTrailingSlash(
    envValue("VITE_WAVE_CONTROL_API_BASE_URL") || window.location.origin,
  ),
  stackProjectId: envValue("VITE_STACK_PROJECT_ID", "NEXT_PUBLIC_STACK_PROJECT_ID"),
  stackPublishableClientKey: envValue(
    "VITE_STACK_PUBLISHABLE_CLIENT_KEY",
    "NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY",
  ),
};
