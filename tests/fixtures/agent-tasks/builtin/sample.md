---
name: sample
description: Builtin sample task
tags: [test]
safety:
  mode: plan-only
steps:
  - type: command
    command: blacklist list
    risk: readonly
---
# Notes

Builtin sample.
