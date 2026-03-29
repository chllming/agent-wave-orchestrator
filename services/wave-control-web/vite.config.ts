import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));

function normalizeBase(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return "/";
  }
  if (trimmed === "./") {
    return "./";
  }
  return trimmed.endsWith("/") ? trimmed : `${trimmed}/`;
}

export default defineConfig(() => ({
  base: normalizeBase(process.env.WAVE_CONTROL_WEB_BASE_PATH?.trim() || "/"),
  build: {
    outDir: process.env.WAVE_CONTROL_WEB_OUT_DIR?.trim()
      ? path.resolve(here, process.env.WAVE_CONTROL_WEB_OUT_DIR.trim())
      : path.resolve(here, "dist"),
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    host: true,
    port: 4175,
    strictPort: true,
  },
}));
