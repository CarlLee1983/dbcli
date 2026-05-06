---
name: sample
description: Shared override
tags: [test, shared]
safety:
  mode: plan-only
steps:
  - type: command
    command: blacklist list
    risk: readonly
  - type: command
    command: status --format json
    risk: readonly
---
