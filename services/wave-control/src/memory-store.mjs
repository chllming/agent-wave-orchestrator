import {
  buildAnalyticsOverview,
  getBenchmarkRunDetail,
  getRunDetail,
  listBenchmarkRunSummaries,
  listRunSummaries,
} from "./projections.mjs";

function artifactKey(eventId, artifactId) {
  return `${eventId}:${artifactId}`;
}

export class MemoryWaveControlStore {
  constructor() {
    this.events = [];
    this.artifactUploads = new Map();
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
}
