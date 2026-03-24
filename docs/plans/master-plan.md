# Master Plan

## Goals

- Keep the orchestrator generic enough to reuse across repositories.
- Preserve the working runtime features from the original implementation.
- Keep repo-specific policy in config and docs, not in engine code.
- Keep external-doc use narrow, explicit, and non-canonical.

## Near-Term Work

- Keep the starter wave, migration docs, role prompts, starter skills, and component cutover matrix aligned with the authority-set architecture and the staged hardening plan.
- Expand `wave doctor` and migration guidance around cross-repo adoption, executor availability, and future breaking config changes.
- Build on the shipped planner foundation with richer starter templates and eventually ad-hoc or forward-replan flows.
- Extend replay and trace tooling from internal helpers and file-backed artifacts into easier operator workflows, larger historical fixtures, and a public replay surface if it proves stable.
- Add the remaining roadmap items that are not yet shipped, especially stronger operating-mode enforcement, thinner-launcher cleanup, and better operator workflows around cross-lane dependency tickets.
