# Kubernetes Verification Patterns

Reference for verifying Kubernetes workload state using kubectl.

## Workload Health
- Deployment status: `kubectl -n <ns> get deploy <name> -o wide`
- Pod status: `kubectl -n <ns> get pods -l app=<label> -o wide`
- Rollout status: `kubectl -n <ns> rollout status deploy/<name> --timeout=120s`
- Key checks: READY count matches DESIRED, all pods Running, no restarts.

## Pod Diagnostics
- Events: `kubectl -n <ns> describe pod <name>` (check Events section)
- Logs: `kubectl -n <ns> logs <pod> -c <container> --tail=100`
- Previous logs (after crash): `kubectl -n <ns> logs <pod> -c <container> --previous`
- Resource usage: `kubectl -n <ns> top pod <name>`

## Service and Networking
- Service endpoints: `kubectl -n <ns> get endpoints <svc-name>`
- Service details: `kubectl -n <ns> describe svc <name>`
- Key checks: Endpoints list has pod IPs, port mappings are correct.

## Failure Patterns

### Image Pull Failure
- Symptom: Pod stuck in ImagePullBackOff or ErrImagePull.
- Diagnose: `kubectl -n <ns> describe pod <name>` → Events show pull error.
- Fix: Check image name/tag, registry credentials, network access.

### Crash Loop
- Symptom: Pod in CrashLoopBackOff, restart count increasing.
- Diagnose: `kubectl -n <ns> logs <pod> --previous` → Check exit reason.
- Fix: Application error, missing config, resource limits too tight.

### Readiness Probe Failure
- Symptom: Pod Running but not Ready (0/1).
- Diagnose: `kubectl -n <ns> describe pod <name>` → Readiness probe failed.
- Fix: Check probe path/port, application startup time, increase initialDelaySeconds.

### Admission Webhook Rejection
- Symptom: Pod creation fails immediately.
- Diagnose: `kubectl -n <ns> get events --field-selector reason=FailedCreate`
- Fix: Check webhook policies, pod security standards, resource quotas.

## Rollback and Recovery
- Rollback: `kubectl -n <ns> rollout undo deploy/<name>`
- Rollback to specific revision: `kubectl -n <ns> rollout undo deploy/<name> --to-revision=<n>`
- Restart (rolling): `kubectl -n <ns> rollout restart deploy/<name>`
- Scale: `kubectl -n <ns> scale deploy/<name> --replicas=<n>`
- Pause rollout: `kubectl -n <ns> rollout pause deploy/<name>`

## Evidence Template
Record for each verification:
- Cluster: <name>
- Namespace: <ns>
- Resource: <type>/<name>
- Command: <exact kubectl command>
- Result: <key output fields>
- Assessment: <healthy|degraded|failed>
