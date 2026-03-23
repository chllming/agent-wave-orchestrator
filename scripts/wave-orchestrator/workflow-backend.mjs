import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ensureDirectory, readJsonOrNull, toIsoTimestamp, writeJsonAtomic } from "./shared.mjs";
import { reduceWaveState } from "./wave-state-reducer.mjs";

/**
 * WorkflowBackend interface (P2-15 end-state).
 *
 * First implementation: local files + reducer.
 * The interface is designed so that future backends (Temporal, service-backed)
 * can implement the same contract.
 *
 * Design constraint: in-process timers (setTimeout) are lost on restart.
 * This is acceptable for the local-file backend. A production backend
 * would use durable timer storage (e.g. Temporal timers, database-backed
 * scheduling). The scheduleTimer / cancelTimer / getExpiredTimers interface
 * is designed to accommodate both approaches.
 */
export class LocalWorkflowBackend {
  constructor(basePath) {
    this.basePath = basePath;
    this._timers = new Map();
    this._humanInputs = new Map();
  }

  // -------------------------------------------------------------------------
  // Event persistence (P2-15: appendEvent / readEvents)
  // -------------------------------------------------------------------------

  /**
   * Append an event to the JSONL file at basePath/events.jsonl.
   */
  async appendEvent(event) {
    if (!event || typeof event !== "object") {
      throw new Error("Event must be an object");
    }
    const eventsPath = path.join(this.basePath, "events.jsonl");
    ensureDirectory(this.basePath);
    const record = {
      ...event,
      persistedAt: toIsoTimestamp(),
      eventId: event.eventId || `evt-${crypto.randomBytes(4).toString("hex")}`,
    };
    fs.appendFileSync(eventsPath, `${JSON.stringify(record)}\n`, "utf8");
    return record;
  }

  /**
   * Read events from JSONL, optionally filtered by entityType, wave, or lane.
   */
  async readEvents(filter = {}) {
    const eventsPath = path.join(this.basePath, "events.jsonl");
    if (!fs.existsSync(eventsPath)) {
      return [];
    }
    const raw = fs.readFileSync(eventsPath, "utf8").trim();
    if (!raw) {
      return [];
    }
    const lines = raw.split("\n").filter(Boolean);
    let events = [];
    for (const line of lines) {
      try {
        events.push(JSON.parse(line));
      } catch {
        // Skip malformed lines.
      }
    }
    if (filter.entityType) {
      events = events.filter((event) => event.entityType === filter.entityType);
    }
    if (filter.wave !== undefined && filter.wave !== null) {
      events = events.filter((event) => event.wave === filter.wave);
    }
    if (filter.lane) {
      events = events.filter((event) => event.lane === filter.lane);
    }
    return events;
  }

  // -------------------------------------------------------------------------
  // State queries (P2-15: backed by reducer)
  // -------------------------------------------------------------------------

  /**
   * Get the full wave state by reading events and calling the reducer.
   *
   * @param {string} lane
   * @param {number} wave
   * @returns {object|null} WaveState or null if no events
   */
  async getWaveState(lane, wave) {
    const events = await this.readEvents({ lane, wave });
    if (events.length === 0) {
      return null;
    }
    return reduceWaveState({
      controlPlaneEvents: events,
      coordinationRecords: [],
      agentResults: {},
      waveDefinition: null,
      dependencyTickets: null,
      feedbackRequests: [],
      laneConfig: { lane },
    });
  }

  /**
   * Get the state of a specific task.
   *
   * @param {string} taskId
   * @returns {object|null} TaskState or null
   */
  async getTaskState(taskId) {
    if (!taskId) {
      return null;
    }
    // Parse wave/lane from taskId (format: "wave-N:agentId:scope")
    const match = String(taskId).match(/^wave-(\d+):/);
    if (!match) {
      return null;
    }
    const waveNumber = Number.parseInt(match[1], 10);
    const state = await this.getWaveState(null, waveNumber);
    if (!state?.tasks) {
      return null;
    }
    const tasks = Array.isArray(state.tasks) ? state.tasks : [];
    return tasks.find((t) => t.taskId === taskId) || null;
  }

  /**
   * Get all open blockers for a wave.
   *
   * @param {string} lane
   * @param {number} wave
   * @returns {Array} Open blockers
   */
  async getOpenBlockers(lane, wave) {
    const state = await this.getWaveState(lane, wave);
    return state?.openBlockers || [];
  }

  /**
   * Get closure eligibility for a wave.
   *
   * @param {string} lane
   * @param {number} wave
   * @returns {object|null} ClosureState
   */
  async getClosureEligibility(lane, wave) {
    const state = await this.getWaveState(lane, wave);
    return state?.closureEligibility || null;
  }

  // -------------------------------------------------------------------------
  // Timer management (P2-15)
  // -------------------------------------------------------------------------

  /**
   * Schedule a timer (local implementation: setTimeout wrapper).
   * Returns { timerId, scheduledAt, expiresAt, cancel() }.
   *
   * Design constraint: in-process timers are lost on restart.
   */
  async scheduleTimer(timerId, durationMs, callback) {
    const scheduledAt = toIsoTimestamp();
    const expiresAt = new Date(Date.now() + durationMs).toISOString();
    const id = timerId || `timer-${crypto.randomBytes(4).toString("hex")}`;
    const handle = setTimeout(() => {
      this._timers.delete(id);
      if (typeof callback === "function") {
        callback({ timerId: id, scheduledAt, expiresAt, firedAt: toIsoTimestamp() });
      }
    }, durationMs);
    const entry = {
      timerId: id,
      scheduledAt,
      expiresAt,
      cancel: () => {
        clearTimeout(handle);
        this._timers.delete(id);
      },
    };
    this._timers.set(id, entry);
    return entry;
  }

  /**
   * Cancel a timer by its ID (P2-15 standalone cancel method).
   * Returns true if the timer was found and cancelled, false otherwise.
   */
  async cancelTimer(timerId) {
    const entry = this._timers.get(timerId);
    if (!entry) {
      return false;
    }
    if (typeof entry.cancel === "function") {
      entry.cancel();
    } else {
      this._timers.delete(timerId);
    }
    return true;
  }

  /**
   * Get all expired timers that have not yet fired.
   * In the local implementation, timers fire immediately via setTimeout,
   * so this returns timers whose expiresAt is in the past but are still tracked.
   * Returns an array of timer entries.
   */
  async getExpiredTimers() {
    const now = Date.now();
    const expired = [];
    for (const [, entry] of this._timers) {
      const expiresAt = Date.parse(entry.expiresAt || "");
      if (Number.isFinite(expiresAt) && expiresAt <= now) {
        expired.push(entry);
      }
    }
    return expired;
  }

  // -------------------------------------------------------------------------
  // Human input (P2-15)
  // -------------------------------------------------------------------------

  /**
   * Create a human input request.
   * Returns the requestId.
   */
  async createHumanInput(request) {
    if (!request || typeof request !== "object") {
      throw new Error("Request must be an object");
    }
    const requestId = request.requestId || `hi-${crypto.randomBytes(4).toString("hex")}`;
    const record = {
      requestId,
      kind: request.kind || "clarification",
      status: "pending",
      requestedBy: request.requestedBy || null,
      requestedAt: toIsoTimestamp(),
      assignedTo: null,
      answeredAt: null,
      resolvedAt: null,
      question: request.question || null,
      context: request.context || null,
      response: null,
    };
    this._humanInputs.set(requestId, record);

    // Also persist as an event for durability
    await this.appendEvent({
      entityType: "human_input",
      action: "created",
      requestId,
      ...record,
    });

    return requestId;
  }

  /**
   * Resolve a human input request with a response.
   */
  async resolveHumanInput(requestId, response) {
    const record = this._humanInputs.get(requestId);
    if (!record) {
      throw new Error(`Human input request not found: ${requestId}`);
    }
    record.status = "answered";
    record.response = response || null;
    record.answeredAt = toIsoTimestamp();
    record.resolvedAt = toIsoTimestamp();

    await this.appendEvent({
      entityType: "human_input",
      action: "resolved",
      requestId,
      response: record.response,
      resolvedAt: record.resolvedAt,
    });
  }

  /**
   * Get all open (unresolved) human input requests, optionally filtered.
   */
  async getOpenHumanInputs(filter = {}) {
    const results = [];
    for (const [, record] of this._humanInputs) {
      if (record.status !== "pending" && record.status !== "assigned") {
        continue;
      }
      if (filter.kind && record.kind !== filter.kind) {
        continue;
      }
      if (filter.requestedBy && record.requestedBy !== filter.requestedBy) {
        continue;
      }
      results.push({ ...record });
    }
    return results;
  }

  // -------------------------------------------------------------------------
  // Lease management (retained from v1)
  // -------------------------------------------------------------------------

  /**
   * Acquire a lease. Returns { leaseId, ownerId, acquiredAt, expiresAt }.
   * If already held (not expired), returns null (lease not available).
   */
  async acquireLease(leaseId, ownerAgentId, durationMs) {
    const leasesDir = path.join(this.basePath, "leases");
    ensureDirectory(leasesDir);
    const leasePath = path.join(leasesDir, `${leaseId}.json`);
    const existing = readJsonOrNull(leasePath);
    if (existing && typeof existing === "object") {
      const expiresAt = Date.parse(existing.expiresAt || "");
      if (Number.isFinite(expiresAt) && expiresAt > Date.now()) {
        return null;
      }
    }
    const acquiredAt = toIsoTimestamp();
    const expiresAt = new Date(Date.now() + durationMs).toISOString();
    const lease = {
      leaseId,
      ownerId: ownerAgentId,
      acquiredAt,
      expiresAt,
    };
    writeJsonAtomic(leasePath, lease);
    return lease;
  }

  /**
   * Release a lease. Returns true if released, false if not held.
   */
  async releaseLease(leaseId) {
    const leasePath = path.join(this.basePath, "leases", `${leaseId}.json`);
    if (!fs.existsSync(leasePath)) {
      return false;
    }
    try {
      fs.unlinkSync(leasePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if a lease is currently held (not expired).
   */
  async isLeaseHeld(leaseId) {
    const leasePath = path.join(this.basePath, "leases", `${leaseId}.json`);
    const existing = readJsonOrNull(leasePath);
    if (!existing || typeof existing !== "object") {
      return false;
    }
    const expiresAt = Date.parse(existing.expiresAt || "");
    return Number.isFinite(expiresAt) && expiresAt > Date.now();
  }

  // -------------------------------------------------------------------------
  // Key-value state (retained from v1)
  // -------------------------------------------------------------------------

  /**
   * Read state by key from basePath/state/<key>.json.
   */
  async getState(key) {
    const statePath = path.join(this.basePath, "state", `${key}.json`);
    return readJsonOrNull(statePath);
  }

  /**
   * Write state by key to basePath/state/<key>.json.
   */
  async setState(key, value) {
    const stateDir = path.join(this.basePath, "state");
    ensureDirectory(stateDir);
    const statePath = path.join(stateDir, `${key}.json`);
    writeJsonAtomic(statePath, value);
  }
}

/**
 * Factory: currently always returns LocalWorkflowBackend.
 * Future: could return TemporalBackend, ServiceBackend, etc. based on options.type.
 */
export function createWorkflowBackend(options = {}) {
  return new LocalWorkflowBackend(options.basePath || ".tmp/workflow");
}
