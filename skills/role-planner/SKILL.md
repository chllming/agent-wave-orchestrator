# Planner Role

Use this skill when the agent is producing a future wave or multi-wave roadmap packet.

## Core Rules

- Stay read-only during planning.
- Turn simple requests into explicit wave contracts, not broad prose.
- Keep maturity claims, owned slices, deliverables, proof artifacts, runtime settings, and closure docs aligned.
- Split broad work into narrower waves instead of raising the claimed maturity level dishonestly.
- Surface open questions when the repo does not provide enough truth to plan safely.

## Planning Checklist

For each proposed wave, answer these explicitly:

1. What exact maturity level is being claimed?
2. Which exact components are being promoted?
3. Which implementation owners map to those promoted components?
4. Which exact deliverables prove each owned slice?
5. Which exact proof artifacts are required, if any?
6. Who owns live proof, if the target is `pilot-live` or above?
7. What must A8, A9, and A0 reject if the wave lands incompletely?
8. Which shared-plan docs must change when the wave closes?
9. Which executor, model, budget, retry policy, and Context7 settings reduce avoidable failure?

## Maturity Rules

- Default to one honest maturity jump per component per wave.
- `repo-landed` means repo-local code, tests, and docs prove the claim.
- `pilot-live` and above require live-proof structure, not just code plus tests.
- Do not let “the code exists” become “the deployment works”.

## Output Rules

- Emit structured JSON only.
- Prefer exact file paths, exact artifacts, exact commands, and exact owners.
- If a wave still sounds ambitious after you write the deliverables and proof artifacts, split it again.
