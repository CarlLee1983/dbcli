// The build determinism check's decisions, with the two builds left out.
//
// The check spends about two minutes building; what it decides afterwards is
// pure and lives here so that it can be asserted without spending that. Nothing
// in this file imports anything, for the same reason the handoff rules do not:
// what it does is then a property of the file rather than a promise about it.
//
// Why the failure message is this file's business at all: DBCLI-032 removed the
// separate `bun run build` step from the `make verify` roster, because
// `build:determinism` rebuilds the same artifacts twice and overwrites its
// output before anything reads it. That step was also, incidentally, the one
// that made a broken build readable — this check ran its builds with their
// output discarded. Removing it without this would have traded a minute of gate
// time for an unreadable failure.

/**
 * The artifacts whose digests differ between two builds of identical source.
 *
 * A digest that is missing counts as drift. `undefined === undefined` is the
 * shape that turns a build which produced nothing at all into a passing
 * reproducibility check, which is the one answer this must never give.
 */
export function driftedArtifacts(
  artifacts: readonly string[],
  first: ReadonlyMap<string, string>,
  second: ReadonlyMap<string, string>
): string[] {
  return artifacts.filter((artifact) => {
    const before = first.get(artifact)
    const after = second.get(artifact)
    return before === undefined || after === undefined || before !== after
  })
}

/**
 * What to print when one of the two builds fails.
 *
 * Which build matters: a first build that fails is an ordinary broken build,
 * and a second that fails after the first succeeded is a far stranger thing and
 * should not be reported in the same words.
 */
export function buildFailureMessage(label: string, exitCode: number, output: string): string {
  const text = output.trim()
  const body = text.length > 0 ? text : '(the build produced no output)'

  return [
    `✗ the ${label} build failed with exit ${exitCode}, so reproducibility was not checked.`,
    '',
    body,
  ].join('\n')
}
