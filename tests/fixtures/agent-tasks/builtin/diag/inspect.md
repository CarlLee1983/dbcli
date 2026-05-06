---
name: diag/inspect
description: Nested builtin
engines: [postgres]
tags: [diagnostics]
safety:
  mode: plan-only
steps:
  - type: command
    command: schema users --format json
    risk: readonly
---
