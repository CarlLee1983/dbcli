---
name: sample
description: Local override (final)
tags: [test, local]
safety:
  mode: plan-only
steps:
  - type: command
    command: status --format json
    risk: readonly
---
