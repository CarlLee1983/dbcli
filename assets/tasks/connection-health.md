---
name: connection-health
description: Quick read-only health check of the active connection (reachability, config, capacity signals).
tags: [diagnostics, health, readonly]
engines: [postgres, mysql]
params:
  section:
    type: string
    required: false
    default: health
    description: Which report section to pull.
    enum: [health, capacity, perf]
safety:
  mode: plan-only
  requires:
    - blacklist-list
steps:
  - type: command
    command: status
    reason: Confirm the connection and permission tier resolve without exposing credentials.
    risk: readonly
  - type: command
    command: doctor
    reason: Run environment, config, connection and schema-cache diagnostics.
    risk: readonly
  - type: command
    command: report --section {{section}} --for-agent
    reason: Pull the diagnostic report section for a structured health snapshot.
    risk: readonly
---
# Agent Notes

Use this task as a first-touch triage when a connection "feels" wrong or before a
larger operation — it answers "can I reach the DB, is the config sane, and are there
obvious health/capacity red flags?" entirely read-only. If `doctor` reports a stale
schema cache, refresh it before trusting cached schema. Escalate to
`dbcli guide capacity` or `dbcli report --section perf` for deeper analysis.
