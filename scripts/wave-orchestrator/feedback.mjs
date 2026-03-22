import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { withFileLock } from "./coordination.mjs";
import {
  DEFAULT_WAIT_TIMEOUT_SECONDS,
  DEFAULT_WATCH_REFRESH_MS,
  DEFAULT_WAVE_LANE,
  REPO_ROOT,
  buildLanePaths,
  compactSingleLine,
  ensureDirectory,
  formatAgeFromTimestamp,
  parseNonNegativeInt,
  parsePositiveInt,
  readJsonOrNull,
  sanitizeAdhocRunId,
  sanitizeLaneName,
  sleep,
  toIsoTimestamp,
  truncate,
  writeJsonAtomic,
} from "./shared.mjs";

function sanitizeToken(value) {
  const token = String(value || "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!token) {
    throw new Error("Invalid token");
  }
  return token;
}

function requestFilePath(feedbackRequestsDir, requestId) {
  return path.join(feedbackRequestsDir, `${requestId}.json`);
}

function resolveLaneForRun(runId, fallbackLane) {
  const resultPath = path.join(REPO_ROOT, ".wave", "adhoc", "runs", runId, "result.json");
  return readJsonOrNull(resultPath)?.lane || fallbackLane;
}

function buildRequestId({ lane, wave, agentId }) {
  const ts = new Date().toISOString().replace(/[-:.TZ]/g, "");
  const random = crypto.randomBytes(3).toString("hex");
  return `${ts}-${sanitizeToken(lane)}-w${wave}-${sanitizeToken(agentId)}-${random}`;
}

export function createFeedbackRequest({
  feedbackStateDir,
  feedbackRequestsDir,
  lane,
  wave,
  agentId,
  orchestratorId,
  question,
  context,
}) {
  ensureDirectory(feedbackRequestsDir);
  const requestId = buildRequestId({ lane, wave, agentId });
  const filePath = requestFilePath(feedbackRequestsDir, requestId);
  const now = toIsoTimestamp();
  const payload = {
    id: requestId,
    createdAt: now,
    updatedAt: now,
    lane,
    wave,
    agentId,
    orchestratorId: orchestratorId || null,
    status: "pending",
    question: String(question || "").trim(),
    context: String(context || "").trim(),
    response: null,
  };
  withFileLock(path.join(feedbackStateDir, "requests.lock"), () => {
    if (fs.existsSync(filePath)) {
      throw new Error(`Request already exists: ${path.relative(REPO_ROOT, filePath)}`);
    }
    writeJsonAtomic(filePath, payload);
  });
  return { requestId, filePath, payload };
}

export function answerFeedbackRequest({
  feedbackStateDir,
  feedbackRequestsDir,
  requestId,
  response,
  operator = "human-operator",
  force = false,
}) {
  const lockPath = path.join(feedbackStateDir, "requests.lock");
  let answeredPayload = null;
  withFileLock(lockPath, () => {
    const filePath = requestFilePath(feedbackRequestsDir, requestId);
    const existing = readJsonOrNull(filePath);
    if (!existing) {
      throw new Error(`Request not found: ${requestId}`);
    }
    if (existing.status === "answered" && !force) {
      throw new Error(`Request already answered: ${requestId} (use --force to override)`);
    }
    answeredPayload = {
      ...existing,
      status: "answered",
      updatedAt: toIsoTimestamp(),
      response: {
        operator,
        text: response,
        answeredAt: toIsoTimestamp(),
      },
    };
    writeJsonAtomic(filePath, answeredPayload);
  });
  return answeredPayload;
}

function readAllRequests(feedbackRequestsDir) {
  ensureDirectory(feedbackRequestsDir);
  return fs
    .readdirSync(feedbackRequestsDir)
    .filter((fileName) => fileName.endsWith(".json"))
    .map((fileName) => path.join(feedbackRequestsDir, fileName))
    .map((filePath) => ({ payload: readJsonOrNull(filePath), filePath }))
    .filter(({ payload }) => payload && typeof payload === "object")
    .map(({ payload, filePath }) => ({ ...payload, __filePath: filePath }))
    .toSorted(
      (a, b) => Date.parse(String(a.createdAt || "")) - Date.parse(String(b.createdAt || "")),
    );
}

function filterRequests(requests, filters) {
  return requests.filter((request) => {
    if (filters.pending && request.status !== "pending") {
      return false;
    }
    if (filters.lane && String(request.lane) !== String(filters.lane)) {
      return false;
    }
    if (filters.wave !== null && Number(request.wave) !== Number(filters.wave)) {
      return false;
    }
    if (filters.agent && String(request.agentId) !== String(filters.agent)) {
      return false;
    }
    return true;
  });
}

function formatRequestRow(request) {
  return [
    truncate(request.id, 28).padEnd(28, " "),
    truncate(request.status, 10).padEnd(10, " "),
    truncate(request.lane, 12).padEnd(12, " "),
    truncate(`w${request.wave}`, 6).padEnd(6, " "),
    truncate(request.agentId, 10).padEnd(10, " "),
    truncate(formatAgeFromTimestamp(Date.parse(String(request.updatedAt || ""))), 12).padEnd(
      12,
      " ",
    ),
    truncate(request.question, 72),
  ].join(" ");
}

function parseFeedbackArgs(argv) {
  const normalizedArgv = argv[0] === "--" ? argv.slice(1) : argv;
  const subcommand = normalizedArgv[0];
  if (
    !subcommand ||
    ["ask", "respond", "list", "watch", "show"].every((value) => value !== subcommand)
  ) {
    throw new Error("Expected subcommand: ask | respond | list | watch | show");
  }
  const args = normalizedArgv.slice(1);
  const out = {
    subcommand,
    lane: DEFAULT_WAVE_LANE,
    wave: null,
    runId: "",
    agent: null,
    question: "",
    context: "",
    orchestratorId: "",
    wait: false,
    timeoutSeconds: DEFAULT_WAIT_TIMEOUT_SECONDS,
    id: "",
    response: "",
    operator: "human-operator",
    force: false,
    pending: false,
    json: false,
    refreshMs: DEFAULT_WATCH_REFRESH_MS,
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--") {
      continue;
    }
    if (arg === "--lane") {
      out.lane = sanitizeLaneName(args[++i]);
    } else if (arg === "--run") {
      out.runId = sanitizeAdhocRunId(args[++i]);
    } else if (arg === "--wave") {
      out.wave = parseNonNegativeInt(args[++i], "--wave");
    } else if (arg === "--agent") {
      out.agent = String(args[++i] || "").trim();
    } else if (arg === "--question") {
      out.question = String(args[++i] || "").trim();
    } else if (arg === "--context") {
      out.context = String(args[++i] || "").trim();
    } else if (arg === "--orchestrator-id") {
      out.orchestratorId = String(args[++i] || "").trim();
    } else if (arg === "--wait") {
      out.wait = true;
    } else if (arg === "--timeout-seconds") {
      out.timeoutSeconds = parsePositiveInt(args[++i], "--timeout-seconds");
    } else if (arg === "--id") {
      out.id = String(args[++i] || "").trim();
    } else if (arg === "--response") {
      out.response = String(args[++i] || "").trim();
    } else if (arg === "--operator") {
      out.operator = String(args[++i] || "").trim() || "human-operator";
    } else if (arg === "--force") {
      out.force = true;
    } else if (arg === "--pending") {
      out.pending = true;
    } else if (arg === "--json") {
      out.json = true;
    } else if (arg === "--refresh-ms") {
      out.refreshMs = parsePositiveInt(args[++i], "--refresh-ms");
    } else if (arg === "--help" || arg === "-h") {
      return { help: true, options: out };
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { help: false, options: out };
}

async function waitForAnswer(filePath, timeoutSeconds) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    const payload = readJsonOrNull(filePath);
    if (payload?.status === "answered") {
      return payload;
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for response after ${timeoutSeconds}s`);
}

function printHelp() {
  console.log(`Usage:
  pnpm exec wave-feedback ask --lane <lane> --wave <n> --agent <id> --question "<text>" [options]
  pnpm exec wave-feedback respond --id <request-id> --response "<text>" [options]
  pnpm exec wave-feedback list [--pending] [--lane <lane>] [--wave <n>] [--agent <id>] [--json]
  pnpm exec wave-feedback watch [--pending] [--lane <lane>] [--wave <n>] [--agent <id>] [--refresh-ms <n>]
  pnpm exec wave-feedback show --id <request-id>
`);
}

export async function runFeedbackCli(argv) {
  const { help, options } = parseFeedbackArgs(argv);
  if (help) {
    printHelp();
    return;
  }
  if (options.runId) {
    options.lane = resolveLaneForRun(options.runId, options.lane);
  }
  const lanePaths = buildLanePaths(options.lane, {
    adhocRunId: options.runId || null,
  });
  const requestsDir = lanePaths.feedbackRequestsDir;
  const stateDir = lanePaths.feedbackStateDir;

  if (options.subcommand === "ask") {
    if (options.wave === null || !options.agent || !options.question) {
      throw new Error("ask requires --wave, --agent, and --question");
    }
    const result = createFeedbackRequest({
      feedbackStateDir: stateDir,
      feedbackRequestsDir: requestsDir,
      lane: options.lane,
      wave: options.wave,
      agentId: options.agent,
      orchestratorId: options.orchestratorId,
      question: options.question,
      context: options.context,
    });
    console.log(`[wave-human-feedback] created ${result.requestId}`);
    console.log(`file: ${path.relative(REPO_ROOT, result.filePath)}`);
    if (options.wait) {
      const answered = await waitForAnswer(result.filePath, options.timeoutSeconds);
      console.log(
        `[wave-human-feedback] answered by ${answered?.response?.operator || "human-operator"}`,
      );
      console.log(answered?.response?.text || "");
    }
    return;
  }

  if (options.subcommand === "respond") {
    if (!options.id || !options.response) {
      throw new Error("respond requires --id and --response");
    }
    answerFeedbackRequest({
      feedbackStateDir: stateDir,
      feedbackRequestsDir: requestsDir,
      requestId: options.id,
      response: options.response,
      operator: options.operator,
      force: options.force,
    });
    console.log(`[wave-human-feedback] answered ${options.id}`);
    return;
  }

  if (options.subcommand === "show") {
    if (!options.id) {
      throw new Error("show requires --id");
    }
    const filePath = requestFilePath(requestsDir, options.id);
    const payload = readJsonOrNull(filePath);
    if (!payload) {
      throw new Error(`Request not found: ${options.id}`);
    }
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  const renderTable = () => {
    const requests = filterRequests(readAllRequests(requestsDir), {
      pending: options.pending,
      lane: options.lane || null,
      wave: options.wave,
      agent: options.agent || null,
    });
    if (options.json) {
      console.log(JSON.stringify(requests, null, 2));
      return;
    }
    console.log(
      [
        "ID".padEnd(28),
        "Status".padEnd(10),
        "Lane".padEnd(12),
        "Wave".padEnd(6),
        "Agent".padEnd(10),
        "Updated".padEnd(12),
        "Question",
      ].join(" "),
    );
    for (const request of requests) {
      console.log(
        formatRequestRow({
          ...request,
          question: compactSingleLine(request.question, 72),
        }),
      );
    }
    if (requests.length === 0) {
      console.log("(none)");
    }
  };

  if (options.subcommand === "list") {
    renderTable();
    return;
  }

  if (options.subcommand === "watch") {
    while (true) {
      if (process.stdout.isTTY) {
        process.stdout.write("\u001bc");
      }
      renderTable();
      await sleep(options.refreshMs);
    }
  }
}
