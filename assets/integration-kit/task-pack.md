---
name: example-read-only-review
description: Minimal Task Pack requirement declaration for an external Skill.
engines: [postgresql, mysql]
safety:
  mode: plan-only
  requires: [schema.read, query.read]
steps:
  - type: command
    command: dbcli blacklist list --format json
    risk: readonly
  - type: command
    command: dbcli schema {{table}} --format json
    risk: readonly
---

This pack only plans commands. `safety.requires` contains capability IDs, not
command names; dbcli validates them before emitting a plan.
