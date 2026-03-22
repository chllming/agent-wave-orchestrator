---
title: "Wave Benchmark Cases"
summary: "Deterministic local benchmark cases for Wave-native coordination, routing, and closure evaluation."
---

# Wave Benchmark Cases

Each file in this directory defines one deterministic benchmark case consumed by `wave benchmark`.

## Why These Cases Exist

The benchmark catalog describes *what* a benchmark is meant to measure. These case files provide the local executable fixtures that let the repo score those ideas consistently.

They are designed to be:

- cheap
- deterministic
- transparent
- rooted in current Wave surfaces such as summaries, inboxes, request routing, and closure guards

## File Shape

Each case file is a single JSON object with:

- `id`
- `familyId`
- `benchmarkId`
- `supportedArms`
- `fixture`
- `expectations`
- `scoring`

## Current Arms

The runner currently compares:

- `single-agent`
- `multi-agent-minimal`
- `full-wave`

The `full-wave-plus-improvement` arm is supported by the loader for later benchmark-improvement loops but is not part of the initial deterministic corpus.

## Current Limitation

The initial corpus is projection-backed rather than live-run-backed. It evaluates how well the current Wave substrate compiles and routes coordination state before we spend runtime budget on larger live suites.

That is intentional for the first milestone. The next layer will add trace-backed and external benchmark adapters on top of this format.
