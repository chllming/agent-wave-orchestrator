---
name: signal-hygiene
description: Use for long-running resident or waiting agents that must stay idle until the orchestrator writes a new signal version, then acknowledge that change before acting.
---

# Signal Hygiene

Use this skill only when the agent is intentionally long-running.

This is not a generic polling skill for normal one-shot implementation work.

## Core loop

- Treat the signal state file as the orchestrator-controlled wakeup surface.
- Treat the signal ack file as your durable confirmation that you observed a specific signal version.
- Stay idle while the signal version is unchanged.
- Act once when the signal version increases and the new signal is actionable.

## Required behavior

- Read the signal state path provided in the prompt before deciding whether to keep waiting or resume work.
- If the signal file is missing, assume the orchestrator has not published a new signal yet and keep waiting.
- Compare the signal file's `version` to the version already recorded in the signal ack file.
- When the signal version increases, write the ack file immediately before you act on the change.
- Write the ack file as JSON with exactly these keys:
  - `agentId`
  - `version`
  - `signal`
  - `observedAt`
- After acknowledging the new version, re-read the inbox, shared summary, message board, and any explicitly referenced artifacts before taking action.
- If the signal kind is `completed` or `failed`, stop the waiting loop and finish cleanly.

## Do not do this

- Do not busy-loop or emit repeated status chatter while the signal version is unchanged.
- Do not keep re-processing the same signal version.
- Do not invent your own wakeup surface when the orchestrator already provided signal and ack paths.
- Do not stay resident forever once the signal clearly becomes terminal.

## Actionability rule

Treat these signal kinds as actionable by default:

- `feedback-requested`
- `feedback-answered`
- `coordination-action`
- `resume-ready`
- `completed`
- `failed`

Treat `waiting` and `stable` as non-actionable until the version changes again.
