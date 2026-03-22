# Kubernetes

<!-- CUSTOMIZE: Add your cluster names, namespaces, workload names, and health probe paths below. -->

## Core Rules

- Name the exact cluster, namespace, workload, and rollout surface involved.
- Prefer explicit `kubectl` state, health, and event evidence over generic rollout notes.
- Distinguish manifest drift, admission failure, image failure, and readiness failure.
- If rollback or restart is involved, make the operator-visible recovery posture explicit.
- Always specify `--context` or `--kubeconfig` when multiple clusters are accessible.

## Resource Identification

Every Kubernetes verification must specify:

- **Cluster name** -- the cluster context name as it appears in kubeconfig.
- **Namespace** -- the Kubernetes namespace. Never omit this; do not rely on the default namespace.
- **Workload type** -- Deployment, StatefulSet, DaemonSet, Job, CronJob, or bare Pod.
- **Resource name** -- the exact name of the workload resource.

Example: `Deployment api-server in namespace production, cluster prod-us-east-1`.

## Verification Procedures

### Pod State

```
kubectl get pods -n <namespace> -l app=<label> --context <cluster>
kubectl describe pod <pod-name> -n <namespace> --context <cluster>
```

Confirm: all pods in `Running` state, restart count is zero or stable, no pods in `CrashLoopBackOff`, `ImagePullBackOff`, or `Pending`.

### Deployment and Rollout

```
kubectl get deploy <name> -n <namespace> --context <cluster>
kubectl rollout status deploy/<name> -n <namespace> --context <cluster>
kubectl get replicasets -n <namespace> -l app=<label> --context <cluster>
```

Confirm: desired replicas match ready replicas, rollout is complete (not progressing or stalled), only one active ReplicaSet for the current revision.

### Services and Endpoints

```
kubectl get svc <name> -n <namespace> --context <cluster>
kubectl get endpoints <name> -n <namespace> --context <cluster>
```

Confirm: service exists, endpoints list is non-empty and matches expected pod count, port mappings are correct.

### Events

```
kubectl get events -n <namespace> --sort-by=.lastTimestamp --context <cluster>
kubectl describe deploy <name> -n <namespace> --context <cluster>
```

Check for: `FailedScheduling`, `FailedMount`, `Unhealthy`, `BackOff`, `FailedCreate`, or admission webhook rejection events.

### Application Logs

```
kubectl logs deploy/<name> -n <namespace> --tail=100 --context <cluster>
kubectl logs <pod-name> -n <namespace> -c <container> --tail=100 --context <cluster>
```

Confirm: no unhandled exceptions, startup completed successfully, application-level health indicators are positive.

<!-- CUSTOMIZE: Add verification procedures for Ingress, HPA, PDB, ConfigMaps, or Secrets checks specific to your project here. -->

## Failure Classification

Classify Kubernetes failures precisely:

### Manifest Drift

- Desired spec does not match actual running state.
- Symptom: `kubectl diff` shows changes, ReplicaSet count mismatch, container image tag differs from expected.
- Fix: re-apply manifests or investigate what modified the live state.

### Admission Failure

- Webhook or policy controller rejected the resource creation or update.
- Symptom: events show `admission webhook denied`, OPA/Gatekeeper/Kyverno policy violation.
- Fix: update the manifest to comply with policy, or update the policy if the manifest is correct.

### Image Failure

- Container image cannot be pulled or crashes immediately on start.
- Symptom: `ImagePullBackOff` (registry auth, image not found, tag not found) or `CrashLoopBackOff` (image starts and exits non-zero).
- Fix: verify image exists in registry, check pull secrets, check application startup for fatal errors.

### Readiness Failure

- Pod is running but not passing readiness probes.
- Symptom: pod shows `Running` but `0/1 Ready`, endpoints list is empty, service returns 503.
- Fix: check readiness probe configuration (path, port, timeout), check application health endpoint, check dependencies the app needs at startup.

Name the failure type explicitly in the `[deploy-status]` marker detail field.

## Recovery Posture

### Rollback

```
kubectl rollout undo deploy/<name> -n <namespace> --context <cluster>
kubectl rollout status deploy/<name> -n <namespace> --context <cluster>
```

Use when: the current revision is unhealthy and the previous revision was known healthy. Verify the rollback completes and pods are ready.

### Restart

```
kubectl rollout restart deploy/<name> -n <namespace> --context <cluster>
```

Use when: the current revision should be correct but pods are in a bad state (stale connections, resource exhaustion, transient failure). This re-creates pods with the same spec.

### Scale Adjustment

```
kubectl scale deploy/<name> --replicas=<n> -n <namespace> --context <cluster>
```

Use when: the issue is capacity-related (OOM, CPU throttling, request queuing). Scale up to relieve pressure, then investigate root cause.

After any recovery action, re-verify using the procedures above and emit the appropriate `[deploy-status]` marker.

## Customization

<!-- CUSTOMIZE: Override or extend any section above. Common additions:
  - Cluster names: prod=<context>, staging=<context>
  - Namespaces: <comma-separated-list>
  - Workload inventory: <namespace>/<type>/<name>
  - Health probe paths: <workload> -> <path>
  - Ingress hostnames and TLS configuration
  - HPA scaling thresholds
  - PDB minimum availability requirements
-->
