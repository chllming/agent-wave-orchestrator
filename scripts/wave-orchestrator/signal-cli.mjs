import fs from "node:fs";
import path from "node:path";
import { ensureDirectory } from "./shared.mjs";
import {
  EXIT_CONTRACT_COMPLETION_VALUES,
  EXIT_CONTRACT_DURABILITY_VALUES,
  EXIT_CONTRACT_PROOF_VALUES,
  EXIT_CONTRACT_DOC_IMPACT_VALUES,
} from "./agent-state.mjs";
import { parseStructuredSignalCandidate } from "./structured-signal-parser.mjs";

const PROOF_STATES = ["met", "complete", "gap"];
const DOC_CLOSURE_STATES = ["closed", "no-change", "delta"];
const INTEGRATION_STATES = ["ready-for-doc-closure", "needs-more-work"];
const COMPONENT_ID_REGEX = /^[a-z0-9._-]+$/;
const COMPONENT_LEVEL_REGEX = /^[a-z0-9._-]+$/;
const UNSAFE_KEY_VALUE_FRAGMENT_REGEX = /(^|\s)[a-z][a-z0-9_-]*=/i;
const PARSER_KIND_BY_SIGNAL_KIND = {
  proof: "proof",
  "doc-delta": "docDelta",
  component: "component",
  integration: "integration",
  "doc-closure": "docClosure",
};

function printUsage() {
  console.log(`Usage:
  wave signal proof --completion <level> --durability <level> --proof <level> --state <met|complete|gap> [--detail <text>] [--json] [--append-file <path>]
  wave signal doc-delta --state <none|owned|shared-plan> [--path <file> ...] [--detail <text>] [--json] [--append-file <path>]
  wave signal component --id <component> --level <level> --state <met|complete|gap> [--detail <text>] [--json] [--append-file <path>]
  wave signal integration --state <ready-for-doc-closure|needs-more-work> --claims <n> --conflicts <n> --blockers <n> [--detail <text>] [--json] [--append-file <path>]
  wave signal doc-closure --state <closed|no-change|delta> [--path <file> ...] [--detail <text>] [--json] [--append-file <path>]
`);
}

function normalizeState(value) {
  return String(value || "").trim().toLowerCase() === "complete" ? "met" : String(value || "").trim();
}

function cleanText(value) {
  return String(value || "").trim();
}

function validateAllowedValue(label, value, allowedValues) {
  const normalized = cleanText(value).toLowerCase();
  if (!allowedValues.includes(normalized)) {
    throw new Error(`${label} must be one of: ${allowedValues.join(", ")}`);
  }
  return normalized;
}

function validateSafeField(label, value, { allowCommas = true } = {}) {
  const normalized = cleanText(value);
  if (!normalized) {
    return normalized;
  }
  if (/[\r\n]/.test(normalized)) {
    throw new Error(`${label} cannot contain newlines`);
  }
  if (!allowCommas && normalized.includes(",")) {
    throw new Error(`${label} cannot contain commas`);
  }
  if (UNSAFE_KEY_VALUE_FRAGMENT_REGEX.test(normalized)) {
    throw new Error(`${label} cannot contain embedded key=value fragments`);
  }
  return normalized;
}

function validatePathList(paths) {
  return paths.map((item, index) =>
    validateSafeField(`path ${index + 1}`, item, { allowCommas: false }),
  );
}

function parseArgs(argv) {
  const kind = String(argv[0] || "").trim().toLowerCase();
  const options = {
    completion: "",
    durability: "",
    proof: "",
    state: "",
    detail: "",
    componentId: "",
    level: "",
    paths: [],
    claims: "0",
    conflicts: "0",
    blockers: "0",
    appendFile: "",
    json: false,
  };
  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--completion") {
      options.completion = String(argv[++index] || "").trim();
    } else if (arg === "--durability") {
      options.durability = String(argv[++index] || "").trim();
    } else if (arg === "--proof") {
      options.proof = String(argv[++index] || "").trim();
    } else if (arg === "--state") {
      options.state = String(argv[++index] || "").trim();
    } else if (arg === "--detail") {
      options.detail = String(argv[++index] || "").trim();
    } else if (arg === "--id") {
      options.componentId = String(argv[++index] || "").trim();
    } else if (arg === "--level") {
      options.level = String(argv[++index] || "").trim();
    } else if (arg === "--path") {
      options.paths.push(String(argv[++index] || "").trim());
    } else if (arg === "--claims") {
      options.claims = String(argv[++index] || "0").trim();
    } else if (arg === "--conflicts") {
      options.conflicts = String(argv[++index] || "0").trim();
    } else if (arg === "--blockers") {
      options.blockers = String(argv[++index] || "0").trim();
    } else if (arg === "--append-file") {
      options.appendFile = String(argv[++index] || "").trim();
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--help" || arg === "-h") {
      return { help: true, kind, options };
    } else if (arg) {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { help: false, kind, options };
}

function buildLine(kind, options) {
  if (kind === "proof") {
    return [
      "[wave-proof]",
      `completion=${options.completion}`,
      `durability=${options.durability}`,
      `proof=${options.proof}`,
      `state=${normalizeState(options.state)}`,
      ...(options.detail ? [`detail=${options.detail}`] : []),
    ].join(" ");
  }
  if (kind === "doc-delta") {
    return [
      "[wave-doc-delta]",
      `state=${options.state}`,
      ...(options.paths.length > 0 ? [`paths=${options.paths.join(",")}`] : []),
      ...(options.detail ? [`detail=${options.detail}`] : []),
    ].join(" ");
  }
  if (kind === "component") {
    return [
      "[wave-component]",
      `component=${options.componentId}`,
      `level=${options.level}`,
      `state=${normalizeState(options.state)}`,
      ...(options.detail ? [`detail=${options.detail}`] : []),
    ].join(" ");
  }
  if (kind === "integration") {
    return [
      "[wave-integration]",
      `state=${options.state}`,
      `claims=${options.claims}`,
      `conflicts=${options.conflicts}`,
      `blockers=${options.blockers}`,
      ...(options.detail ? [`detail=${options.detail}`] : []),
    ].join(" ");
  }
  if (kind === "doc-closure") {
    return [
      "[wave-doc-closure]",
      `state=${options.state}`,
      ...(options.paths.length > 0 ? [`paths=${options.paths.join(",")}`] : []),
      ...(options.detail ? [`detail=${options.detail}`] : []),
    ].join(" ");
  }
  throw new Error(`Unknown signal kind: ${kind}`);
}

function assertCanonicalRoundTrip(kind, line) {
  const candidate = parseStructuredSignalCandidate(line);
  const parserKind = PARSER_KIND_BY_SIGNAL_KIND[kind] || kind;
  if (!candidate?.accepted || candidate.kind !== parserKind || candidate.normalizedLine !== line) {
    throw new Error(`wave signal ${kind} could not round-trip through the shipped structured-signal parser`);
  }
}

function validate(kind, options) {
  if (kind === "proof") {
    if (!options.completion || !options.durability || !options.proof || !options.state) {
      throw new Error("wave signal proof requires --completion, --durability, --proof, and --state");
    }
    options.completion = validateAllowedValue("--completion", options.completion, EXIT_CONTRACT_COMPLETION_VALUES);
    options.durability = validateAllowedValue("--durability", options.durability, EXIT_CONTRACT_DURABILITY_VALUES);
    options.proof = validateAllowedValue("--proof", options.proof, EXIT_CONTRACT_PROOF_VALUES);
    options.state = validateAllowedValue("--state", options.state, PROOF_STATES);
    options.detail = validateSafeField("--detail", options.detail);
    return;
  }
  if (kind === "doc-delta" || kind === "doc-closure") {
    if (!options.state) {
      throw new Error(`wave signal ${kind} requires --state`);
    }
    options.state = validateAllowedValue(
      "--state",
      options.state,
      kind === "doc-delta" ? EXIT_CONTRACT_DOC_IMPACT_VALUES : DOC_CLOSURE_STATES,
    );
    options.paths = validatePathList(options.paths);
    options.detail = validateSafeField("--detail", options.detail);
    return;
  }
  if (kind === "component") {
    if (!options.componentId || !options.level || !options.state) {
      throw new Error("wave signal component requires --id, --level, and --state");
    }
    options.componentId = validateSafeField("--id", options.componentId, { allowCommas: false });
    options.level = validateSafeField("--level", options.level, { allowCommas: false }).toLowerCase();
    options.state = validateAllowedValue("--state", options.state, PROOF_STATES);
    options.detail = validateSafeField("--detail", options.detail);
    if (!COMPONENT_ID_REGEX.test(options.componentId)) {
      throw new Error("--id must use a canonical component token like runtime-render-snapshot");
    }
    if (!COMPONENT_LEVEL_REGEX.test(options.level)) {
      throw new Error("--level must use a canonical component level token");
    }
    return;
  }
  if (kind === "integration") {
    if (!options.state) {
      throw new Error("wave signal integration requires --state");
    }
    options.state = validateAllowedValue("--state", options.state, INTEGRATION_STATES);
    options.detail = validateSafeField("--detail", options.detail);
    for (const field of ["claims", "conflicts", "blockers"]) {
      const value = Number.parseInt(options[field], 10);
      if (!Number.isFinite(value) || value < 0) {
        throw new Error(`--${field} must be a non-negative integer`);
      }
      options[field] = String(value);
    }
    return;
  }
  throw new Error(`Unknown signal kind: ${kind}`);
}

export async function runSignalCli(argv) {
  if (["--help", "-h", "help"].includes(String(argv[0] || "").trim().toLowerCase())) {
    printUsage();
    return;
  }
  const parsed = parseArgs(argv);
  if (parsed.help || !parsed.kind) {
    printUsage();
    return;
  }
  validate(parsed.kind, parsed.options);
  const line = buildLine(parsed.kind, parsed.options);
  assertCanonicalRoundTrip(parsed.kind, line);
  if (parsed.options.appendFile) {
    ensureDirectory(path.dirname(parsed.options.appendFile));
    fs.appendFileSync(parsed.options.appendFile, `${line}\n`, "utf8");
  }
  if (parsed.options.json) {
    console.log(JSON.stringify({
      kind: parsed.kind,
      line,
      appendFile: parsed.options.appendFile || null,
    }, null, 2));
    return;
  }
  console.log(line);
}
