import crypto from "node:crypto";

const USER_CREDENTIAL_ALGORITHM = "aes-256-gcm";
const USER_CREDENTIAL_KEY_VERSION = "v1";

function nowIso() {
  return new Date().toISOString();
}

function normalizeString(value) {
  return String(value || "").trim() || null;
}

export function normalizeCredentialId(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(normalized)) {
    const error = new Error(
      "credentialId must match /^[a-z0-9][a-z0-9._-]*$/ and use only lowercase letters, numbers, dots, underscores, or dashes.",
    );
    error.statusCode = 400;
    throw error;
  }
  return normalized;
}

export function normalizeCredentialEnvVar(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (!/^[A-Z_][A-Z0-9_]*$/.test(normalized)) {
    const error = new Error(
      "envVar must match /^[A-Z_][A-Z0-9_]*$/ and use shell-safe environment variable syntax.",
    );
    error.statusCode = 400;
    throw error;
  }
  return normalized;
}

export function sanitizeUserCredentialRecord(record) {
  if (!record || typeof record !== "object") {
    return null;
  }
  return {
    appUserId: normalizeString(record.appUserId),
    credentialId: record.credentialId ? normalizeCredentialId(record.credentialId) : null,
    algorithm: normalizeString(record.algorithm) || USER_CREDENTIAL_ALGORITHM,
    keyVersion: normalizeString(record.keyVersion) || USER_CREDENTIAL_KEY_VERSION,
    ciphertext: normalizeString(record.ciphertext),
    iv: normalizeString(record.iv),
    authTag: normalizeString(record.authTag),
    createdAt: normalizeString(record.createdAt),
    updatedAt: normalizeString(record.updatedAt),
    createdByType: normalizeString(record.createdByType),
    createdById: normalizeString(record.createdById),
    updatedByType: normalizeString(record.updatedByType),
    updatedById: normalizeString(record.updatedById),
  };
}

export function sanitizeUserCredentialMetadata(record) {
  const normalized = sanitizeUserCredentialRecord(record);
  if (!normalized) {
    return null;
  }
  return {
    appUserId: normalized.appUserId,
    credentialId: normalized.credentialId,
    algorithm: normalized.algorithm,
    keyVersion: normalized.keyVersion,
    createdAt: normalized.createdAt,
    updatedAt: normalized.updatedAt,
    createdByType: normalized.createdByType,
    createdById: normalized.createdById,
    updatedByType: normalized.updatedByType,
    updatedById: normalized.updatedById,
  };
}

function resolveEncryptionKey(config) {
  const raw = String(config?.secrets?.encryptionKey || "").trim();
  if (!raw) {
    const error = new Error(
      "Wave Control credential storage requires WAVE_CONTROL_SECRET_ENCRYPTION_KEY to be configured.",
    );
    error.statusCode = 500;
    throw error;
  }
  let key = null;
  try {
    key = Buffer.from(raw, "base64");
  } catch {
    key = null;
  }
  if (!key || key.length !== 32) {
    const error = new Error(
      "WAVE_CONTROL_SECRET_ENCRYPTION_KEY must be a base64-encoded 32-byte AES-256-GCM key.",
    );
    error.statusCode = 500;
    throw error;
  }
  return {
    key,
    keyVersion: USER_CREDENTIAL_KEY_VERSION,
  };
}

function encryptCredentialValue(config, plaintextValue) {
  const value = String(plaintextValue ?? "");
  if (!value) {
    const error = new Error("Credential value is required.");
    error.statusCode = 400;
    throw error;
  }
  const { key, keyVersion } = resolveEncryptionKey(config);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(USER_CREDENTIAL_ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    algorithm: USER_CREDENTIAL_ALGORITHM,
    keyVersion,
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
  };
}

export function createEncryptedUserCredentialRecord(
  config,
  {
    appUserId,
    credentialId,
    plaintextValue,
    actorType = null,
    actorId = null,
    existingRecord = null,
  } = {},
) {
  const current = sanitizeUserCredentialRecord(existingRecord);
  const encrypted = encryptCredentialValue(config, plaintextValue);
  const timestamp = nowIso();
  return sanitizeUserCredentialRecord({
    appUserId,
    credentialId,
    algorithm: encrypted.algorithm,
    keyVersion: encrypted.keyVersion,
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    authTag: encrypted.authTag,
    createdAt: current?.createdAt || timestamp,
    updatedAt: timestamp,
    createdByType: current?.createdByType || actorType,
    createdById: current?.createdById || actorId,
    updatedByType: actorType,
    updatedById: actorId,
  });
}

export function decryptUserCredentialValue(config, record) {
  const normalized = sanitizeUserCredentialRecord(record);
  if (!normalized?.ciphertext || !normalized?.iv || !normalized?.authTag) {
    const error = new Error("Stored credential is malformed.");
    error.statusCode = 500;
    throw error;
  }
  const { key } = resolveEncryptionKey(config);
  try {
    const decipher = crypto.createDecipheriv(
      normalized.algorithm || USER_CREDENTIAL_ALGORITHM,
      key,
      Buffer.from(normalized.iv, "base64"),
    );
    decipher.setAuthTag(Buffer.from(normalized.authTag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(normalized.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
    return plaintext;
  } catch {
    const error = new Error(
      `Credential ${normalized.credentialId || "unknown"} could not be decrypted with the configured service key.`,
    );
    error.statusCode = 500;
    throw error;
  }
}
