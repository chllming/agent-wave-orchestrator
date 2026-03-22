# Oversight, Dark-Factory, And Human Feedback

Wave now has an explicit planning vocabulary for execution posture.

Today that posture is captured in project profile memory and planner output. The deeper runtime policy attached to those modes is still roadmap work, so this page distinguishes what is already shipped from what is still a convention.

## The Two Postures

- `oversight`
  Human review and intervention are expected parts of the operating model for risky work.
- `dark-factory`
  The goal is end-to-end execution without routine human intervention.

These values are stored in `.wave/project-profile.json` and emitted into planner-generated specs and wave markdown.

## What Ships Today

Today the runtime ships:

- project-profile memory for default oversight mode
- planner prompts that ask for oversight mode
- generated specs and waves that record the chosen mode
- deploy-environment memory that helps infra and release planning
- orchestrator-first clarification handling and human feedback queueing

The runtime does not yet enforce a separate hard policy profile for `dark-factory` beyond what is already encoded in the wave itself.

## How To Interpret The Modes Right Now

Treat them as planning posture:

- `oversight`
  Default when a human operator should expect to inspect progress, answer questions, or approve risky transitions.
- `dark-factory`
  Use only when the wave already has explicit environment modeling, validation, rollback posture, and clear closure signals.

## Human Feedback Is Not The Same Thing

Human feedback is a runtime escalation mechanism, not an operating mode.

The launcher flow is:

1. agent emits a clarification request or blocker
2. the orchestrator tries to resolve it from repo state, policy, ownership, or targeted rerouting
3. only unresolved items become human feedback tickets
4. those tickets stay visible in ledgers, summaries, and traces until resolved

That means even `oversight` mode still tries to keep routine clarification inside the orchestration loop before escalating to a human.

## Oversight Mode Best Fit

Choose `oversight` when:

- deploy or infra mutation is live and risky
- the environment model is incomplete
- rollback steps are still implicit
- legal, compliance, or release decisions need explicit human sign-off
- the repo is still shaping its skills and closure rules

## Dark-Factory Best Fit

Choose `dark-factory` only when all of these are already true:

- deploy environments are typed and explicit
- runtime and credential expectations are known
- validation commands are concrete
- rollback or recovery posture is documented
- closure evidence is machine-checkable or strongly operator-visible
- missing context would be treated as a planning failure, not something to improvise live

## Best Practice

Default to `oversight` until the repo has earned `dark-factory`.

That usually means:

- stable skills for deploy and infra work
- consistent deploy-environment naming
- strong validation commands
- reliable docs and trace review habits
- low ambiguity about who owns live mutation

## Relationship To The Roadmap

The roadmap still includes stronger explicit oversight vs dark-factory workflows. What is shipped today is the planning foundation:

- stored project defaults
- typed values in planner output
- better environment modeling

The stricter execution semantics are the next step, not a hidden already-finished feature.
