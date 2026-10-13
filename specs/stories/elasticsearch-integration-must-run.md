# Make Elasticsearch integration verification execute

## Goal

The owner explicitly assigned this narrow fix in the current session on
2026-10-13 after reviewing the release 10.0.0 CI coverage gap: fix the
Elasticsearch test's AbortSignal incompatibility and prove that its real
roundtrip executes before release. A green test caused by returning after an
unexpected connection error is not verification.

The baseline is release preparation commit
`bede10783a33d899120455374a79125ae6cd432e`, whose parent is the current main
`3bd041d5e223da4d3df1c956f0f024b808b5e01c`. This separate stacked change keeps
the release preparation's version/document scope distinct from the test fix.

## Out of Scope

- Product adapters or other shipped source, dependencies, lockfile, workflow
  configuration, performance budgets, and unrelated test changes. If the
  diagnosis requires product changes, report the exact reason before proceeding.
- Private databases, credentials, browser login, repository/security settings,
  merging, tagging, publishing, or changing the release version.
- Treating arbitrary errors as service absence, silently returning from an
  enabled test, weakening assertions, or claiming skipped cases executed.

## Acceptance Criteria

1. Identify and reproduce the test-environment web API incompatibility that
   produces `signal is not of type AbortSignal`. Fix it in test infrastructure
   without changing product behavior or leaking incompatible globals between
   tests.
2. With required integration services enabled, unavailable Elasticsearch or any
   unexpected adapter/setup failure makes the test run fail. Optional local
   service absence and an explicit integration-skip request remain deliberate,
   visible skips under the repository's existing policy.
3. When the Elasticsearch service is available, the test actually creates an
   index, inserts and refreshes a document, queries and asserts its content,
   inspects and asserts schema, and cleans up its own index. Success evidence
   cannot be printed until those assertions complete.
4. Deterministic regression tests cover the global-API compatibility, required
   service failure, unexpected error propagation, and deliberate skip behavior.
   These tests use isolated local fixtures and never real private databases.
5. Update the relevant developer testing guidance and release notes to describe
   the corrected verification and its actual limits. No CLI or config behavior
   changes are claimed.
6. Run the repository's canonical `make verify` on the final committed revision.
   If local database services are absent, record that failed gate accurately
   and obtain exact-revision CI evidence with the disposable test services.
   Inspect the CI log to prove the Elasticsearch roundtrip executed rather than
   relying only on a green status or runner pass count.
7. Keep this fix in its own draft PR against the release preparation branch,
   report exact commit/tree and acceptance evidence, list skips and risks, and
   leave human review, merge, tagging and publication to the owner.
