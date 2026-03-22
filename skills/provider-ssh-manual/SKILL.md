# SSH Manual

<!-- CUSTOMIZE: Add your hosts, SSH access patterns, approved operations, and sudo policies below. -->

## Core Rules

- Treat manual host access as high-risk and fail closed on missing proof.
- Record the exact host or surface touched and the exact checks performed.
- Avoid destructive manual changes unless explicitly approved by the task and repo policy.
- Convert shell observations into explicit environment or deploy status markers.
- Every SSH session must produce a durable evidence record. No verification without documentation.

## Risk Posture

Manual SSH access is the highest-risk verification surface:

- **Fail closed** -- if proof is missing or ambiguous, the state is NOT VERIFIED. Do not assume health.
- **High-risk default** -- all manual access is treated as high-risk. There is no "low-risk" SSH operation from a proof standpoint.
- **Destructive changes need explicit approval** -- any command that modifies state (restart, config edit, file delete, package install) requires explicit task-level approval in the wave prompt. Read-only verification does not require special approval.
- **Session isolation** -- do not carry state assumptions between SSH sessions. Each session starts with zero knowledge of the host's current state.
- **No implicit trust** -- a previous session showing healthy state does not prove current state. Re-verify if the task requires current proof.

## Verification Protocol

Follow this sequence for every SSH verification:

1. **Identify the host** -- exact hostname, IP address, or infrastructure identifier. Record how the host was identified (from wave definition, config file, DNS, etc.).
2. **Connect** -- establish SSH connection. Record the user and authentication method used.
3. **Run verification commands** -- execute only the commands needed for the verification scope. Capture stdout and stderr.
4. **Record output** -- save the exact command output. Do not paraphrase or summarize prematurely.
5. **Classify result** -- determine the state: healthy, degraded, failed, or unknown.
6. **Emit status marker** -- produce the appropriate `[deploy-status]` or `[infra-status]` marker based on the classification.
7. **Disconnect** -- end the session. Do not leave connections open.

Never skip step 4. The raw output is the proof artifact.

## Evidence Recording

Use this structure for every SSH verification:

```
Host: <hostname-or-ip>
User: <ssh-user>
Timestamp Context: <when-the-session-occurred>
Commands Run:
  1. <exact-command-1>
  2. <exact-command-2>
Stdout Excerpts:
  1. <relevant-output-from-command-1>
  2. <relevant-output-from-command-2>
Conclusion: <healthy|degraded|failed|unknown> -- <one-line-reason>
Follow-up Needed: <yes|no> -- <what-and-who-if-yes>
```

Do not omit fields. If a field is not applicable, write `N/A` with a reason.

## Approved Operations

### Read-Only (Default Approved)

These operations are approved by default for verification purposes:

- `systemctl status <service>` -- check service state.
- `df -h` / `free -m` -- check disk and memory.
- `tail -n 100 <log-file>` -- read recent log entries.
- `cat <config-file>` -- read configuration files.
- `ps aux | grep <process>` -- check running processes.
- `netstat -tlnp` / `ss -tlnp` -- check listening ports.
- `uptime` -- check system uptime and load.
- `docker ps` / `docker logs <container>` -- check container state if Docker is present.

### Write Operations (Require Explicit Approval)

These operations modify host state and require explicit task-level approval:

- `systemctl restart <service>` -- restart a service.
- `systemctl stop/start <service>` -- stop or start a service.
- Editing configuration files.
- Installing or updating packages.
- Modifying firewall rules.
- Deleting files or directories.
- Running database migrations or administrative commands.

If the wave prompt does not explicitly approve write operations on the target host, do not perform them. Record the need as a follow-up.

<!-- CUSTOMIZE: Add your project-specific approved read-only and write commands here. -->

## Customization

<!-- CUSTOMIZE: Override or extend any section above. Common additions:
  - Host inventory: <hostname> -> <purpose> -> <access-pattern>
  - SSH access patterns: key-based, bastion host, SSM Session Manager
  - Sudo policies: which users can sudo, which commands are allowed
  - Log file locations per host
  - Service names per host
  - Approved write operations for specific wave types
-->
