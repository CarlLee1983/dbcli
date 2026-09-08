# Acceptance Criteria

## Happy Path

* [ ] AC-001: <acceptance criterion>

## Business Rules

* [ ] AC-002: <acceptance criterion>

## Failure Cases

* [ ] AC-003: <acceptance criterion>

## Regression Requirements

* [ ] AC-004: <acceptance criterion>

## Acceptance Evidence

Required for `scripts/story-check --ready`. Add exactly one row for every
checkbox AC. `Method` is `test`, `command`, or `human`; every other value is
one exact non-placeholder value in backticks. The checker validates this map
only. Run the declared command or test, and leave contextual judgment to Human
Review.

| AC | Method | Evidence | Fixture / precondition | Expected observation |
| --- | --- | --- | --- | --- |
| `AC-001` | test | `tests/example.sh` | `fixture name` | `expected assertion` |
| `AC-002` | command | `make verify` | `repository checkout` | `exit 0` |
| `AC-003` | human | `review record` | `external invariant` | `review observation` |
| `AC-004` | test | `tests/example.sh` | `regression fixture` | `expected assertion` |

## Security Fixture Matrix

Required when the Story declares `Security sensitive: yes`; otherwise delete
this section. Every cell except the expected result must carry an exact value in
backticks. The expected result is one of `preserve`, `redact`, `reject`, or
`omit`.

| Source field | Payload | Expected result | Persisted locations | Verification |
| --- | --- | --- | --- | --- |
| `field.name` | `literal payload value` | redact | `artifact.field` | `tests/example.sh` |

## Verification Notes

Any Story-specific verification instructions.

Replace placeholders with observable criteria; keep each AC ID unique. Optional
`scripts/story-check --ready <story-directory>` checks minimum content and the
evidence map, not human-approved READY. Criteria may be checked manually or
automatically.

Example (fenced examples do not count as acceptance criteria):

```markdown
* [ ] AC-001: An empty order returns a total of zero cents.
* [ ] AC-002: A negative quantity is rejected with an invalid-quantity error.
```
