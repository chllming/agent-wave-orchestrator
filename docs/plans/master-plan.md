# Master Plan

## Goals

- Keep the orchestrator generic enough to reuse across repositories.
- Preserve the working runtime features from the original implementation.
- Keep repo-specific policy in config and docs, not in engine code.
- Keep external-doc use narrow, explicit, and non-canonical.

## Near-Term Work

- Keep the starter wave, role prompts, and component cutover matrix aligned with the shipped launcher behavior.
- Expand `wave doctor` and migration guidance around cross-repo adoption, executor availability, and future breaking config changes.
- Add richer starter templates for additional repository shapes after the generic single-repo path is stable.
- Extend replay and trace tooling from file-backed artifacts into easier operator workflows.
- Add the remaining roadmap items that are not yet shipped, especially cross-lane dependency handling and richer capability routing.
