import {
  buildAnalyticsOverview,
  getBenchmarkRunDetail,
  getRunDetail,
  listBenchmarkRunSummaries,
  listRunSummaries,
} from "./projections.mjs";
import { sanitizeUserCredentialRecord } from "./user-credentials.mjs";

function artifactKey(eventId, artifactId) {
  return `${eventId}:${artifactId}`;
}

export class MemoryWaveControlStore {
  constructor() {
    this.events = [];
    this.artifactUploads = new Map();
    this.personalAccessTokens = [];
    this.appUsers = [];
    this.userCredentials = [];
    this.auditEvents = [];
  }

  async init() {}

  async ingestBatch(batch) {
    let accepted = 0;
    let duplicates = 0;
    for (const event of batch.events || []) {
      if (this.events.some((existing) => existing.id === event.id)) {
        duplicates += 1;
        continue;
      }
      this.events.push(JSON.parse(JSON.stringify(event)));
      accepted += 1;
      for (const upload of event.artifactUploads || []) {
        this.artifactUploads.set(artifactKey(event.id, upload.artifactId), {
          eventId: event.id,
          artifactId: upload.artifactId,
          contentType: upload.contentType,
          encoding: upload.encoding,
          content: upload.content,
        });
      }
    }
    return { accepted, duplicates };
  }

  async listRuns(filters = {}) {
    return listRunSummaries(this.events, filters);
  }

  async getRun(filters = {}) {
    return getRunDetail(this.events, filters);
  }

  async listBenchmarkRuns(filters = {}) {
    return listBenchmarkRunSummaries(this.events, filters);
  }

  async getBenchmarkRun(filters = {}) {
    return getBenchmarkRunDetail(this.events, filters);
  }

  async getAnalytics(filters = {}) {
    return buildAnalyticsOverview(this.events, filters);
  }

  async getArtifact({ eventId, artifactId, inline = false }) {
    const event = this.events.find((entry) => entry.id === eventId);
    if (!event) {
      return null;
    }
    const artifact = (event.artifacts || []).find((entry) => entry.artifactId === artifactId);
    if (!artifact) {
      return null;
    }
    const upload = this.artifactUploads.get(artifactKey(eventId, artifactId)) || null;
    return {
      eventId,
      artifactId,
      metadata: artifact,
      inlineContent: inline ? upload : null,
    };
  }

  async listPersonalAccessTokens({ ownerStackUserId, ownerEmail } = {}) {
    return this.personalAccessTokens.filter(
      (record) =>
        (!ownerStackUserId && !ownerEmail) ||
        (ownerStackUserId
          ? record.ownerStackUserId === ownerStackUserId
          : ownerEmail
            ? record.ownerEmail === ownerEmail
            : true),
    );
  }

  async createPersonalAccessToken(record) {
    this.personalAccessTokens.push(JSON.parse(JSON.stringify(record)));
    return record;
  }

  async findPersonalAccessTokenByHash(tokenHash) {
    return this.personalAccessTokens.find(
      (record) => record.tokenHash === tokenHash && !record.revokedAt,
    ) || null;
  }

  async findPersonalAccessTokenById(id) {
    return this.personalAccessTokens.find((record) => record.id === id) || null;
  }

  async touchPersonalAccessTokenLastUsed(id, usedAt) {
    const record = this.personalAccessTokens.find((entry) => entry.id === id);
    if (record) {
      record.lastUsedAt = usedAt;
    }
  }

  async revokePersonalAccessToken(id, revokedAt) {
    const record = this.personalAccessTokens.find((entry) => entry.id === id);
    if (!record) {
      return null;
    }
    record.revokedAt = revokedAt;
    return record;
  }

  async listAppUsers() {
    return this.appUsers
      .slice()
      .sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")));
  }

  async findAppUserByStackUserId(stackUserId) {
    return this.appUsers.find((record) => record.stackUserId === stackUserId) || null;
  }

  async findAppUserById(id) {
    return this.appUsers.find((record) => record.id === id) || null;
  }

  async findAppUserByEmail(email) {
    return this.appUsers.find((record) => record.email === email) || null;
  }

  async createAppUser(record) {
    this.appUsers.push(JSON.parse(JSON.stringify(record)));
    return record;
  }

  async updateAppUser(id, record) {
    const index = this.appUsers.findIndex((entry) => entry.id === id);
    if (index === -1) {
      return null;
    }
    this.appUsers[index] = JSON.parse(JSON.stringify(record));
    return record;
  }

  async appendAuditEvent(record) {
    this.auditEvents.push(JSON.parse(JSON.stringify(record)));
    return record;
  }

  async listUserCredentials(appUserId) {
    return this.userCredentials
      .filter((record) => record.appUserId === appUserId)
      .slice()
      .sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")));
  }

  async findUserCredential(appUserId, credentialId) {
    return this.userCredentials.find(
      (record) => record.appUserId === appUserId && record.credentialId === credentialId,
    ) || null;
  }

  async upsertUserCredential(record) {
    const normalized = sanitizeUserCredentialRecord(record);
    const index = this.userCredentials.findIndex(
      (entry) =>
        entry.appUserId === normalized.appUserId && entry.credentialId === normalized.credentialId,
    );
    if (index === -1) {
      this.userCredentials.push(JSON.parse(JSON.stringify(normalized)));
    } else {
      this.userCredentials[index] = JSON.parse(JSON.stringify(normalized));
    }
    return normalized;
  }

  async deleteUserCredential(appUserId, credentialId) {
    const index = this.userCredentials.findIndex(
      (record) => record.appUserId === appUserId && record.credentialId === credentialId,
    );
    if (index === -1) {
      return null;
    }
    const [deleted] = this.userCredentials.splice(index, 1);
    return deleted;
  }
}
