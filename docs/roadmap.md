# Wave Orchestrator Roadmap

This roadmap is intentionally short and current. The older planner-foundation and ad-hoc-run phase list has been removed because that work no longer describes the actual shipping direction for this package.

## Current Release: 0.9.12

`0.9.12` is the current packaged surface.

It includes:

- detached process-backed agent execution instead of tmux-heavy live execution
- lower steady-state memory pressure and less terminal churn during long runs
- better behavior in constrained sandboxes such as LEAPclaw, OpenClaw, Nemoshell, and Docker-based operator environments
- a safer `submit -> supervise -> status/wait -> attach` control path for long-running agentic orchestration
- tighter supervisor recovery, progress journaling, and closure/retry correctness
- the current protected Wave Control model: Stack-authenticated browser access, Wave-managed approval states and provider grants, PATs, service tokens, encrypted per-user credentials, and runtime env leasing
- owned Context7 and Corridor broker routes plus the Corridor-backed security context that can gate closure before integration

## Near-Term Direction On This Node Line

This standalone Node line should now be treated as maintenance-oriented:

- bug fixes
- compatibility updates
- operational hardening
- documentation updates
- release-surface alignment work

## Strategic Direction: LEAPclaw Execution Model

With the authenticated Wave Control surface now present, the main execution roadmap moves away from expanding this Node runtime and toward the LEAPclaw execution model.

The target shape is:

- LEAPclaw-native execution semantics for agent orchestration and management
- Go-based runtime ownership for the long-running execution layer
- Temporal-backed workflow and recovery coordination
- LEAPclaw nodes as the durable execution substrate for orchestrated agent work
- Wave Control acting as an authenticated control and observability surface rather than the long-term primary execution engine

This direction matches the broader local platform work in the sibling `slowfast.ai` repository, where the support-service and runtime direction already points toward LEAPclaw support services, Go runtime ownership, and Temporal-backed orchestration.

## Future Standalone Runtime Direction

For future standalone Wave Orchestrator versions, the preferred implementation direction is the Rust runtime at:

- `https://github.com/chllming/agent-wave-orchestrator`

That line is expected to carry:

- its own runtime implementation
- its own terminal-native/TUI operator surface
- the longer-term standalone execution model once the Node package settles into maintenance mode

## Practical Guidance

For this repository, the practical sequence is:

1. Ship `0.9.12` with the closure, operator-surface, and release-doc alignment fixes.
2. Maintain this Node package for bug fixes, compatibility, operational hardening, and release-surface sync rather than a broad new feature wave.
3. Move long-term execution investment to the LEAPclaw + Go + Temporal architecture and the Rust standalone runtime.
