# Master Plan

## Goals

- Keep the orchestrator generic enough to reuse across repositories.
- Preserve the working runtime features from the original implementation.
- Keep repo-specific policy in config and docs, not in engine code.
- Keep external-doc use narrow, explicit, and non-canonical.

## Near-Term Work

- Finish genericizing remaining tests and runtime helpers.
- Keep the starter component cutover matrix and sample wave aligned with the shipped harness behavior.
- Add additional starter templates for common repository shapes.
- Add richer doctor checks and guided migrations for future breaking config changes.
- Expand release automation and changelog generation around the package-first install flow.
