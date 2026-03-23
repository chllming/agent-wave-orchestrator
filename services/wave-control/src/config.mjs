function normalizeText(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function normalizeInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeBool(value, fallback = false) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  if (typeof value === "boolean") {
    return value;
  }
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function normalizeTokenList(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function loadWaveControlServiceConfig(env = process.env) {
  const authTokens = normalizeTokenList(
    env.WAVE_CONTROL_API_TOKENS || env.WAVE_CONTROL_API_TOKEN || "",
  );
  return {
    host: normalizeText(env.HOST, "0.0.0.0"),
    port: normalizeInt(env.PORT, 3000),
    logLevel: normalizeText(env.WAVE_CONTROL_LOG_LEVEL, "info"),
    auth: {
      tokens: authTokens,
      requireAuthForReads: normalizeBool(env.WAVE_CONTROL_REQUIRE_AUTH_FOR_READS, true),
    },
    postgres: {
      databaseUrl: normalizeText(env.DATABASE_URL, ""),
      ssl: normalizeBool(env.PGSSL, false),
      maxConnections: normalizeInt(env.WAVE_CONTROL_DB_MAX_CONNECTIONS, 10),
    },
    storage: {
      bucketName: normalizeText(env.WAVE_CONTROL_BUCKET_NAME, ""),
      endpoint: normalizeText(env.WAVE_CONTROL_BUCKET_ENDPOINT, ""),
      accessKeyId: normalizeText(env.WAVE_CONTROL_BUCKET_ACCESS_KEY_ID, ""),
      secretAccessKey: normalizeText(env.WAVE_CONTROL_BUCKET_SECRET_ACCESS_KEY, ""),
      region: normalizeText(env.WAVE_CONTROL_BUCKET_REGION, "auto"),
      publicBaseUrl: normalizeText(env.WAVE_CONTROL_BUCKET_PUBLIC_BASE_URL, ""),
      signedUrlTtlSeconds: normalizeInt(env.WAVE_CONTROL_BUCKET_SIGNED_URL_TTL_SECONDS, 900),
      forcePathStyle: normalizeBool(env.WAVE_CONTROL_BUCKET_FORCE_PATH_STYLE, true),
    },
    ingest: {
      maxBatchEvents: normalizeInt(env.WAVE_CONTROL_MAX_BATCH_EVENTS, 200),
      maxInlineArtifactBytes: normalizeInt(env.WAVE_CONTROL_MAX_INLINE_ARTIFACT_BYTES, 512 * 1024),
    },
    ui: {
      title: normalizeText(env.WAVE_CONTROL_UI_TITLE, "Wave Control"),
    },
  };
}
