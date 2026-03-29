import {
  listInvalidServiceTokenScopes,
  normalizeServiceTokenScopes,
} from "./service-tokens.mjs";

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

function normalizeServiceTokensJson(value) {
  const raw = normalizeText(value, "");
  if (!raw) {
    return [];
  }
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("WAVE_CONTROL_SERVICE_TOKENS_JSON must be valid JSON.");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("WAVE_CONTROL_SERVICE_TOKENS_JSON must be a JSON array.");
  }
  const seenTokens = new Set();
  return parsed.map((entry, index) => {
    const token = normalizeText(entry?.token, "");
    if (!token) {
      throw new Error(`WAVE_CONTROL_SERVICE_TOKENS_JSON[${index}].token is required.`);
    }
    if (seenTokens.has(token)) {
      throw new Error("WAVE_CONTROL_SERVICE_TOKENS_JSON must not contain duplicate token values.");
    }
    seenTokens.add(token);
    const scopes = normalizeServiceTokenScopes(entry?.scopes || []);
    const invalidScopes = listInvalidServiceTokenScopes(entry?.scopes || []);
    if (invalidScopes.length > 0) {
      throw new Error(
        `WAVE_CONTROL_SERVICE_TOKENS_JSON[${index}].scopes contains unsupported values: ${invalidScopes.join(", ")}.`,
      );
    }
    return {
      label: normalizeText(entry?.label, `service-token-${index + 1}`),
      token,
      scopes,
    };
  });
}

export function loadWaveControlServiceConfig(env = process.env) {
  const authTokens = normalizeTokenList(
    env.WAVE_API_TOKENS ||
      env.WAVE_API_TOKEN ||
      env.WAVE_CONTROL_API_TOKENS ||
      env.WAVE_CONTROL_API_TOKEN ||
      "",
  );
  return {
    host: normalizeText(env.HOST, "0.0.0.0"),
    port: normalizeInt(env.PORT, 3000),
    logLevel: normalizeText(env.WAVE_CONTROL_LOG_LEVEL, "info"),
    auth: {
      tokens: authTokens,
      serviceTokens: normalizeServiceTokensJson(env.WAVE_CONTROL_SERVICE_TOKENS_JSON),
      requireAuthForReads: normalizeBool(env.WAVE_CONTROL_REQUIRE_AUTH_FOR_READS, true),
    },
    secrets: {
      encryptionKey: normalizeText(env.WAVE_CONTROL_SECRET_ENCRYPTION_KEY, ""),
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
    cors: {
      allowedOrigins: normalizeTokenList(env.WAVE_CONTROL_ALLOWED_ORIGINS),
    },
    stack: {
      enabled: normalizeBool(env.WAVE_CONTROL_STACK_ENABLED, false),
      projectId: normalizeText(env.WAVE_CONTROL_STACK_PROJECT_ID || env.NEXT_PUBLIC_STACK_PROJECT_ID, ""),
      publishableClientKey: normalizeText(
        env.WAVE_CONTROL_STACK_PUBLISHABLE_CLIENT_KEY || env.NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY,
        "",
      ),
      secretServerKey: normalizeText(env.STACK_SECRET_SERVER_KEY, ""),
      internalTeamIds: normalizeTokenList(env.WAVE_CONTROL_STACK_INTERNAL_TEAM_IDS),
      adminTeamIds: normalizeTokenList(env.WAVE_CONTROL_STACK_ADMIN_TEAM_IDS),
      bootstrapSuperuserEmails: normalizeTokenList(env.WAVE_CONTROL_BOOTSTRAP_SUPERUSER_EMAILS),
    },
    broker: {
      ownedDeployment: normalizeBool(env.WAVE_BROKER_OWNED_DEPLOYMENT, false),
      context7Enabled: normalizeBool(env.WAVE_BROKER_ENABLE_CONTEXT7, false),
      context7ApiKey: normalizeText(env.WAVE_BROKER_CONTEXT7_API_KEY, ""),
      corridorEnabled: normalizeBool(env.WAVE_BROKER_ENABLE_CORRIDOR, false),
      corridorApiToken: normalizeText(env.WAVE_BROKER_CORRIDOR_API_TOKEN, ""),
      openaiEnabled: normalizeBool(env.WAVE_BROKER_ENABLE_OPENAI, false),
      openaiApiKey: normalizeText(env.WAVE_BROKER_OPENAI_API_KEY, ""),
      anthropicEnabled: normalizeBool(env.WAVE_BROKER_ENABLE_ANTHROPIC, false),
      anthropicApiKey: normalizeText(env.WAVE_BROKER_ANTHROPIC_API_KEY, ""),
      requestTimeoutMs: normalizeInt(env.WAVE_BROKER_REQUEST_TIMEOUT_MS, 10000),
      maxRetries: normalizeInt(env.WAVE_BROKER_MAX_RETRIES, 1),
      maxPages: normalizeInt(env.WAVE_BROKER_MAX_PAGES, 10),
      corridorProjectMap: (() => {
        const raw = normalizeText(env.WAVE_BROKER_CORRIDOR_PROJECT_MAP, "");
        if (!raw) {
          return {};
        }
        try {
          const parsed = JSON.parse(raw);
          return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
        } catch {
          return {};
        }
      })(),
    },
  };
}
