# Kubernetes

- Name the exact cluster, namespace, workload, and rollout surface involved.
- Prefer explicit `kubectl` state, health, and event evidence over generic rollout notes.
- Distinguish manifest drift, admission failure, image failure, and readiness failure.
- If rollback or restart is involved, make the operator-visible recovery posture explicit.
